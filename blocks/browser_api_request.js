'use strict';

const requestID = value => {
  const id = String(value ?? '').trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(id)) throw new Error('Browser API Request ID must start with a letter and contain only letters, numbers, underscores, or dashes');
  return id;
};

function containsProtectedSecret(value, seen = new Set()) {
  if (value?.__phidiasSecret) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some(item => containsProtectedSecret(item, seen));
}

function headers(value) {
  if (value == null || value === '') return {};
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error('Browser API Request headers must be a JSON object'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Browser API Request headers must be an object');
  if (containsProtectedSecret(value)) throw new Error('Protected credentials cannot be sent to a user browser');
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [String(name), Array.isArray(item) ? item.map(String).join(', ') : String(item)]));
}

function scriptJSON(value) {
  return JSON.stringify(value).replace(/[<\u2028\u2029]/g, character => ({ '<': '\\u003c', '\u2028': '\\u2028', '\u2029': '\\u2029' })[character]);
}

function browserRequestHTML(configuration) {
  const encodedID = encodeURIComponent(configuration.id);
  return `<span class="phidias-browser-api-request" data-request-id="${configuration.id}" role="status" aria-live="polite" hidden></span>
<script>
(() => {
  const script = document.currentScript;
  const status = script && script.previousElementSibling;
  const configuration = ${scriptJSON(configuration)};
  const callbackURL = "/_phidias/browser-api/${encodedID}";
  const limit = 786432;
  const report = async payload => {
    const reply = await fetch(callbackURL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-phidias-browser-api": configuration.id },
      body: JSON.stringify(payload)
    });
    if (!reply.ok) throw new Error("Application callback failed with HTTP " + reply.status);
    if (status) status.dataset.state = payload.ok ? "complete" : "error";
    document.dispatchEvent(new CustomEvent("phidias:browser-api-reply", { detail: { requestId: configuration.id, ...payload } }));
  };
  const run = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), configuration.timeoutMs);
    try {
      const requestHeaders = { ...configuration.headers };
      let body = configuration.body;
      const hasBody = !["GET", "HEAD"].includes(configuration.method) && body !== null && body !== "";
      if (hasBody && configuration.bodyFormat === "JSON" && typeof body !== "string") body = JSON.stringify(body);
      if (hasBody && configuration.bodyFormat === "JSON" && !Object.keys(requestHeaders).some(name => name.toLowerCase() === "content-type")) requestHeaders["content-type"] = "application/json";
      const response = await fetch(configuration.url, {
        method: configuration.method,
        headers: requestHeaders,
        credentials: configuration.credentials,
        signal: controller.signal,
        ...(hasBody ? { body: String(body) } : {})
      });
      const text = await response.text();
      if (new Blob([text]).size > limit) throw new Error("Supplier response exceeds 768 KiB");
      let bodyValue = text;
      try { bodyValue = JSON.parse(text); } catch {}
      await report({
        ok: response.ok,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: bodyValue,
        error: response.ok ? "" : "Supplier returned HTTP " + response.status
      });
    } catch (error) {
      await report({ ok: false, status: 0, headers: {}, body: null, error: error && error.name === "AbortError" ? "Browser API request timed out" : String(error && error.message || error) });
    } finally {
      clearTimeout(timer);
    }
  };
  if (status) status.dataset.state = "loading";
  run().catch(error => {
    if (status) status.dataset.state = "callback-error";
    console.error("Browser API Request callback failed:", error);
  });
})();
</script>`;
}

module.exports = {
  type: 'browser_api_request',
  name: 'Browser API Request',
  category: 'Internet Stuff',
  description: 'Outputs HTML that requests an API from the user browser, then sends the result to a Browser API Reply block. The supplier must permit the request through CORS.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'request_id', name: 'Request ID', kind: 'value', types: ['text'], required: true },
    { id: 'url', name: 'API URL', kind: 'value', types: ['text'], required: true },
    { id: 'headers', name: 'Headers', kind: 'value', types: ['object', 'text'] },
    { id: 'body', name: 'Body', kind: 'value', types: ['text', 'object', 'list', 'number', 'unspecified'] }
  ],
  fields: [
    { key: 'method', label: 'Method', type: 'select', choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
    { key: 'body_format', label: 'Body format', type: 'select', choices: ['JSON', 'Text'], default: 'JSON' },
    { key: 'credentials', label: 'Browser credentials', type: 'select', choices: ['Omit', 'Include'], default: 'Omit' },
    { key: 'timeout_seconds', label: 'Timeout in seconds', type: 'number', default: 30, min: 1, max: 120 }
  ],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'Browser Request HTML', kind: 'value', types: ['text'] }
  ],
  async execute(ctx, options, inputs, setOutput) {
    const id = requestID(inputs.request_id);
    if (containsProtectedSecret(inputs.url)) throw new Error('Protected credentials cannot be sent to a user browser');
    const url = String(inputs.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('Browser API Request URL must use HTTP or HTTPS');
    if (containsProtectedSecret(inputs.body)) throw new Error('Protected credentials cannot be sent to a user browser');
    const configuration = {
      id,
      url,
      method: options.method,
      headers: headers(inputs.headers),
      body: inputs.body ?? null,
      bodyFormat: options.body_format,
      credentials: options.credentials === 'Include' ? 'include' : 'omit',
      timeoutMs: Number(options.timeout_seconds) * 1000
    };
    setOutput('html', browserRequestHTML(configuration));
    return 'next';
  },
  browserRequestHTML,
  containsProtectedSecret,
  headers,
  requestID
};

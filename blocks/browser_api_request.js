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

function passthrough(value) {
  if (containsProtectedSecret(value)) throw new Error('Protected credentials cannot be sent to a user browser');
  if (typeof value !== 'string' && !Array.isArray(value) && (!value || typeof value !== 'object')) throw new Error('Browser API Request passthrough must be text, a list, or an object');
  let encoded;
  try { encoded = encodeURIComponent(JSON.stringify(value)); }
  catch { throw new Error('Browser API Request passthrough must be JSON-compatible'); }
  if (Buffer.byteLength(encoded) > 3000) throw new Error('Browser API Request passthrough exceeds the 3,000-byte cookie limit');
  return value;
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
  const passthroughCookie = "phidias_browser_api_" + configuration.id;
  const passthroughCookieOptions = "; Path=" + callbackURL + "; SameSite=Strict" + (window.location.protocol === "https:" ? "; Secure" : "");
  const limit = 786432;
  const hasPassthrough = Object.prototype.hasOwnProperty.call(configuration, "passthrough");
  const storePassthrough = () => {
    if (!hasPassthrough) return;
    const encoded = encodeURIComponent(JSON.stringify(configuration.passthrough));
    if (new Blob([encoded]).size > 3000) throw new Error("Browser API Request passthrough exceeds the 3,000-byte cookie limit");
    document.cookie = passthroughCookie + "=" + encoded + passthroughCookieOptions + "; Max-Age=" + Math.ceil(configuration.timeoutMs / 1000 + 60);
  };
  const clearPassthrough = () => {
    if (hasPassthrough) document.cookie = passthroughCookie + "=" + passthroughCookieOptions + "; Max-Age=0";
  };
  const report = async payload => {
    const reply = await fetch(callbackURL, {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      headers: { "content-type": "application/json", "x-phidias-browser-api": configuration.id },
      body: JSON.stringify(payload)
    });
    const redirect = reply.headers.get("x-phidias-redirect");
    const isHTML = (reply.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() === "text/html";
    if (!reply.ok && !isHTML) throw new Error("Application callback failed with HTTP " + reply.status);
    const html = isHTML ? await reply.text() : null;
    if (status) status.dataset.state = payload.ok ? "complete" : "error";
    document.dispatchEvent(new CustomEvent("phidias:browser-api-reply", { detail: { requestId: configuration.id, ...payload } }));
    if (redirect) {
      const target = new URL(redirect, new URL(callbackURL, window.location.href));
      if (!["http:", "https:"].includes(target.protocol)) throw new Error("Application redirect must use HTTP or HTTPS");
      window.location.assign(target.href);
    } else if (html) {
      document.open();
      document.write(html);
      document.close();
      document.dispatchEvent(new CustomEvent("phidias:internal-refresh", {
        detail: { source: "browser-api-reply", requestId: configuration.id }
      }));
    }
  };
  const run = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), configuration.timeoutMs);
    let payload;
    try {
      storePassthrough();
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
      payload = {
        ok: response.ok,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: bodyValue,
        error: response.ok ? "" : "Supplier returned HTTP " + response.status
      };
    } catch (error) {
      payload = { ok: false, status: 0, headers: {}, body: null, error: error && error.name === "AbortError" ? "Browser API request timed out" : String(error && error.message || error) };
    } finally {
      clearTimeout(timer);
    }
    try { await report(payload); }
    finally { clearPassthrough(); }
  };
  if (status) status.dataset.state = "loading";
  return run().catch(error => {
    if (status) status.dataset.state = "callback-error";
    console.error("Browser API Request callback failed:", error);
  });
})();
</script>`;
}

function browserBatchRequestHTML(configuration) {
  const encodedID = encodeURIComponent(configuration.id);
  return `<span class="phidias-browser-api-request" data-request-id="${configuration.id}" role="status" aria-live="polite" hidden></span>
<script>
(() => {
  const script = document.currentScript;
  const status = script && script.previousElementSibling;
  const configuration = ${scriptJSON(configuration)};
  const callbackURL = "/_phidias/browser-api/${encodedID}";
  const passthroughCookie = "phidias_browser_api_" + configuration.id;
  const passthroughCookieOptions = "; Path=" + callbackURL + "; SameSite=Strict" + (window.location.protocol === "https:" ? "; Secure" : "");
  const responseLimit = Math.floor(737280 / configuration.requests.length);
  const hasPassthrough = Object.prototype.hasOwnProperty.call(configuration, "passthrough");
  const storePassthrough = () => {
    if (!hasPassthrough) return;
    const encoded = encodeURIComponent(JSON.stringify(configuration.passthrough));
    if (new Blob([encoded]).size > 3000) throw new Error("Browser API Request passthrough exceeds the 3,000-byte cookie limit");
    document.cookie = passthroughCookie + "=" + encoded + passthroughCookieOptions + "; Max-Age=" + Math.ceil(configuration.timeoutMs / 1000 + 60);
  };
  const clearPassthrough = () => {
    if (hasPassthrough) document.cookie = passthroughCookie + "=" + passthroughCookieOptions + "; Max-Age=0";
  };
  const requestOne = async request => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), configuration.timeoutMs);
    try {
      const requestHeaders = { ...request.headers };
      let body = request.body;
      const hasBody = !["GET", "HEAD"].includes(request.method) && body !== null && body !== "";
      if (hasBody && request.bodyFormat === "JSON" && typeof body !== "string") body = JSON.stringify(body);
      if (hasBody && request.bodyFormat === "JSON" && !Object.keys(requestHeaders).some(name => name.toLowerCase() === "content-type")) requestHeaders["content-type"] = "application/json";
      const response = await fetch(request.url, {
        method: request.method,
        headers: requestHeaders,
        credentials: request.credentials,
        signal: controller.signal,
        ...(hasBody ? { body: String(body) } : {})
      });
      const text = await response.text();
      if (new Blob([text]).size > responseLimit) throw new Error("Supplier response is too large for a batched browser request");
      let bodyValue = text;
      try { bodyValue = JSON.parse(text); } catch {}
      return {
        ok: response.ok,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: bodyValue,
        error: response.ok ? "" : "Supplier returned HTTP " + response.status
      };
    } catch (error) {
      return { ok: false, status: 0, headers: {}, body: null, error: error && error.name === "AbortError" ? "Browser API request timed out" : String(error && error.message || error) };
    } finally {
      clearTimeout(timer);
    }
  };
  const report = async payload => {
    const reply = await fetch(callbackURL, {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      headers: { "content-type": "application/json", "x-phidias-browser-api": configuration.id },
      body: JSON.stringify(payload)
    });
    const redirect = reply.headers.get("x-phidias-redirect");
    const isHTML = (reply.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() === "text/html";
    if (!reply.ok && !isHTML) throw new Error("Application callback failed with HTTP " + reply.status);
    const html = isHTML ? await reply.text() : null;
    if (status) status.dataset.state = payload.ok ? "complete" : "error";
    document.dispatchEvent(new CustomEvent("phidias:browser-api-reply", { detail: { requestId: configuration.id, ...payload } }));
    if (redirect) {
      const target = new URL(redirect, new URL(callbackURL, window.location.href));
      if (!["http:", "https:"].includes(target.protocol)) throw new Error("Application redirect must use HTTP or HTTPS");
      window.location.assign(target.href);
    } else if (html) {
      document.open();
      document.write(html);
      document.close();
      document.dispatchEvent(new CustomEvent("phidias:internal-refresh", { detail: { source: "browser-api-reply", requestId: configuration.id } }));
    }
  };
  const run = async () => {
    try {
      storePassthrough();
      const results = await Promise.all(configuration.requests.map(requestOne));
      const failures = results.filter(result => !result.ok);
      await report({
        batch: true,
        ok: failures.length === 0,
        results,
        error: failures.map((result, index) => "Request " + (results.indexOf(result) + 1) + ": " + result.error).join("; ")
      });
    } finally {
      clearPassthrough();
    }
  };
  if (status) status.dataset.state = "loading";
  return run().catch(error => {
    if (status) status.dataset.state = "callback-error";
    console.error("Browser API Request callback failed:", error);
  });
})();
</script>`;
}

function createBatchDefinition(count) {
  if (![2, 3].includes(count)) throw new Error('Browser API Request batch size must be 2 or 3');
  const inputPorts = [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'request_id', name: 'Request ID', kind: 'value', types: ['text'], required: true }
  ];
  const fields = [];
  for (let index = 1; index <= count; index++) {
    inputPorts.push(
      { id: `url${index}`, name: `URL ${index}`, kind: 'value', types: ['text'], required: true },
      { id: `headers${index}`, name: `Headers ${index}`, kind: 'value', types: ['object', 'text'] },
      { id: `body${index}`, name: `Body ${index}`, kind: 'value', types: ['text', 'object', 'list', 'number', 'unspecified'] }
    );
    fields.push(
      { key: `method${index}`, label: `Method ${index}`, type: 'select', choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
      { key: `body_format${index}`, label: `Body format ${index}`, type: 'select', choices: ['JSON', 'Text'], default: 'JSON' },
      { key: `credentials${index}`, label: `Browser credentials ${index}`, type: 'select', choices: ['Omit', 'Include'], default: 'Omit' }
    );
  }
  inputPorts.push({ id: 'passthrough', name: 'Value Passthrough', kind: 'value', types: ['text', 'object', 'list'] });
  fields.push({ key: 'timeout_seconds', label: 'Timeout in seconds', type: 'number', default: 30, min: 1, max: 120 });
  return {
    type: `browser_api_request_${count}x`,
    name: `Browser API Request ${count}x`,
    category: 'Internet Stuff',
    description: `Runs ${count} browser API requests in parallel and sends all results to a matching Browser API Reply ${count}x block.`,
    inputPorts,
    fields,
    outputs: ['next'],
    outputPorts: [
      { id: 'next', name: 'Action', kind: 'action', types: [] },
      { id: 'html', name: 'Browser Request HTML', kind: 'value', types: ['html', 'text'] }
    ],
    async execute(_ctx, options, inputs, setOutput) {
      const id = requestID(inputs.request_id);
      const requests = [];
      for (let index = 1; index <= count; index++) {
        if (containsProtectedSecret(inputs[`url${index}`])) throw new Error('Protected credentials cannot be sent to a user browser');
        const url = String(inputs[`url${index}`] ?? '').trim();
        if (!/^https?:\/\//i.test(url)) throw new Error(`Browser API Request URL ${index} must use HTTP or HTTPS`);
        if (containsProtectedSecret(inputs[`body${index}`])) throw new Error('Protected credentials cannot be sent to a user browser');
        requests.push({
          url,
          method: options[`method${index}`],
          headers: headers(inputs[`headers${index}`]),
          body: inputs[`body${index}`] ?? null,
          bodyFormat: options[`body_format${index}`],
          credentials: options[`credentials${index}`] === 'Include' ? 'include' : 'omit'
        });
      }
      const configuration = { id, requests, timeoutMs: Number(options.timeout_seconds) * 1000 };
      if (Object.hasOwn(inputs, 'passthrough') && inputs.passthrough !== undefined) configuration.passthrough = passthrough(inputs.passthrough);
      setOutput('html', browserBatchRequestHTML(configuration));
      return 'next';
    }
  };
}

module.exports = {
  type: 'browser_api_request',
  name: 'Browser API Request',
  category: 'Internet Stuff',
  description: 'Outputs HTML that requests an API from the user browser, then sends the result to a Browser API Reply block. Value Passthrough temporarily carries text, lists, or objects in an ID-scoped browser cookie. The supplier must permit the request through CORS.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'request_id', name: 'Request ID', kind: 'value', types: ['text'], required: true },
    { id: 'url', name: 'API URL', kind: 'value', types: ['text'], required: true },
    { id: 'headers', name: 'Headers', kind: 'value', types: ['object', 'text'] },
    { id: 'body', name: 'Body', kind: 'value', types: ['text', 'object', 'list', 'number', 'unspecified'] },
    { id: 'passthrough', name: 'Value Passthrough', kind: 'value', types: ['text', 'object', 'list'] }
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
    if (Object.hasOwn(inputs, 'passthrough') && inputs.passthrough !== undefined) configuration.passthrough = passthrough(inputs.passthrough);
    setOutput('html', browserRequestHTML(configuration));
    return 'next';
  },
  browserRequestHTML,
  browserBatchRequestHTML,
  createBatchDefinition,
  containsProtectedSecret,
  headers,
  passthrough,
  requestID
};

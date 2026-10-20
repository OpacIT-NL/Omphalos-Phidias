'use strict';

const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

function consoleHTML({ token, title, height, maxLines }) {
  const streamURL = `/_phidias/application-console/${encodeURIComponent(token)}`;
  return `<section class="phidias-application-console" data-console-token="${escapeHTML(token)}" style="--phidias-console-height:${height}px">
  <header class="phidias-application-console__header">
    <strong>${escapeHTML(title)}</strong>
    <span class="phidias-application-console__status" aria-live="polite">Connecting</span>
    <button class="phidias-application-console__clear" type="button">Clear</button>
  </header>
  <div class="phidias-application-console__output" role="log" aria-live="polite" aria-relevant="additions text"></div>
</section>
<style>
.phidias-application-console{overflow:hidden;border:1px solid #343a44;border-radius:5px;background:#101318;color:#d8dde4;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}
.phidias-application-console__header{display:flex;align-items:center;gap:12px;min-height:42px;padding:7px 11px;border-bottom:1px solid #343a44;background:#20242b;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
.phidias-application-console__header strong{margin-right:auto;color:#edf0f4;font-size:12px}
.phidias-application-console__status{color:#9ca5b2;font-size:10px}
.phidias-application-console__status[data-state="connected"]{color:#55c596}
.phidias-application-console__status[data-state="error"]{color:#e8ad60}
.phidias-application-console__clear{border:1px solid #434b57;border-radius:4px;padding:4px 8px;background:#252a32;color:#edf0f4;font:600 11px/1.2 Inter,ui-sans-serif,system-ui,sans-serif;cursor:pointer}
.phidias-application-console__output{height:var(--phidias-console-height);overflow:auto;padding:9px 11px;white-space:pre-wrap;overflow-wrap:anywhere}
.phidias-application-console__line{padding:1px 0;color:#d8dde4}
.phidias-application-console__line--debug{color:#737d8a}
.phidias-application-console__line--warning{color:#e8ad60}
.phidias-application-console__line--error,.phidias-application-console__line--critical{color:#dd6b72}
</style>
<script>
(() => {
  const script = document.currentScript;
  const style = script && script.previousElementSibling;
  const panel = style && style.previousElementSibling;
  if (!panel || !panel.classList.contains("phidias-application-console")) return;
  const output = panel.querySelector(".phidias-application-console__output");
  const status = panel.querySelector(".phidias-application-console__status");
  const clear = panel.querySelector(".phidias-application-console__clear");
  const maximum = ${maxLines};
  clear.addEventListener("click", () => output.replaceChildren());
  const source = new EventSource(${JSON.stringify(streamURL)});
  source.addEventListener("open", () => { status.textContent = "Live"; status.dataset.state = "connected"; });
  source.addEventListener("error", () => { status.textContent = "Reconnecting"; status.dataset.state = "error"; });
  source.addEventListener("log", event => {
    let entry;
    try { entry = JSON.parse(event.data); } catch { return; }
    const line = document.createElement("div");
    const level = /^(critical|error|warning|info|debug)$/.test(entry.level) ? entry.level : "info";
    line.className = "phidias-application-console__line phidias-application-console__line--" + level;
    line.textContent = String(entry.line ?? "");
    output.append(line);
    while (output.childElementCount > maximum) output.firstElementChild.remove();
    output.scrollTop = output.scrollHeight;
  });
  window.addEventListener("pagehide", () => source.close(), { once: true });
})();
</script>`;
}

module.exports = {
  type: 'application_console_passthrough',
  name: 'Application Console Passthrough',
  category: 'Internet Stuff',
  description: 'Outputs a live, read-only application console for an HTML page. Console output may contain sensitive operational information, so place it only on an authenticated administrator page.',
  requiresHttpContext: true,
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  fields: [
    { key: 'title', label: 'Title', type: 'text', default: 'Application Console' },
    { key: 'height', label: 'Height in pixels', type: 'number', default: 360, min: 120, max: 1200 },
    { key: 'max_lines', label: 'Maximum visible lines', type: 'number', default: 250, min: 10, max: 2000 }
  ],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'Console HTML', kind: 'value', types: ['text'] }
  ],
  async execute(ctx, options, _inputs, setOutput) {
    if (typeof ctx.createConsolePassthrough !== 'function') throw new Error('Application Console Passthrough requires an HTTP endpoint in the application runtime');
    const height = Math.max(120, Math.min(1200, Number(options.height) || 360));
    const maxLines = Math.max(10, Math.min(2000, Number(options.max_lines) || 250));
    const token = ctx.createConsolePassthrough();
    setOutput('html', consoleHTML({ token, title: options.title || 'Application Console', height, maxLines }));
    return 'next';
  },
  consoleHTML
};

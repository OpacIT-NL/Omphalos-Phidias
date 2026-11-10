'use strict';

const TEXT_SIZES = Object.freeze([100, 110, 125, 150, 175, 200]);
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const RUNTIME_MARKER = 'data-phidias-accessibility-runtime';

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function accessibilitySettingsHTML(options = {}) {
  const title = escapeHTML(options.panel_title || 'Accessibility settings');
  const sizes = TEXT_SIZES.map(size => `<option value="${size}"${size === 100 ? ' selected' : ''}>${size}%</option>`).join('');

  return `<section class="phidias-accessibility-settings" data-phidias-accessibility-settings aria-label="${title}">
  <header class="phidias-accessibility-settings__header">
    <h2>${title}</h2>
    <p>Adjust how this application is displayed.</p>
  </header>
  <div class="phidias-accessibility-settings__body">
    <fieldset class="phidias-accessibility-settings__group">
      <legend>Color theme</legend>
      <label><input type="radio" name="phidias-accessibility-theme" value="dark"> <span>Dark</span></label>
      <label><input type="radio" name="phidias-accessibility-theme" value="light"> <span>Light</span></label>
    </fieldset>
    <label class="phidias-accessibility-settings__field">
      <span>Text size</span>
      <select data-phidias-text-size>${sizes}</select>
    </label>
    <label class="phidias-accessibility-settings__toggle">
      <input type="checkbox" data-phidias-high-contrast>
      <span>Increase contrast</span>
    </label>
    <p class="phidias-accessibility-settings__hint">Changes are saved on this device.</p>
    <p class="phidias-accessibility-settings__status" role="status" aria-live="polite"></p>
  </div>
  <footer class="phidias-accessibility-settings__actions">
    <button class="phidias-accessibility-settings__save" type="button">Save settings</button>
    <button class="phidias-accessibility-settings__reset" type="button">Reset settings</button>
  </footer>
</section>`;
}

function accessibilityRuntimeHTML() {
  return `<style ${RUNTIME_MARKER}>
html[data-phidias-accessibility-ready]{--phidias-theme-filter:brightness(1);--phidias-contrast-filter:contrast(1);--phidias-high-contrast-bg:#000;--phidias-high-contrast-text:#fff;--phidias-high-contrast-link:#66e0ff;filter:var(--phidias-theme-filter) var(--phidias-contrast-filter);color-scheme:dark}
html[data-phidias-theme="dark"]{color-scheme:dark}
html[data-phidias-theme="light"]{--phidias-theme-filter:var(--phidias-light-theme-filter,invert(1) hue-rotate(180deg));color-scheme:light;background:#f5f5f5}
html[data-phidias-contrast="high"]{--phidias-contrast-filter:contrast(1.35) saturate(1.08)}
html[data-phidias-accessibility-ready] body{min-width:0;zoom:var(--phidias-text-scale,1)}
html[data-phidias-theme="light"] :is(img,video,canvas,iframe,embed,object,[data-phidias-preserve-colors]){filter:var(--phidias-light-media-filter,invert(1) hue-rotate(180deg))}
html[data-phidias-accessibility-ready] :is(img,picture,video,canvas,svg){max-width:100%;height:auto}
html[data-phidias-accessibility-ready] :focus-visible{outline:3px solid CanvasText!important;outline-offset:3px!important;box-shadow:0 0 0 5px Canvas!important}
html[data-phidias-contrast="high"] body,html[data-phidias-contrast="high"] body :where(div,section,article,aside,header,footer,nav,main,form,fieldset,dialog,table,thead,tbody,tfoot,tr,th,td,input,select,textarea,button){border-color:var(--phidias-high-contrast-text)!important;background-color:var(--phidias-high-contrast-bg)!important;color:var(--phidias-high-contrast-text)!important;text-shadow:none!important}
html[data-phidias-contrast="high"] body a{color:var(--phidias-high-contrast-link)!important;text-decoration:underline!important;text-decoration-thickness:.12em!important;text-underline-offset:.18em!important}
.phidias-accessibility-settings,.phidias-accessibility-settings *{box-sizing:border-box}
.phidias-accessibility-settings{--phidias-settings-bg:#151922;--phidias-settings-raised:#202631;--phidias-settings-border:#718096;--phidias-settings-text:#f5f7fa;--phidias-settings-muted:#cbd5e1;--phidias-settings-status:#a5f3fc;width:min(560px,100%);overflow:hidden;border:2px solid var(--phidias-settings-border);border-radius:12px;background:var(--phidias-settings-bg);color:var(--phidias-settings-text);font:400 16px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 30px rgb(0 0 0 / 24%)}
html[data-phidias-theme="light"] .phidias-accessibility-settings{--phidias-settings-bg:#fff;--phidias-settings-raised:#edf1f4;--phidias-settings-border:#647482;--phidias-settings-text:#17212b;--phidias-settings-muted:#465563;--phidias-settings-status:#174f66}
.phidias-accessibility-settings button,.phidias-accessibility-settings select,.phidias-accessibility-settings input{font:inherit}
.phidias-accessibility-settings button,.phidias-accessibility-settings select{min-height:44px;border:2px solid var(--phidias-settings-border);border-radius:7px;background:var(--phidias-settings-raised);color:var(--phidias-settings-text)}
.phidias-accessibility-settings button{padding:8px 14px;font-weight:700;cursor:pointer}
.phidias-accessibility-settings button:hover{filter:brightness(1.12)}
.phidias-accessibility-settings__header{padding:18px;border-bottom:1px solid var(--phidias-settings-border)}
.phidias-accessibility-settings__header h2{margin:0;font-size:1.2rem;line-height:1.3}
.phidias-accessibility-settings__header p{margin:4px 0 0;color:var(--phidias-settings-muted);font-size:.875rem}
.phidias-accessibility-settings__body{display:grid;gap:18px;padding:18px}
.phidias-accessibility-settings__group{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0;border:0;padding:0}
.phidias-accessibility-settings__group legend,.phidias-accessibility-settings__field>span{grid-column:1/-1;margin:0 0 7px;color:var(--phidias-settings-text);font-weight:700}
.phidias-accessibility-settings__group label,.phidias-accessibility-settings__toggle{min-height:44px;display:flex;align-items:center;gap:9px;border:1px solid var(--phidias-settings-border);border-radius:7px;padding:8px 10px;background:var(--phidias-settings-raised);cursor:pointer}
.phidias-accessibility-settings input{width:20px;height:20px;margin:0;accent-color:#0891b2}
.phidias-accessibility-settings__field{display:grid}
.phidias-accessibility-settings__field select{width:100%;padding:7px 10px}
.phidias-accessibility-settings__hint,.phidias-accessibility-settings__status{min-height:1.5em;margin:0;color:var(--phidias-settings-muted);font-size:.875rem}
.phidias-accessibility-settings__status{color:var(--phidias-settings-status)}
.phidias-accessibility-settings__actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px;padding:14px 18px;border-top:1px solid var(--phidias-settings-border)}
.phidias-accessibility-settings__save{background:#176b80!important;border-color:#67e8f9!important;color:#fff!important}
@media(max-width:480px){.phidias-accessibility-settings__group{grid-template-columns:1fr}.phidias-accessibility-settings__actions{flex-direction:column}.phidias-accessibility-settings__actions button{width:100%}}
@media(prefers-reduced-motion:reduce){.phidias-accessibility-settings *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
@media(forced-colors:active){.phidias-accessibility-settings,.phidias-accessibility-settings button,.phidias-accessibility-settings select,.phidias-accessibility-settings__group label,.phidias-accessibility-settings__toggle{forced-color-adjust:auto}}
</style>
<script ${RUNTIME_MARKER}>
(() => {
  if (window.__phidiasAccessibilitySettings &&
      window.__phidiasAccessibilitySettings.page === document.documentElement &&
      typeof window.__phidiasAccessibilitySettings.bind === "function") {
    window.__phidiasAccessibilitySettings.bind(document);
    window.__phidiasAccessibilitySettings.apply();
    return;
  }

  const cookieNames = { theme: "phidias_accessibility_theme", textSize: "phidias_accessibility_text_size", contrast: "phidias_accessibility_contrast" };
  const allowedSizes = ${JSON.stringify(TEXT_SIZES)};
  const roots = new Set();
  const statusTimers = new WeakMap();
  const readCookie = name => {
    const prefix = encodeURIComponent(name) + "=";
    const part = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith(prefix));
    if (!part) return "";
    try { return decodeURIComponent(part.slice(prefix.length)); } catch { return ""; }
  };
  const readLocal = name => {
    try { return window.localStorage.getItem(name) || ""; } catch { return ""; }
  };
  const writeCookie = (name, value) => {
    let cookie = encodeURIComponent(name) + "=" + encodeURIComponent(value) + "; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax";
    if (location.protocol === "https:") cookie += "; Secure";
    document.cookie = cookie;
  };
  const writeLocal = (name, value) => {
    try { window.localStorage.setItem(name, String(value)); } catch {}
  };
  const readPreference = name => readCookie(name) || readLocal(name);
  const writePreference = (name, value) => {
    writeCookie(name, value);
    writeLocal(name, value);
  };
  const normalize = values => ({
    theme: values.theme === "light" ? "light" : "dark",
    textSize: allowedSizes.includes(Number(values.textSize)) ? Number(values.textSize) : 100,
    contrast: values.contrast === "high" ? "high" : "normal"
  });
  let settings = normalize({ theme: readPreference(cookieNames.theme), textSize: readPreference(cookieNames.textSize), contrast: readPreference(cookieNames.contrast) });
  const page = document.documentElement;

  const syncRoot = root => {
    for (const input of root.querySelectorAll('input[name="phidias-accessibility-theme"]')) input.checked = input.value === settings.theme;
    const textSize = root.querySelector("[data-phidias-text-size]");
    const contrast = root.querySelector("[data-phidias-high-contrast]");
    if (textSize) textSize.value = String(settings.textSize);
    if (contrast) contrast.checked = settings.contrast === "high";
  };
  const announce = root => {
    const status = root && root.querySelector(".phidias-accessibility-settings__status");
    if (!status) return;
    window.clearTimeout(statusTimers.get(root));
    status.textContent = "Accessibility settings saved.";
    statusTimers.set(root, window.setTimeout(() => { status.textContent = ""; }, 2200));
  };
  const applySettings = (save, announcingRoot) => {
    settings = normalize(settings);
    page.dataset.phidiasAccessibilityReady = "true";
    page.dataset.phidiasTheme = settings.theme;
    page.dataset.phidiasTextSize = String(settings.textSize);
    page.dataset.phidiasContrast = settings.contrast;
    page.style.setProperty("--phidias-text-scale", String(settings.textSize / 100));
    if (save) {
      writePreference(cookieNames.theme, settings.theme);
      writePreference(cookieNames.textSize, String(settings.textSize));
      writePreference(cookieNames.contrast, settings.contrast);
    }
    for (const root of roots) syncRoot(root);
    if (announcingRoot) announce(announcingRoot);
    window.dispatchEvent(new CustomEvent("phidias:accessibility-change", { detail: { ...settings } }));
  };
  const bindRoot = root => {
    if (root.dataset.phidiasAccessibilityBound === "true") return;
    root.dataset.phidiasAccessibilityBound = "true";
    roots.add(root);
    for (const input of root.querySelectorAll('input[name="phidias-accessibility-theme"]')) {
      input.addEventListener("change", () => { if (input.checked) { settings.theme = input.value; applySettings(false, null); } });
    }
    const textSize = root.querySelector("[data-phidias-text-size]");
    const contrast = root.querySelector("[data-phidias-high-contrast]");
    const save = root.querySelector(".phidias-accessibility-settings__save");
    const reset = root.querySelector(".phidias-accessibility-settings__reset");
    if (textSize) textSize.addEventListener("change", () => { settings.textSize = Number(textSize.value); applySettings(false, null); });
    if (contrast) contrast.addEventListener("change", () => { settings.contrast = contrast.checked ? "high" : "normal"; applySettings(false, null); });
    if (save) save.addEventListener("click", () => applySettings(true, root));
    if (reset) reset.addEventListener("click", () => { settings = { theme: "dark", textSize: 100, contrast: "normal" }; applySettings(true, root); });
    syncRoot(root);
  };
  const bind = scope => {
    if (scope.matches && scope.matches("[data-phidias-accessibility-settings]")) bindRoot(scope);
    for (const root of scope.querySelectorAll("[data-phidias-accessibility-settings]")) bindRoot(root);
  };

  const refresh = () => {
    applySettings(false, null);
    bind(document);
  };
  window.__phidiasAccessibilitySettings = { page, bind, apply: () => applySettings(false, null), refresh };
  applySettings(false, null);
  bind(document);
  document.addEventListener("phidias:internal-refresh", refresh);
})();
</script>`;
}

module.exports = {
  type: 'show_accessibility_settings',
  name: 'Show Accessibility Settings',
  category: 'HTML',
  description: 'Outputs a plain, always-visible HTML section for choosing color theme, text size, and contrast. Pass the completed page through Use Accessibility Settings to activate and save the controls.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  fields: [{ key: 'panel_title', label: 'Title', type: 'text', default: 'Accessibility settings' }],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'Accessibility Settings HTML', kind: 'value', types: ['html', 'text'] }
  ],
  async execute(_ctx, options, _inputs, setOutput) {
    setOutput('html', accessibilitySettingsHTML(options));
    return 'next';
  },
  accessibilityHTML: accessibilitySettingsHTML,
  accessibilitySettingsHTML,
  accessibilityRuntimeHTML,
  TEXT_SIZES,
  COOKIE_MAX_AGE,
  RUNTIME_MARKER
};

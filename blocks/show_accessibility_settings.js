'use strict';

const TEXT_SIZES = Object.freeze([100, 110, 125, 150, 175, 200]);
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function accessibilityHTML(options = {}) {
  const buttonLabel = escapeHTML(options.button_label || 'Accessibility');
  const panelTitle = escapeHTML(options.panel_title || 'Accessibility settings');
  const sizes = TEXT_SIZES.map(size => `<option value="${size}"${size === 100 ? ' selected' : ''}>${size}%</option>`).join('');

  return `<aside class="phidias-accessibility" data-phidias-accessibility>
  <button class="phidias-accessibility__open" type="button" aria-haspopup="dialog">${buttonLabel}</button>
  <dialog class="phidias-accessibility__dialog" aria-label="${panelTitle}">
    <div class="phidias-accessibility__header">
      <h2>${panelTitle}</h2>
      <button class="phidias-accessibility__close" type="button" aria-label="Close accessibility settings">&#215;</button>
    </div>
    <div class="phidias-accessibility__body">
      <fieldset class="phidias-accessibility__group">
        <legend>Color theme</legend>
        <label><input type="radio" name="phidias-accessibility-theme" value="dark"> <span>Dark</span></label>
        <label><input type="radio" name="phidias-accessibility-theme" value="light"> <span>Light</span></label>
      </fieldset>
      <label class="phidias-accessibility__field">
        <span>Text size</span>
        <select data-phidias-text-size>${sizes}</select>
      </label>
      <label class="phidias-accessibility__toggle">
        <input type="checkbox" data-phidias-high-contrast>
        <span>Increase contrast</span>
      </label>
      <p class="phidias-accessibility__hint">Changes are saved on this device.</p>
      <p class="phidias-accessibility__status" role="status" aria-live="polite"></p>
    </div>
    <div class="phidias-accessibility__actions">
      <button class="phidias-accessibility__reset" type="button">Reset settings</button>
      <button class="phidias-accessibility__done" type="button">Done</button>
    </div>
  </dialog>
</aside>
<style data-phidias-accessibility-style>
html[data-phidias-accessibility-ready]{--phidias-theme-filter:none;--phidias-contrast-filter:none;filter:var(--phidias-theme-filter) var(--phidias-contrast-filter);color-scheme:dark}
html[data-phidias-theme="dark"]{color-scheme:dark}
html[data-phidias-theme="light"]{--phidias-theme-filter:invert(1) hue-rotate(180deg);color-scheme:light;background:#f5f5f5}
html[data-phidias-contrast="high"]{--phidias-contrast-filter:contrast(1.35) saturate(1.08)}
html[data-phidias-accessibility-ready] body{min-width:0;zoom:var(--phidias-text-scale,1)}
html[data-phidias-theme="light"] :is(img,video,canvas,iframe,embed,object,[data-phidias-preserve-colors]){filter:invert(1) hue-rotate(180deg)}
html[data-phidias-accessibility-ready] :is(img,picture,video,canvas,svg){max-width:100%;height:auto}
html[data-phidias-accessibility-ready] :focus-visible{outline:3px solid CanvasText!important;outline-offset:3px!important;box-shadow:0 0 0 5px Canvas!important}
html[data-phidias-contrast="high"] body,html[data-phidias-contrast="high"] body :where(div,section,article,aside,header,footer,nav,main,form,fieldset,dialog,table,thead,tbody,tfoot,tr,th,td,input,select,textarea,button){border-color:#fff!important;background-color:#000!important;color:#fff!important;text-shadow:none!important}
html[data-phidias-contrast="high"] body a{color:#ff0!important;text-decoration:underline!important;text-decoration-thickness:.12em!important;text-underline-offset:.18em!important}
.phidias-accessibility,.phidias-accessibility *{box-sizing:border-box}
.phidias-accessibility{position:fixed;z-index:2147483000;right:18px;bottom:18px;font:400 16px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f5f7fa}
.phidias-accessibility button,.phidias-accessibility select,.phidias-accessibility input{font:inherit}
.phidias-accessibility button,.phidias-accessibility select{min-height:44px;border:2px solid #718096;border-radius:7px;background:#202631;color:#f5f7fa}
.phidias-accessibility button{padding:8px 14px;font-weight:700;cursor:pointer}
.phidias-accessibility button:hover{background:#303a49}
.phidias-accessibility :focus-visible{outline:3px solid #67e8f9;outline-offset:3px}
.phidias-accessibility__open{box-shadow:0 6px 24px rgb(0 0 0 / 35%)}
.phidias-accessibility__dialog{width:min(390px,calc(100vw - 24px));max-height:min(680px,calc(100vh - 24px));margin:auto;overflow:auto;border:2px solid #718096;border-radius:12px;padding:0;background:#151922;color:#f5f7fa;box-shadow:0 20px 60px rgb(0 0 0 / 55%)}
.phidias-accessibility__dialog::backdrop{background:rgb(0 0 0 / 72%)}
.phidias-accessibility__header{display:flex;align-items:center;gap:16px;padding:16px 18px;border-bottom:1px solid #596578}
.phidias-accessibility__header h2{min-width:0;margin:0 auto 0 0;font-size:1.2rem;line-height:1.3}
.phidias-accessibility__close{width:44px;padding:0;font-size:1.5rem;line-height:1}
.phidias-accessibility__body{display:grid;gap:18px;padding:18px}
.phidias-accessibility__group{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0;border:0;padding:0}
.phidias-accessibility__group legend,.phidias-accessibility__field>span{grid-column:1/-1;margin:0 0 7px;color:#f5f7fa;font-weight:700}
.phidias-accessibility__group label,.phidias-accessibility__toggle{min-height:44px;display:flex;align-items:center;gap:9px;border:1px solid #718096;border-radius:7px;padding:8px 10px;background:#202631;cursor:pointer}
.phidias-accessibility input{width:20px;height:20px;margin:0;accent-color:#22d3ee}
.phidias-accessibility__field{display:grid}
.phidias-accessibility__field select{width:100%;padding:7px 10px}
.phidias-accessibility__hint,.phidias-accessibility__status{min-height:1.5em;margin:0;color:#cbd5e1;font-size:.875rem}
.phidias-accessibility__status{color:#a5f3fc}
.phidias-accessibility__actions{display:flex;justify-content:flex-end;gap:10px;padding:14px 18px;border-top:1px solid #596578}
.phidias-accessibility__done{border-color:#22d3ee!important;background:#155e75!important}
@media(max-width:480px){.phidias-accessibility{right:10px;bottom:10px}.phidias-accessibility__actions{align-items:stretch;flex-direction:column}.phidias-accessibility__actions button{width:100%}}
@media(prefers-reduced-motion:reduce){.phidias-accessibility *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
@media(forced-colors:active){.phidias-accessibility__dialog,.phidias-accessibility button,.phidias-accessibility select,.phidias-accessibility__group label,.phidias-accessibility__toggle{forced-color-adjust:auto}}
</style>
<script>
(() => {
  const script = document.currentScript;
  const style = script && script.previousElementSibling;
  const root = style && style.previousElementSibling;
  if (!root || !root.matches("[data-phidias-accessibility]")) return;
  if (window.__phidiasAccessibilitySettings) { root.remove(); style.remove(); return; }
  window.__phidiasAccessibilitySettings = true;

  const cookieNames = { theme: "phidias_accessibility_theme", textSize: "phidias_accessibility_text_size", contrast: "phidias_accessibility_contrast" };
  const allowedSizes = ${JSON.stringify(TEXT_SIZES)};
  const readCookie = name => {
    const prefix = encodeURIComponent(name) + "=";
    const part = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith(prefix));
    if (!part) return "";
    try { return decodeURIComponent(part.slice(prefix.length)); } catch { return ""; }
  };
  const writeCookie = (name, value) => {
    let cookie = encodeURIComponent(name) + "=" + encodeURIComponent(value) + "; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax";
    if (location.protocol === "https:") cookie += "; Secure";
    document.cookie = cookie;
  };
  const normalize = values => ({
    theme: values.theme === "light" ? "light" : "dark",
    textSize: allowedSizes.includes(Number(values.textSize)) ? Number(values.textSize) : 100,
    contrast: values.contrast === "high" ? "high" : "normal"
  });
  let settings = normalize({ theme: readCookie(cookieNames.theme), textSize: readCookie(cookieNames.textSize), contrast: readCookie(cookieNames.contrast) });
  const page = document.documentElement;
  const status = root.querySelector(".phidias-accessibility__status");
  const dialog = root.querySelector("dialog");
  const openButton = root.querySelector(".phidias-accessibility__open");
  const closeButton = root.querySelector(".phidias-accessibility__close");
  const doneButton = root.querySelector(".phidias-accessibility__done");
  const resetButton = root.querySelector(".phidias-accessibility__reset");
  const textSize = root.querySelector("[data-phidias-text-size]");
  const contrast = root.querySelector("[data-phidias-high-contrast]");
  const themeInputs = Array.from(root.querySelectorAll('input[name="phidias-accessibility-theme"]'));
  let statusTimer;

  const syncControls = () => {
    for (const input of themeInputs) input.checked = input.value === settings.theme;
    textSize.value = String(settings.textSize);
    contrast.checked = settings.contrast === "high";
  };
  const applySettings = (save, announce) => {
    settings = normalize(settings);
    page.dataset.phidiasAccessibilityReady = "true";
    page.dataset.phidiasTheme = settings.theme;
    page.dataset.phidiasTextSize = String(settings.textSize);
    page.dataset.phidiasContrast = settings.contrast;
    page.style.setProperty("--phidias-text-scale", String(settings.textSize / 100));
    if (save) {
      writeCookie(cookieNames.theme, settings.theme);
      writeCookie(cookieNames.textSize, String(settings.textSize));
      writeCookie(cookieNames.contrast, settings.contrast);
    }
    syncControls();
    if (announce) {
      window.clearTimeout(statusTimer);
      status.textContent = "Accessibility settings saved.";
      statusTimer = window.setTimeout(() => { status.textContent = ""; }, 2200);
    }
    window.dispatchEvent(new CustomEvent("phidias:accessibility-change", { detail: { ...settings } }));
  };

  applySettings(false, false);
  openButton.addEventListener("click", () => {
    syncControls();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  });
  const closeDialog = () => {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  };
  closeButton.addEventListener("click", closeDialog);
  doneButton.addEventListener("click", closeDialog);
  dialog.addEventListener("close", () => openButton.focus());
  for (const input of themeInputs) input.addEventListener("change", () => { if (input.checked) { settings.theme = input.value; applySettings(true, true); } });
  textSize.addEventListener("change", () => { settings.textSize = Number(textSize.value); applySettings(true, true); });
  contrast.addEventListener("change", () => { settings.contrast = contrast.checked ? "high" : "normal"; applySettings(true, true); });
  resetButton.addEventListener("click", () => { settings = { theme: "dark", textSize: 100, contrast: "normal" }; applySettings(true, true); });
})();
</script>`;
}

module.exports = {
  type: 'show_accessibility_settings',
  name: 'Show Accessibility Settings',
  category: 'HTML',
  description: 'Displays keyboard-accessible application settings for dark or light mode, text scaling up to 200%, and increased contrast. Preferences are stored in first-party cookies.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  fields: [
    { key: 'button_label', label: 'Button Label', type: 'text', default: 'Accessibility' },
    { key: 'panel_title', label: 'Panel Title', type: 'text', default: 'Accessibility settings' }
  ],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'Accessibility Settings HTML', kind: 'value', types: ['html', 'text'] }
  ],
  async execute(_ctx, options, _inputs, setOutput) {
    setOutput('html', accessibilityHTML(options));
    return 'next';
  },
  accessibilityHTML,
  TEXT_SIZES,
  COOKIE_MAX_AGE
};

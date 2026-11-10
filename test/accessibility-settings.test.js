'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  accessibilitySettingsHTML,
  accessibilityRuntimeHTML,
  TEXT_SIZES,
  COOKIE_MAX_AGE,
  RUNTIME_MARKER
} = require('../blocks/show_accessibility_settings');
const { useAccessibilitySettings } = require('../blocks/use_accessibility_settings');
const { loadDefinitions } = require('../runtime/app');

test('Show Accessibility Settings renders a plain, always-visible settings section', () => {
  const html = accessibilitySettingsHTML({ panel_title: 'Display <options>' });

  assert.match(html, /^<section class="phidias-accessibility-settings"/);
  assert.match(html, /aria-label="Display &lt;options&gt;"/);
  assert.match(html, /<h2>Display &lt;options&gt;<\/h2>/);
  assert.match(html, /<fieldset[^>]*>[\s\S]*<legend>Color theme<\/legend>/);
  assert.match(html, /type="radio"[^>]+value="dark"/);
  assert.match(html, /type="radio"[^>]+value="light"/);
  assert.match(html, /<select data-phidias-text-size>/);
  assert.match(html, /data-phidias-high-contrast/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /Reset settings/);
  assert.doesNotMatch(html, /<dialog|aria-haspopup|<script|<style/i);
  assert.doesNotMatch(html, /Display <options>/);
});

test('Show Accessibility Settings offers incremental scaling through 200 percent', () => {
  const html = accessibilitySettingsHTML();

  assert.deepEqual(TEXT_SIZES, [100, 110, 125, 150, 175, 200]);
  for (const size of TEXT_SIZES) assert.match(html, new RegExp(`<option value="${size}"`));
});

test('Use Accessibility Settings preserves page HTML and appends the runtime once', () => {
  const page = '<main><h1>Settings</h1></main>';
  const enhanced = useAccessibilitySettings(page);

  assert.ok(enhanced.startsWith(page));
  assert.match(enhanced, new RegExp(`<style ${RUNTIME_MARKER}>`));
  assert.match(enhanced, new RegExp(`<script ${RUNTIME_MARKER}>`));
  assert.equal(useAccessibilitySettings(enhanced), enhanced);
  assert.throws(() => useAccessibilitySettings(null), /requires HTML/);
});

test('Use Accessibility Settings inserts its runtime inside complete HTML documents', () => {
  const page = '<!doctype html><html><head><title>App</title></head><body><main>Content</main></body></html>';
  const enhanced = useAccessibilitySettings(page);

  assert.match(enhanced, /<main>Content<\/main><style data-phidias-accessibility-runtime>/);
  assert.match(enhanced, /<\/script>\n<\/body><\/html>$/);
});

test('Use Accessibility Settings persists validated preferences in existing cookies', () => {
  const html = accessibilityRuntimeHTML();

  assert.equal(COOKIE_MAX_AGE, 31536000);
  assert.match(html, /values\.theme === "light" \? "light" : "dark"/);
  assert.match(html, /allowedSizes\.includes\(Number\(values\.textSize\)\)/);
  assert.match(html, /values\.contrast === "high" \? "high" : "normal"/);
  assert.match(html, /phidias_accessibility_theme/);
  assert.match(html, /phidias_accessibility_text_size/);
  assert.match(html, /phidias_accessibility_contrast/);
  assert.match(html, /Path=\/; Max-Age=31536000; SameSite=Lax/);
  assert.match(html, /location\.protocol === "https:"/);
  assert.match(html, /cookie \+= "; Secure"/);
});

test('Use Accessibility Settings provides global theme, contrast, and focus adaptations', () => {
  const html = accessibilityRuntimeHTML();

  assert.match(html, /--phidias-theme-filter:brightness\(1\)/);
  assert.match(html, /--phidias-contrast-filter:contrast\(1\)/);
  assert.match(html, /data-phidias-theme="light"[^}]+var\(--phidias-light-theme-filter,invert\(1\) hue-rotate\(180deg\)\)/);
  assert.match(html, /data-phidias-contrast="high"[^}]+contrast\(1\.35\)/);
  assert.match(html, /body\{min-width:0;zoom:var\(--phidias-text-scale,1\)\}/);
  assert.match(html, /data-phidias-preserve-colors/);
  assert.match(html, /:focus-visible\{outline:3px solid CanvasText/);
  assert.match(html, /--phidias-high-contrast-link:#66e0ff/);
  assert.doesNotMatch(html, /--phidias-(?:theme|contrast)-filter:none/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html, /@media\(forced-colors:active\)/);
});

test('Use Accessibility Settings binds plain settings sections and emits valid JavaScript', () => {
  const runtime = accessibilityRuntimeHTML();
  const script = runtime.match(/<script[^>]*>([\s\S]+)<\/script>/)?.[1];

  assert.match(runtime, /querySelectorAll\("\[data-phidias-accessibility-settings\]"\)/);
  assert.match(runtime, /phidiasAccessibilityBound/);
  assert.match(runtime, /window\.__phidiasAccessibilitySettings = \{ bind/);
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test('accessibility blocks expose current HTML ports and execute independently', async () => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const show = definitions.get('show_accessibility_settings');
  const use = definitions.get('use_accessibility_settings');
  assert.ok(show);
  assert.ok(use);
  assert.deepEqual(show.inputPorts.map(port => port.id), ['action']);
  assert.deepEqual(show.outputPorts.map(port => port.id), ['next', 'html']);
  assert.deepEqual(use.inputPorts.map(port => port.id), ['action', 'html']);
  assert.deepEqual(use.outputPorts.map(port => port.id), ['next', 'html']);
  assert.ok(show.outputPorts.find(port => port.id === 'html').types.includes('html'));
  assert.ok(use.inputPorts.find(port => port.id === 'html').types.includes('html'));

  let settings;
  let page;
  assert.equal(await show.execute({}, {}, {}, (id, value) => { if (id === 'html') settings = value; }), 'next');
  assert.equal(await use.execute({}, {}, { html: settings }, (id, value) => { if (id === 'html') page = value; }), 'next');
  assert.match(settings, /^<section/);
  assert.doesNotMatch(settings, /<script/);
  assert.match(page, /<script data-phidias-accessibility-runtime>/);
});

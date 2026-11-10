'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { accessibilityHTML, TEXT_SIZES, COOKIE_MAX_AGE } = require('../blocks/show_accessibility_settings');
const { loadDefinitions } = require('../runtime/app');

test('Show Accessibility Settings renders labelled keyboard controls and a native dialog', () => {
  const html = accessibilityHTML({ button_label: 'Access & display', panel_title: 'Display <options>' });

  assert.match(html, /<button[^>]+aria-haspopup="dialog"[^>]*>Access &amp; display<\/button>/);
  assert.match(html, /<dialog[^>]+aria-label="Display &lt;options&gt;"/);
  assert.match(html, /<fieldset[^>]*>[\s\S]*<legend>Color theme<\/legend>/);
  assert.match(html, /type="radio"[^>]+value="dark"/);
  assert.match(html, /type="radio"[^>]+value="light"/);
  assert.match(html, /<select data-phidias-text-size>/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /aria-label="Close accessibility settings"/);
  assert.doesNotMatch(html, /Display <options>/);
});

test('Show Accessibility Settings supports incremental scaling through 200 percent', () => {
  const html = accessibilityHTML();

  assert.deepEqual(TEXT_SIZES, [100, 110, 125, 150, 175, 200]);
  for (const size of TEXT_SIZES) assert.match(html, new RegExp(`<option value="${size}"`));
  assert.match(html, /body\{min-width:0;zoom:var\(--phidias-text-scale,1\)\}/);
  assert.match(html, /page\.style\.setProperty\("--phidias-text-scale"/);
});

test('Show Accessibility Settings defaults safely and persists validated preferences in cookies', () => {
  const html = accessibilityHTML();

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

test('Show Accessibility Settings provides global theme, contrast, media, and focus adaptations', () => {
  const html = accessibilityHTML();

  assert.match(html, /data-phidias-theme="light"[^}]+invert\(1\) hue-rotate\(180deg\)/);
  assert.match(html, /data-phidias-contrast="high"[^}]+contrast\(1\.35\)/);
  assert.match(html, /data-phidias-preserve-colors/);
  assert.match(html, /:focus-visible\{outline:3px solid CanvasText/);
  assert.match(html, /box-shadow:0 0 0 5px Canvas/);
  assert.match(html, /body a\{color:#ff0!important;text-decoration:underline/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html, /@media\(forced-colors:active\)/);
  assert.match(html, /dialog\.addEventListener\("close", \(\) => openButton\.focus\(\)\)/);
});

test('Show Accessibility Settings emits valid browser JavaScript', () => {
  const script = accessibilityHTML().match(/<script>([\s\S]+)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test('Show Accessibility Settings is loaded as an HTML block', async () => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const definition = definitions.get('show_accessibility_settings');
  assert.ok(definition);
  assert.equal(definition.category, 'HTML');
  assert.deepEqual(definition.inputPorts.map(port => port.id), ['action']);
  assert.deepEqual(definition.outputPorts.map(port => port.id), ['next', 'html']);
  assert.ok(definition.outputPorts.find(port => port.id === 'html').types.includes('html'));

  let output;
  const result = await definition.execute({}, {}, {}, (id, value) => { if (id === 'html') output = value; });
  assert.equal(result, 'next');
  assert.match(output, /data-phidias-accessibility/);
});

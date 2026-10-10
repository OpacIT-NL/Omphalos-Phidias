'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getTemplate } = require('../blocks/get_template');
const { applyVariable } = require('../blocks/apply_variable');
const { markdownToHTML } = require('../blocks/markdown_to_html');

test('Get Template reads HTML and CSS files only from the application html folder', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-template-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'html'));
  await fs.writeFile(path.join(directory, 'html', 'page.html'), '<main>%content%</main>');
  await fs.writeFile(path.join(directory, 'html', 'styles.css'), 'body { color: purple; }');
  assert.equal(await getTemplate(directory, 'page'), '<main>%content%</main>');
  assert.equal(await getTemplate(directory, 'page.html'), '<main>%content%</main>');
  assert.equal(await getTemplate(directory, 'styles.css'), 'body { color: purple; }');
  await assert.rejects(getTemplate(directory, '../page.html'), /must be a file in the html folder/);
  await assert.rejects(getTemplate(directory, 'missing.html'), /Template not found/);
});

test('Apply Variable replaces every matching placeholder with text or HTML', () => {
  const table = '<table><tr><td>Online</td></tr></table>';
  assert.equal(applyVariable('<title>%name%</title><h1>%name%</h1>', 'name', 'Delphi'), '<title>Delphi</title><h1>Delphi</h1>');
  assert.equal(applyVariable('<main>%content%</main>', 'content', table), `<main>${table}</main>`);
  assert.equal(applyVariable('<p>%missing%</p>', 'other', 'value'), '<p>%missing%</p>');
  assert.throws(() => applyVariable('', '%name%', 'x'), /without percent signs/);
});

test('multi-template, multi-variable, and requested multi-text blocks expose every numbered value', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-multi-template-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'html'));
  for (let index = 1; index <= 5; index++) await fs.writeFile(path.join(directory, 'html', `page${index}.html`), `<p>%value${index}%</p>`);
  for (const count of [2, 3, 4, 5]) {
    const block = require(`../blocks/get_template_${count}x`), outputs = {};
    const inputs = Object.fromEntries(Array.from({ length: count }, (_, index) => [`name${index + 1}`, `page${index + 1}.html`]));
    assert.equal(await block.execute({ directory }, {}, inputs, (id, value) => { outputs[id] = value; }), 'success');
    for (let index = 1; index <= count; index++) assert.equal(outputs[`html${index}`], `<p>%value${index}%</p>`);

    const apply = require(`../blocks/apply_variable_${count}x`), applied = {};
    const replacements = { html: Array.from({ length: count }, (_, index) => `%value${index + 1}%`).join('|') };
    for (let index = 1; index <= count; index++) { replacements[`name${index}`] = `value${index}`; replacements[`value${index}`] = `result${index}`; }
    assert.equal(await apply.execute({}, {}, replacements, (id, value) => { applied[id] = value; }), 'next');
    assert.equal(applied.html, Array.from({ length: count }, (_, index) => `result${index + 1}`).join('|'));
  }
  for (const count of [5, 7, 8]) {
    const block = require(`../blocks/text_${count}x`), outputs = {};
    const options = Object.fromEntries(Array.from({ length: count }, (_, index) => [`text${index + 1}`, `Text ${index + 1}`]));
    await block.execute({}, options, {}, (id, value) => { outputs[id] = value; });
    assert.deepEqual(outputs, options);
  }
});

test('Markdown to HTML supports common Markdown and escapes embedded HTML', () => {
  const html = markdownToHTML('# Title\n\nHello **world** and `code`.\n\n- One\n- Two\n\n[Safe](https://example.test?a=1&b=2)\n\n<script>alert(1)</script>');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>world<\/strong>/); assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<ul><li>One<\/li><li>Two<\/li><\/ul>/);
  assert.match(html, /href="https:\/\/example\.test\?a=1&amp;b=2"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(markdownToHTML('[Bad](javascript:alert(1))'), /href=/);
});

test('template, Markdown, and variable blocks form an HTML response workflow', async t => {
  const { createApp, loadDefinitions } = require('../runtime/app');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-template-app-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'html'));
  await fs.writeFile(path.join(directory, 'html', 'page.html'), '<html><h1>%title%</h1><main>%content%</main></html>');
  const text = (id, value) => ({ id, type: 'text', x: 0, y: 0, options: { text: value } });
  const document = { version: 1, name: 'Template app', workspaces: [{ id: 'main', name: 'Main', active: true, blocks: [
    { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/page' } },
    text('file', 'page.html'), { id: 'template', type: 'get_template', x: 0, y: 0, options: {} },
    text('title-name', 'title'), text('title-value', 'Status'), { id: 'title', type: 'apply_variable', x: 0, y: 0, options: {} },
    text('markdown-value', '**Online**'), { id: 'markdown', type: 'markdown_to_html', x: 0, y: 0, options: {} },
    text('content-name', 'content'), { id: 'content', type: 'apply_variable', x: 0, y: 0, options: {} },
    { id: 'reply', type: 'respond', x: 0, y: 0, options: { status: 200, format: 'HTML', body: '', headers: '{}' } }
  ], connections: [
    { id: 'a1', from: 'http', output: 'next', to: 'template', input: 'action', kind: 'action' },
    { id: 'v1', from: 'file', output: 'text', to: 'template', input: 'name', kind: 'value' },
    { id: 'a2', from: 'template', output: 'success', to: 'title', input: 'action', kind: 'action' },
    { id: 'v2', from: 'template', output: 'html', to: 'title', input: 'html', kind: 'value' },
    { id: 'v3', from: 'title-name', output: 'text', to: 'title', input: 'name', kind: 'value' },
    { id: 'v4', from: 'title-value', output: 'text', to: 'title', input: 'value', kind: 'value' },
    { id: 'a3', from: 'title', output: 'next', to: 'content', input: 'action', kind: 'action' },
    { id: 'v5', from: 'title', output: 'html', to: 'content', input: 'html', kind: 'value' },
    { id: 'v6', from: 'content-name', output: 'text', to: 'content', input: 'name', kind: 'value' },
    { id: 'v7', from: 'markdown-value', output: 'text', to: 'markdown', input: 'markdown', kind: 'value' },
    { id: 'v8', from: 'markdown', output: 'html', to: 'content', input: 'value', kind: 'value' },
    { id: 'a4', from: 'content', output: 'next', to: 'reply', input: 'action', kind: 'action' },
    { id: 'v9', from: 'content', output: 'html', to: 'reply', input: 'body', kind: 'value' }
  ] }] };
  const app = createApp({ directory, document, definitions: loadDefinitions(path.resolve(__dirname, '../blocks')) });
  const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const response = await fetch(`http://127.0.0.1:${address.port}/page`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<html><h1>Status</h1><main><p><strong>Online</strong></p></main></html>');
});

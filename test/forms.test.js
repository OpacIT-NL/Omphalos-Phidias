'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createForm } = require('../blocks/create_form');
const { parseFormBody, safeFormReturnPath, isSameOriginFormRequest, createApp, loadDefinitions } = require('../runtime/app');

test('form HTML escapes identifiers, content, defaults, and choices', async () => {
  const form = createForm('new_instance', { title: 'New <Instance>', submit_label: 'Create & return' }, { path: '/iris/newinstance', headers: { host: 'example.test', referer: 'http://example.test/iris/instances?site=a%20b' } });
  assert.match(form, /action="\/_phidias\/forms\/new_instance"/);
  assert.match(form, /value="\/iris\/instances\?site=a%20b"/);
  assert.match(form, /New &lt;Instance&gt;/);
  const text = require('../blocks/form_text_input'), output = {};
  await text.execute({}, { input_type: 'Text', required: 'Yes' }, { form, field_name: 'display_name', label: 'Name "shown"', default_value: 'A&B', placeholder: '<name>' }, (id, value) => { output[id] = value; });
  assert.match(output.html, /name="display_name"/);
  assert.match(output.html, /Name &quot;shown&quot;/);
  assert.match(output.html, /value="A&amp;B"/);
  assert.match(output.html, /placeholder="&lt;name&gt;"/);
  assert.match(output.html, / required/);
});

test('form values become JSON-safe properties and repeated values become lists', () => {
  assert.deepEqual(parseFormBody('name=A%20%22quoted%22%20%26%20safe&roles=admin&roles=operator&json=%7B%22x%22%3A1%7D&__phidias_return_to=%2Fignored'), {
    name: 'A "quoted" & safe', roles: ['admin', 'operator'], json: '{"x":1}'
  });
  assert.equal(safeFormReturnPath('/iris/instances?created=yes'), '/iris/instances?created=yes');
  assert.equal(safeFormReturnPath('//evil.example/path', '/fallback'), '/fallback');
  assert.equal(safeFormReturnPath('https://evil.example/path', '/fallback'), '/fallback');
  assert.deepEqual(parseFormBody('roles%5B%5D=admin'), { roles: ['admin'] });
  assert.equal(isSameOriginFormRequest({ host: 'app.example', origin: 'http://app.example' }), true);
  assert.equal(isSameOriginFormRequest({ host: 'internal:3001', 'x-forwarded-host': 'app.example', 'x-forwarded-proto': 'https', origin: 'https://app.example' }), true);
  assert.equal(isSameOriginFormRequest({ host: 'app.example', origin: 'https://evil.example' }), false);
});

test('choice blocks support list, object, and escaped JSON values', async () => {
  const form = createForm('choices', {}, { path: '/form', headers: {} });
  const select = require('../blocks/form_select_list'), selectOutput = {};
  await select.execute({}, { multiple: 'Yes', required: 'No' }, { form, field_name: 'roles', label: 'Roles', choices: [{ value: 'admin"root', label: 'Admin & Root' }], selected: ['admin"root'] }, (id, value) => { selectOutput[id] = value; });
  assert.match(selectOutput.html, /value="admin&quot;root" selected/);
  assert.match(selectOutput.html, /Admin &amp; Root/);
  assert.match(selectOutput.html, / multiple/);
  assert.match(selectOutput.html, /name="roles\[\]"/);

  const option = require('../blocks/form_option_list'), optionOutput = {};
  await option.execute({}, { required: 'Yes' }, { form: selectOutput.html, field_name: 'environment', label: 'Environment', choices: { rc: 'Release candidate', prod: 'Production' }, selected: 'rc' }, (id, value) => { optionOutput[id] = value; });
  assert.match(optionOutput.html, /type="radio" name="environment" value="rc" checked required/);

  const checkmarks = require('../blocks/form_checkmark_list'), checkmarkOutput = {};
  await checkmarks.execute({}, {}, { form: optionOutput.html, field_name: 'features', label: 'Features', choices: 'API,Monitoring', selected: 'Monitoring' }, (id, value) => { checkmarkOutput[id] = value; });
  assert.match(checkmarkOutput.html, /type="checkbox" name="features\[\]" value="Monitoring" checked/);

  const longText = require('../blocks/form_long_text_input'), longTextOutput = {};
  await longText.execute({}, { rows: 8, required: 'No' }, { form: checkmarkOutput.html, field_name: 'notes', label: 'Notes', default_value: '<safe>' }, (id, value) => { longTextOutput[id] = value; });
  assert.match(longTextOutput.html, /<textarea[^>]+rows="8"[^>]*>&lt;safe&gt;<\/textarea>/);
});

test('Prefill Form from Object fills every form control and locks an ID field', async () => {
  const form = createForm('edit_instance', { title: 'Edit instance' }, { path: '/iris/edit', headers: {} });
  const text = require('../blocks/form_text_input');
  const longText = require('../blocks/form_long_text_input');
  const select = require('../blocks/form_select_list');
  const option = require('../blocks/form_option_list');
  const checkmarks = require('../blocks/form_checkmark_list');
  const prefill = require('../blocks/prefill_form_from_object');
  const apply = async (definition, options, inputs) => {
    const output = {};
    await definition.execute({}, options, inputs, (id, value) => { output[id] = value; });
    return output.html;
  };
  let html = await apply(text, { input_type: 'Text', required: 'Yes' }, { form, field_name: 'id', label: 'ID', default_value: 'old-id' });
  html = await apply(text, { input_type: 'Text', required: 'No' }, { form: html, field_name: 'name', label: 'Name', default_value: 'Old name' });
  html = await apply(longText, { rows: 5, required: 'No' }, { form: html, field_name: 'notes', label: 'Notes', default_value: 'Old notes' });
  html = await apply(select, { multiple: 'No', required: 'No' }, { form: html, field_name: 'environment', label: 'Environment', choices: ['rc', 'prod'], selected: 'rc' });
  html = await apply(option, { required: 'No' }, { form: html, field_name: 'state', label: 'State', choices: ['online', 'offline'], selected: 'offline' });
  html = await apply(checkmarks, {}, { form: html, field_name: 'roles', label: 'Roles', choices: ['admin', 'operator'], selected: 'operator' });

  const result = prefill.prefillForm(html, JSON.stringify({
    id: 'node-42', name: 'A "quoted" & safe', notes: '<updated>', environment: 'prod', state: 'online', roles: ['admin']
  }));
  assert.match(result, /name="id"[^>]*value="node-42"[^>]*readonly[^>]*aria-readonly="true"/);
  assert.match(result, /name="name"[^>]*value="A &quot;quoted&quot; &amp; safe"/);
  assert.match(result, /name="notes"[^>]*>&lt;updated&gt;<\/textarea>/);
  assert.match(result, /<option value="prod" selected>/);
  assert.doesNotMatch(result, /<option value="rc" selected>/);
  assert.match(result, /type="radio" name="state" value="online" checked/);
  assert.doesNotMatch(result, /type="radio" name="state" value="offline" checked/);
  assert.match(result, /type="checkbox" name="roles\[\]" value="admin" checked/);
  assert.doesNotMatch(result, /type="checkbox" name="roles\[\]" value="operator" checked/);
});

test('Prefill Form from Object keeps locked select IDs submitted and rejects invalid data', async () => {
  const select = require('../blocks/form_select_list');
  const prefill = require('../blocks/prefill_form_from_object');
  const output = {};
  await select.execute({}, { multiple: 'No', required: 'No' }, {
    form: createForm('edit_select', {}, { path: '/edit', headers: {} }),
    field_name: 'id', label: 'ID', choices: ['one', 'two'], selected: 'one'
  }, (id, value) => { output[id] = value; });
  const result = prefill.prefillForm(output.html, { id: 'two' });
  assert.match(result, /<select[^>]*name="id"[^>]*disabled[^>]*aria-disabled="true"/);
  assert.match(result, /<option value="two" selected>/);
  assert.match(result, /<input type="hidden" name="id" value="two" data-phidias-locked-copy>/);
  assert.match(prefill.prefillForm(output.html, [{ id: 'one' }]), /<option value="one" selected>/);
  assert.throws(() => prefill.prefillForm(output.html, '["not-an-object"]'), /exactly one object/);
  assert.throws(() => prefill.prefillForm(output.html, [{ id: 'one' }, { id: 'two' }]), /exactly one object/);
  assert.throws(() => prefill.prefillForm('<p>not a form<\/p>', {}), /must contain a form/);
});

test('active Form Submit IDs must be valid and unique', () => {
  const { validate } = require('../runtime/validate');
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const block = (id, formID) => ({ id, type: 'form_submit', x: 0, y: 0, options: { form_id: formID } });
  assert.throws(() => validate({ version: 1, name: 'Duplicate forms', workspaces: [
    { id: 'one', name: 'One', active: true, blocks: [block('first', 'same')], connections: [] },
    { id: 'two', name: 'Two', active: true, blocks: [block('second', 'same')], connections: [] }
  ] }, definitions), /Duplicate Form Submit ID/);
});

test('Form Submit triggers its workflow and redirects to the originating page', async t => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const document = { version: 1, name: 'Forms', workspaces: [{ id: 'forms', name: 'Forms', active: true, blocks: [
    { id: 'submit', type: 'form_submit', x: 0, y: 0, options: { form_id: 'new_instance' } },
    { id: 'log', type: 'console_log', x: 300, y: 0, options: { level: 'info', value: '' } }
  ], connections: [
    { id: 'action', from: 'submit', output: 'next', to: 'log', input: 'action', kind: 'action' },
    { id: 'value', from: 'submit', output: 'form_data', to: 'log', input: 'value', kind: 'value' }
  ] }] };
  const entries = [];
  const logger = { debug() {}, warning() {}, error() {}, info(...values) { entries.push(values); } };
  const app = createApp({ document, definitions, logger });
  const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const response = await fetch(`http://127.0.0.1:${address.port}/_phidias/forms/new_instance`, {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: '__phidias_return_to=%2Firis%2Finstances&name=A%20%22quoted%22&roles=admin&roles=operator'
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/iris/instances');
  assert.deepEqual(Object.fromEntries(Object.entries(entries[0][0])), { name: 'A "quoted"', roles: ['admin', 'operator'] });
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/_phidias/forms/missing`, { method: 'POST' })).status, 404);
});

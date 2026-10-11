'use strict';
const { FORM_MARKER, escapeHTML } = require('./form_helpers.cjs');

function formID(value) {
  const id = String(value ?? '').trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(id)) throw new Error('Form ID must start with a letter and contain only letters, numbers, underscores, or dashes');
  return id;
}
function returnPath(request) {
  const fallback = request?.path && request.path.startsWith('/') ? request.path : '/';
  const referrer = request?.headers?.referer || request?.headers?.referrer;
  if (!referrer) return fallback;
  try {
    const host = String(request.headers['x-forwarded-host'] || request.headers.host || 'localhost').split(',')[0].trim();
    const protocol = String(request.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() === 'https' ? 'https:' : 'http:';
    const origin = new URL(`${protocol}//${host}`).origin;
    const url = new URL(referrer, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/') || url.pathname.startsWith('//')) return fallback;
    return `${url.pathname}${url.search}`;
  } catch { return fallback; }
}
function createForm(id, options = {}, request = null) {
  id = formID(id);
  const action = `/_phidias/forms/${encodeURIComponent(id)}`;
  const title = String(options.title || '').trim();
  const submit = String(options.submit_label || 'Submit').trim() || 'Submit';
  return `<form class="phidias-form" id="phidias-form-${escapeHTML(id)}" method="post" action="${escapeHTML(action)}" accept-charset="UTF-8">
  <input type="hidden" name="__phidias_return_to" value="${escapeHTML(returnPath(request))}">
  ${title ? `<header class="phidias-form__header"><h2>${escapeHTML(title)}</h2></header>\n  ` : ''}<div class="phidias-form__fields">
    ${FORM_MARKER}
  </div>
  <footer class="phidias-form__actions"><button type="submit">${escapeHTML(submit)}</button></footer>
</form>`;
}

module.exports = {
  type: 'create_form', name: 'Create Form', category: 'Forms',
  description: 'Creates an HTML form. Connect its HTML output through form input blocks and place the result in an HTML page.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'form_id', name: 'Form ID', kind: 'value', types: ['text'], required: true }
  ],
  fields: [
    { key: 'title', label: 'Form title', type: 'text', default: '' },
    { key: 'submit_label', label: 'Submit button', type: 'text', default: 'Submit' }
  ],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'Form HTML', kind: 'value', types: ['text'] }
  ],
  async execute(ctx, options, inputs, setOutput) {
    setOutput('html', createForm(inputs.form_id, options, ctx.request));
    return 'next';
  },
  createForm, formID, returnPath
};

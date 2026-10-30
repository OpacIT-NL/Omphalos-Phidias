'use strict';

const { escapeHTML } = require('./form_helpers.cjs');

const decodeHTML = value => String(value ?? '').replace(/&(amp|lt|gt|quot|#39);/g, entity => ({
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"
})[entity]);

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? decodeHTML(match[1] ?? match[2]) : null;
}

function removeAttribute(tag, name) {
  return tag.replace(new RegExp(`\\s${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?`, 'ig'), '');
}

function setAttribute(tag, name, value) {
  const cleaned = removeAttribute(tag, name);
  return cleaned.replace(/\s*\/?\s*>$/, ending => ` ${name}="${escapeHTML(value)}"${ending.includes('/') ? ' /' : ''}>`);
}

function setBooleanAttribute(tag, name) {
  const cleaned = removeAttribute(tag, name);
  return cleaned.replace(/\s*\/?\s*>$/, ending => ` ${name}${ending.includes('/') ? ' /' : ''}>`);
}

function objectValue(value) {
  if (value == null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function valueSet(value) {
  return new Set((Array.isArray(value) ? value : [value]).map(objectValue));
}

function parseObject(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error('Form Data must be a JSON object or object value'); }
  }
  if (Array.isArray(value)) {
    if (value.length !== 1 || !value[0] || typeof value[0] !== 'object' || Array.isArray(value[0])) {
      throw new Error('Form Data object lists must contain exactly one object');
    }
    value = value[0];
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Form Data must be a JSON object or object value');
  return value;
}

function fieldKey(tag) {
  const name = attribute(tag, 'name');
  return name?.endsWith('[]') ? name.slice(0, -2) : name;
}

function hiddenValue(name, value) {
  return `<input type="hidden" name="${escapeHTML(name)}" value="${escapeHTML(value)}" data-phidias-locked-copy>`;
}

function prefillForm(form, source) {
  if (typeof form !== 'string' || !/<form\b/i.test(form)) throw new Error('Form HTML input must contain a form');
  const data = parseObject(source);
  const has = key => key !== null && Object.hasOwn(data, key);

  let html = form.replace(/<select\b[^>]*>[\s\S]*?<\/select>/gi, select => {
    const key = fieldKey(select);
    if (!has(key)) return select;
    const selected = valueSet(data[key]);
    let updated = select.replace(/<option\b[^>]*>/gi, option => {
      const value = attribute(option, 'value') ?? '';
      const cleaned = removeAttribute(option, 'selected');
      return selected.has(value) ? setBooleanAttribute(cleaned, 'selected') : cleaned;
    });
    if (key.toLowerCase() !== 'id') return updated;
    const opening = updated.match(/^<select\b[^>]*>/i)?.[0];
    if (!opening) return updated;
    const locked = setAttribute(setBooleanAttribute(opening, 'disabled'), 'aria-disabled', 'true');
    updated = locked + updated.slice(opening.length);
    const submittedName = attribute(opening, 'name') || key;
    return updated + [...selected].map(value => hiddenValue(submittedName, value)).join('');
  });

  html = html.replace(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi, textarea => {
    const opening = textarea.match(/^<textarea\b[^>]*>/i)?.[0];
    const key = opening ? fieldKey(opening) : null;
    if (!opening || !has(key)) return textarea;
    const locked = key.toLowerCase() === 'id';
    const updatedOpening = locked ? setAttribute(setBooleanAttribute(opening, 'readonly'), 'aria-readonly', 'true') : opening;
    return `${updatedOpening}${escapeHTML(objectValue(data[key]))}</textarea>`;
  });

  html = html.replace(/<input\b[^>]*>/gi, input => {
    const key = fieldKey(input);
    if (!has(key) || key.startsWith('__phidias_') || input.includes('data-phidias-locked-copy')) return input;
    const type = String(attribute(input, 'type') || 'text').toLowerCase();
    if (['submit', 'button', 'reset', 'image', 'file'].includes(type)) return input;
    const locked = key.toLowerCase() === 'id';
    if (type === 'checkbox' || type === 'radio') {
      const values = valueSet(data[key]);
      const value = attribute(input, 'value') ?? 'on';
      let updated = removeAttribute(input, 'checked');
      if (values.has(value)) updated = setBooleanAttribute(updated, 'checked');
      if (!locked) return updated;
      updated = setAttribute(setBooleanAttribute(updated, 'disabled'), 'aria-disabled', 'true');
      return updated + (values.has(value) ? hiddenValue(attribute(input, 'name') || key, value) : '');
    }
    let updated = setAttribute(input, 'value', objectValue(data[key]));
    if (locked && type !== 'hidden') updated = setAttribute(setBooleanAttribute(updated, 'readonly'), 'aria-readonly', 'true');
    return updated;
  });
  return html;
}

module.exports = {
  type: 'prefill_form_from_object',
  name: 'Prefill Form from Object',
  category: 'Forms',
  description: 'Prefills matching form fields from a JSON object or one-row object list. A field named id is locked but remains part of the submitted form data.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'form', name: 'Form HTML', kind: 'value', types: ['text'], required: true },
    { id: 'object', name: 'Form Data', kind: 'value', types: ['object', 'list', 'text'], required: true }
  ],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'Form HTML', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(_ctx, _options, inputs, setOutput) {
    setOutput('html', prefillForm(inputs.form, inputs.object));
    return 'next';
  },
  prefillForm,
  parseObject
};

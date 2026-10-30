'use strict';

const FORM_MARKER = '<!-- phidias-form-fields -->';
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function fieldName(value) {
  const name = String(value ?? '').trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(name)) throw new Error('Field Name must start with a letter and contain only letters, numbers, underscores, or dashes');
  if (name.startsWith('__phidias_')) throw new Error('Field Name uses a reserved prefix');
  return name;
}

function insertField(form, field) {
  if (typeof form !== 'string' || !form.includes(FORM_MARKER)) throw new Error('Form input must come from Create Form or another form input block');
  return form.replace(FORM_MARKER, `${field}\n    ${FORM_MARKER}`);
}

function choices(value) {
  let source = value;
  if (typeof source === 'string') {
    const text = source.trim();
    if (!text) throw new Error('At least one choice is required');
    try { source = JSON.parse(text); } catch { source = text.split(/[\n,]+/).map(item => item.trim()).filter(Boolean); }
  }
  let result;
  if (Array.isArray(source)) {
    result = source.map(item => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const optionValue = item.value ?? item.id ?? item.label ?? item.name;
        return { value: String(optionValue ?? ''), label: String(item.label ?? item.name ?? optionValue ?? '') };
      }
      return { value: String(item ?? ''), label: String(item ?? '') };
    });
  } else if (source && typeof source === 'object') {
    result = Object.entries(source).map(([optionValue, label]) => ({ value: String(optionValue), label: String(label) }));
  } else throw new Error('Choices must be a list, object, JSON text, or comma/newline-separated text');
  if (!result.length || result.some(item => !item.value)) throw new Error('Every choice must have a non-empty value');
  return result;
}

function selectedValues(value) {
  if (value == null || value === '') return new Set();
  let source = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { source = source.split(/[\n,]+/).map(item => item.trim()).filter(Boolean); }
  }
  return new Set((Array.isArray(source) ? source : [source]).map(String));
}

function commonPorts(extra = []) {
  return [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'form', name: 'Form HTML', kind: 'value', types: ['text'], required: true },
    { id: 'field_name', name: 'Field Name', kind: 'value', types: ['text'], required: true },
    { id: 'label', name: 'Label', kind: 'value', types: ['text'], required: true },
    ...extra
  ];
}

const outputPorts = [
  { id: 'next', name: 'Action', kind: 'action', types: [] },
  { id: 'html', name: 'Form HTML', kind: 'value', types: ['text'] }
];

module.exports = { FORM_MARKER, escapeHTML, fieldName, insertField, choices, selectedValues, commonPorts, outputPorts };

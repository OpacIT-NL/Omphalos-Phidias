'use strict';

const TITLE_FIELDS = new Set(['title', 'name', 'term']);
const BODY_FIELDS = new Set(['definition', 'description', 'content', 'body']);
const META_FIELDS = new Set(['coiner', 'author', 'credit']);
const TAG_FIELDS = new Set(['tags', 'categories', 'category']);
const LINK_FIELDS = new Set(['source', 'url', 'link']);

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function escapeAttribute(value) {
  return escapeHTML(value).replace(/\r\n?|\n/g, '&#10;').replace(/\t/g, '&#9;');
}

function fieldName(value) {
  return String(value ?? '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

function fieldKey(value) {
  return fieldName(value).toLocaleLowerCase();
}

function fieldSlug(value) {
  return fieldKey(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'field';
}

function fieldLabel(value) {
  const normalized = fieldKey(value);
  if (normalized === 'coiner') return 'Coined by';
  const label = fieldName(value);
  return label ? label[0].toLocaleUpperCase() + label.slice(1) : 'Value';
}

function scalarText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function renderText(value) {
  return escapeHTML(scalarText(value)).replace(/\r\n?|\n/g, '<br>');
}

function safeWebURL(value) {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function searchableText(value, ancestors = new Set()) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  if (ancestors.has(value)) throw new Error('Convert JSON to HTML list cannot convert circular objects');
  const next = new Set(ancestors).add(value);
  return (Array.isArray(value) ? value : Object.values(value)).map(item => searchableText(item, next)).filter(Boolean).join(' ');
}

function renderTags(values, key) {
  const tags = (Array.isArray(values) ? values : [values]).filter(value => value !== null && value !== undefined && String(value).trim() !== '');
  if (!tags.length) return '';
  const contents = tags.map(tag => `<span class="phidias-html-list__tag">${renderText(tag)}</span>`).join('');
  return `<p class="phidias-html-list__tags phidias-html-list__field phidias-html-list__field--${fieldSlug(key)}" data-field="${escapeAttribute(key)}">${contents}</p>`;
}

function renderField(key, value) {
  if (value === null || value === undefined || value === '') return '';
  const normalized = fieldKey(key);
  const slug = fieldSlug(key);
  const dataField = escapeAttribute(key);
  if (TITLE_FIELDS.has(normalized)) {
    return `<p class="phidias-html-list__title phidias-html-list__field phidias-html-list__field--${slug}" data-field="${dataField}"><strong>${renderText(value)}</strong></p>`;
  }
  if (BODY_FIELDS.has(normalized)) {
    return `<p class="phidias-html-list__body phidias-html-list__field phidias-html-list__field--${slug}" data-field="${dataField}">${renderText(value)}</p>`;
  }
  if (TAG_FIELDS.has(normalized) || Array.isArray(value)) return renderTags(value, key);

  const label = escapeHTML(fieldLabel(key));
  let contents = renderText(value);
  if (LINK_FIELDS.has(normalized)) {
    const url = safeWebURL(value);
    if (url) contents = `<a class="phidias-html-list__link" href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">View ${label.toLocaleLowerCase()}</a>`;
  }
  const kind = META_FIELDS.has(normalized) ? ' phidias-html-list__meta' : '';
  return `<p class="phidias-html-list__field${kind} phidias-html-list__field--${slug}" data-field="${dataField}"><span class="phidias-html-list__label">${label}:</span> <span class="phidias-html-list__value">${contents}</span></p>`;
}

function itemObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return { Value: value };
}

function renderItem(value, index) {
  const item = itemObject(value);
  const entries = Object.entries(item);
  const title = entries.find(([key]) => TITLE_FIELDS.has(fieldKey(key)))?.[1] ?? '';
  const tags = entries.find(([key]) => TAG_FIELDS.has(fieldKey(key)))?.[1] ?? '';
  const search = searchableText(item);
  const fields = entries.map(([key, child]) => renderField(key, child)).filter(Boolean).join('\n    ');
  return `  <article class="phidias-html-list__item" data-index="${index}" data-title="${escapeAttribute(scalarText(title))}" data-tags="${escapeAttribute(searchableText(tags))}" data-search="${escapeAttribute(search)}">\n    ${fields}\n  </article>`;
}

function parseInput(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); }
    catch { throw new Error('Convert JSON to HTML list requires valid JSON text, an object, or a list'); }
  }
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  throw new Error('Convert JSON to HTML list requires JSON text, an object, or a list');
}

function convertJSONToHTMLList(value) {
  const items = parseInput(value);
  const body = items.map(renderItem).join('\n');
  return `<section class="phidias-html-list" data-count="${items.length}">${body ? `\n${body}\n` : ''}</section>`;
}

module.exports = {
  type: 'convert_json_to_html_list',
  name: 'Convert JSON to HTML List',
  category: 'Data',
  description: 'Converts JSON into a paragraph-based HTML card list with title, body, metadata, tags, links, and searchable data attributes.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'json', name: 'JSON', kind: 'value', types: ['text', 'object', 'list'], required: true }
  ],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML List', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(_ctx, _options, inputs, setOutput) {
    setOutput('html', convertJSONToHTMLList(inputs.json));
    return 'next';
  },
  convertJSONToHTMLList,
  renderField,
  safeWebURL
};

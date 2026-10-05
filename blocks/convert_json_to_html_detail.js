'use strict';
const { convertJSONToHTMLTable } = require('./convert_json_to_html_table');

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
function parseObject(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); }
    catch { throw new Error('Convert JSON to HTML detail requires valid JSON text, an object, or a list'); }
  }
  if (!value || typeof value !== 'object') throw new Error('Convert JSON to HTML detail requires an object or a list');
  return value;
}
function renderValue(value, ancestors, depth) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `\n${convertJSONToHTMLTable(value)}\n${'  '.repeat(depth)}`;
  if (typeof value === 'object') return `\n${renderDetail(value, ancestors, depth)}\n${'  '.repeat(depth)}`;
  return escapeHTML(value);
}
function renderDetail(value, ancestors = new Set(), depth = 0) {
  if (ancestors.has(value)) throw new Error('Convert JSON to HTML detail cannot convert circular objects');
  const nextAncestors = new Set(ancestors).add(value), indent = '  '.repeat(depth);
  const rows = Object.entries(value).map(([key, child]) => `${indent}    <tr><th scope="row">${escapeHTML(key)}</th><td>${renderValue(child, nextAncestors, depth + 3)}</td></tr>`).join('\n');
  return `${indent}<table class="phidias-detail-table">\n${indent}  <tbody>${rows ? `\n${rows}\n${indent}  ` : ''}</tbody>\n${indent}</table>`;
}
function convertJSONToHTMLDetail(value) {
  return renderDetail(parseObject(value));
}

module.exports = {
  type: 'convert_json_to_html_detail',
  name: 'Convert JSON to HTML Detail',
  category: 'Data',
  description: 'Converts a JSON object or list into a vertical HTML detail table with header and value columns.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'json', name: 'JSON', kind: 'value', types: ['text', 'object', 'list'], required: true }
  ],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML Detail', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(_ctx, _options, inputs, setOutput) {
    setOutput('html', convertJSONToHTMLDetail(inputs.json));
    return 'next';
  },
  convertJSONToHTMLDetail,
  renderDetail
};

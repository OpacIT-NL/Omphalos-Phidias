'use strict';

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
function normalizeRows(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map(item => item && typeof item === 'object' && !Array.isArray(item) ? item : { Value: item });
}
function renderTable(value, ancestors = new Set(), depth = 0) {
  if (value && typeof value === 'object') {
    if (ancestors.has(value)) throw new Error('Convert JSON to HTML table cannot convert circular objects');
    ancestors = new Set(ancestors).add(value);
  }
  const rows = normalizeRows(value);
  const indent = '  '.repeat(depth);
  if (!rows.length) return `${indent}<table>\n${indent}  <tbody></tbody>\n${indent}</table>`;
  const columns = [];
  const seen = new Set();
  for (const row of rows) for (const key of Object.keys(row)) {
    if (!seen.has(key)) { seen.add(key); columns.push(key); }
  }
  const header = columns.map(column => `<th>${escapeHTML(column)}</th>`).join('');
  const body = rows.map(row => {
    const cells = columns.map(column => {
      const cell = row[column];
      if (cell !== null && typeof cell === 'object') return `<td>\n${renderTable(cell, ancestors, depth + 4)}\n${indent}      </td>`;
      return `<td>${cell === null || cell === undefined ? '' : escapeHTML(cell)}</td>`;
    }).join('');
    return `${indent}    <tr>${cells}</tr>`;
  }).join('\n');
  return `${indent}<table>\n${indent}  <thead>\n${indent}    <tr>${header}</tr>\n${indent}  </thead>\n${indent}  <tbody>\n${body}\n${indent}  </tbody>\n${indent}</table>`;
}
function parseInput(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); }
    catch { throw new Error('Convert JSON to HTML table requires valid JSON text, an object, or a list of objects'); }
  }
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  throw new Error('Convert JSON to HTML table requires JSON text, an object, or a list of objects');
}
function convertJSONToHTMLTable(value) {
  return renderTable(parseInput(value));
}

module.exports = {
  type: 'convert_json_to_html_table',
  name: 'Convert JSON to HTML Table',
  category: 'Data',
  description: 'Converts layered JSON into an HTML table, nesting child tables inside cells.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'json', name: 'JSON', kind: 'value', types: ['text', 'object', 'list'], required: true }
  ],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML Table', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(_ctx, _options, inputs, setOutput) {
    setOutput('html', convertJSONToHTMLTable(inputs.json));
    return 'next';
  },
  convertJSONToHTMLTable
};

'use strict';

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
function displayValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
function parseInput(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); }
    catch { throw new Error('Convert JSON to HTML table requires valid JSON text, an object, or a list of objects'); }
  }
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  throw new Error('Convert JSON to HTML table requires JSON text, an object, or a list of objects');
}
function convertJSONToHTMLTable(value) {
  const values = parseInput(value);
  if (!values.length) return '<table>\n  <tbody></tbody>\n</table>';
  const rows = values.map(item => item && typeof item === 'object' && !Array.isArray(item) ? item : { Value: item });
  const columns = [];
  const seen = new Set();
  for (const row of rows) for (const key of Object.keys(row)) {
    if (!seen.has(key)) { seen.add(key); columns.push(key); }
  }
  const header = columns.map(column => `<th>${escapeHTML(column)}</th>`).join('');
  const body = rows.map(row => `    <tr>${columns.map(column => `<td>${escapeHTML(displayValue(row[column]))}</td>`).join('')}</tr>`).join('\n');
  return `<table>\n  <thead>\n    <tr>${header}</tr>\n  </thead>\n  <tbody>\n${body}\n  </tbody>\n</table>`;
}

module.exports = {
  type: 'convert_json_to_html_table',
  name: 'Convert JSON to HTML Table',
  category: 'Data',
  description: 'Converts JSON text, an object, or a list of objects into an HTML table.',
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

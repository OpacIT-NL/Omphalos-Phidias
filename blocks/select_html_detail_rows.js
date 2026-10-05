'use strict';
const { outerTable, directRows, directCells, headerText } = require('./select_html_table_columns');

function detailRows(table) {
  return directRows(table).map(row => ({ ...row, cells: directCells(row.html) })).filter(row => row.cells.length >= 2 && row.cells[0].tag === 'th');
}
function detailRowName(row) { return headerText(row.cells[0].html); }
function selectHTMLDetailRows(html, rowsText) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('HTML Detail is required');
  const selectedNames = String(rowsText ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (!selectedNames.length) throw new Error('Enter at least one comma-separated row header');
  const outer = outerTable(html), rows = detailRows(outer.html);
  if (!rows.length) throw new Error('HTML detail does not contain headed rows');
  const names = rows.map(row => detailRowName(row).toLocaleLowerCase());
  const missing = selectedNames.filter(name => !names.includes(name.toLocaleLowerCase()));
  if (missing.length) throw new Error(`Row${missing.length === 1 ? '' : 's'} not found: ${missing.join(', ')}`);
  const wanted = new Set(selectedNames.map(name => name.toLocaleLowerCase()));
  let filtered = '', position = 0;
  for (const row of rows) {
    filtered += outer.html.slice(position, row.start);
    if (wanted.has(detailRowName(row).toLocaleLowerCase())) filtered += row.html;
    position = row.end;
  }
  filtered += outer.html.slice(position);
  return html.slice(0, outer.start) + filtered + html.slice(outer.end);
}

module.exports = {
  type: 'select_html_detail_rows',
  name: 'Select HTML Detail Rows',
  category: 'Data',
  description: 'Keeps selected detail rows and removes every non-selected row.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML Detail', kind: 'value', types: ['text'], required: true },
    { id: 'rows', name: 'Row Headers', kind: 'value', types: ['text'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] },
    { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'html', name: 'Filtered HTML Detail', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(_ctx, _options, inputs, setOutput) {
    try {
      setOutput('html', selectHTMLDetailRows(inputs.html, inputs.rows));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('html', '');
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  selectHTMLDetailRows,
  detailRows,
  detailRowName
};

'use strict';
const { outerTable, headerText } = require('./select_html_table_columns');
const { detailRows, detailRowName } = require('./select_html_detail_rows');

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function sortHTMLDetailRows(html, sortBy = 'Header', direction = 'Ascending') {
  if (typeof html !== 'string' || !html.trim()) throw new Error('HTML Detail is required');
  if (!['Header', 'Value'].includes(sortBy)) throw new Error('Sort By must be Header or Value');
  if (!['Ascending', 'Descending'].includes(direction)) throw new Error('Sort Direction must be Ascending or Descending');
  const outer = outerTable(html), rows = detailRows(outer.html);
  if (!rows.length) throw new Error('HTML detail does not contain headed rows');
  const ordered = rows.map((row, index) => ({
    row, index, value: sortBy === 'Header' ? detailRowName(row) : headerText(row.cells[1].html)
  })).sort((left, right) => {
    const compared = collator.compare(left.value, right.value);
    return (direction === 'Descending' ? -compared : compared) || left.index - right.index;
  });
  let changed = '', position = 0, sortedIndex = 0;
  for (const row of rows) {
    changed += outer.html.slice(position, row.start) + ordered[sortedIndex++].row.html;
    position = row.end;
  }
  changed += outer.html.slice(position);
  return html.slice(0, outer.start) + changed + html.slice(outer.end);
}

module.exports = {
  type: 'sort_html_detail_rows',
  name: 'Sort HTML Detail Rows',
  category: 'Data',
  description: 'Sorts detail rows naturally by their header or value.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML Detail', kind: 'value', types: ['text'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] },
    { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'html', name: 'Sorted HTML Detail', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [
    { key: 'sort_by', label: 'Sort By', type: 'select', choices: ['Header', 'Value'], default: 'Header' },
    { key: 'direction', label: 'Sort Direction', type: 'select', choices: ['Ascending', 'Descending'], default: 'Ascending' }
  ],
  async execute(_ctx, options, inputs, setOutput) {
    try {
      setOutput('html', sortHTMLDetailRows(inputs.html, options.sort_by, options.direction));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('html', '');
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  sortHTMLDetailRows
};

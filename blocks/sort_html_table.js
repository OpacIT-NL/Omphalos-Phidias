'use strict';
const { outerTable, directRows, directCells, headerText } = require('./select_html_table_columns');

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function rowValue(row, columnIndex) {
  const cell = directCells(row.html)[columnIndex];
  return cell ? headerText(cell.html) : '';
}
function sortHTMLTable(html, column, direction = 'Ascending') {
  if (typeof html !== 'string' || !html.trim()) throw new Error('HTML Table is required');
  column = String(column ?? '').trim();
  if (!column) throw new Error('Column Header is required');
  if (!['Ascending', 'Descending'].includes(direction)) throw new Error('Sort Direction must be Ascending or Descending');
  const outer = outerTable(html), rows = directRows(outer.html);
  const headerRow = rows.find(row => directCells(row.html).some(cell => cell.tag === 'th'));
  if (!headerRow) throw new Error('HTML table does not contain column headings');
  const headers = directCells(headerRow.html).map(cell => headerText(cell.html));
  const columnIndex = headers.findIndex(header => header.toLocaleLowerCase() === column.toLocaleLowerCase());
  if (columnIndex < 0) throw new Error(`Column not found: ${column}`);
  const hasBody = rows.some(row => row.section === 'tbody');
  const sortable = rows.filter(row => (hasBody ? row.section === 'tbody' : row.section !== 'thead' && row.section !== 'tfoot') && !directCells(row.html).some(cell => cell.tag === 'th'));
  const ordered = sortable.map((row, index) => ({ row, index, value: rowValue(row, columnIndex) })).sort((left, right) => {
    const leftEmpty = !left.value, rightEmpty = !right.value;
    if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
    const compared = collator.compare(left.value, right.value);
    return (direction === 'Descending' ? -compared : compared) || left.index - right.index;
  });
  const sortableStarts = new Set(sortable.map(row => row.start));
  let result = '', position = 0, sortedIndex = 0;
  for (const row of rows) {
    result += outer.html.slice(position, row.start);
    result += sortableStarts.has(row.start) ? ordered[sortedIndex++].row.html : row.html;
    position = row.end;
  }
  result += outer.html.slice(position);
  return html.slice(0, outer.start) + result + html.slice(outer.end);
}

module.exports = {
  type: 'sort_html_table',
  name: 'Sort HTML Table',
  category: 'Data',
  description: 'Sorts table rows using the values under a selected column heading.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML Table', kind: 'value', types: ['text'], required: true },
    { id: 'column', name: 'Column Header', kind: 'value', types: ['text'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] },
    { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'html', name: 'Sorted HTML Table', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [
    { key: 'direction', label: 'Sort Direction', type: 'select', choices: ['Ascending', 'Descending'], default: 'Ascending' }
  ],
  async execute(_ctx, options, inputs, setOutput) {
    try {
      setOutput('html', sortHTMLTable(inputs.html, inputs.column, options.direction));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('html', '');
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  sortHTMLTable
};

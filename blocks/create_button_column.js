'use strict';
const { outerTable, directRows, directCells, headerText } = require('./select_html_table_columns');

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function appendCell(row, cell) {
  const matches = [...row.matchAll(/<\s*\/\s*tr\s*>/gi)];
  if (!matches.length) throw new Error('HTML contains an unclosed table row');
  const closing = matches.at(-1);
  return row.slice(0, closing.index) + cell + row.slice(closing.index);
}
function createButtonColumn(html, columnName, urlTemplate, argumentColumn) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('HTML Table is required');
  columnName = String(columnName ?? '').trim();
  urlTemplate = String(urlTemplate ?? '').trim();
  argumentColumn = String(argumentColumn ?? '').trim();
  if (!columnName) throw new Error('Name of Column is required');
  if (!urlTemplate) throw new Error('URL is required');
  if (!argumentColumn) throw new Error('Argument Column is required');
  if (/^(?:javascript|data|vbscript)\s*:/i.test(urlTemplate)) throw new Error('URL uses an unsafe scheme');
  const outer = outerTable(html), rows = directRows(outer.html);
  const headerRow = rows.find(row => directCells(row.html).some(cell => cell.tag === 'th'));
  if (!headerRow) throw new Error('HTML table does not contain column headings');
  const headers = directCells(headerRow.html).map(cell => headerText(cell.html));
  const normalizedName = columnName.toLocaleLowerCase();
  if (headers.some(header => header.toLocaleLowerCase() === normalizedName)) throw new Error(`Column already exists: ${columnName}`);
  const argumentIndex = headers.findIndex(header => header.toLocaleLowerCase() === argumentColumn.toLocaleLowerCase());
  if (argumentIndex < 0) throw new Error(`Argument column not found: ${argumentColumn}`);
  const hasBody = rows.some(row => row.section === 'tbody');
  let result = '', position = 0;
  for (const row of rows) {
    result += outer.html.slice(position, row.start);
    const cells = directCells(row.html);
    let added;
    if (row.start === headerRow.start) added = `<th>${escapeHTML(columnName)}</th>`;
    else if (cells.some(cell => cell.tag === 'th')) added = '<th></th>';
    else if ((hasBody && row.section === 'tbody') || (!hasBody && row.section !== 'thead' && row.section !== 'tfoot')) {
      const argument = cells[argumentIndex] ? headerText(cells[argumentIndex].html) : '';
      const url = urlTemplate.replaceAll('${text1}', encodeURIComponent(argument));
      added = `<td><a class="phidias-table-button" href="${escapeHTML(url)}" role="button">${escapeHTML(columnName)}</a></td>`;
    } else added = '<td></td>';
    result += appendCell(row.html, added);
    position = row.end;
  }
  result += outer.html.slice(position);
  return html.slice(0, outer.start) + result + html.slice(outer.end);
}

module.exports = {
  type: 'create_button_column',
  name: 'Create Button Column',
  category: 'Data',
  description: 'Adds a link-button column whose URL can include a row value through ${text1}.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML Table', kind: 'value', types: ['text'], required: true },
    { id: 'column_name', name: 'Name of Column', kind: 'value', types: ['text'], required: true },
    { id: 'url', name: 'URL', kind: 'value', types: ['text'], required: true },
    { id: 'argument_column', name: 'Argument Column', kind: 'value', types: ['text'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] },
    { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'html', name: 'HTML Table', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(_ctx, _options, inputs, setOutput) {
    try {
      setOutput('html', createButtonColumn(inputs.html, inputs.column_name, inputs.url, inputs.argument_column));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('html', '');
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  createButtonColumn
};

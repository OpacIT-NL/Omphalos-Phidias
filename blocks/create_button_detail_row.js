'use strict';
const { outerTable, headerText } = require('./select_html_table_columns');
const { detailRows, detailRowName } = require('./select_html_detail_rows');

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function createButtonDetailRow(html, rowName, urlTemplate, argumentRow) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('HTML Detail is required');
  rowName = String(rowName ?? '').trim();
  urlTemplate = String(urlTemplate ?? '').trim();
  argumentRow = String(argumentRow ?? '').trim();
  if (!rowName) throw new Error('Name of Row is required');
  if (!urlTemplate) throw new Error('URL is required');
  if (!argumentRow) throw new Error('Argument Row is required');
  if (/^(?:javascript|data|vbscript)\s*:/i.test(urlTemplate)) throw new Error('URL uses an unsafe scheme');
  const outer = outerTable(html), rows = detailRows(outer.html);
  if (!rows.length) throw new Error('HTML detail does not contain headed rows');
  if (rows.some(row => detailRowName(row).toLocaleLowerCase() === rowName.toLocaleLowerCase())) throw new Error(`Row already exists: ${rowName}`);
  const argument = rows.find(row => detailRowName(row).toLocaleLowerCase() === argumentRow.toLocaleLowerCase());
  if (!argument) throw new Error(`Argument row not found: ${argumentRow}`);
  const value = headerText(argument.cells[1].html), url = urlTemplate.replaceAll('${text1}', encodeURIComponent(value));
  const row = `<tr><th scope="row">${escapeHTML(rowName)}</th><td><a class="phidias-table-button phidias-detail-button" href="${escapeHTML(url)}" role="button">${escapeHTML(rowName)}</a></td></tr>`;
  const insertAt = rows.at(-1).end;
  const changed = outer.html.slice(0, insertAt) + row + outer.html.slice(insertAt);
  return html.slice(0, outer.start) + changed + html.slice(outer.end);
}

module.exports = {
  type: 'create_button_detail_row',
  name: 'Create Button Detail Row',
  category: 'Data',
  description: 'Adds a link-button row whose URL can include another detail-row value through ${text1}.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML Detail', kind: 'value', types: ['text'], required: true },
    { id: 'row_name', name: 'Name of Row', kind: 'value', types: ['text'], required: true },
    { id: 'url', name: 'URL', kind: 'value', types: ['text'], required: true },
    { id: 'argument_row', name: 'Argument Row', kind: 'value', types: ['text'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] },
    { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'html', name: 'HTML Detail', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(_ctx, _options, inputs, setOutput) {
    try {
      setOutput('html', createButtonDetailRow(inputs.html, inputs.row_name, inputs.url, inputs.argument_row));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('html', '');
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  createButtonDetailRow
};

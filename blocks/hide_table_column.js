'use strict';

const {
  outerTable,
  directRows,
  directCells,
  headerText,
  normalizeHeaderName
} = require('./select_html_table_columns');

const HIDDEN_CLASS = 'phidias-table-hidden-column';
const STYLE = `<style data-phidias-hidden-table-column>.${HIDDEN_CLASS}{display:none!important}</style>`;

function addClass(openingTag, className) {
  const classAttribute = openingTag.match(/\bclass\s*=\s*(["'])([\s\S]*?)\1/i);
  if (classAttribute) {
    const classes = classAttribute[2].split(/\s+/).filter(Boolean);
    if (!classes.includes(className)) classes.push(className);
    return openingTag.replace(classAttribute[0], `class=${classAttribute[1]}${classes.join(' ')}${classAttribute[1]}`);
  }
  const tagName = openingTag.match(/^<\s*(?:th|td)\b/i);
  if (!tagName) throw new Error('HTML table contains an invalid cell');
  return openingTag.slice(0, tagName[0].length) + ` class="${className}"` + openingTag.slice(tagName[0].length);
}

function hideCell(cell) {
  const openingEnd = cell.indexOf('>');
  if (openingEnd < 0) throw new Error('HTML table contains an invalid cell');
  let opening = addClass(cell.slice(0, openingEnd + 1), HIDDEN_CLASS);
  if (!/\sdata-phidias-hidden-column(?:\s|=|>)/i.test(opening)) {
    opening = opening.slice(0, -1) + ' data-phidias-hidden-column="true">';
  }
  if (!/\shidden(?:\s|=|>)/i.test(opening)) opening = opening.slice(0, -1) + ' hidden>';
  if (!/\saria-hidden\s*=/i.test(opening)) opening = opening.slice(0, -1) + ' aria-hidden="true">';
  return opening + cell.slice(openingEnd + 1);
}

function hideCellsInRow(row, indexes) {
  const cells = directCells(row);
  if (!cells.length) return row;
  const hiddenIndexes = new Set(indexes);
  let output = '', position = 0;
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index];
    output += row.slice(position, cell.start);
    output += hiddenIndexes.has(index) ? hideCell(cell.html) : cell.html;
    position = cell.end;
  }
  return output + row.slice(position);
}

function hideTableColumn(html, columnName) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('HTML Table is required');
  columnName = String(columnName ?? '').trim();
  if (!columnName) throw new Error('Column Header is required');

  const outer = outerTable(html);
  const rows = directRows(outer.html);
  const headerRow = rows.find(row => directCells(row.html).some(cell => cell.tag === 'th'));
  if (!headerRow) throw new Error('HTML table does not contain column headings');

  const requested = normalizeHeaderName(columnName);
  const headers = directCells(headerRow.html);
  const indexes = headers
    .map((cell, index) => normalizeHeaderName(headerText(cell.html)) === requested ? index : -1)
    .filter(index => index >= 0);
  if (!indexes.length) throw new Error(`Column not found: ${columnName}`);

  let hiddenTable = '', position = 0;
  for (const row of rows) {
    hiddenTable += outer.html.slice(position, row.start) + hideCellsInRow(row.html, indexes);
    position = row.end;
  }
  hiddenTable += outer.html.slice(position);

  const style = /<style\b[^>]*\bdata-phidias-hidden-table-column\b/i.test(html) ? '' : STYLE;
  return html.slice(0, outer.start) + style + hiddenTable + html.slice(outer.end);
}

module.exports = {
  type: 'hide_table_column',
  name: 'Hide Table Column',
  category: 'Data',
  description: 'Hides a table column visually while keeping its header and cell values in the HTML for other blocks and browser code.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML Table', kind: 'value', types: ['text'], required: true },
    { id: 'column', name: 'Column Header', kind: 'value', types: ['text'], required: true }
  ],
  fields: [],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] },
    { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'html', name: 'HTML Table', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  async execute(_ctx, _options, inputs, setOutput) {
    try {
      setOutput('html', hideTableColumn(inputs.html, inputs.column));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('html', '');
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  hideTableColumn,
  hideCell
};


'use strict';

const TAG = /<!--[\s\S]*?-->|<![^>]*>|<\/?\s*([a-zA-Z][\w:-]*)\b[^>]*>/g;
function closing(tag) { return /^<\s*\//.test(tag); }
function selfClosing(tag) { return /\/\s*>$/.test(tag); }
function decodeHTML(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, code) => {
    if (code[0] === '#') {
      const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
    }
    return named[code.toLowerCase()] ?? entity;
  });
}
function headerText(cell) {
  return decodeHTML(cell.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}
function matchingTableEnd(html, start) {
  TAG.lastIndex = start;
  let depth = 0, match;
  while ((match = TAG.exec(html))) {
    const name = match[1]?.toLowerCase();
    if (name !== 'table') continue;
    if (closing(match[0])) {
      if (--depth === 0) return TAG.lastIndex;
    } else if (!selfClosing(match[0])) depth++;
  }
  throw new Error('HTML contains an unclosed table');
}
function outerTable(html) {
  TAG.lastIndex = 0;
  let opening;
  while ((opening = TAG.exec(html))) if (opening[1]?.toLowerCase() === 'table' && !closing(opening[0])) break;
  if (!opening) throw new Error('HTML does not contain a table');
  const start = opening.index, end = matchingTableEnd(html, opening.index);
  return { start, end, html: html.slice(start, end) };
}
function directRows(table) {
  const rows = [];
  TAG.lastIndex = 0;
  let tableDepth = 0, rowStart = -1, section = null, rowSection = null, match;
  while ((match = TAG.exec(table))) {
    const name = match[1]?.toLowerCase();
    if (name === 'table') {
      if (closing(match[0])) tableDepth--;
      else if (!selfClosing(match[0])) tableDepth++;
      continue;
    }
    if (['thead', 'tbody', 'tfoot'].includes(name) && tableDepth === 1) {
      section = closing(match[0]) ? null : name;
      continue;
    }
    if (name !== 'tr' || tableDepth !== 1) continue;
    if (!closing(match[0]) && rowStart < 0) { rowStart = match.index; rowSection = section; }
    else if (closing(match[0]) && rowStart >= 0) {
      rows.push({ start: rowStart, end: TAG.lastIndex, html: table.slice(rowStart, TAG.lastIndex), section: rowSection });
      rowStart = -1;
    }
  }
  if (rowStart >= 0) throw new Error('HTML contains an unclosed table row');
  return rows;
}
function directCells(row) {
  const cells = [];
  TAG.lastIndex = 0;
  let tableDepth = 0, cell = null, match;
  while ((match = TAG.exec(row))) {
    const name = match[1]?.toLowerCase();
    if (name === 'table') {
      if (closing(match[0])) tableDepth--;
      else if (!selfClosing(match[0])) tableDepth++;
      continue;
    }
    if (tableDepth !== 0 || !['th', 'td'].includes(name)) continue;
    if (!closing(match[0]) && !cell) cell = { tag: name, start: match.index };
    else if (closing(match[0]) && cell?.tag === name) {
      cells.push({ tag: name, start: cell.start, end: TAG.lastIndex, html: row.slice(cell.start, TAG.lastIndex) });
      cell = null;
    }
  }
  if (cell) throw new Error('HTML contains an unclosed table cell');
  return cells;
}
function filterRow(row, selectedIndexes) {
  const cells = directCells(row);
  if (!cells.length) return row;
  let output = '', position = 0;
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index];
    output += row.slice(position, cell.start);
    if (selectedIndexes.has(index)) output += cell.html;
    position = cell.end;
  }
  return output + row.slice(position);
}
function selectHTMLTableColumns(html, columnsText) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('HTML Table is required');
  const selectedNames = String(columnsText ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (!selectedNames.length) throw new Error('Enter at least one comma-separated column header');
  const wanted = new Set(selectedNames.map(value => value.toLocaleLowerCase()));
  const { start: tableStart, end: tableEnd, html: table } = outerTable(html);
  const rows = directRows(table);
  const headerRow = rows.find(row => directCells(row.html).some(cell => cell.tag === 'th'));
  if (!headerRow) throw new Error('HTML table does not contain column headings');
  const headers = directCells(headerRow.html);
  const normalizedHeaders = headers.map(cell => headerText(cell.html).toLocaleLowerCase());
  const missing = selectedNames.filter(name => !normalizedHeaders.includes(name.toLocaleLowerCase()));
  if (missing.length) throw new Error(`Column${missing.length === 1 ? '' : 's'} not found: ${missing.join(', ')}`);
  const selectedIndexes = new Set(normalizedHeaders.map((name, index) => wanted.has(name) ? index : -1).filter(index => index >= 0));
  let filteredTable = '', position = 0;
  for (const row of rows) {
    filteredTable += table.slice(position, row.start) + filterRow(row.html, selectedIndexes);
    position = row.end;
  }
  filteredTable += table.slice(position);
  return html.slice(0, tableStart) + filteredTable + html.slice(tableEnd);
}

module.exports = {
  type: 'select_html_table_columns',
  name: 'Select HTML Table Columns',
  category: 'Data',
  description: 'Keeps selected table columns and removes every non-selected column.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML Table', kind: 'value', types: ['text'], required: true },
    { id: 'columns', name: 'Column Headers', kind: 'value', types: ['text'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] },
    { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'html', name: 'Filtered HTML Table', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(_ctx, _options, inputs, setOutput) {
    try {
      setOutput('html', selectHTMLTableColumns(inputs.html, inputs.columns));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('html', '');
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  selectHTMLTableColumns,
  outerTable,
  directRows,
  directCells,
  headerText
};

'use strict';

const { outerTable, directRows, directCells, headerText } = require('./select_html_table_columns');

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function replaceCellContent(cell, content) {
  const openingEnd = cell.indexOf('>');
  const closingStart = cell.toLocaleLowerCase().lastIndexOf('</th');
  if (openingEnd < 0 || closingStart < openingEnd) throw new Error('HTML table contains an invalid column heading');
  return cell.slice(0, openingEnd + 1) + content + cell.slice(closingStart);
}

function enhanceHeaderRow(row) {
  const cells = directCells(row);
  let output = '', position = 0;
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index];
    output += row.slice(position, cell.start);
    if (cell.tag !== 'th') {
      output += cell.html;
    } else {
      const name = headerText(cell.html) || `Column ${index + 1}`;
      const openingEnd = cell.html.indexOf('>');
      const closingStart = cell.html.toLocaleLowerCase().lastIndexOf('</th');
      const original = cell.html.slice(openingEnd + 1, closingStart);
      const controls = `<span class="phidias-table-column-controls"><button type="button" class="phidias-table-sort" data-phidias-column="${index}" title="Sort by ${escapeHTML(name)}">${original}<span class="phidias-table-sort__indicator" aria-hidden="true">↕</span></button><input type="search" class="phidias-table-search" data-phidias-column="${index}" aria-label="Search ${escapeHTML(name)}" placeholder="Search ${escapeHTML(name)}"></span>`;
      output += replaceCellContent(cell.html, controls);
    }
    position = cell.end;
  }
  return output + row.slice(position);
}

function enhanceTable(table) {
  const rows = directRows(table);
  const headerRow = rows.find(row => directCells(row.html).some(cell => cell.tag === 'th'));
  if (!headerRow) throw new Error('HTML table does not contain column headings');
  const headingCount = directCells(headerRow.html).filter(cell => cell.tag === 'th').length;
  if (!headingCount) throw new Error('HTML table does not contain column headings');
  return table.slice(0, headerRow.start) + enhanceHeaderRow(headerRow.html) + table.slice(headerRow.end);
}

const STYLE = `<style>
.phidias-table-search-sort{max-width:100%;overflow-x:auto}
.phidias-table-search-sort .phidias-table-column-controls{display:grid;gap:.35rem;min-width:7rem}
.phidias-table-search-sort .phidias-table-sort{display:flex;width:100%;align-items:center;justify-content:space-between;gap:.5rem;border:0;padding:0;background:transparent;color:inherit;font:inherit;font-weight:inherit;text-align:left;cursor:pointer}
.phidias-table-search-sort .phidias-table-sort__indicator{flex:0 0 auto;font-size:.8em;opacity:.65}
.phidias-table-search-sort .phidias-table-search{box-sizing:border-box;width:100%;min-width:0;border:1px solid currentColor;border-radius:4px;padding:.3rem .45rem;background:var(--iris-surface,#fff);color:inherit;font:inherit;font-weight:400;opacity:.9}
.phidias-table-search-sort .phidias-table-search::placeholder{color:inherit;opacity:.55}
</style>`;

const SCRIPT = `<script>
(() => {
  const script = document.currentScript;
  const root = script && script.previousElementSibling;
  const table = root && root.querySelector('table');
  if (!table) return;
  const directRows = section => Array.from(section ? section.rows : []).filter(row => row.closest('table') === table);
  const bodies = Array.from(table.tBodies);
  const dataRows = () => bodies.flatMap(directRows);
  const searches = Array.from(root.querySelectorAll('.phidias-table-search'));
  const buttons = Array.from(root.querySelectorAll('.phidias-table-sort'));
  const value = (row, index) => (row.cells[index]?.textContent || '').trim();
  const compare = (left, right, direction) => {
    const leftEmpty = !left.value;
    const rightEmpty = !right.value;
    if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
    return direction * left.value.localeCompare(right.value, undefined, { numeric: true, sensitivity: 'base' }) || left.index - right.index;
  };
  const filter = () => {
    const terms = searches.map(input => ({ column: Number(input.dataset.phidiasColumn), value: input.value.trim().toLocaleLowerCase() }));
    for (const row of dataRows()) row.hidden = terms.some(term => term.value && !value(row, term.column).toLocaleLowerCase().includes(term.value));
  };
  for (const input of searches) input.addEventListener('input', filter);
  for (const button of buttons) button.addEventListener('click', () => {
    const column = Number(button.dataset.phidiasColumn);
    const wasAscending = button.dataset.phidiasDirection === 'ascending';
    const direction = wasAscending ? -1 : 1;
    for (const other of buttons) {
      delete other.dataset.phidiasDirection;
      other.closest('th')?.removeAttribute('aria-sort');
      const indicator = other.querySelector('.phidias-table-sort__indicator');
      if (indicator) indicator.textContent = '↕';
    }
    button.dataset.phidiasDirection = direction === 1 ? 'ascending' : 'descending';
    button.closest('th')?.setAttribute('aria-sort', button.dataset.phidiasDirection);
    const indicator = button.querySelector('.phidias-table-sort__indicator');
    if (indicator) indicator.textContent = direction === 1 ? '↑' : '↓';
    for (const body of bodies) {
      const rows = directRows(body).map((row, index) => ({ row, index, value: value(row, column) }));
      rows.sort((left, right) => compare(left, right, direction));
      for (const item of rows) body.appendChild(item.row);
    }
    filter();
  });
})();
</script>`;

function enableSearchAndSortingForTable(html) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('HTML Table is required');
  const outer = outerTable(html);
  const enhanced = enhanceTable(outer.html);
  const widget = `<div class="phidias-table-search-sort">${STYLE}${enhanced}</div>${SCRIPT}`;
  return html.slice(0, outer.start) + widget + html.slice(outer.end);
}

module.exports = {
  type: 'enable_search_and_sorting_for_table',
  name: 'Enable Search and Sorting for Table',
  category: 'Data',
  description: 'Adds a per-column search field and clickable sorting controls to an HTML table.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML Table', kind: 'value', types: ['text'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] },
    { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'html', name: 'Searchable and Sortable Table', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(_ctx, _options, inputs, setOutput) {
    try {
      setOutput('html', enableSearchAndSortingForTable(inputs.html));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('html', '');
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  enableSearchAndSortingForTable
};

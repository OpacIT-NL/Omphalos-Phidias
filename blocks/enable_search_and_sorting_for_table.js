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
  const cells = directCells(row), headings = [];
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
      headings.push({ index, name });
      const controls = `<span class="phidias-table-column-controls"><button type="button" class="phidias-table-sort" data-phidias-column="${index}" title="Sort by ${escapeHTML(name)}">${original}<span class="phidias-table-sort__indicator" aria-hidden="true">↕</span></button><input type="search" class="phidias-table-search" data-phidias-column="${index}" aria-label="Search ${escapeHTML(name)}" placeholder="Search ${escapeHTML(name)}"></span>`;
      output += replaceCellContent(cell.html, controls);
    }
    position = cell.end;
  }
  return { html: output + row.slice(position), headings };
}

function enhanceTable(table) {
  const rows = directRows(table);
  const headerRow = rows.find(row => directCells(row.html).some(cell => cell.tag === 'th'));
  if (!headerRow) throw new Error('HTML table does not contain column headings');
  const headingCount = directCells(headerRow.html).filter(cell => cell.tag === 'th').length;
  if (!headingCount) throw new Error('HTML table does not contain column headings');
  const header = enhanceHeaderRow(headerRow.html);
  return { html: table.slice(0, headerRow.start) + header.html + table.slice(headerRow.end), headings: header.headings };
}

function mobileSearchMenu(headings) {
  const fields = headings.map(({ index, name }) => `<label class="phidias-table-mobile-search__field"><span>${escapeHTML(name)}</span><input type="search" class="phidias-table-search phidias-table-search--mobile" data-phidias-column="${index}" aria-label="Search ${escapeHTML(name)}" placeholder="Search ${escapeHTML(name)}"></label>`).join('');
  return `<details class="phidias-table-mobile-search"><summary>Search and filter</summary><div class="phidias-table-mobile-search__fields">${fields}</div></details>`;
}

const STYLE = `<style>
.phidias-table-search-sort{max-width:100%}
.phidias-table-search-sort .phidias-table-scroll{max-width:100%;overflow-x:auto}
.phidias-table-search-sort .phidias-table-column-controls{display:grid;gap:.35rem;min-width:7rem}
.phidias-table-search-sort .phidias-table-sort{display:flex;width:100%;align-items:center;justify-content:space-between;gap:.5rem;border:0;padding:0;background:transparent;color:inherit;font:inherit;font-weight:inherit;text-align:left;cursor:pointer}
.phidias-table-search-sort .phidias-table-sort__indicator{flex:0 0 auto;font-size:.8em;opacity:.65}
.phidias-table-search-sort .phidias-table-search{box-sizing:border-box;width:100%;min-width:0;border:1px solid currentColor;border-radius:4px;padding:.3rem .45rem;background:var(--iris-surface,#fff);color:inherit;font:inherit;font-weight:400;opacity:.9}
.phidias-table-search-sort .phidias-table-search::placeholder{color:inherit;opacity:.55}
.phidias-table-search-sort .phidias-table-mobile-search{display:none}
@media (max-width:48rem){
  .phidias-table-search-sort .phidias-table-column-controls>.phidias-table-search{display:none}
  .phidias-table-search-sort .phidias-table-mobile-search{display:block;margin:0 0 .75rem;border:1px solid currentColor;border-radius:.6rem;background:var(--iris-surface,#fff);color:inherit}
  .phidias-table-search-sort .phidias-table-mobile-search>summary{display:flex;min-height:2.75rem;box-sizing:border-box;align-items:center;justify-content:space-between;gap:.75rem;padding:.7rem .85rem;font:inherit;font-weight:700;cursor:pointer;list-style:none;touch-action:manipulation}
  .phidias-table-search-sort .phidias-table-mobile-search>summary::-webkit-details-marker{display:none}
  .phidias-table-search-sort .phidias-table-mobile-search>summary::after{content:'+';flex:0 0 auto;font-size:1.25rem;line-height:1}
  .phidias-table-search-sort .phidias-table-mobile-search[open]>summary::after{content:'−'}
  .phidias-table-search-sort .phidias-table-mobile-search__fields{display:grid;gap:.75rem;padding:0 .85rem .85rem}
  .phidias-table-search-sort .phidias-table-mobile-search__field{display:grid;gap:.35rem;min-width:0;font:inherit;font-weight:600}
  .phidias-table-search-sort .phidias-table-mobile-search .phidias-table-search{min-height:2.75rem;padding:.7rem .8rem;border-radius:.5rem;font-size:1rem;line-height:1.25}
}
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
  for (const input of searches) input.addEventListener('input', () => {
    for (const peer of searches) if (peer !== input && peer.dataset.phidiasColumn === input.dataset.phidiasColumn) peer.value = input.value;
    filter();
  });
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
  const widget = `<div class="phidias-table-search-sort">${STYLE}${mobileSearchMenu(enhanced.headings)}<div class="phidias-table-scroll">${enhanced.html}</div></div>${SCRIPT}`;
  return html.slice(0, outer.start) + widget + html.slice(outer.end);
}

module.exports = {
  type: 'enable_search_and_sorting_for_table',
  name: 'Enable Search and Sorting for Table',
  category: 'Data',
  description: 'Adds per-column search fields and clickable sorting controls to an HTML table or detail list, with a collapsible touch-friendly search panel on mobile.',
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

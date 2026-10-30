'use strict';

const SQLITE_EXPERIMENTAL_WARNING = 'SQLite is an experimental feature and might change at any time';

function loadSQLite() {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = function filteredSQLiteWarning(warning, ...options) {
    const message = warning instanceof Error ? warning.message : String(warning);
    const setting = options[0];
    const type = typeof setting === 'string' ? setting : setting?.type;
    if (message === SQLITE_EXPERIMENTAL_WARNING && (!type || type === 'ExperimentalWarning')) return;
    return Reflect.apply(originalEmitWarning, this, [warning, ...options]);
  };
  try {
    return require('node:sqlite');
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

module.exports = { loadSQLite };

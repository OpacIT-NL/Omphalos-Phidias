'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const block = require('../blocks/make_object_sql_ready');

test('Make Object SQL Ready creates embeddable query text and a complete SQL literal', () => {
  const value = {
    name: "O'Reilly",
    enabled: true,
    count: 3,
    empty: null,
    nested: { message: 'first\nsecond', path: 'C:\\temp' }
  };

  assert.equal(
    block.makeObjectSQLReady(value),
    JSON.stringify(value).replace(/\\/g, '\\\\').replace(/'/g, "''")
  );
  assert.equal(block.makeObjectSQLLiteral(value), `'${block.makeObjectSQLReady(value)}'`);
  assert.equal(`INSERT INTO trace (content) VALUES ('${block.makeObjectSQLReady(value)}')`, `INSERT INTO trace (content) VALUES (${block.makeObjectSQLLiteral(value)})`);
});

test('Make Object SQL Ready supports object lists and valid JSON text', () => {
  const value = [{ id: 1 }, { id: 2, text: "it's here" }];
  assert.equal(block.makeObjectSQLReady(value), `[{"id":1},{"id":2,"text":"it''s here"}]`);
  assert.equal(block.makeObjectSQLReady(JSON.stringify(value)), `[{"id":1},{"id":2,"text":"it''s here"}]`);
});

test('Make Object SQL Ready rejects non-JSON input', () => {
  assert.throws(() => block.makeObjectSQLReady('not JSON'), /valid JSON text/);
  assert.throws(() => block.makeObjectSQLReady(42), /JSON object or list/);
});

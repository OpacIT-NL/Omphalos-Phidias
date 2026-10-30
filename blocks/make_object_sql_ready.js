'use strict';

function parseObject(value) {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error('Make Object SQL Ready requires valid JSON text, an object, or a list');
    }
  }

  if (!value || typeof value !== 'object') {
    throw new Error('Make Object SQL Ready requires a JSON object or list');
  }

  return value;
}

function makeObjectSQLReady(value) {
  const json = JSON.stringify(parseObject(value));
  if (json === undefined) throw new Error('The supplied value cannot be converted to JSON');

  // MySQL consumes backslashes while parsing string literals. Preserve the
  // backslashes created by JSON.stringify, then escape SQL apostrophes using
  // the standard doubled-apostrophe form.
  return json.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

function makeObjectSQLLiteral(value) {
  return `'${makeObjectSQLReady(value)}'`;
}

module.exports = {
  type: 'make_object_sql_ready',
  name: 'Make Object SQL Ready',
  category: 'Database Stuff',
  description: 'Converts an object, object list, or JSON text into escaped MySQL query text for Merge Texts (Advanced).',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'object', name: 'Object', kind: 'value', types: ['object', 'list', 'text'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Action', kind: 'action', types: [] },
    { id: 'error', name: 'Action (Error)', kind: 'action', types: [] },
    { id: 'query_text', name: 'Query Text', kind: 'value', types: ['text'] },
    { id: 'sql_literal', name: 'SQL Literal', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(_ctx, _options, inputs, setOutput) {
    try {
      setOutput('query_text', makeObjectSQLReady(inputs.object));
      setOutput('sql_literal', makeObjectSQLLiteral(inputs.object));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('query_text', '');
      setOutput('sql_literal', '');
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  makeObjectSQLReady,
  makeObjectSQLLiteral
};

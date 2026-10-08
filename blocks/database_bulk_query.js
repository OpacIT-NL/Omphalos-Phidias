'use strict';

const MAX_QUERIES = 1000;
const MAX_QUERY_BYTES = 1024 * 1024;

function parseQueries(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) throw new Error('At least one SQL query is required');
    if (text.startsWith('[') || text.startsWith('{')) {
      try { return parseQueries(JSON.parse(text)); } catch (error) {
        if (error.message !== 'At least one SQL query is required' && !error.message.startsWith('Query ')) throw new Error(`Queries JSON is invalid: ${error.message}`);
        throw error;
      }
    }
    const separated = /^\s*---\s*$/m.test(text) ? text.split(/^\s*---\s*$/m) : text.split(/\r?\n/);
    value = separated.filter(query => query.trim());
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    value = value.queries;
  }
  if (!Array.isArray(value) || !value.length) throw new Error('Queries must be a list, JSON list, or text with one query per line');
  if (value.length > MAX_QUERIES) throw new Error(`A bulk query can contain at most ${MAX_QUERIES} queries`);
  let bytes = 0;
  const queries = value.map((entry, index) => {
    const query = typeof entry === 'string' ? entry.trim() : typeof entry?.query === 'string' ? entry.query.trim() : '';
    if (!query) throw new Error(`Query ${index + 1} must be non-empty SQL text`);
    bytes += Buffer.byteLength(query);
    return query;
  });
  if (bytes > MAX_QUERY_BYTES) throw new Error('Combined SQL query text exceeds 1 MB');
  return queries;
}

async function runBulkQueries(database, queries, signal) {
  const connection = typeof database.getConnection === 'function' ? await database.getConnection() : database;
  const responses = [];
  try {
    for (let index = 0; index < queries.length; index++) {
      signal?.throwIfAborted();
      try {
        const [rows] = await connection.execute(queries[index]);
        responses.push(rows);
      } catch (error) {
        error.bulkQueryNumber = index + 1;
        error.bulkQuery = queries[index];
        error.bulkResponses = responses;
        throw error;
      }
    }
    return responses;
  } finally {
    connection.release?.();
  }
}

module.exports = {
  type: 'database_bulk_query',
  name: 'Database SQL Bulk Query',
  category: 'Database Stuff',
  description: 'Executes multiple SQL queries sequentially using the database credential set selected in application settings. Accepts a list, JSON list, or one query per line; use a line containing --- to separate multiline queries.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'queries', name: 'SQL Queries', kind: 'value', types: ['text', 'list', 'object'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Action', kind: 'action', types: [] },
    { id: 'error', name: 'Action (Error)', kind: 'action', types: [] },
    { id: 'responses', name: 'Server Responses', kind: 'value', types: ['list'] },
    { id: 'completed_count', name: 'Completed Query Count', kind: 'value', types: ['number'] },
    { id: 'total_count', name: 'Total Query Count', kind: 'value', types: ['number'] },
    { id: 'failed_query_number', name: 'Failed Query Number', kind: 'value', types: ['number'] },
    { id: 'failed_query', name: 'Failed Query', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(ctx, _options, inputs, setOutput) {
    let queries = [];
    setOutput('responses', []); setOutput('completed_count', 0); setOutput('total_count', 0);
    setOutput('failed_query_number', 0); setOutput('failed_query', ''); setOutput('error_message', '');
    try {
      queries = parseQueries(inputs.queries);
      setOutput('total_count', queries.length);
      const responses = await runBulkQueries(await ctx.database(), queries, ctx.signal);
      setOutput('responses', responses); setOutput('completed_count', responses.length);
      return 'success';
    } catch (error) {
      if (ctx.signal?.aborted) throw error;
      const responses = error.bulkResponses || [];
      const failedQueryNumber = error.bulkQueryNumber || 0;
      setOutput('responses', responses); setOutput('completed_count', responses.length);
      setOutput('total_count', queries.length);
      setOutput('failed_query_number', failedQueryNumber);
      setOutput('failed_query', error.bulkQuery || '');
      setOutput('error_message', failedQueryNumber ? `Query ${failedQueryNumber} failed: ${error.message}` : error.message);
      return 'error';
    }
  },
  parseQueries,
  runBulkQueries
};

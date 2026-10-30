'use strict';

module.exports = {
  type: 'send_query_to_log_database',
  name: 'Send Query to Log Database',
  category: 'Database Stuff',
  description: 'Executes a SQL query using the logging database credential set selected for the deployed RC or Prod application.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'query', name: 'SQL Query', kind: 'value', types: ['text'], required: true }
  ],
  outputs: ['action', 'erroraction'],
  outputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'erroraction', name: 'Action (Error)', kind: 'action', types: [] },
    { id: 'response', name: 'Server Response', kind: 'value', types: ['object', 'list', 'unspecified'] },
    { id: 'errormsg', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(ctx, _options, inputs, setOutput) {
    try {
      const database = await ctx.logDatabase();
      const [rows] = await database.execute(String(inputs.query));
      setOutput('response', rows);
      setOutput('errormsg', '');
      return 'action';
    } catch (error) {
      if (ctx.signal?.aborted) throw error;
      setOutput('response', null);
      setOutput('errormsg', error.message);
      return 'erroraction';
    }
  }
};

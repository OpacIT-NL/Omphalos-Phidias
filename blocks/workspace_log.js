'use strict';

module.exports = {
  type: 'workspace_log',
  name: 'On Workspace Log',
  category: 'Triggers',
  description: 'Runs for every block event when Log all runs to log block is enabled in the workspace settings.',
  trigger: 'workspace_log',
  fields: [],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'logged_in_user', name: 'Logged In User', kind: 'value', types: ['text'] },
    { id: 'content', name: 'Content', kind: 'value', types: ['object'] },
    { id: 'run_id', name: 'Run ID', kind: 'value', types: ['text'] }
  ]
};

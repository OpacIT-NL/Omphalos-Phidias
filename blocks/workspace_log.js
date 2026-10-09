'use strict';

module.exports = {
  type: 'workspace_log',
  name: 'On Workspace Log',
  category: 'Triggers',
  description: 'Application-wide listener for every block event from active workspaces with Log all runs to log block enabled. It may be placed once in a dedicated logging workspace.',
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

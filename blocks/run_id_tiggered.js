'use strict';

module.exports = {
  type: 'run_id_tiggered',
  name: 'On Run ID Created',
  category: 'Triggers',
  description: 'Application-wide listener that runs once when an active workspace with Log all runs to log block enabled creates a Run ID. It may be placed once in a dedicated logging workspace.',
  trigger: 'run_id_triggered',
  fields: [],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'run_id', name: 'Run ID', kind: 'value', types: ['text'] },
    { id: 'started_at', name: 'Started At', kind: 'value', types: ['text'] },
    { id: 'logged_in_user', name: 'Logged In User', kind: 'value', types: ['text'] },
    { id: 'workspace_name', name: 'Workspace Name', kind: 'value', types: ['text'] },
    { id: 'workspace_number_id', name: 'Workspace Number ID', kind: 'value', types: ['number'] },
    { id: 'workspace_id', name: 'Workspace UUID', kind: 'value', types: ['text'] },
    { id: 'workspace', name: 'Workspace', kind: 'value', types: ['object'] }
  ]
};

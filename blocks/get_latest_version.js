'use strict';
const { latestVersionInfo, valueOutputs, setVersionOutputs } = require('./version_helpers.cjs');

module.exports = {
  type: 'get_latest_version',
  name: 'Get Latest Version',
  category: 'System',
  description: 'Checks the configured RC or Prod repository and returns its latest version as {appname}_{stage}_rev{revision}.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Action', kind: 'action', types: [] },
    { id: 'error', name: 'Action (Error)', kind: 'action', types: [] },
    ...valueOutputs('Latest Version'),
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(ctx, _options, _inputs, setOutput) {
    try {
      setVersionOutputs(setOutput, await latestVersionInfo(ctx));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('version', '');
      setOutput('app_name', String(ctx.appName || ''));
      setOutput('stage', String(ctx.deployment?.channel || ''));
      setOutput('revision', 0);
      setOutput('error_message', error instanceof Error ? error.message : String(error));
      return 'error';
    }
  }
};

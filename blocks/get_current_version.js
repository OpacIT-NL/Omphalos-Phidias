'use strict';
const { versionInfo, valueOutputs, setVersionOutputs } = require('./version_helpers.cjs');

module.exports = {
  type: 'get_current_version',
  name: 'Get Current Version',
  category: 'System',
  description: 'Returns the running application version as {appname}_{stage}_rev{revision}.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    ...valueOutputs('Current Version')
  ],
  fields: [],
  async execute(ctx, _options, _inputs, setOutput) {
    setVersionOutputs(setOutput, versionInfo(ctx, ctx.appRevision));
    return 'next';
  }
};

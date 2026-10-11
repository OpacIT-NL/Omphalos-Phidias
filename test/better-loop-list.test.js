'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createApp, loadDefinitions } = require('../runtime/app');
const { validate } = require('../runtime/validate');

const block = (id, type, options = {}) => ({ id, type, x: 0, y: 0, options });
const edge = (id, from, output, to, input = 'action', kind = 'action') => ({ id, from, output, to, input, kind });

test('Better Loop List exposes current-runtime-compatible typed ports', () => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const definition = definitions.get('better_loop_list');
  assert.ok(definition);
  assert.deepEqual(definition.inputPorts.map(port => port.id), ['action', 'list', 'delay']);
  assert.deepEqual(definition.outputPorts.map(port => port.id), ['action', 'action2', 'index', 'value']);
  assert.equal(definition.outputPorts.find(port => port.id === 'index').types[0], 'number');

  assert.doesNotThrow(() => validate({
    version: 1,
    name: 'Loop compatibility',
    workspaces: [{
      id: 'main', name: 'Main', active: false,
      blocks: [block('list', 'create_list'), block('loop', 'better_loop_list')],
      connections: [edge('list-loop', 'list', 'list', 'loop', 'list', 'value')]
    }]
  }, definitions));
});

test('Better Loop List waits for each item workflow before starting the next and finishing', async t => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const events = [];
  let active = 0;
  let maximumActive = 0;

  definitions.set('loop_test_list', {
    type: 'loop_test_list', name: 'Loop Test List', category: 'Tests', description: 'Supplies test data.', fields: [], outputs: [], inputPorts: [],
    outputPorts: [{ id: 'list', name: 'List', kind: 'value', types: ['list'] }],
    async execute(_ctx, _options, _inputs, setOutput) { setOutput('list', ['alpha', 'beta', 'gamma']); }
  });
  definitions.set('loop_test_capture', {
    type: 'loop_test_capture', name: 'Loop Test Capture', category: 'Tests', description: 'Captures loop values.', fields: [], outputs: [],
    inputPorts: [
      { id: 'action', name: 'Action', kind: 'action', types: [] },
      { id: 'index', name: 'Index', kind: 'value', types: ['number'] },
      { id: 'value', name: 'Value', kind: 'value', types: ['unspecified'] }
    ],
    outputPorts: [],
    async execute(_ctx, _options, inputs) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      events.push(`start:${inputs.index}:${inputs.value}`);
      await new Promise(resolve => setTimeout(resolve, 10));
      events.push(`end:${inputs.index}:${inputs.value}`);
      active -= 1;
    }
  });
  definitions.set('loop_test_finish', {
    type: 'loop_test_finish', name: 'Loop Test Finish', category: 'Tests', description: 'Completes the request.', fields: [], outputs: [],
    inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }], outputPorts: [],
    async execute(ctx) {
      events.push('finish');
      ctx.response.writeHead(200, { 'content-type': 'text/plain' });
      ctx.response.end('done');
    }
  });

  const document = {
    version: 1,
    name: 'Sequential list loop',
    workspaces: [{
      id: 'main', name: 'Main', active: true,
      blocks: [
        block('http', 'http', { method: 'GET', path: '/loop' }),
        block('source', 'loop_test_list'),
        block('loop', 'better_loop_list'),
        block('capture', 'loop_test_capture'),
        block('finish', 'loop_test_finish')
      ],
      connections: [
        edge('start', 'http', 'next', 'loop'),
        edge('list', 'source', 'list', 'loop', 'list', 'value'),
        edge('each', 'loop', 'action', 'capture'),
        edge('index', 'loop', 'index', 'capture', 'index', 'value'),
        edge('value', 'loop', 'value', 'capture', 'value', 'value'),
        edge('finished', 'loop', 'action2', 'finish')
      ]
    }]
  };

  assert.doesNotThrow(() => validate(structuredClone(document), definitions));
  const errors = [];
  const app = createApp({ document, definitions, onError: error => errors.push(error) });
  const address = await app.start(0, '127.0.0.1');
  t.after(() => app.stop());
  const response = await fetch(`http://127.0.0.1:${address.port}/loop`);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'done');
  assert.equal(maximumActive, 1);
  assert.deepEqual(events, [
    'start:0:alpha', 'end:0:alpha',
    'start:1:beta', 'end:1:beta',
    'start:2:gamma', 'end:2:gamma',
    'finish'
  ]);
  assert.deepEqual(errors, []);
});

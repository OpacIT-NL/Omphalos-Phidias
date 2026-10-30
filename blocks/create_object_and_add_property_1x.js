'use strict';

const VALUE_TYPES = ['unspecified', 'secret', 'undefined', 'null', 'object', 'boolean', 'date', 'number', 'text', 'list'];

function createObject(inputs, count, revealSecret = value => value?.__phidiasSecret ? String(value) : value) {
  const entries = [];
  for (let index = 1; index <= count; index++) {
    const key = inputs[`key${index}`];
    if (key === undefined || key === null || String(key).trim() === '') continue;
    entries.push([String(key), revealSecret(inputs[`value${index}`])]);
  }
  return Object.fromEntries(entries);
}

function createDefinition(count) {
  const inputPorts = [{ id: 'action', name: 'Action', kind: 'action', types: [] }];
  for (let index = 1; index <= count; index++) {
    inputPorts.push(
      { id: `key${index}`, name: `Key ${index}`, kind: 'value', types: ['text', 'unspecified'], required: true },
      { id: `value${index}`, name: `Value ${index}`, kind: 'value', types: VALUE_TYPES, required: true }
    );
  }
  return {
    type: `create_object_and_add_property_${count}x`,
    name: `Create Object and Add Property ${count}x`,
    category: 'Object Stuff',
    description: `Creates one object from ${count} key and value pair${count === 1 ? '' : 's'} supplied through wires.`,
    inputPorts,
    fields: [],
    outputs: ['action'],
    outputPorts: [
      { id: 'action', name: 'Action', kind: 'action', types: [] },
      { id: 'object', name: 'Object', kind: 'value', types: ['object'] }
    ],
    async execute(ctx, _options, inputs, setOutput) {
      setOutput('object', createObject(inputs, count, ctx.revealSecret));
      return 'action';
    }
  };
}

module.exports = createDefinition(1);
Object.defineProperties(module.exports, {
  createDefinition: { value: createDefinition },
  createObject: { value: createObject }
});

'use strict';

module.exports = {
  name: 'Better Loop List',
  description: 'Loops through a list sequentially. For each item, it returns the zero-based position and value, with an optional delay between iterations.',
  category: 'List Stuff',
  immediateActionOutputs: true,

  inputs: [
    {
      id: 'action',
      name: 'Action',
      description: 'Executes this block.',
      types: ['action']
    },
    {
      id: 'list',
      name: 'List',
      description: 'The list to loop through.',
      types: ['list', 'unspecified'],
      required: true
    },
    {
      id: 'delay',
      name: 'Delay in Milliseconds',
      description: 'How long to wait between iterations. The default is no delay.',
      types: ['number', 'unspecified']
    }
  ],

  options: [],

  outputs: [
    {
      id: 'action',
      name: 'Action (Loop)',
      description: 'Executes the following workflow once for every list item.',
      types: ['action']
    },
    {
      id: 'action2',
      name: 'Action (Finish)',
      description: 'Executes after every list item and its following workflow have completed.',
      types: ['action']
    },
    {
      id: 'index',
      name: 'Position Number',
      description: 'The zero-based position of the current list item.',
      types: ['number']
    },
    {
      id: 'value',
      name: 'Item Value',
      description: 'The current list item.',
      types: ['unspecified']
    }
  ],

  async code(cache) {
    const list = this.GetInputValue('list', cache);
    if (list === null || typeof list !== 'object') throw new Error('Better Loop List requires a list');

    const requestedDelay = Number(this.GetInputValue('delay', cache) ?? 0);
    if (!Number.isFinite(requestedDelay) || requestedDelay < 0) {
      throw new Error('Better Loop List delay must be a non-negative number');
    }

    const entries = Array.isArray(list)
      ? Array.from(list.entries())
      : Object.entries(list).map(([key, value], position) => [Number.isInteger(Number(key)) ? Number(key) : position, value]);

    for (let position = 0; position < entries.length; position += 1) {
      const [index, value] = entries[position];
      this.StoreOutputValue(index, 'index', cache);
      this.StoreOutputValue(value, 'value', cache);
      await this.RunNextBlock('action', cache);
      if (requestedDelay > 0 && position < entries.length - 1) {
        await new Promise(resolve => setTimeout(resolve, requestedDelay));
      }
    }

    await this.RunNextBlock('action2', cache);
  }
};

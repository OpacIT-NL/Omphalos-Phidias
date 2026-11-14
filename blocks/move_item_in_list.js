'use strict';

function moveItemInList(list, position, direction, amount = 1) {
  if (!Array.isArray(list)) throw new TypeError('List must be a list');

  const result = list.slice();
  if (result.length === 0) return result;

  position = Number(position);
  amount = Number(amount ?? 1);
  direction = String(direction ?? '').trim().toLowerCase();

  if (!Number.isInteger(position) || position < 0 || position >= result.length) {
    throw new RangeError(`Position must be a whole number from 0 to ${result.length - 1}`);
  }
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError('Amount must be a whole number of 0 or more');
  }
  if (direction !== 'up' && direction !== 'down') {
    throw new Error('Direction must be up or down');
  }

  const offset = direction === 'up' ? -amount : amount;
  const destination = ((position + offset) % result.length + result.length) % result.length;
  if (destination === position) return result;

  const [item] = result.splice(position, 1);
  result.splice(destination, 0, item);
  return result;
}

module.exports = {
  type: 'move_item_in_list',
  name: 'Move Item in List',
  category: 'List Stuff',
  description: 'Moves an item up or down by a number of zero-based list positions, wrapping at either end.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'list', name: 'List', kind: 'value', types: ['list', 'unspecified'], required: true },
    {
      id: 'position',
      name: 'Position',
      description: 'The zero-based position of the item to move. The first item is position 0.',
      kind: 'value',
      types: ['number', 'unspecified'],
      required: true
    }
  ],
  fields: [
    {
      key: 'direction',
      label: 'Direction',
      description: 'Move the selected item up or down in the list.',
      type: 'select',
      choices: ['up', 'down'],
      default: 'up'
    },
    {
      key: 'amount',
      label: 'Amount',
      description: 'The number of positions to move.',
      type: 'number',
      default: 1,
      min: 0,
      max: Number.MAX_SAFE_INTEGER
    }
  ],
  outputs: ['action'],
  outputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'list', name: 'List', kind: 'value', types: ['list'] }
  ],
  async execute(_ctx, options, inputs, setOutput) {
    setOutput('list', moveItemInList(inputs.list, inputs.position, options.direction, options.amount));
    return 'action';
  },
  moveItemInList
};


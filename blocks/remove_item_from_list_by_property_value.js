'use strict';

function parseValues(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [value];

  return values
    .map(item => typeof item === 'string' ? item.trim() : item)
    .filter(item => item !== undefined && item !== null && item !== '');
}

module.exports = {
  name: 'Remove Items From List by Property Value',
  description: 'Removes every object whose selected property equals one of the supplied comma-separated values.',
  category: 'List Stuff',

  inputs: [
    {
      id: 'action',
      name: 'Action',
      description: 'Acceptable Types: Action\n\nDescription: Executes this block.',
      types: ['action']
    },
    {
      id: 'list',
      name: 'List',
      description: 'Acceptable Types: List, Unspecified\n\nDescription: The list to filter.',
      types: ['list', 'unspecified'],
      required: true
    },
    {
      id: 'property_key',
      name: 'Property Key',
      description: 'Acceptable Types: Text, Unspecified\n\nDescription: The object property to compare, such as id.',
      types: ['text', 'unspecified']
    },
    {
      id: 'values',
      name: 'Values',
      description: 'Acceptable Types: Text, List, Number, Boolean, Unspecified\n\nDescription: A comma-separated text value or list of values to remove.',
      types: ['text', 'list', 'number', 'boolean', 'unspecified']
    }
  ],

  options: [
    {
      id: 'property_key',
      name: 'Property Key',
      description: 'Description: The object property to compare, such as id.',
      type: 'text'
    },
    {
      id: 'values',
      name: 'Values',
      description: 'Description: Comma-separated values to remove, such as vhins,phans,bhuns.',
      type: 'text'
    }
  ],

  outputs: [
    {
      id: 'action',
      name: 'Action',
      description: 'Type: Action\n\nDescription: Executes the following blocks when filtering finishes.',
      types: ['action']
    },
    {
      id: 'list',
      name: 'List',
      description: 'Type: List\n\nDescription: The list with every matching item removed.',
      types: ['list']
    }
  ],

  code(cache) {
    const list = this.GetInputValue('list', cache);
    const propertyKey = String(this.GetInputValue('property_key', cache) ?? '').trim();
    const values = parseValues(this.GetInputValue('values', cache));

    if (!Array.isArray(list)) throw new TypeError('List must be a list');
    if (!propertyKey) throw new Error('Property Key is required');

    const comparableValues = new Set(values.map(value => String(value)));
    const filteredList = list.filter(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
      if (!Object.prototype.hasOwnProperty.call(item, propertyKey)) return true;
      return !comparableValues.has(String(item[propertyKey]));
    });

    this.StoreOutputValue(filteredList, 'list', cache);
    this.RunNextBlock('action', cache);
  }
};


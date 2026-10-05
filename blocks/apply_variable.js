'use strict';

function applyVariable(html, name, value) {
  if (typeof html !== 'string') throw new Error('HTML input is required');
  name = String(name ?? '').trim();
  if (!name) throw new Error('Variable Name is required');
  if (name.includes('%')) throw new Error('Enter the variable name without percent signs');
  const replacement = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return html.replaceAll(`%${name}%`, replacement);
}

module.exports = {
  type: 'apply_variable',
  name: 'Apply Variable',
  category: 'Data',
  description: 'Replaces every %name% placeholder in HTML with text or generated HTML.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML', kind: 'value', types: ['text'], required: true },
    { id: 'name', name: 'Variable Name', kind: 'value', types: ['text'], required: true },
    { id: 'value', name: 'Value', kind: 'value', types: ['text', 'object', 'list', 'number', 'boolean', 'unspecified'], required: true }
  ],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(_ctx, _options, inputs, setOutput) {
    setOutput('html', applyVariable(inputs.html, inputs.name, inputs.value));
    return 'next';
  },
  applyVariable
};

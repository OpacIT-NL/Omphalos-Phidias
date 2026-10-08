'use strict';
const { transformJSON } = require('./math_helpers.cjs');

module.exports = {
  type: 'transform_json_numbers', name: 'Transform JSON Numbers', category: 'Math',
  description: 'Calculates a numeric field for every JSON row or key-value entry and returns graph-compatible JSON.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'json', name: 'JSON Data', kind: 'value', types: ['text', 'object', 'list'], required: true },
    { id: 'operand', name: 'Connected Operand', kind: 'value', types: ['number', 'text', 'unspecified'] }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] }, { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'result', name: 'Transformed JSON', kind: 'value', types: ['object', 'list', 'number'] },
    { id: 'json_text', name: 'JSON Text', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [
    { key: 'source_field', label: 'Source Field Path (blank = values)', type: 'text', default: '' },
    { key: 'operation', label: 'Operation', type: 'select', choices: ['Add', 'Subtract', 'Multiply', 'Divide', 'Modulo', 'Power', 'Minimum', 'Maximum', 'Value as Percentage of Operand', 'Percentage of Value', 'Percentage Change from Operand'], default: 'Multiply' },
    { key: 'operand_source', label: 'Operand Source', type: 'select', choices: ['Connected Value', 'Constant', 'Field'], default: 'Constant' },
    { key: 'operand_field', label: 'Operand Field Path', type: 'text', default: '' },
    { key: 'constant', label: 'Constant Operand', type: 'text', default: '1' },
    { key: 'output_mode', label: 'Output Mode', type: 'select', choices: ['Add Result Field', 'Replace Source Field', 'Values Only'], default: 'Add Result Field' },
    { key: 'result_field', label: 'Result Field Path', type: 'text', default: 'Result' },
    { key: 'invalid_values', label: 'Invalid Values', type: 'select', choices: ['Error', 'Null', 'Skip Row', 'Keep Original'], default: 'Error' },
    { key: 'rounding', label: 'Rounding', type: 'select', choices: ['None', 'Decimal Places', 'Significant Digits', 'Floor', 'Ceiling', 'Truncate'], default: 'None' },
    { key: 'decimal_places', label: 'Decimal Places / Significant Digits', type: 'number', min: 0, max: 12, default: 2 }
  ],
  async execute(_ctx, options, inputs, setOutput) {
    try {
      const result = transformJSON(inputs.json, inputs.operand, options); setOutput('result', result); setOutput('json_text', JSON.stringify(result)); setOutput('error_message', ''); return 'success';
    } catch (error) { setOutput('result', null); setOutput('json_text', ''); setOutput('error_message', error.message); return 'error'; }
  },
  transformJSON
};

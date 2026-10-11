'use strict';
const { escapeHTML, fieldName, insertField, commonPorts, outputPorts } = require('./form_helpers.cjs');

const inputTypes = { Text: 'text', Email: 'email', Password: 'password', Number: 'number', Date: 'date', 'Date and time': 'datetime-local', URL: 'url', Telephone: 'tel' };
module.exports = {
  type: 'form_text_input', name: 'Form Text Input', category: 'Forms',
  description: 'Adds a single-line input to an HTML form.',
  inputPorts: commonPorts([
    { id: 'default_value', name: 'Default Value', kind: 'value', types: ['text', 'number', 'unspecified'] },
    { id: 'placeholder', name: 'Placeholder', kind: 'value', types: ['text'] }
  ]),
  fields: [
    { key: 'input_type', label: 'Input type', type: 'select', choices: Object.keys(inputTypes), default: 'Text' },
    { key: 'required', label: 'Required', type: 'select', choices: ['No', 'Yes'], default: 'No' }
  ],
  outputs: ['next'], outputPorts,
  async execute(_ctx, options, inputs, setOutput) {
    const name = fieldName(inputs.field_name), id = `phidias-field-${name}`;
    const field = `<label class="phidias-form__field" for="${id}"><span>${escapeHTML(inputs.label)}</span><input id="${id}" name="${escapeHTML(name)}" type="${inputTypes[options.input_type] || 'text'}"${inputs.default_value == null ? '' : ` value="${escapeHTML(inputs.default_value)}"`}${inputs.placeholder == null ? '' : ` placeholder="${escapeHTML(inputs.placeholder)}"`}${options.required === 'Yes' ? ' required' : ''}></label>`;
    setOutput('html', insertField(inputs.form, field)); return 'next';
  }
};

'use strict';
const { escapeHTML, fieldName, insertField, commonPorts, outputPorts } = require('./form_helpers.cjs');

module.exports = {
  type: 'form_long_text_input', name: 'Form Long Text Input', category: 'Forms',
  description: 'Adds a multi-line text area to an HTML form.',
  inputPorts: commonPorts([
    { id: 'default_value', name: 'Default Value', kind: 'value', types: ['text', 'number', 'unspecified'] },
    { id: 'placeholder', name: 'Placeholder', kind: 'value', types: ['text'] }
  ]),
  fields: [
    { key: 'rows', label: 'Visible rows', type: 'number', default: 5, min: 2, max: 40 },
    { key: 'required', label: 'Required', type: 'select', choices: ['No', 'Yes'], default: 'No' }
  ],
  outputs: ['next'], outputPorts,
  async execute(_ctx, options, inputs, setOutput) {
    const name = fieldName(inputs.field_name), id = `phidias-field-${name}`;
    const field = `<label class="phidias-form__field" for="${id}"><span>${escapeHTML(inputs.label)}</span><textarea id="${id}" name="${escapeHTML(name)}" rows="${Number(options.rows) || 5}"${inputs.placeholder == null ? '' : ` placeholder="${escapeHTML(inputs.placeholder)}"`}${options.required === 'Yes' ? ' required' : ''}>${escapeHTML(inputs.default_value ?? '')}</textarea></label>`;
    setOutput('html', insertField(inputs.form, field)); return 'next';
  }
};

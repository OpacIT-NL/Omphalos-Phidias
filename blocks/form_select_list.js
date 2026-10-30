'use strict';
const { escapeHTML, fieldName, insertField, choices, selectedValues, commonPorts, outputPorts } = require('./form_helpers.cjs');

module.exports = {
  type: 'form_select_list', name: 'Form Select List', category: 'Forms',
  description: 'Adds a select list. Choices accept a list, object, JSON text, or comma/newline-separated text.',
  inputPorts: commonPorts([
    { id: 'choices', name: 'Choices', kind: 'value', types: ['text', 'list', 'object'], required: true },
    { id: 'selected', name: 'Selected Value(s)', kind: 'value', types: ['text', 'list', 'number', 'unspecified'] }
  ]),
  fields: [
    { key: 'multiple', label: 'Allow multiple', type: 'select', choices: ['No', 'Yes'], default: 'No' },
    { key: 'required', label: 'Required', type: 'select', choices: ['No', 'Yes'], default: 'No' }
  ],
  outputs: ['next'], outputPorts,
  async execute(_ctx, options, inputs, setOutput) {
    const name = fieldName(inputs.field_name), id = `phidias-field-${name}`, selected = selectedValues(inputs.selected);
    const items = choices(inputs.choices).map(item => `<option value="${escapeHTML(item.value)}"${selected.has(item.value) ? ' selected' : ''}>${escapeHTML(item.label)}</option>`).join('');
    const multiple = options.multiple === 'Yes';
    const field = `<label class="phidias-form__field" for="${id}"><span>${escapeHTML(inputs.label)}</span><select id="${id}" name="${escapeHTML(name)}${multiple ? '[]' : ''}"${multiple ? ' multiple' : ''}${options.required === 'Yes' ? ' required' : ''}>${items}</select></label>`;
    setOutput('html', insertField(inputs.form, field)); return 'next';
  }
};

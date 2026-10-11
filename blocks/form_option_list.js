'use strict';
const { escapeHTML, fieldName, insertField, choices, selectedValues, commonPorts, outputPorts } = require('./form_helpers.cjs');

module.exports = {
  type: 'form_option_list', name: 'Form Option List', category: 'Forms',
  description: 'Adds a list of radio-button options. Choices accept a list, object, JSON text, or comma/newline-separated text.',
  inputPorts: commonPorts([
    { id: 'choices', name: 'Choices', kind: 'value', types: ['text', 'list', 'object'], required: true },
    { id: 'selected', name: 'Selected Value', kind: 'value', types: ['text', 'number', 'unspecified'] }
  ]),
  fields: [{ key: 'required', label: 'Required', type: 'select', choices: ['No', 'Yes'], default: 'No' }],
  outputs: ['next'], outputPorts,
  async execute(_ctx, options, inputs, setOutput) {
    const name = fieldName(inputs.field_name), selected = selectedValues(inputs.selected);
    const items = choices(inputs.choices).map((item, index) => `<label class="phidias-form__choice"><input type="radio" name="${escapeHTML(name)}" value="${escapeHTML(item.value)}"${selected.has(item.value) ? ' checked' : ''}${options.required === 'Yes' && index === 0 ? ' required' : ''}><span>${escapeHTML(item.label)}</span></label>`).join('');
    const field = `<fieldset class="phidias-form__field phidias-form__choice-group"><legend>${escapeHTML(inputs.label)}</legend>${items}</fieldset>`;
    setOutput('html', insertField(inputs.form, field)); return 'next';
  }
};

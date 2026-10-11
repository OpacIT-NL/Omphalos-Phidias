'use strict';
const { escapeHTML, fieldName, insertField, choices, selectedValues, commonPorts, outputPorts } = require('./form_helpers.cjs');

module.exports = {
  type: 'form_checkmark_list', name: 'Form Checkmark List', category: 'Forms',
  description: 'Adds a checkbox list. Multiple checked values arrive as a JSON list on Form Submit.',
  inputPorts: commonPorts([
    { id: 'choices', name: 'Choices', kind: 'value', types: ['text', 'list', 'object'], required: true },
    { id: 'selected', name: 'Selected Value(s)', kind: 'value', types: ['text', 'list', 'number', 'unspecified'] }
  ]),
  fields: [], outputs: ['next'], outputPorts,
  async execute(_ctx, _options, inputs, setOutput) {
    const name = fieldName(inputs.field_name), selected = selectedValues(inputs.selected);
    const items = choices(inputs.choices).map(item => `<label class="phidias-form__choice"><input type="checkbox" name="${escapeHTML(name)}[]" value="${escapeHTML(item.value)}"${selected.has(item.value) ? ' checked' : ''}><span>${escapeHTML(item.label)}</span></label>`).join('');
    const field = `<fieldset class="phidias-form__field phidias-form__choice-group"><legend>${escapeHTML(inputs.label)}</legend>${items}</fieldset>`;
    setOutput('html', insertField(inputs.form, field)); return 'next';
  }
};

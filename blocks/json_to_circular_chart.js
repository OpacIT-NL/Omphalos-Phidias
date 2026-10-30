'use strict';
const { circularChart } = require('./chart_helpers.cjs');

module.exports = {
  type: 'json_to_circular_chart',
  name: 'JSON to Circular Chart',
  category: 'Data',
  description: 'Creates a responsive pie or donut chart from JSON rows, labels and datasets, or a key-value object.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'json', name: 'Chart Data', kind: 'value', types: ['text', 'object', 'list'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] },
    { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'html', name: 'Chart HTML', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [
    { key: 'chart_type', label: 'Chart Type', type: 'select', choices: ['Donut', 'Pie'], default: 'Donut' },
    { key: 'data_format', label: 'JSON Data Format', type: 'select', choices: ['Auto', 'Rows', 'Labels and Datasets', 'Key-value Object'], default: 'Auto' },
    { key: 'category_field', label: 'Label Field', type: 'text', default: '' },
    { key: 'series_fields', label: 'Value Field', type: 'text', default: '' },
    { key: 'series_name', label: 'Series Name', type: 'text', default: 'Value' },
    { key: 'aggregate', label: 'Duplicate Label Handling', type: 'select', choices: ['None', 'Sum', 'Average', 'Minimum', 'Maximum', 'Count'], default: 'Sum' },
    { key: 'sort', label: 'Slice Order', type: 'select', choices: ['None', 'Value Ascending', 'Value Descending'], default: 'Value Descending' },
    { key: 'max_slices', label: 'Maximum Slices', type: 'number', min: 1, max: 100, default: 20 },
    { key: 'group_below_percent', label: 'Group Slices Below %', type: 'number', min: 0, max: 50, default: 0 },
    { key: 'other_label', label: 'Grouped Slice Label', type: 'text', default: 'Other' },
    { key: 'inner_radius', label: 'Donut Inner Radius %', type: 'number', min: 10, max: 85, default: 58 },
    { key: 'number_format', label: 'Number Format', type: 'select', choices: ['Auto', 'Integer', 'Decimal', 'Percent'], default: 'Auto' },
    { key: 'title', label: 'Chart Title', type: 'text', default: '' },
    { key: 'center_label', label: 'Donut Center Label', type: 'text', default: 'Total' },
    { key: 'width', label: 'SVG Width', type: 'number', min: 280, max: 1600, default: 520 },
    { key: 'height', label: 'SVG Height', type: 'number', min: 240, max: 1200, default: 380 },
    { key: 'palette', label: 'Colors (comma-separated)', type: 'text', default: '#69b7e6,#55c596,#e8ad60,#dd6b72,#9b8ee6' },
    { key: 'theme', label: 'Theme', type: 'select', choices: ['Dark', 'Light', 'Transparent'], default: 'Dark' },
    { key: 'show_legend', label: 'Show Legend', type: 'select', choices: ['Yes', 'No'], default: 'Yes' },
    { key: 'show_labels', label: 'Show Slice Labels', type: 'select', choices: ['Yes', 'No'], default: 'Yes' },
    { key: 'show_values', label: 'Show Slice Values', type: 'select', choices: ['No', 'Yes'], default: 'No' }
  ],
  async execute(_ctx, options, inputs, setOutput) {
    try {
      setOutput('html', circularChart(inputs.json, options));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('html', '');
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  circularChart
};

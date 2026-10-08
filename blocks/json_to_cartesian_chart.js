'use strict';
const { cartesianChart } = require('./chart_helpers.cjs');

module.exports = {
  type: 'json_to_cartesian_chart',
  name: 'JSON to Cartesian Chart',
  category: 'Data',
  description: 'Creates a responsive line, area, bar, stacked bar, horizontal bar, or scatter chart from JSON.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'json', name: 'Chart Data', kind: 'value', types: ['text', 'object', 'list'], required: true },
    { id: 'x_min', name: 'X Minimum', kind: 'value', types: ['number'] },
    { id: 'x_max', name: 'X Maximum', kind: 'value', types: ['number'] },
    { id: 'y_min', name: 'Y Minimum', kind: 'value', types: ['number'] },
    { id: 'y_max', name: 'Y Maximum', kind: 'value', types: ['number'] }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] },
    { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'html', name: 'Chart HTML', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [
    { key: 'chart_type', label: 'Chart Type', type: 'select', choices: ['Line', 'Area', 'Bar', 'Stacked Bar', 'Horizontal Bar', 'Scatter'], default: 'Line' },
    { key: 'data_format', label: 'JSON Data Format', type: 'select', choices: ['Auto', 'Rows', 'Labels and Datasets', 'Key-value Object'], default: 'Auto' },
    { key: 'category_field', label: 'Category / X Field', type: 'text', default: '' },
    { key: 'series_fields', label: 'Series / Y Fields (comma-separated)', type: 'text', default: '' },
    { key: 'series_name', label: 'Single Series Name', type: 'text', default: 'Value' },
    { key: 'aggregate', label: 'Duplicate Category Handling', type: 'select', choices: ['None', 'Sum', 'Average', 'Minimum', 'Maximum', 'Count'], default: 'None' },
    { key: 'sort', label: 'Point Order', type: 'select', choices: ['None', 'Label Ascending', 'Label Descending', 'Value Ascending', 'Value Descending'], default: 'None' },
    { key: 'max_points', label: 'Maximum Points', type: 'number', min: 1, max: 1000, default: 100 },
    { key: 'missing_values', label: 'Missing Values', type: 'select', choices: ['Gap', 'Zero', 'Skip'], default: 'Gap' },
    { key: 'number_format', label: 'Number Format', type: 'select', choices: ['Auto', 'Integer', 'Decimal', 'Percent'], default: 'Auto' },
    { key: 'title', label: 'Chart Title', type: 'text', default: '' },
    { key: 'x_axis_title', label: 'X Axis Title', type: 'text', default: '' },
    { key: 'y_axis_title', label: 'Y Axis Title', type: 'text', default: '' },
    { key: 'width', label: 'SVG Width', type: 'number', min: 320, max: 2000, default: 760 },
    { key: 'height', label: 'SVG Height', type: 'number', min: 220, max: 1200, default: 360 },
    { key: 'palette', label: 'Colors (comma-separated)', type: 'text', default: '#69b7e6,#55c596,#e8ad60,#dd6b72,#9b8ee6' },
    { key: 'theme', label: 'Theme', type: 'select', choices: ['Dark', 'Light', 'Transparent'], default: 'Dark' },
    { key: 'show_legend', label: 'Show Legend', type: 'select', choices: ['Yes', 'No'], default: 'Yes' },
    { key: 'show_grid', label: 'Show Grid', type: 'select', choices: ['Yes', 'No'], default: 'Yes' },
    { key: 'show_values', label: 'Show Values', type: 'select', choices: ['No', 'Yes'], default: 'No' },
    { key: 'line_style', label: 'Line Style', type: 'select', choices: ['Straight', 'Smooth'], default: 'Smooth' }
  ],
  async execute(_ctx, options, inputs, setOutput) {
    try {
      const bounds = Object.fromEntries(['x_min', 'x_max', 'y_min', 'y_max'].filter(key => inputs[key] !== undefined).map(key => [key, inputs[key]]));
      setOutput('html', cartesianChart(inputs.json, { ...options, ...bounds }));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('html', '');
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  cartesianChart
};

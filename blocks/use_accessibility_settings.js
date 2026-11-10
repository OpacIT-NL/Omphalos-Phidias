'use strict';

const { accessibilityRuntimeHTML, RUNTIME_MARKER } = require('./show_accessibility_settings');

function useAccessibilitySettings(value) {
  if (value === undefined || value === null) throw new Error('Use Accessibility Settings requires HTML');
  const html = String(value);
  if (html.includes(RUNTIME_MARKER)) return html;
  const runtime = accessibilityRuntimeHTML();
  const lower = html.toLocaleLowerCase();
  const bodyEnd = lower.lastIndexOf('</body>');
  if (bodyEnd !== -1) return `${html.slice(0, bodyEnd)}${runtime}\n${html.slice(bodyEnd)}`;
  const htmlEnd = lower.lastIndexOf('</html>');
  if (htmlEnd !== -1) return `${html.slice(0, htmlEnd)}${runtime}\n${html.slice(htmlEnd)}`;
  return `${html}\n${runtime}`;
}

module.exports = {
  type: 'use_accessibility_settings',
  name: 'Use Accessibility Settings',
  category: 'HTML',
  description: 'Adds the accessibility theme, text-size, contrast, and cookie runtime to an HTML page. Place this after all HTML composition blocks.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML', kind: 'value', types: ['html', 'text'], required: true }
  ],
  fields: [],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML', kind: 'value', types: ['html', 'text'] }
  ],
  async execute(_ctx, _options, inputs, setOutput) {
    setOutput('html', useAccessibilitySettings(inputs.html));
    return 'next';
  },
  useAccessibilitySettings
};

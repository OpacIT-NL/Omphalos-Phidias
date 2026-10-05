'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

function templateName(value) {
  let name = String(value ?? '').trim();
  if (!name) throw new Error('Template name is required');
  if (!path.extname(name)) name += '.html';
  if (path.basename(name) !== name || !/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,95}\.(?:html|css)$/i.test(name)) {
    throw new Error('Template name must be a file in the html folder ending in .html or .css');
  }
  return name;
}
async function getTemplate(directory, name) {
  const filename = path.join(directory, 'html', templateName(name));
  try { return await fs.readFile(filename, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') throw new Error(`Template not found: ${templateName(name)}`); throw error; }
}

module.exports = {
  type: 'get_template',
  name: 'Get Template',
  category: 'Data',
  description: 'Reads an HTML or CSS file from the application html folder.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'name', name: 'Template Name', kind: 'value', types: ['text'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] },
    { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'html', name: 'HTML', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(ctx, _options, inputs, setOutput) {
    try {
      setOutput('html', await getTemplate(ctx.directory || process.cwd(), inputs.name));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('html', '');
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  getTemplate,
  templateName
};

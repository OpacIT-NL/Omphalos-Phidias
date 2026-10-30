'use strict';

function scriptString(value) {
  return JSON.stringify(value).replace(/[<\u2028\u2029]/g, character => ({
    '<': '\\u003c', '\u2028': '\\u2028', '\u2029': '\\u2029'
  })[character]);
}

function replaceInScript(script, token, replacement) {
  // A placeholder used as an entire quoted JavaScript value must replace the
  // quotes as well. Raw HTML substitution would otherwise turn CR/LF, quotes,
  // or backslashes from form/API data into invalid JavaScript source.
  for (const quote of ['"', "'"]) {
    const quotedToken = `${quote}${token}${quote}`;
    script = script.split(quotedToken).join(scriptString(replacement));
  }
  return script.split(token).join(replacement);
}

function applyVariable(html, name, value) {
  if (typeof html !== 'string') throw new Error('HTML input is required');
  name = String(name ?? '').trim();
  if (!name) throw new Error('Variable Name is required');
  if (name.includes('%')) throw new Error('Enter the variable name without percent signs');
  const replacement = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const token = `%${name}%`;
  // String.replace/replaceAll interpret $&, $`, $', and $$ inside replacement
  // strings. Generated HTML commonly contains those sequences (Console$&gt;
  // for example), so join literal segments instead of treating output as a
  // JavaScript replacement pattern.
  return html.split(/(<script\b[^>]*>[\s\S]*?<\/script\s*>)/gi).map(part => {
    if (!/^<script\b/i.test(part)) return part.split(token).join(replacement);
    return replaceInScript(part, token, replacement);
  }).join('');
}

module.exports = {
  type: 'apply_variable',
  name: 'Apply Variable',
  category: 'Data',
  description: 'Replaces every %name% placeholder in HTML with text or generated HTML.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML', kind: 'value', types: ['text'], required: true },
    { id: 'name', name: 'Variable Name', kind: 'value', types: ['text'], required: true },
    { id: 'value', name: 'Value', kind: 'value', types: ['text', 'object', 'list', 'number', 'boolean', 'unspecified'], required: true }
  ],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(_ctx, _options, inputs, setOutput) {
    setOutput('html', applyVariable(inputs.html, inputs.name, inputs.value));
    return 'next';
  },
  applyVariable,
  scriptString
};

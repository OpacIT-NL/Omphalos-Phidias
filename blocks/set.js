module.exports = {
  type: 'set', name: 'Set variable', category: 'Data',
  description: 'Store a value for this workflow run. Read it with {{vars.name}}.',
  outputs: ['next'], fields: [
    { key: 'name', label: 'Variable name', type: 'text', default: 'message' },
    { key: 'value', label: 'Value', type: 'text', default: 'Hello from Phidias' }
  ],
  async execute(ctx, options) { ctx.vars[options.name] = ctx.render(options.value); return 'next'; }
};

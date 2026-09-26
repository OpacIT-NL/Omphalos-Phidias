module.exports = {
  type: 'log', name: 'Write to log', category: 'Actions',
  description: 'Print a message to the application console. Templates can read variables.',
  outputs: ['next'], fields: [{ key: 'message', label: 'Message', type: 'text', default: 'Hello from Phidias' }],
  async execute(ctx, options) { console.log(ctx.render(options.message)); return 'next'; }
};

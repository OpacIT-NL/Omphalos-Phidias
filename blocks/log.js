module.exports = {
  type: 'log', name: 'Write to log', category: 'Actions',
  description: 'Write an Info message to the application console and its current log file. Templates can read variables.',
  outputs: ['next'], fields: [{ key: 'message', label: 'Message', type: 'text', default: 'Hello from Phidias' }],
  async execute(ctx, options) { (ctx.logger?.info || console.log)(ctx.render(options.message)); return 'next'; }
};

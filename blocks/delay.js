const { setTimeout } = require('node:timers/promises');
module.exports = {
  type: 'delay', name: 'Wait', category: 'Logic', description: 'Pause this workflow before continuing.',
  outputs: ['next'], fields: [{ key: 'seconds', label: 'Seconds', type: 'number', default: 1, min: 0, max: 3600 }],
  async execute(ctx, options) { await setTimeout(Number(options.seconds) * 1000, undefined, { signal: ctx.signal }); return 'next'; }
};

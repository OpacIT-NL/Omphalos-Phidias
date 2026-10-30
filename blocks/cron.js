module.exports = {
  type: 'cron', name: 'On cron', category: 'Triggers',
  description: 'Runs on a five-field cron schedule using the server local time.',
  trigger: 'cron', outputs: ['next'], fields: [
    { key: 'expression', label: 'Cron expression', type: 'text', default: '*/5 * * * *' }
  ]
};

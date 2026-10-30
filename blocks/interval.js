module.exports = {
  type: 'interval', name: 'On interval', category: 'Triggers',
  description: 'Runs repeatedly. Overlapping runs are skipped.',
  trigger: 'interval', outputs: ['next'],
  fields: [{ key: 'seconds', label: 'Every (seconds)', type: 'number', default: 60, min: 1, max: 2147483 }]
};

module.exports = {
  type: 'condition', name: 'Condition', category: 'Logic',
  description: 'Compare two values and follow the matching output.',
  outputs: ['true', 'false'], fields: [
    { key: 'left', label: 'Left value', type: 'text', default: '{{request.method}}' },
    { key: 'operator', label: 'Operator', type: 'select', choices: ['equals', 'not equals', 'contains', 'greater than'], default: 'equals' },
    { key: 'right', label: 'Right value', type: 'text', default: 'GET' }
  ],
  async execute(ctx, options) {
    const a = String(ctx.render(options.left)), b = String(ctx.render(options.right));
    const match = { equals: () => a === b, 'not equals': () => a !== b, contains: () => a.includes(b), 'greater than': () => Number(a) > Number(b) };
    return match[options.operator]() ? 'true' : 'false';
  }
};

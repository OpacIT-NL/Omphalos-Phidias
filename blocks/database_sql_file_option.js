module.exports = {
  name: 'Database SQL File Option (Legacy)',
  description: 'Compatibility block for older projects. Select a database credential set in application settings instead.',
  category: 'Database Stuff',
  hidden: true,
  auto_execute: true,
  inputs: [],
  options: [],
  outputs: [{ id: 'action', name: 'Action', types: ['action'] }],
  async code(cache) { this.RunNextBlock('action', cache); }
};

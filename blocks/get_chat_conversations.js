'use strict';
const chat = require('./chat_helpers.cjs');
module.exports = {
  type: 'get_chat_conversations', name: 'Get Chat Conversations', category: 'Chat', description: 'Lists internal member chats and cross-system chats available to the supplied viewer.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }, { id: 'system_id', name: 'Viewer System ID', kind: 'value', types: ['text'], required: true }, { id: 'member_id', name: 'Viewer Member ID', kind: 'value', types: ['text'] }], fields: [], outputs: ['next', 'error'],
  outputPorts: [{ id: 'next', name: 'Loaded', kind: 'action', types: [] }, { id: 'error', name: 'Error', kind: 'action', types: [] }, { id: 'conversations', name: 'Conversations', kind: 'value', types: ['list'] }, { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }],
  async execute(ctx, _options, inputs, setOutput) { try { setOutput('conversations', await chat.listConversations(await ctx.database(), inputs.system_id, inputs.member_id)); setOutput('error_message', ''); return 'next'; } catch (error) { setOutput('error_message', error.message); return 'error'; } }
};

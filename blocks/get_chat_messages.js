'use strict';
const chat = require('./chat_helpers.cjs');
module.exports = {
  type: 'get_chat_messages', name: 'Get Chat Messages', category: 'Chat', description: 'Reads messages after an optional message ID, after checking membership.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }, { id: 'conversation_id', name: 'Conversation ID', kind: 'value', types: ['text', 'number'], required: true }, { id: 'system_id', name: 'System ID', kind: 'value', types: ['text'], required: true }, { id: 'member_id', name: 'Member ID', kind: 'value', types: ['text'] }, { id: 'after_message_id', name: 'After Message ID', kind: 'value', types: ['text', 'number'] }],
  fields: [{ key: 'limit', label: 'Maximum messages', type: 'number', default: 100, min: 1, max: 200 }], outputs: ['next', 'error'], outputPorts: [{ id: 'next', name: 'Loaded', kind: 'action', types: [] }, { id: 'error', name: 'Error', kind: 'action', types: [] }, { id: 'messages', name: 'Messages', kind: 'value', types: ['list'] }, { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }],
  async execute(ctx, options, inputs, setOutput) { try { const database = await ctx.database(); const access = await chat.authorize(database, inputs.conversation_id, inputs.system_id, inputs.member_id); setOutput('messages', await chat.messagesAfter(database, access, inputs.after_message_id, options.limit)); setOutput('error_message', ''); return 'next'; } catch (error) { setOutput('error_message', error.message); return 'error'; } }
};

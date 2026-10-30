'use strict';
const chat = require('./chat_helpers.cjs');
module.exports = {
  type: 'create_chat_conversation', name: 'Create Chat Conversation', category: 'Chat',
  description: 'Creates an internal member chat or cross-system chat in the Application Database.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'title', name: 'Title', kind: 'value', types: ['text'] },
    { id: 'creator_system_id', name: 'Creator System ID', kind: 'value', types: ['text'], required: true },
    { id: 'creator_member_id', name: 'Creator Member ID', kind: 'value', types: ['text'] },
    { id: 'participants', name: 'Participants', kind: 'value', types: ['list', 'text'], required: true }
  ],
  fields: [{ key: 'chat_type', label: 'Chat type', type: 'select', choices: ['internal_direct', 'internal_group', 'system_direct', 'system_group'], default: 'internal_direct' }],
  outputs: ['next', 'error'],
  outputPorts: [
    { id: 'next', name: 'Created', kind: 'action', types: [] }, { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'conversation_id', name: 'Conversation ID', kind: 'value', types: ['text'] },
    { id: 'conversation', name: 'Conversation', kind: 'value', types: ['object'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  async execute(ctx, options, inputs, setOutput) {
    try {
      const result = await chat.createConversation(await ctx.database(), options.chat_type, inputs.title, inputs.creator_system_id, inputs.creator_member_id, inputs.participants);
      setOutput('conversation_id', result.id); setOutput('conversation', result); setOutput('error_message', ''); return 'next';
    } catch (error) { setOutput('error_message', error.message); return 'error'; }
  }
};

'use strict';
const chat = require('./chat_helpers.cjs');
module.exports = {
  type: 'add_chat_participant', name: 'Add Chat Participant', category: 'Chat', description: 'Adds a member or system to a chat.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }, { id: 'conversation_id', name: 'Conversation ID', kind: 'value', types: ['text', 'number'], required: true }, { id: 'system_id', name: 'System ID', kind: 'value', types: ['text'], required: true }, { id: 'member_id', name: 'Member ID', kind: 'value', types: ['text'] }],
  fields: [], outputs: ['next', 'error'], outputPorts: [{ id: 'next', name: 'Added', kind: 'action', types: [] }, { id: 'error', name: 'Error', kind: 'action', types: [] }, { id: 'participant', name: 'Participant', kind: 'value', types: ['object'] }, { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }],
  async execute(ctx, _options, inputs, setOutput) { try { const result = await chat.addParticipant(await ctx.database(), inputs.conversation_id, inputs.system_id, inputs.member_id); setOutput('participant', result); setOutput('error_message', ''); return 'next'; } catch (error) { setOutput('error_message', error.message); return 'error'; } }
};

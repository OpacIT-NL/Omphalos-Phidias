'use strict';
const chat = require('./chat_helpers.cjs');
module.exports = {
  type: 'get_chat_participants', name: 'Get Chat Participants', category: 'Chat', description: 'Lists a conversation’s participating members or systems after checking viewer access.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }, { id: 'conversation_id', name: 'Conversation ID', kind: 'value', types: ['text', 'number'], required: true }, { id: 'viewer_system_id', name: 'Viewer System ID', kind: 'value', types: ['text'], required: true }, { id: 'viewer_member_id', name: 'Viewer Member ID', kind: 'value', types: ['text'] }], fields: [], outputs: ['next', 'error'],
  outputPorts: [{ id: 'next', name: 'Loaded', kind: 'action', types: [] }, { id: 'error', name: 'Error', kind: 'action', types: [] }, { id: 'participants', name: 'Participants', kind: 'value', types: ['list'] }, { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }],
  async execute(ctx, _options, inputs, setOutput) { try { setOutput('participants', await chat.listParticipants(await ctx.database(), inputs.conversation_id, inputs.viewer_system_id, inputs.viewer_member_id)); setOutput('error_message', ''); return 'next'; } catch (error) { setOutput('error_message', error.message); return 'error'; } }
};

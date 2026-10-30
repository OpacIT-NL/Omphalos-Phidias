'use strict';
const chat = require('./chat_helpers.cjs');
module.exports = {
  type: 'send_chat_message', name: 'Send Chat Message', category: 'Chat', description: 'Sends a chat message from a server workflow and can resolve PluralKit proxy tags from a member-list response.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }, { id: 'conversation_id', name: 'Conversation ID', kind: 'value', types: ['text', 'number'], required: true }, { id: 'system_id', name: 'System ID', kind: 'value', types: ['text'], required: true }, { id: 'member_id', name: 'Member ID', kind: 'value', types: ['text'] }, { id: 'system_name', name: 'System Name', kind: 'value', types: ['text'] }, { id: 'member_name', name: 'Member Name', kind: 'value', types: ['text'] }, { id: 'members', name: 'PluralKit Member List', kind: 'value', types: ['list', 'object', 'text'] }, { id: 'message', name: 'Message', kind: 'value', types: ['text'], required: true }],
  fields: [], outputs: ['next', 'error'], outputPorts: [{ id: 'next', name: 'Sent', kind: 'action', types: [] }, { id: 'error', name: 'Error', kind: 'action', types: [] }, { id: 'message', name: 'Saved Message', kind: 'value', types: ['object'] }, { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }],
  async execute(ctx, _options, inputs, setOutput) {
    try {
      const database = await ctx.database();
      const access = await chat.authorize(database, inputs.conversation_id, inputs.system_id, inputs.member_id);
      const members = chat.normalizeMembers(inputs.members);
      const matched = chat.matchProxy(members, inputs.message, access.internal ? access.memberID : '');
      const selected = members.find(member => member.id === String(inputs.member_id || ''));
      const result = await chat.sendMessage(database, access, matched?.body ?? inputs.message, {
        memberID: matched?.memberID ?? inputs.member_id,
        memberName: matched?.memberName ?? inputs.member_name ?? selected?.displayName ?? selected?.name,
        systemName: inputs.system_name,
        proxyPrefix: matched?.prefix,
        proxySuffix: matched?.suffix
      });
      setOutput('message', result); setOutput('error_message', ''); return 'next';
    } catch (error) { setOutput('error_message', error.message); return 'error'; }
  }
};

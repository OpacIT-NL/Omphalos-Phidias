'use strict';

const CHAT_TYPES = new Set(['internal_direct', 'internal_group', 'system_direct', 'system_group']);
const INTERNAL_TYPES = new Set(['internal_direct', 'internal_group']);
const MAX_MESSAGE_LENGTH = 4000;

function identifier(value, label = 'ID', required = true) {
  const text = String(value ?? '').trim();
  if (!text && !required) return '';
  if (!text || text.length > 191 || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${label} must contain 1–191 printable characters`);
  return text;
}

function chatType(value) {
  const type = String(value ?? '').trim();
  if (!CHAT_TYPES.has(type)) throw new Error('Chat type must be internal_direct, internal_group, system_direct, or system_group');
  return type;
}

function parseList(value, label) {
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error(`${label} must be a JSON list`); }
  }
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
  return value;
}

function normalizeMembers(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.members)) value = value.members;
  const members = parseList(value, 'PluralKit member list').map(item => {
    if (typeof item === 'string' || typeof item === 'number') return { id: identifier(item, 'Member ID'), name: String(item), displayName: String(item), proxyTags: [] };
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Every member must be an ID or object');
    const id = identifier(item.id ?? item.member_id, 'Member ID');
    const name = String(item.name ?? item.display_name ?? id).trim().slice(0, 191) || id;
    const displayName = String(item.display_name ?? item.displayName ?? name).trim().slice(0, 191) || name;
    const sourceTags = item.proxy_tags ?? item.proxyTags ?? [];
    if (!Array.isArray(sourceTags)) throw new Error(`Proxy tags for member ${id} must be a list`);
    const proxyTags = sourceTags.map(tag => {
      if (!tag || typeof tag !== 'object' || Array.isArray(tag)) throw new Error(`Every proxy tag for member ${id} must be an object`);
      const prefix = tag.prefix == null ? '' : String(tag.prefix);
      const suffix = tag.suffix == null ? '' : String(tag.suffix);
      if (!prefix && !suffix) return null;
      if (prefix.length > 100 || suffix.length > 100 || /[\u0000-\u001f\u007f]/.test(prefix + suffix)) throw new Error(`Proxy tags for member ${id} must contain at most 100 printable characters per side`);
      return { prefix, suffix };
    }).filter(Boolean);
    return { id, name, displayName, proxyTags };
  });
  return [...new Map(members.map(member => [member.id, member])).values()].slice(0, 100);
}

function proxyChoices(members) {
  return normalizeMembers(members).flatMap(member => member.proxyTags.length
    ? member.proxyTags.map((tag, proxyIndex) => ({ memberID: member.id, memberName: member.displayName || member.name, proxyIndex, prefix: tag.prefix, suffix: tag.suffix }))
    : [{ memberID: member.id, memberName: member.displayName || member.name, proxyIndex: -1, prefix: '', suffix: '' }]);
}

function matchProxy(members, value, memberID = '') {
  const body = String(value ?? '');
  const choices = proxyChoices(members)
    .filter(choice => choice.proxyIndex >= 0 && (!memberID || choice.memberID === memberID))
    .sort((left, right) => (right.prefix.length + right.suffix.length) - (left.prefix.length + left.suffix.length));
  for (const choice of choices) {
    if (choice.prefix && !body.startsWith(choice.prefix)) continue;
    if (choice.suffix && !body.endsWith(choice.suffix)) continue;
    if (body.length < choice.prefix.length + choice.suffix.length) continue;
    const end = choice.suffix ? body.length - choice.suffix.length : body.length;
    const stripped = body.slice(choice.prefix.length, end).trim();
    if (stripped) return { ...choice, body: stripped };
  }
  return null;
}

function normalizeParticipants(value, type) {
  const internal = INTERNAL_TYPES.has(type);
  const source = parseList(value, 'Participants');
  if (source.length > 500) throw new Error('A chat cannot add more than 500 participants at once');
  const participants = source.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Every participant must be an object');
    const systemID = identifier(item.system_id ?? item.systemId, 'Participant System ID');
    const memberID = internal ? identifier(item.member_id ?? item.memberId, 'Participant Member ID') : '';
    return { participantType: internal ? 'member' : 'system', systemID, memberID };
  });
  return [...new Map(participants.map(item => [`${item.participantType}\0${item.systemID}\0${item.memberID}`, item])).values()];
}

async function withTransaction(database, operation) {
  if (typeof database.getConnection !== 'function') return operation(database);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function conversation(database, conversationID) {
  const [rows] = await database.execute(
    'SELECT `id`,`chat_type`,`title` FROM `plural_chat_conversations` WHERE `id` = ? LIMIT 1',
    [identifier(conversationID, 'Conversation ID')]
  );
  if (!rows[0]) throw Object.assign(new Error('Chat conversation was not found'), { status: 404 });
  return { id: String(rows[0].id), type: chatType(rows[0].chat_type), title: String(rows[0].title || '') };
}

async function authorize(database, conversationID, systemID, memberID = '') {
  const chat = await conversation(database, conversationID);
  systemID = identifier(systemID, 'Viewer System ID');
  const internal = INTERNAL_TYPES.has(chat.type);
  memberID = identifier(memberID, 'Viewer Member ID', !internal ? false : true);
  const sql = internal
    ? 'SELECT `id` FROM `plural_chat_participants` WHERE `conversation_id` = ? AND `participant_type` = \'member\' AND `system_id` = ? AND `member_id` = ? LIMIT 1'
    : 'SELECT `id` FROM `plural_chat_participants` WHERE `conversation_id` = ? AND `participant_type` = \'system\' AND `system_id` = ? LIMIT 1';
  const parameters = internal ? [chat.id, systemID, memberID] : [chat.id, systemID];
  const [rows] = await database.execute(sql, parameters);
  if (!rows[0]) throw Object.assign(new Error('You do not have access to this conversation'), { status: 403 });
  return { ...chat, systemID, memberID, internal };
}

async function createConversation(database, type, title, creatorSystemID, creatorMemberID, participantInput) {
  type = chatType(type);
  title = String(title ?? '').trim();
  if (title.length > 191) throw new Error('Chat title cannot exceed 191 characters');
  creatorSystemID = identifier(creatorSystemID, 'Creator System ID');
  const internal = INTERNAL_TYPES.has(type);
  creatorMemberID = identifier(creatorMemberID, 'Creator Member ID', internal);
  const participants = normalizeParticipants(participantInput, type);
  participants.push({ participantType: internal ? 'member' : 'system', systemID: creatorSystemID, memberID: internal ? creatorMemberID : '' });
  const unique = [...new Map(participants.map(item => [`${item.participantType}\0${item.systemID}\0${item.memberID}`, item])).values()];
  if (type.endsWith('_direct') && unique.length !== 2) throw new Error('A direct chat must contain exactly two participants');
  if (type.endsWith('_group') && unique.length < 2) throw new Error('A group chat must contain at least two participants');
  const now = Date.now();
  return withTransaction(database, async connection => {
    const [result] = await connection.execute(
      'INSERT INTO `plural_chat_conversations` (`chat_type`,`title`,`created_by_system_id`,`created_by_member_id`,`created_at`) VALUES (?,?,?,?,?)',
      [type, title, creatorSystemID, creatorMemberID || null, now]
    );
    for (const item of unique) await connection.execute(
      'INSERT INTO `plural_chat_participants` (`conversation_id`,`participant_type`,`system_id`,`member_id`,`joined_at`) VALUES (?,?,?,?,?)',
      [result.insertId, item.participantType, item.systemID, item.memberID, now]
    );
    return { id: String(result.insertId), chat_type: type, title, participants: unique.length, created_at: now };
  });
}

async function addParticipant(database, conversationID, systemID, memberID = '') {
  const chat = await conversation(database, conversationID);
  const internal = INTERNAL_TYPES.has(chat.type);
  systemID = identifier(systemID, 'Participant System ID');
  memberID = identifier(memberID, 'Participant Member ID', internal);
  await database.execute(
    'INSERT INTO `plural_chat_participants` (`conversation_id`,`participant_type`,`system_id`,`member_id`,`joined_at`) VALUES (?,?,?,?,?)',
    [chat.id, internal ? 'member' : 'system', systemID, internal ? memberID : '', Date.now()]
  );
  return { conversation_id: chat.id, system_id: systemID, member_id: internal ? memberID : '' };
}

async function removeParticipant(database, conversationID, systemID, memberID = '') {
  const chat = await conversation(database, conversationID);
  const internal = INTERNAL_TYPES.has(chat.type);
  systemID = identifier(systemID, 'Participant System ID');
  memberID = identifier(memberID, 'Participant Member ID', internal);
  const [result] = await database.execute(
    'DELETE FROM `plural_chat_participants` WHERE `conversation_id` = ? AND `participant_type` = ? AND `system_id` = ? AND `member_id` = ?',
    [chat.id, internal ? 'member' : 'system', systemID, internal ? memberID : '']
  );
  return { removed: Number(result.affectedRows || 0), conversation_id: chat.id };
}

async function listConversations(database, systemID, memberID = '') {
  systemID = identifier(systemID, 'Viewer System ID');
  memberID = identifier(memberID, 'Viewer Member ID', false);
  const [rows] = await database.execute(
    `SELECT \`c\`.\`id\`,\`c\`.\`chat_type\`,\`c\`.\`title\`,\`c\`.\`created_at\`,\`p\`.\`last_read_message_id\`,MAX(\`m\`.\`id\`) AS \`last_message_id\`,MAX(\`m\`.\`created_at\`) AS \`last_message_at\`
       FROM \`plural_chat_conversations\` AS \`c\`
       INNER JOIN \`plural_chat_participants\` AS \`p\` ON \`p\`.\`conversation_id\` = \`c\`.\`id\`
       LEFT JOIN \`plural_chat_messages\` AS \`m\` ON \`m\`.\`conversation_id\` = \`c\`.\`id\` AND \`m\`.\`deleted_at\` IS NULL
      WHERE ((\`c\`.\`chat_type\` IN ('internal_direct','internal_group') AND \`p\`.\`participant_type\` = 'member' AND \`p\`.\`system_id\` = ? AND \`p\`.\`member_id\` = ?)
         OR (\`c\`.\`chat_type\` IN ('system_direct','system_group') AND \`p\`.\`participant_type\` = 'system' AND \`p\`.\`system_id\` = ?))
      GROUP BY \`c\`.\`id\`,\`c\`.\`chat_type\`,\`c\`.\`title\`,\`c\`.\`created_at\`,\`p\`.\`last_read_message_id\`
      ORDER BY COALESCE(MAX(\`m\`.\`created_at\`),\`c\`.\`created_at\`) DESC`,
    [systemID, memberID, systemID]
  );
  return rows.map(row => ({ ...row, id: String(row.id), created_at: Number(row.created_at), last_message_id: row.last_message_id == null ? null : String(row.last_message_id), last_message_at: row.last_message_at == null ? null : Number(row.last_message_at) }));
}

async function listParticipants(database, conversationID, viewerSystemID, viewerMemberID = '') {
  const access = await authorize(database, conversationID, viewerSystemID, viewerMemberID);
  const [rows] = await database.execute(
    'SELECT `participant_type`,`system_id`,`member_id`,`joined_at`,`last_read_message_id` FROM `plural_chat_participants` WHERE `conversation_id` = ? ORDER BY `id` ASC',
    [access.id]
  );
  return rows.map(row => ({ ...row, member_id: row.member_id || null, joined_at: Number(row.joined_at), last_read_message_id: row.last_read_message_id == null ? null : String(row.last_read_message_id) }));
}

async function sendMessage(database, access, body, sender = {}) {
  body = String(body ?? '').trim();
  if (!body || body.length > MAX_MESSAGE_LENGTH) throw Object.assign(new Error(`Message must contain 1–${MAX_MESSAGE_LENGTH} characters`), { status: 400 });
  const memberID = access.internal ? access.memberID : identifier(sender.memberID, 'Sender Member ID', false);
  const memberName = String(sender.memberName || memberID || '').trim().slice(0, 191);
  const systemName = String(sender.systemName || access.systemID).trim().slice(0, 191) || access.systemID;
  const proxyPrefix = sender.proxyPrefix == null ? null : String(sender.proxyPrefix).slice(0, 100);
  const proxySuffix = sender.proxySuffix == null ? null : String(sender.proxySuffix).slice(0, 100);
  const now = Date.now();
  const [result] = await database.execute(
    'INSERT INTO `plural_chat_messages` (`conversation_id`,`sender_system_id`,`sender_member_id`,`sender_system_name`,`sender_member_name`,`sender_proxy_prefix`,`sender_proxy_suffix`,`body`,`created_at`) VALUES (?,?,?,?,?,?,?,?,?)',
    [access.id, access.systemID, memberID || null, systemName, memberName || null, proxyPrefix, proxySuffix, body, now]
  );
  return { id: String(result.insertId), conversation_id: access.id, sender_system_id: access.systemID, sender_member_id: memberID || null, sender_system_name: systemName, sender_member_name: memberName || null, sender_proxy_prefix: proxyPrefix, sender_proxy_suffix: proxySuffix, body, created_at: now };
}

async function messagesAfter(database, access, after = 0, limit = 100) {
  after = Number.isSafeInteger(Number(after)) && Number(after) >= 0 ? Number(after) : 0;
  limit = Math.max(1, Math.min(200, Number(limit) || 100));
  const [rows] = await database.execute(
    'SELECT `id`,`conversation_id`,`sender_system_id`,`sender_member_id`,`sender_system_name`,`sender_member_name`,`sender_proxy_prefix`,`sender_proxy_suffix`,`body`,`created_at`,`edited_at` FROM `plural_chat_messages` WHERE `conversation_id` = ? AND `id` > ? AND `deleted_at` IS NULL ORDER BY `id` ASC LIMIT ?',
    [access.id, after, limit]
  );
  return rows.map(row => ({ ...row, id: String(row.id), conversation_id: String(row.conversation_id), created_at: Number(row.created_at), edited_at: row.edited_at == null ? null : Number(row.edited_at) }));
}

module.exports = { CHAT_TYPES, INTERNAL_TYPES, MAX_MESSAGE_LENGTH, identifier, chatType, normalizeMembers, proxyChoices, matchProxy, normalizeParticipants, conversation, authorize, createConversation, addParticipant, removeParticipant, listConversations, listParticipants, sendMessage, messagesAfter };

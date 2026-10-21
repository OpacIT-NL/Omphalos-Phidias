'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createApp, loadDefinitions } = require('../runtime/app');
const chat = require('../blocks/chat_helpers.cjs');
const display = require('../blocks/display_html_chat');

function memoryDatabase(type = 'system_group') {
  const messages = [];
  return {
    messages,
    async execute(sql, parameters) {
      if (sql.startsWith('SELECT `c`.`id`')) return [[{ id: 7, chat_type: type, title: 'Friends', created_at: 10, last_read_message_id: null, last_message_id: 2, last_message_at: 20 }]];
      if (sql.startsWith('SELECT `id`,`chat_type`,`title`')) return [[{ id: 7, chat_type: type, title: 'Friends' }]];
      if (sql.startsWith('SELECT `id` FROM `plural_chat_participants`')) return [[{ id: 3 }]];
      if (sql.startsWith('SELECT `id`,`conversation_id`')) return [messages.filter(message => Number(message.id) > Number(parameters[1]))];
      if (sql.startsWith('INSERT INTO `plural_chat_messages`')) {
        const id = messages.length + 1;
        messages.push({ id, conversation_id: parameters[0], sender_system_id: parameters[1], sender_member_id: parameters[2], sender_system_name: parameters[3], sender_member_name: parameters[4], sender_proxy_prefix: parameters[5], sender_proxy_suffix: parameters[6], body: parameters[7], created_at: parameters[8], edited_at: null });
        return [{ insertId: id, affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

test('chat helpers enforce member/system access and preserve proxy attribution', async () => {
  const database = memoryDatabase('system_group');
  const access = await chat.authorize(database, '7', 'system-a', 'member-a');
  assert.equal(access.internal, false);
  const saved = await chat.sendMessage(database, access, '<b>plain text</b>', { memberID: 'member-a', memberName: 'Alex', systemName: 'Northstar' });
  assert.equal(saved.sender_member_id, 'member-a');
  assert.equal(saved.sender_member_name, 'Alex');
  assert.equal(saved.body, '<b>plain text</b>');
  assert.deepEqual((await chat.messagesAfter(database, access, 0)).map(item => item.body), ['<b>plain text</b>']);
  assert.deepEqual((await chat.listConversations(database, 'system-a', 'member-a')).map(item => item.id), ['7']);
  await assert.rejects(() => chat.sendMessage(database, access, 'x'.repeat(4001)), /1–4000/);
});

test('PluralKit member JSON preserves display names and resolves proxy tags', () => {
  const members = chat.normalizeMembers(JSON.stringify([
    { id: 'member-a', name: 'Alex', display_name: 'Alex Star', proxy_tags: [{ prefix: '[', suffix: ']' }, { prefix: null, suffix: '-a' }] },
    { id: 'member-b', name: 'Robin', proxy_tags: [] }
  ]));
  assert.deepEqual(members[0], { id: 'member-a', name: 'Alex', displayName: 'Alex Star', proxyTags: [{ prefix: '[', suffix: ']' }, { prefix: '', suffix: '-a' }] });
  assert.deepEqual(chat.matchProxy(members, '[Hello]'), { memberID: 'member-a', memberName: 'Alex Star', proxyIndex: 0, prefix: '[', suffix: ']', body: 'Hello' });
  assert.deepEqual(chat.matchProxy(members, 'Hello-a'), { memberID: 'member-a', memberName: 'Alex Star', proxyIndex: 1, prefix: '', suffix: '-a', body: 'Hello' });
  assert.equal(chat.matchProxy(members, 'Hello'), null);
});

test('Display HTML Chat produces executable safe browser HTML', () => {
  const html = display.chatHTML({ token: 'a'.repeat(64), systemID: 'system-a', title: '<Chat>', members: [{ id: 'member-a', name: '<Alex>' }], defaultMemberID: 'member-a', refreshMs: 3000 });
  assert.match(html, /&lt;Chat&gt;/);
  assert.match(html, /&lt;Alex&gt;/);
  assert.match(html, /textContent = String\(item\.body/);
  assert.doesNotMatch(html, /innerHTML/);
  const scripts = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Function(scripts[0][1]));
});

test('HTML chat polls and sends through a cookie-bound MySQL-backed endpoint', async t => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  definitions.set('test_chat_auth', {
    type: 'test_chat_auth', name: 'Test Chat Authentication', category: 'Tests', inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }], fields: [], outputs: ['next'], outputPorts: [{ id: 'next', name: 'Next', kind: 'action', types: [] }],
    async execute(ctx) { ctx.setLoggedInUser({ username: 'alice' }); return 'next'; }
  });
  const text = (id, value) => ({ id, type: 'text', x: 0, y: 0, options: { text: value } });
  const document = { version: 1, name: 'Chat app', workspaces: [{ id: 'chat', name: 'Chat', active: true, blocks: [
    { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/chat' } },
    { id: 'auth', type: 'test_chat_auth', x: 150, y: 0, options: {} },
    text('conversation', '7'), text('system', 'system-a'), text('system-name', 'Northstar'), text('member', 'member-a'), text('members', '[{"id":"member-a","name":"Alex","display_name":"Alex Star","proxy_tags":[{"prefix":"[","suffix":"]"}]}]'),
    { id: 'display', type: 'display_html_chat', x: 300, y: 0, options: { refresh_seconds: 3 } },
    { id: 'reply', type: 'respond', x: 600, y: 0, options: { status: 200, format: 'HTML', body: '', headers: '{}' } },
    { id: 'error-log', type: 'console_log', x: 600, y: 200, options: { level: 'error', value: '' } }
  ], connections: [
    { id: 'a0', from: 'http', output: 'next', to: 'auth', input: 'action', kind: 'action' },
    { id: 'a1', from: 'auth', output: 'next', to: 'display', input: 'action', kind: 'action' },
    { id: 'v1', from: 'conversation', output: 'text', to: 'display', input: 'conversation_id', kind: 'value' },
    { id: 'v2', from: 'system', output: 'text', to: 'display', input: 'viewer_system_id', kind: 'value' },
    { id: 'v3', from: 'system-name', output: 'text', to: 'display', input: 'viewer_system_name', kind: 'value' },
    { id: 'v4', from: 'member', output: 'text', to: 'display', input: 'viewer_member_id', kind: 'value' },
    { id: 'v5', from: 'members', output: 'text', to: 'display', input: 'members', kind: 'value' },
    { id: 'a2', from: 'display', output: 'next', to: 'reply', input: 'action', kind: 'action' },
    { id: 'v6', from: 'display', output: 'html', to: 'reply', input: 'body', kind: 'value' },
    { id: 'a3', from: 'display', output: 'error', to: 'error-log', input: 'action', kind: 'action' },
    { id: 'v7', from: 'display', output: 'error_message', to: 'error-log', input: 'value', kind: 'value' }
  ] }] };
  const database = memoryDatabase();
  const errors = [];
  const logErrors = [];
  const logger = { debug() {}, info() {}, warning() {}, error(value) { logErrors.push(value); } };
  const app = createApp({ document, definitions, databaseProvider: async () => database, logger, onError: error => errors.push(error) });
  const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`, cookie = 'phidias_local_session_chat=test-session';
  const page = await fetch(base + '/chat', { headers: { cookie } });
  assert.equal(page.status, 200, errors[0]?.stack || logErrors[0]);
  const html = await page.text();
  const token = html.match(/data-phidias-chat="([a-f0-9]{64})"/)?.[1];
  assert.ok(token);
  const endpoint = `${base}/_phidias/chat/${token}/messages`;
  assert.equal((await fetch(endpoint)).status, 403);
  const sent = await fetch(endpoint, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json', 'x-phidias-chat-token': token }, body: JSON.stringify({ body: '[Hello <script>]', member_id: 'member-a', proxy_index: 0 }) });
  assert.equal(sent.status, 201);
  const sentMessage = await sent.json();
  assert.equal(sentMessage.sender_member_name, 'Alex Star');
  assert.equal(sentMessage.sender_proxy_prefix, '[');
  assert.equal(sentMessage.body, 'Hello <script>');
  const feed = await fetch(endpoint + '?after=0', { headers: { cookie } });
  assert.equal(feed.status, 200);
  assert.equal((await feed.json()).messages[0].body, 'Hello <script>');
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { LocalDatabaseAuth } = require('../runtime/local-auth');

test('remembered local sessions survive an authentication runtime restart and logout revokes them', async () => {
  const rows = new Map();
  const user = { id: 42, username: 'alice', allow_login: 1 };
  const database = {
    async execute(sql, parameters) {
      if (sql.startsWith('INSERT INTO `sessions`')) {
        rows.set(parameters[0], { token_hash: parameters[0], user_id: parameters[1], created_at: parameters[2], last_used_at: parameters[3] });
        return [{ insertId: 1 }, []];
      }
      if (sql.startsWith('SELECT `u`.`id`')) return [[rows.has(parameters[0]) ? user : undefined].filter(Boolean), []];
      if (sql.startsWith('UPDATE `sessions`')) {
        const row = rows.get(parameters[1]);
        if (row) row.last_used_at = parameters[0];
        return [{ affectedRows: row ? 1 : 0 }, []];
      }
      if (sql.startsWith('DELETE FROM `sessions`')) return [{ affectedRows: rows.delete(parameters[0]) ? 1 : 0 }, []];
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };

  const first = new LocalDatabaseAuth(database, { cookieName: 'local_test_session' });
  const created = await first.createSession(user, true);
  const tokenHash = crypto.createHash('sha256').update(created.token).digest('hex');
  assert.equal(created.remembered, true);
  assert.equal(created.expiresAt, null);
  assert.equal(rows.has(tokenHash), true);
  assert.equal(rows.has(created.token), false);
  assert.match(first.browserCookie(created.token, false, true), /Max-Age=2147483647/);
  first.close();

  const request = { headers: { cookie: `local_test_session=${created.token}` } };
  const restarted = new LocalDatabaseAuth(database, { cookieName: 'local_test_session' });
  const restored = await restarted.browserSession(request);
  assert.deepEqual(
    { userid: restored.userid, username: restored.username, remembered: restored.remembered, expiresAt: restored.expiresAt },
    { userid: '42', username: 'alice', remembered: true, expiresAt: null }
  );
  assert.equal((await restarted.logout(request)).userid, '42');
  assert.equal(rows.size, 0);
  assert.equal(await restarted.browserSession(request), null);
  restarted.close();
});

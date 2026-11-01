'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const argon2 = require('../lib/password-hash');
const { LocalDatabaseAuth } = require('../runtime/local-auth');
const block = require('../blocks/change_local_user_password');

function response() {
  return {
    writableEnded: false,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); },
    end(body = '') { this.body = body; this.writableEnded = true; }
  };
}

test('password change fields accept form and parsed request bodies', () => {
  const expected = {
    username: 'alice',
    currentPassword: 'current password',
    newPassword: 'replacement password',
    confirmNewPassword: 'replacement password'
  };
  assert.deepEqual(block.fieldsFromBody({
    username: 'alice',
    current_password: 'current password',
    new_password: 'replacement password',
    confirm_new_password: 'replacement password'
  }), expected);
  assert.deepEqual(block.fieldsFromBody(new URLSearchParams({
    username: 'alice',
    current_password: 'current password',
    new_password: 'replacement password',
    confirm_new_password: 'replacement password'
  }).toString()), expected);
});

test('local password changes verify the current password, hash the replacement, and revoke sessions', async () => {
  const currentHash = await argon2.hash('current application password', { type: argon2.argon2id });
  const queries = [];
  const database = {
    async execute(sql, parameters) {
      queries.push({ sql, parameters });
      if (sql.startsWith('SELECT')) return [[{ id: 42, username: 'alice', password_hash: currentHash, allow_login: 1 }], []];
      if (sql.startsWith('UPDATE')) return [{ affectedRows: 1 }, []];
      return [{ affectedRows: 2 }, []];
    }
  };
  const authentication = new LocalDatabaseAuth(database);
  authentication.sessions.set('alice-session', { userid: '42' });
  authentication.sessions.set('other-session', { userid: '99' });

  await assert.rejects(authentication.changePassword({
    username: 'alice',
    currentPassword: 'current application password',
    newPassword: 'replacement application password',
    confirmNewPassword: 'different replacement'
  }, '127.0.0.1'), error => error?.status === 400 && /do not match/.test(error.message));
  assert.equal(queries.length, 0);

  await assert.rejects(authentication.changePassword({
    username: 'alice',
    currentPassword: 'wrong current password',
    newPassword: 'replacement application password',
    confirmNewPassword: 'replacement application password'
  }, '127.0.0.1'), error => error?.status === 401 && /Invalid username or current password/.test(error.message));
  assert.equal(queries.length, 1);

  const changed = await authentication.changePassword({
    username: 'alice',
    currentPassword: 'current application password',
    newPassword: 'replacement application password',
    confirmNewPassword: 'replacement application password'
  }, '127.0.0.1');
  assert.deepEqual(changed, { userid: '42', username: 'alice' });

  const update = queries.find(query => query.sql.startsWith('UPDATE'));
  assert.equal(update.sql, 'UPDATE `users` SET `password_hash` = ? WHERE `id` = ? AND `password_hash` = ?');
  assert.deepEqual(update.parameters.slice(1), [42, currentHash]);
  assert.match(update.parameters[0], /^\$argon2id\$/);
  assert.equal(await argon2.verify(update.parameters[0], 'replacement application password'), true);
  assert.deepEqual(queries.at(-1), {
    sql: 'DELETE FROM `sessions` WHERE `user_id` = ?',
    parameters: [42]
  });
  assert.equal(authentication.sessions.has('alice-session'), false);
  assert.equal(authentication.sessions.has('other-session'), true);
  authentication.close();
});

test('Change Local User Password renders the default form and follows the changed output', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-password-change-'));
  await fs.cp(path.resolve(__dirname, '../defaults/templates'), path.join(directory, 'html'), { recursive: true });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const getResponse = response();
  const getResult = await block.execute({
    directory,
    appName: 'Local users',
    request: { method: 'GET', path: '/change-password' },
    response: getResponse
  }, {}, {}, () => {});
  assert.equal(getResult, null);
  assert.equal(getResponse.status, 200);
  assert.match(getResponse.body, /name="username"/);
  assert.match(getResponse.body, /name="current_password" type="password"/);
  assert.match(getResponse.body, /name="new_password" type="password"/);
  assert.match(getResponse.body, /name="confirm_new_password" type="password"/);
  assert.match(getResponse.body, /auth-card--password/);
  assert.match(getResponse.body, /background: #18212c/);

  const outputs = {};
  const postResponse = response();
  const postResult = await block.execute({
    request: {
      method: 'POST',
      path: '/change-password',
      ip: '127.0.0.1',
      body: {
        username: 'alice',
        current_password: 'current application password',
        new_password: 'replacement application password',
        confirm_new_password: 'replacement application password'
      }
    },
    response: postResponse,
    async localAuthentication() {
      return {
        async changePassword(values, ip) {
          assert.equal(values.username, 'alice');
          assert.equal(values.currentPassword, 'current application password');
          assert.equal(values.newPassword, 'replacement application password');
          assert.equal(values.confirmNewPassword, 'replacement application password');
          assert.equal(ip, '127.0.0.1');
          return { userid: '42', username: 'alice' };
        }
      };
    }
  }, {}, {}, (id, value) => { outputs[id] = value; });
  assert.equal(postResult, 'changed');
  assert.deepEqual(outputs, { userid: '42', username: 'alice' });
  assert.equal(postResponse.writableEnded, false);
});

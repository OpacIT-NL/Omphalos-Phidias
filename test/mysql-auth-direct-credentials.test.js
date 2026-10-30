'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DirectMySQLAuth } = require('../lib/mysql-auth-direct');

test('Direct MySQL credential lookup quotes the database alias and decrypts the secret', async () => {
  const auth = new DirectMySQLAuth({});
  auth.phidiasKey = crypto.randomBytes(32);
  auth.serverKey = crypto.randomBytes(32);
  const id = crypto.randomUUID();
  const password = auth.encryptCredentialSecret(id, 'password', 'database-secret');
  let query;
  auth.query = async (sql, parameters) => {
    query = { sql, parameters };
    return [[{
      id,
      type: 'mysql',
      name: 'Application database',
      host: 'mysql.internal',
      port: 3306,
      domain: '',
      username: 'application',
      password,
      privateKey: '',
      database: 'application',
      permissions: '',
      extra: '{}'
    }]];
  };

  const credential = await auth.credential(id, 'mysql');
  assert.match(query.sql, /database_name AS `database`/);
  assert.deepEqual(query.parameters, [id, 'mysql']);
  assert.equal(credential.database, 'application');
  assert.equal(credential.password, 'database-secret');
});

test('Direct MySQL credential listing quotes the database alias', async () => {
  const auth = new DirectMySQLAuth({});
  let sql;
  auth.query = async statement => { sql = statement; return [[]]; };
  assert.deepEqual(await auth.listCredentials(), []);
  assert.match(sql, /database_name AS `database`/);
});

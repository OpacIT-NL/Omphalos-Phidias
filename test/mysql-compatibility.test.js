'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ensureMySQL, MYSQL_SCHEMA } = require('../lib/auth-backend-shared');

test('MySQL authentication schema quotes reserved identifiers and uses one compatible schema', async () => {
  assert.equal(MYSQL_SCHEMA.length, 14);
  const groups = MYSQL_SCHEMA.find(statement => statement.includes('`acl_groups`'));
  assert.ok(groups);
  assert.match(groups, /`system` TINYINT/);
  assert.match(groups, /`id` BIGINT NOT NULL AUTO_INCREMENT/);
  assert.doesNotMatch(groups, /[, (]system[ )]/i);
  assert.ok(MYSQL_SCHEMA.every(statement => statement.includes('ENGINE=InnoDB')));
  assert.ok(MYSQL_SCHEMA.every(statement => statement.includes('CHARACTER SET utf8mb4')));

  const migrationSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'auth-backend.js'), 'utf8');
  assert.doesNotMatch(migrationSource, /CREATE TABLE/i);
  assert.match(migrationSource, /auth-backend-shared/);
});

test('MySQL schema initialization repairs old non-auto-increment ID columns', async () => {
  const queries = [];
  const connection = {
    async query(sql, parameters = []) {
      queries.push({ sql, parameters });
      if (sql.includes('information_schema')) return [[{ extra: '' }], []];
      return [[], []];
    }
  };

  await ensureMySQL(connection);

  assert.equal(queries.filter(item => /^CREATE TABLE/.test(item.sql)).length, MYSQL_SCHEMA.length);
  assert.deepEqual(
    queries.filter(item => /^ALTER TABLE/.test(item.sql)).map(item => item.sql),
    [
      'ALTER TABLE `users` MODIFY COLUMN `id` BIGINT NOT NULL AUTO_INCREMENT',
      'ALTER TABLE `acl_groups` MODIFY COLUMN `id` BIGINT NOT NULL AUTO_INCREMENT'
    ]
  );
});

test('MySQL schema initialization leaves current auto-increment columns unchanged', async () => {
  const queries = [];
  const connection = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('information_schema')) return [[{ extra: 'auto_increment' }], []];
      return [[], []];
    }
  };

  await ensureMySQL(connection);
  assert.equal(queries.some(sql => /^ALTER TABLE/.test(sql)), false);
});

test('MySQL auth SQL contains no deprecated VALUES(column) upserts or bare SYSTEM identifiers', () => {
  const files = ['lib/mysql-auth-direct.js', 'runtime/auth.js'];
  const source = files.map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /VALUES\s*\(\s*[a-z_]/i);
  assert.doesNotMatch(source, /(?:SELECT|INSERT[^\n]*\(|ORDER BY)\s+[^\n'`]*\bsystem\b/i);
});

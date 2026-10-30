'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const masterKeyBlock = require('../blocks/create_master_key');
const encryptBlock = require('../blocks/encrypt_data');
const decryptBlock = require('../blocks/decrypt_data');

test('Create Master Key returns unique raw 256-bit base64url keys', () => {
  const first = masterKeyBlock.createMasterKey();
  const second = masterKeyBlock.createMasterKey();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(first, 'base64url').length, 32);
  assert.notEqual(first, second);
  assert.equal(masterKeyBlock.outputPorts.find(port => port.id === 'master_key').types[0], 'text');
});

test('Encrypt Data and Decrypt Data round-trip text and JSON-compatible values', () => {
  const key = masterKeyBlock.createMasterKey();
  const values = [
    'A string with "quotes", symbols \\ and unicode 🔐',
    42,
    false,
    null,
    ['admin', 'operator'],
    { id: 7, enabled: true, nested: { name: 'IRIS' } }
  ];
  for (const value of values) {
    const encrypted = encryptBlock.encryptData(value, key);
    assert.match(encrypted, /^phidias:aes-256-gcm:v1:/);
    assert.deepEqual(decryptBlock.decryptData(encrypted, key), value);
  }
});

test('Encrypt Data uses a fresh nonce and Decrypt Data rejects wrong keys and tampering', () => {
  const key = masterKeyBlock.createMasterKey();
  const encrypted = encryptBlock.encryptData('credential password', key);
  assert.notEqual(encrypted, encryptBlock.encryptData('credential password', key));
  assert.throws(() => decryptBlock.decryptData(encrypted, masterKeyBlock.createMasterKey()), /could not be authenticated/);

  const parts = encrypted.split(':');
  const tamperedCiphertext = Buffer.from(parts[4], 'base64url');
  tamperedCiphertext[0] ^= 1;
  parts[4] = tamperedCiphertext.toString('base64url');
  assert.throws(() => decryptBlock.decryptData(parts.join(':'), key), /could not be authenticated/);
  assert.throws(() => encryptBlock.encryptData('data', 'not-a-key'), /Create Master Key/);
});

test('native encryption blocks expose action branches and accept protected secret inputs', async () => {
  const key = masterKeyBlock.createMasterKey();
  const secret = value => ({ __phidiasSecret: true, value });
  const context = { revealSecret: value => value?.__phidiasSecret ? value.value : value };
  const encryptedOutputs = {};
  assert.equal(await encryptBlock.execute(context, {}, {
    data: secret('local password'), master_key: secret(key)
  }, (name, value) => { encryptedOutputs[name] = value; }), 'success');

  const decryptedOutputs = {};
  assert.equal(await decryptBlock.execute(context, {}, {
    encrypted_data: encryptedOutputs.encrypted_data, master_key: secret(key)
  }, (name, value) => { decryptedOutputs[name] = value; }), 'success');
  assert.equal(decryptedOutputs.data, 'local password');
  assert.equal(decryptedOutputs.error_message, '');

  const failedOutputs = {};
  assert.equal(await decryptBlock.execute(context, {}, {
    encrypted_data: encryptedOutputs.encrypted_data, master_key: secret(masterKeyBlock.createMasterKey())
  }, (name, value) => { failedOutputs[name] = value; }), 'error');
  assert.equal(failedOutputs.data, null);
  assert.match(failedOutputs.error_message, /could not be authenticated/);
});

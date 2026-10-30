'use strict';

const crypto = require('node:crypto');

const PREFIX = 'phidias:v1:';

function credentialKey(phidiasKey, serverKey) {
  if (!Buffer.isBuffer(phidiasKey) || phidiasKey.length !== 32) throw new Error('The Phidias key must contain exactly 32 bytes.');
  if (!Buffer.isBuffer(serverKey) || serverKey.length !== 32) throw new Error('The credential vault server key must contain exactly 32 bytes.');
  return crypto.hkdfSync('sha512', phidiasKey, serverKey, Buffer.from('phidias/credential-secrets/v1'), 32);
}

function encrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function aad(id, field) {
  return Buffer.from(`phidias:credential:v1:${id}:${field}`);
}

function encryptSecret(key, id, field, value) {
  const plain = String(value || '');
  if (!plain) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(id, field));
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

function decryptSecret(key, id, field, value) {
  const stored = String(value || '');
  if (!stored || !encrypted(stored)) return stored;
  const packed = Buffer.from(stored.slice(PREFIX.length), 'base64');
  if (packed.length < 29) throw new Error(`Encrypted credential ${field} is invalid.`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
  decipher.setAAD(aad(id, field));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
}

module.exports = { PREFIX, credentialKey, encrypted, encryptSecret, decryptSecret };

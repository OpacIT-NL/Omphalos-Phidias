'use strict';

const crypto = require('node:crypto');
const { PREFIX, AAD, decodeMasterKey } = require('./encrypt_data');

function decodePart(value, label, expectedLength = null) {
  if (!/^[A-Za-z0-9_-]+$/.test(value || '')) throw new Error(`Encrypted Data contains an invalid ${label}`);
  const decoded = Buffer.from(value, 'base64url');
  if (expectedLength !== null && decoded.length !== expectedLength) throw new Error(`Encrypted Data contains an invalid ${label}`);
  return decoded;
}

function decryptData(encryptedData, masterKey) {
  const text = String(encryptedData ?? '').trim();
  const parts = text.split(':');
  const prefixParts = PREFIX.split(':');
  if (parts.length !== prefixParts.length + 3 || parts.slice(0, prefixParts.length).join(':') !== PREFIX) {
    throw new Error('Encrypted Data is not a supported Phidias encrypted value');
  }

  const key = decodeMasterKey(masterKey);
  const nonce = decodePart(parts[prefixParts.length], 'nonce', 12);
  const ciphertext = decodePart(parts[prefixParts.length + 1], 'ciphertext');
  const tag = decodePart(parts[prefixParts.length + 2], 'authentication tag', 16);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plaintext);
    if (!payload || payload.version !== 1 || !Object.hasOwn(payload, 'value')) throw new Error('invalid payload');
    return payload.value;
  } catch {
    throw new Error('Encrypted Data could not be authenticated with this Master Key');
  }
}

module.exports = {
  type: 'decrypt_data',
  name: 'Decrypt Data',
  category: 'Credentials',
  description: 'Decrypts data locally with the same master key used by Encrypt Data and rejects modified or incorrectly keyed data.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'encrypted_data', name: 'Encrypted Data', kind: 'value', types: ['text'], required: true },
    { id: 'master_key', name: 'Master Key', kind: 'value', types: ['text', 'secret'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Action', kind: 'action', types: [] },
    { id: 'error', name: 'Action (Error)', kind: 'action', types: [] },
    { id: 'data', name: 'Data', kind: 'value', types: ['unspecified', 'null', 'object', 'boolean', 'number', 'text', 'list'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(ctx, _options, inputs, setOutput) {
    try {
      const reveal = typeof ctx.revealSecret === 'function' ? ctx.revealSecret : value => value;
      setOutput('data', decryptData(inputs.encrypted_data, reveal(inputs.master_key)));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('data', null);
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  decryptData
};

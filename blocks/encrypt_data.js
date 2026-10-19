'use strict';

const crypto = require('node:crypto');

const PREFIX = 'phidias:aes-256-gcm:v1';
const AAD = Buffer.from(PREFIX, 'utf8');

function decodeMasterKey(value) {
  const text = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) throw new Error('Master Key must be a key created by Create Master Key');
  const key = Buffer.from(text, 'base64url');
  if (key.length !== 32) throw new Error('Master Key must contain exactly 256 bits');
  return key;
}

function encodeData(value) {
  if (value === undefined) throw new Error('Data is required');
  try {
    const encoded = JSON.stringify({ version: 1, value });
    if (encoded === undefined) throw new Error('unsupported value');
    return encoded;
  } catch (error) {
    throw new Error(`Data must be JSON-compatible: ${error.message}`);
  }
}

function encryptData(value, masterKey) {
  const key = decodeMasterKey(masterKey);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(encodeData(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${nonce.toString('base64url')}:${ciphertext.toString('base64url')}:${tag.toString('base64url')}`;
}

module.exports = {
  type: 'encrypt_data',
  name: 'Encrypt Data',
  category: 'Credentials',
  description: 'Encrypts application data locally with AES-256-GCM and a master key. Each encryption uses a new random nonce and includes tamper detection.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'data', name: 'Data', kind: 'value', types: ['unspecified', 'null', 'object', 'boolean', 'number', 'text', 'list', 'secret'], required: true },
    { id: 'master_key', name: 'Master Key', kind: 'value', types: ['text', 'secret'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Action', kind: 'action', types: [] },
    { id: 'error', name: 'Action (Error)', kind: 'action', types: [] },
    { id: 'encrypted_data', name: 'Encrypted Data', kind: 'value', types: ['text'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [],
  async execute(ctx, _options, inputs, setOutput) {
    try {
      const reveal = typeof ctx.revealSecret === 'function' ? ctx.revealSecret : value => value;
      setOutput('encrypted_data', encryptData(reveal(inputs.data), reveal(inputs.master_key)));
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      setOutput('encrypted_data', '');
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  encryptData,
  decodeMasterKey,
  PREFIX,
  AAD
};

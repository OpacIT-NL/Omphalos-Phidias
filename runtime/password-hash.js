'use strict';

const crypto = require('node:crypto');
const wasm = require('hash-wasm');

const argon2d = 0;
const argon2i = 1;
const argon2id = 2;
const names = new Map([[argon2d, 'd'], [argon2i, 'i'], [argon2id, 'id']]);
const functions = new Map([[argon2d, wasm.argon2d], [argon2i, wasm.argon2i], [argon2id, wasm.argon2id]]);

function bytes(value) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('Password must be a string, Buffer, or typed array');
}

function base64(value) {
  return Buffer.from(value).toString('base64').replace(/=+$/, '');
}

function parse(encoded) {
  if (typeof encoded !== 'string') throw new TypeError('Hash must be a string');
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== '' || !/^argon2(?:id|i|d)$/.test(parts[1]) || parts[2] !== 'v=19') throw new Error('Invalid hash');
  const parameters = Object.fromEntries(parts[3].split(',').map(part => part.split('=')));
  const memoryCost = Number(parameters.m), timeCost = Number(parameters.t), parallelism = Number(parameters.p);
  if (!Number.isInteger(memoryCost) || !Number.isInteger(timeCost) || !Number.isInteger(parallelism)) throw new Error('Invalid hash');
  const salt = Buffer.from(parts[4], 'base64'), expected = Buffer.from(parts[5], 'base64');
  if (salt.length < 8 || expected.length < 4) throw new Error('Invalid hash');
  const type = parts[1] === 'argon2id' ? argon2id : parts[1] === 'argon2i' ? argon2i : argon2d;
  return { type, memoryCost, timeCost, parallelism, salt, expected };
}

async function noble(type, password, salt, options) {
  const implementation = await import('@noble/hashes/argon2.js');
  const functionName = type === argon2id ? 'argon2idAsync' : type === argon2i ? 'argon2iAsync' : 'argon2dAsync';
  return implementation[functionName](password, salt, {
    m: options.memoryCost,
    t: options.timeCost,
    p: options.parallelism,
    dkLen: options.hashLength,
    ...(options.secret?.length ? { key: options.secret } : {}),
    ...(options.associatedData?.length ? { personalization: options.associatedData } : {})
  });
}

async function calculate(type, password, salt, options) {
  const input = bytes(password);
  const secret = options.secret ? bytes(options.secret) : Buffer.alloc(0);
  const associatedData = options.associatedData ? bytes(options.associatedData) : Buffer.alloc(0);
  const settings = { ...options, secret, associatedData };
  if (input.length === 0) return noble(type, input, salt, settings);
  return functions.get(type)({
    password: input,
    salt,
    secret,
    iterations: options.timeCost,
    memorySize: options.memoryCost,
    parallelism: options.parallelism,
    hashLength: options.hashLength,
    outputType: 'binary'
  });
}

async function hash(password, options = {}) {
  const type = options.type ?? argon2id;
  if (!functions.has(type)) throw new TypeError('Invalid Argon2 type');
  const settings = {
    memoryCost: options.memoryCost ?? 65536,
    timeCost: options.timeCost ?? 3,
    parallelism: options.parallelism ?? 4,
    hashLength: options.hashLength ?? 32,
    secret: options.secret,
    associatedData: options.associatedData
  };
  const salt = options.salt ? bytes(options.salt) : crypto.randomBytes(16);
  const result = Buffer.from(await calculate(type, password, salt, settings));
  if (options.raw) return result;
  return `$argon2${names.get(type)}$v=19$m=${settings.memoryCost},t=${settings.timeCost},p=${settings.parallelism}$${base64(salt)}$${base64(result)}`;
}

async function verify(encoded, password, options = {}) {
  const parsed = parse(encoded);
  const actual = Buffer.from(await calculate(parsed.type, password, parsed.salt, {
    memoryCost: parsed.memoryCost,
    timeCost: parsed.timeCost,
    parallelism: parsed.parallelism,
    hashLength: parsed.expected.length,
    secret: options.secret
  }));
  return actual.length === parsed.expected.length && crypto.timingSafeEqual(actual, parsed.expected);
}

function needsRehash(encoded, options = {}) {
  const parsed = parse(encoded);
  return parsed.memoryCost !== (options.memoryCost ?? 65536)
    || parsed.timeCost !== (options.timeCost ?? 3)
    || parsed.parallelism !== (options.parallelism ?? 4);
}

module.exports = { argon2d, argon2i, argon2id, hash, verify, needsRehash };

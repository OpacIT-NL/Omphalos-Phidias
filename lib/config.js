'use strict';
const path = require('node:path');
function loadConfig() {
  const config = require('../config.json');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('config.json: port must be an integer between 1 and 65535');
  const auth = config.auth ?? {};
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) throw new Error('config.json: auth must be an object');
  const database = auth.database ?? 'data/auth.sqlite';
  const secureCookies = auth.secureCookies ?? false;
  if (typeof database !== 'string' || !database.trim()) throw new Error('config.json: auth.database must be a file path');
  if (typeof secureCookies !== 'boolean') throw new Error('config.json: auth.secureCookies must be a boolean');
  return { port: config.port, authDatabase: path.resolve(__dirname, '..', database), secureCookies };
}
module.exports = { loadConfig };

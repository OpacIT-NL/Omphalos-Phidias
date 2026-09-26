'use strict';
const readline = require('node:readline/promises');
const { Writable } = require('node:stream');
const { Auth, normalizeUsername, validatePassword } = require('../lib/auth');
const { loadConfig } = require('../lib/config');
async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this command in an interactive terminal. Passwords are not accepted in command arguments or environment variables.');
  const reset = process.argv.includes('--reset');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  const controller = new AbortController();
  rl.on('SIGINT', () => controller.abort());
  rl.on('close', () => controller.abort());
  async function ask(prompt, secret = false) {
    process.stdout.write(prompt); muted = secret;
    try { return await rl.question('', { signal: controller.signal }); }
    finally { muted = false; if (secret) process.stdout.write('\n'); }
  }
  let auth;
  try {
    const username = normalizeUsername(await ask('Username: '));
    const password = await ask('Password (at least 12 characters; hidden): ', true);
    validatePassword(password);
    if (password !== await ask('Confirm password: ', true)) throw new Error('Passwords do not match.');
    const config = loadConfig(); auth = new Auth(config.authDatabase, config);
    if (reset) await auth.resetPassword(username, password);
    else await auth.createUser(username, password);
    console.log(reset ? `Password updated for ${username}. All their sessions have been revoked.` : `Created account ${username}. You can now sign in.`);
  } finally { rl.close(); auth?.close(); }
}
main().catch(error => { console.error(error.name === 'AbortError' ? 'Cancelled.' : error.message); process.exitCode = 1; });

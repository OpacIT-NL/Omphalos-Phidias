'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const argon2 = require('argon2');

const PASSWORD_OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32 };
const SESSION_SECONDS = 8 * 60 * 60;
const WINDOW_MS = 15 * 60 * 1000;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const authError = (message, status, retryAfter) => Object.assign(new Error(message), { status, retryAfter });
let dummyHash;
function normalizeUsername(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(value.trim())) throw new Error('Use a username of 3–64 letters, numbers, dots, underscores or hyphens, starting with a letter or number.');
  return value.trim().toLowerCase();
}
function validatePassword(password) {
  if (typeof password !== 'string' || [...password].length < 12 || Buffer.byteLength(password) > 1024) throw new Error('Use a password of at least 12 characters and at most 1,024 bytes.');
}
async function hashPassword(password) { validatePassword(password); return argon2.hash(password, PASSWORD_OPTIONS); }
class Auth {
  constructor(filename, { secureCookies = false } = {}) {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    // Create with restrictive permissions before SQLite writes credentials.
    const fd = fs.openSync(filename, 'a', 0o600); fs.closeSync(fd);
    fs.chmodSync(filename, 0o600);
    this.db = new DatabaseSync(filename);
    this.secureCookies = secureCookies;
    this.pending = 0;
    this.pendingUsers = new Map();
    this.volatileSessions = new Map();
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS login_limits (
        key TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }
  async createUser(username, password) {
    username = normalizeUsername(username); validatePassword(password);
    const hash = await argon2.hash(password, PASSWORD_OPTIONS);
    try { this.db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)').run(username, hash, Date.now()); }
    catch (error) {
      if (this.db.prepare('SELECT id FROM users WHERE username = ?').get(username)) throw new Error('That username already exists. Use the password-reset command instead.');
      throw error;
    }
    return username;
  }
  async resetPassword(username, password) {
    username = normalizeUsername(username); validatePassword(password);
    const hash = await argon2.hash(password, PASSWORD_OPTIONS);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const user = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (!user) throw new Error('User not found.');
      this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return username;
  }
  runningUser(username) {
    if (this.pendingUsers.has(username)) return this.pendingUsers.get(username);
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
  }
  listUsers() {
    const users = new Map(this.db.prepare('SELECT username FROM users ORDER BY username').all().map(user => [user.username, 'saved']));
    for (const [name, user] of this.pendingUsers) { if (user) users.set(name, 'unsaved'); else users.delete(name); }
    return [...users].sort(([a], [b]) => a.localeCompare(b)).map(([username, state]) => ({ username, state }));
  }
  revokeUserSessions(username) {
    this.db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)').run(username);
    for (const [token, session] of this.volatileSessions) if (session.username === username) this.volatileSessions.delete(token);
  }
  async stageUser(username, password, operation = 'upsert') {
    username = normalizeUsername(username);
    const user = this.runningUser(username);
    if (operation === 'create' && user) throw new Error('That username already exists.');
    if (operation === 'reset' && !user) throw new Error('User not found.');
    const hash = await hashPassword(password);
    this.revokeUserSessions(username);
    this.pendingUsers.set(username, { username, password_hash: hash, created_at: user?.created_at || Date.now() });
    return username;
  }
  stageDeleteUser(username) {
    username = normalizeUsername(username);
    if (!this.runningUser(username)) throw new Error('User not found.');
    this.revokeUserSessions(username);
    this.pendingUsers.set(username, null);
    return username;
  }
  commitPendingUsers(beforeCommit) {
    let restore;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [username, user] of this.pendingUsers) {
        this.db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)').run(username);
        if (!user) this.db.prepare('DELETE FROM users WHERE username = ?').run(username);
        else this.db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash').run(username, user.password_hash, user.created_at);
      }
      for (const [token, session] of this.volatileSessions) {
        const user = this.db.prepare('SELECT id FROM users WHERE username = ?').get(session.username);
        if (user && session.expiresAt > Date.now()) this.db.prepare('INSERT OR REPLACE INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').run(token, user.id, session.csrfToken, session.expiresAt);
      }
      restore = beforeCommit?.();
      this.db.exec('COMMIT');
      this.pendingUsers.clear(); this.volatileSessions.clear();
    } catch (error) {
      this.db.exec('ROLLBACK');
      restore?.();
      throw error;
    }
  }
  consumeAttempt(ip, username) {
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM login_limits WHERE expires_at <= ?').run(now);
      const keys = [[digest(`ip:${ip}`), 20], [digest(`username:${username}`), 10]];
      for (const [key, limit] of keys) {
        const row = this.db.prepare('SELECT attempts, expires_at FROM login_limits WHERE key = ?').get(key);
        if (row && row.attempts >= limit) throw authError('Too many sign-in attempts. Try again later.', 429, Math.ceil((row.expires_at - now) / 1000));
      }
      for (const [key] of keys) this.db.prepare('INSERT INTO login_limits (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1').run(key, now + WINDOW_MS);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async login(username, password, ip) {
    let normalized;
    try { normalized = normalizeUsername(username); } catch { normalized = '<invalid>'; }
    this.consumeAttempt(ip, normalized);
    if (this.pending >= 2) throw authError('Sign-in is busy. Try again shortly.', 429, 2);
    this.pending++;
    try {
      const user = this.runningUser(normalized);
      const dummy = await (dummyHash ||= argon2.hash(crypto.randomBytes(32), PASSWORD_OPTIONS));
      const validInput = typeof password === 'string' && Buffer.byteLength(password) <= 1024;
      const matches = await argon2.verify(user?.password_hash || dummy, validInput ? password : 'invalid-password');
      if (!matches || !user || !validInput) throw authError('Invalid username or password.', 401);
      // A password reset during verification must invalidate this login as well.
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const current = this.runningUser(normalized);
        if (current?.password_hash !== user.password_hash) throw authError('Invalid username or password.', 401);
        const token = crypto.randomBytes(32).toString('hex');
        const csrfToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + SESSION_SECONDS * 1000;
        this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
        if (this.pendingUsers.has(normalized)) {
          for (const [key, session] of this.volatileSessions) if (session.expiresAt <= Date.now()) this.volatileSessions.delete(key);
          this.volatileSessions.set(digest(token), { username: user.username, csrfToken, expiresAt });
        } else this.db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').run(digest(token), user.id, csrfToken, expiresAt);
        this.db.exec('COMMIT');
        return { token, csrfToken, username: user.username, expiresAt };
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    } finally { this.pending--; }
  }
  token(request) {
    const value = (request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('sentinel_session='))?.slice(17);
    return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
  }
  session(request) {
    const token = this.token(request); if (!token) return null;
    const temporary = this.volatileSessions.get(digest(token));
    if (temporary) return temporary.expiresAt > Date.now() && this.runningUser(temporary.username) ? { ...temporary } : null;
    const row = this.db.prepare('SELECT s.csrf_token, s.expires_at, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').get(digest(token), Date.now());
    return row && !this.pendingUsers.has(row.username) ? { username: row.username, csrfToken: row.csrf_token, expiresAt: row.expires_at } : null;
  }
  logout(request) {
    const token = this.token(request);
    if (token) { this.volatileSessions.delete(digest(token)); this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token)); }
  }
  checkCSRF(request, session) {
    const value = request.headers['x-csrf-token'];
    if (typeof value !== 'string' || !crypto.timingSafeEqual(Buffer.from(digest(value)), Buffer.from(digest(session.csrfToken)))) throw authError('Invalid CSRF token. Reload the editor and try again.', 403);
  }
  cookie(token = '') {
    return `sentinel_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_SECONDS : 0}${this.secureCookies ? '; Secure' : ''}`;
  }
  close() { this.db.close(); }
}
module.exports = { Auth, normalizeUsername, validatePassword, hashPassword };

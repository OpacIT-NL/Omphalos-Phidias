'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const argon2 = require('argon2');

const BROWSER_SESSION_MS = 24 * 60 * 60 * 1000;
const API_SESSION_MS = 8 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
let dummyHash;
function authError(message, status = 401, retryAfter) {
  return Object.assign(new Error(message), { status, retryAfter });
}
function normalizedUsername(value) {
  const username = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(username) ? username : '<invalid>';
}
function cookieValue(request, name) {
  const header = request?.headers?.cookie || '';
  const part = header.split(';').map(value => value.trim()).find(value => value.startsWith(name + '='));
  return part ? part.slice(name.length + 1) : null;
}
class WorkflowAuth {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(filename, 'a', 0o600); fs.closeSync(fd);
    fs.chmodSync(filename, 0o600);
    this.db = new DatabaseSync(filename);
    this.pending = 0;
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
      CREATE TABLE IF NOT EXISTS automation_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('browser', 'api')),
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS automation_sessions_expiry ON automation_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS automation_login_limits (
        key TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }
  consumeAttempt(ip, username) {
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM automation_login_limits WHERE expires_at <= ?').run(now);
      const keys = [[digest(`ip:${ip || 'unknown'}`), 20], [digest(`username:${username}`), 10]];
      for (const [key, limit] of keys) {
        const row = this.db.prepare('SELECT attempts, expires_at FROM automation_login_limits WHERE key = ?').get(key);
        if (row && row.attempts >= limit) throw authError('Too many sign-in attempts. Try again later.', 429, Math.ceil((row.expires_at - now) / 1000));
      }
      for (const [key] of keys) this.db.prepare('INSERT INTO automation_login_limits (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1').run(key, now + ATTEMPT_WINDOW_MS);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async login(username, password, kind, ip, deployment = null) {
    username = normalizedUsername(username);
    this.consumeAttempt(ip, username);
    if (this.pending >= 2) throw authError('Sign-in is busy. Try again shortly.', 429, 2);
    this.pending++;
    try {
      const user = this.db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
      const fallback = await (dummyHash ||= argon2.hash(crypto.randomBytes(32), { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32 }));
      const validPassword = typeof password === 'string' && Buffer.byteLength(password) <= 1024;
      const matches = await argon2.verify(user?.password_hash || fallback, validPassword ? password : 'invalid-password');
      if (!matches || !user || !validPassword) throw authError('Invalid username or password.');
      if (!this.allowed(user.username, deployment)) throw authError('This account is not allowed to sign in to this application.', 403);
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + (kind === 'browser' ? BROWSER_SESSION_MS : API_SESSION_MS);
      this.db.prepare('DELETE FROM automation_sessions WHERE expires_at <= ?').run(Date.now());
      this.db.prepare('INSERT INTO automation_sessions (token_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)').run(digest(token), user.id, kind, expiresAt);
      return { token, username: user.username, expiresAt };
    } finally { this.pending--; }
  }
  allowed(username, deployment) {
    if (!deployment?.projectId || !deployment?.channel) return true;
    const permission = deployment.channel === 'Prod' ? 'login_prod' : 'login_rc';
    try {
      return Boolean(this.db.prepare(`SELECT 1 FROM users u WHERE u.username = ? AND (
        EXISTS (SELECT 1 FROM acl_project_grants a WHERE a.principal_type = 'user' AND a.principal_id = u.id AND a.permission = ? AND a.project_id IN (?, '*'))
        OR EXISTS (SELECT 1 FROM acl_group_members m JOIN acl_project_grants a ON a.principal_type = 'group' AND a.principal_id = m.group_id WHERE m.user_id = u.id AND a.permission = ? AND a.project_id IN (?, '*'))
      )`).get(username, permission, deployment.projectId, permission, deployment.projectId));
    } catch (error) {
      if (/no such table/.test(error.message)) return false;
      throw error;
    }
  }
  session(token, kind, deployment = null) {
    if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
    const row = this.db.prepare(`SELECT u.username, s.expires_at FROM automation_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.kind = ? AND s.expires_at > ?`).get(digest(token), kind, Date.now());
    return row && this.allowed(row.username, deployment) ? { username: row.username, expiresAt: row.expires_at } : null;
  }
  browserToken(request) { return cookieValue(request, 'phidias_session'); }
  apiToken(request) {
    const match = String(request?.headers?.authorization || '').match(/^Bearer\s+([a-f0-9]{64})$/i);
    return match ? match[1].toLowerCase() : null;
  }
  browserSession(request, deployment = null) { return this.session(this.browserToken(request), 'browser', deployment); }
  apiSession(request, deployment = null) { return this.session(this.apiToken(request), 'api', deployment); }
  logout(request, kind) {
    const token = kind === 'browser' ? this.browserToken(request) : this.apiToken(request);
    const session = this.session(token, kind);
    if (token) this.db.prepare('DELETE FROM automation_sessions WHERE token_hash = ? AND kind = ?').run(digest(token), kind);
    return session;
  }
  browserCookie(token, secure = false) {
    return `phidias_session=${token}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  }
  clearBrowserCookie(secure = false) {
    return `phidias_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
  }
  close() { this.db.close(); }
}
module.exports = { WorkflowAuth, cookieValue };

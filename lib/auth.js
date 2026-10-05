'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const argon2 = require('argon2');

const PASSWORD_OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32 };
const SESSION_SECONDS = 8 * 60 * 60;
const WINDOW_MS = 15 * 60 * 1000;
const CORE_PERMISSIONS = Object.freeze(['login', 'manage_users', 'create_projects', 'console']);
const PROJECT_PERMISSIONS = Object.freeze(['login_rc', 'login_prod', 'view', 'edit', 'promote', 'delete']);
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
    this.pendingAdministratorGrants = new Set();
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
      CREATE TABLE IF NOT EXISTS acl_groups (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        system INTEGER NOT NULL DEFAULT 0 CHECK(system IN (0, 1)),
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS acl_group_members (
        group_id INTEGER NOT NULL REFERENCES acl_groups(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (group_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS acl_core_grants (
        principal_type TEXT NOT NULL CHECK(principal_type IN ('user', 'group')),
        principal_id INTEGER NOT NULL,
        permission TEXT NOT NULL,
        PRIMARY KEY (principal_type, principal_id, permission)
      );
      CREATE TABLE IF NOT EXISTS acl_project_grants (
        project_id TEXT NOT NULL,
        principal_type TEXT NOT NULL CHECK(principal_type IN ('user', 'group')),
        principal_id INTEGER NOT NULL,
        permission TEXT NOT NULL,
        PRIMARY KEY (project_id, principal_type, principal_id, permission)
      );
      CREATE INDEX IF NOT EXISTS acl_members_user ON acl_group_members(user_id);
      CREATE INDEX IF NOT EXISTS acl_project_lookup ON acl_project_grants(project_id, permission);
      CREATE TABLE IF NOT EXISTS acl_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS acl_user_cleanup AFTER DELETE ON users BEGIN
        DELETE FROM acl_core_grants WHERE principal_type = 'user' AND principal_id = OLD.id;
        DELETE FROM acl_project_grants WHERE principal_type = 'user' AND principal_id = OLD.id;
      END;
      CREATE TRIGGER IF NOT EXISTS acl_group_cleanup AFTER DELETE ON acl_groups BEGIN
        DELETE FROM acl_core_grants WHERE principal_type = 'group' AND principal_id = OLD.id;
        DELETE FROM acl_project_grants WHERE principal_type = 'group' AND principal_id = OLD.id;
      END;
    `);
    this.initializeACL();
  }
  initializeACL() {
    const firstMigration = this.db.prepare("INSERT OR IGNORE INTO acl_meta (key, value) VALUES ('version', '1')").run().changes > 0;
    this.db.prepare("INSERT OR IGNORE INTO acl_groups (name, system, created_at) VALUES ('Administrators', 1, ?)").run(Date.now());
    const administrators = this.db.prepare("SELECT id FROM acl_groups WHERE name = 'Administrators' COLLATE NOCASE").get();
    for (const permission of CORE_PERMISSIONS) this.db.prepare("INSERT OR IGNORE INTO acl_core_grants VALUES ('group', ?, ?)").run(administrators.id, permission);
    for (const permission of PROJECT_PERMISSIONS) this.db.prepare("INSERT OR IGNORE INTO acl_project_grants VALUES ('*', 'group', ?, ?)").run(administrators.id, permission);
    if (firstMigration) this.db.prepare('INSERT OR IGNORE INTO acl_group_members (group_id, user_id) SELECT ?, id FROM users').run(administrators.id);
  }
  ensureFirstAdministrator(username) {
    const users = this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    const administrators = this.db.prepare("SELECT id FROM acl_groups WHERE name = 'Administrators' COLLATE NOCASE").get();
    const members = this.db.prepare('SELECT COUNT(*) AS count FROM acl_group_members WHERE group_id = ?').get(administrators.id).count;
    if (users === 1 && members === 0) this.db.prepare('INSERT OR IGNORE INTO acl_group_members (group_id, user_id) SELECT ?, id FROM users WHERE username = ?').run(administrators.id, username);
  }
  async createUser(username, password) {
    username = normalizeUsername(username); validatePassword(password);
    const hash = await argon2.hash(password, PASSWORD_OPTIONS);
    try { this.db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)').run(username, hash, Date.now()); }
    catch (error) {
      if (this.db.prepare('SELECT id FROM users WHERE username = ?').get(username)) throw new Error('That username already exists. Use the password-reset command instead.');
      throw error;
    }
    this.ensureFirstAdministrator(username);
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
  user(username) { return this.db.prepare('SELECT id, username, created_at FROM users WHERE username = ?').get(normalizeUsername(username)) || null; }
  hasCore(username, permission) {
    if (!CORE_PERMISSIONS.includes(permission)) return false;
    if (this.pendingAdministratorGrants.has(username) && this.runningUser(username)) return true;
    if (this.pendingUsers.has(username) && this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0) return true;
    return Boolean(this.db.prepare(`SELECT 1 FROM users u WHERE u.username = ? AND (
      EXISTS (SELECT 1 FROM acl_core_grants a WHERE a.principal_type = 'user' AND a.principal_id = u.id AND a.permission = ?)
      OR EXISTS (SELECT 1 FROM acl_group_members m JOIN acl_core_grants a ON a.principal_type = 'group' AND a.principal_id = m.group_id WHERE m.user_id = u.id AND a.permission = ?)
    )`).get(username, permission, permission));
  }
  hasProject(username, projectId, permission) {
    if (!PROJECT_PERMISSIONS.includes(permission)) return false;
    if (this.pendingAdministratorGrants.has(username) && this.runningUser(username)) return true;
    if (this.pendingUsers.has(username) && this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0) return true;
    return Boolean(this.db.prepare(`SELECT 1 FROM users u WHERE u.username = ? AND (
      EXISTS (SELECT 1 FROM acl_project_grants a WHERE a.principal_type = 'user' AND a.principal_id = u.id AND a.permission = ? AND a.project_id IN (?, '*'))
      OR EXISTS (SELECT 1 FROM acl_group_members m JOIN acl_project_grants a ON a.principal_type = 'group' AND a.principal_id = m.group_id WHERE m.user_id = u.id AND a.permission = ? AND a.project_id IN (?, '*'))
    )`).get(username, permission, projectId, permission, projectId));
  }
  requireCore(username, permission) {
    if (!this.hasCore(username, permission)) throw authError('You do not have permission to perform this action.', 403);
  }
  requireProject(username, projectId, permission) {
    if (!this.hasProject(username, projectId, permission)) throw authError('You do not have permission to access this project.', 403);
  }
  principal(type, id) {
    if (type === 'user') return this.db.prepare('SELECT id, username AS name FROM users WHERE id = ?').get(Number(id));
    if (type === 'group') return this.db.prepare('SELECT id, name FROM acl_groups WHERE id = ?').get(Number(id));
    return null;
  }
  setGrants(type, id, scope, permissions) {
    const principal = this.principal(type, id);
    if (!principal) throw authError('User or group not found.', 404);
    if (type === 'group' && this.db.prepare('SELECT system FROM acl_groups WHERE id = ?').get(principal.id).system) throw authError('Administrators always have every permission. Change its membership instead.', 409);
    const allowed = scope === 'core' ? CORE_PERMISSIONS : PROJECT_PERMISSIONS;
    if (!Array.isArray(permissions) || permissions.some(permission => !allowed.includes(permission))) throw authError('Invalid permission list.', 400);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (scope === 'core') {
        this.db.prepare('DELETE FROM acl_core_grants WHERE principal_type = ? AND principal_id = ?').run(type, principal.id);
        for (const permission of new Set(permissions)) this.db.prepare('INSERT INTO acl_core_grants VALUES (?, ?, ?)').run(type, principal.id, permission);
      } else {
        this.db.prepare('DELETE FROM acl_project_grants WHERE project_id = ? AND principal_type = ? AND principal_id = ?').run(scope, type, principal.id);
        for (const permission of new Set(permissions)) this.db.prepare('INSERT INTO acl_project_grants VALUES (?, ?, ?, ?)').run(scope, type, principal.id, permission);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  grantProjectOwner(username, projectId) {
    const user = this.user(username); if (!user) return;
    for (const permission of PROJECT_PERMISSIONS) this.db.prepare('INSERT OR IGNORE INTO acl_project_grants VALUES (?, ?, ?, ?)').run(projectId, 'user', user.id, permission);
  }
  deleteProjectGrants(projectId) { this.db.prepare('DELETE FROM acl_project_grants WHERE project_id = ?').run(projectId); }
  async createManagedUser(username, password) { return this.createUser(username, password); }
  async resetManagedPassword(username, password) { return this.resetPassword(username, password); }
  deleteManagedUser(username) {
    username = normalizeUsername(username);
    const result = this.db.prepare('DELETE FROM users WHERE username = ?').run(username);
    if (!result.changes) throw authError('User not found.', 404);
    this.pendingUsers.delete(username); this.pendingAdministratorGrants.delete(username); this.revokeUserSessions(username);
  }
  createGroup(name) {
    name = String(name || '').trim();
    if (!/^[^\x00-\x1f]{1,64}$/.test(name)) throw authError('Use a group name of 1–64 characters.', 400);
    try { return Number(this.db.prepare('INSERT INTO acl_groups (name, created_at) VALUES (?, ?)').run(name, Date.now()).lastInsertRowid); }
    catch (error) { if (this.db.prepare('SELECT id FROM acl_groups WHERE name = ? COLLATE NOCASE').get(name)) throw authError('That group already exists.', 409); throw error; }
  }
  deleteGroup(id) {
    const group = this.db.prepare('SELECT system FROM acl_groups WHERE id = ?').get(Number(id));
    if (!group) throw authError('Group not found.', 404);
    if (group.system) throw authError('The Administrators group cannot be deleted.', 409);
    this.db.prepare('DELETE FROM acl_core_grants WHERE principal_type = ? AND principal_id = ?').run('group', Number(id));
    this.db.prepare('DELETE FROM acl_project_grants WHERE principal_type = ? AND principal_id = ?').run('group', Number(id));
    this.db.prepare('DELETE FROM acl_groups WHERE id = ?').run(Number(id));
  }
  setGroupMembers(id, usernames) {
    const group = this.db.prepare('SELECT id FROM acl_groups WHERE id = ?').get(Number(id));
    if (!group) throw authError('Group not found.', 404);
    if (!Array.isArray(usernames)) throw authError('Members must be a list of usernames.', 400);
    const users = usernames.map(name => this.user(name));
    if (users.some(user => !user)) throw authError('One or more users were not found.', 404);
    if (this.db.prepare('SELECT system FROM acl_groups WHERE id = ?').get(group.id).system && users.length === 0) throw authError('Administrators must contain at least one user.', 409);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM acl_group_members WHERE group_id = ?').run(group.id);
      for (const user of users) this.db.prepare('INSERT INTO acl_group_members VALUES (?, ?)').run(group.id, user.id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  accessModel(projects = []) {
    const core = this.db.prepare('SELECT principal_type, principal_id, permission FROM acl_core_grants').all();
    const project = this.db.prepare('SELECT project_id, principal_type, principal_id, permission FROM acl_project_grants').all();
    const permissionsFor = (type, id, rows, projectId = null) => rows.filter(row => row.principal_type === type && row.principal_id === id && (projectId === null || row.project_id === projectId)).map(row => row.permission);
    const users = this.db.prepare('SELECT id, username, created_at FROM users ORDER BY username').all().map(user => ({ ...user, corePermissions: permissionsFor('user', user.id, core), projectPermissions: Object.fromEntries(projects.map(item => [item.id, permissionsFor('user', user.id, project, item.id)])) }));
    const groups = this.db.prepare('SELECT id, name, system, created_at FROM acl_groups ORDER BY system DESC, name').all().map(group => ({ ...group, members: this.db.prepare('SELECT u.username FROM users u JOIN acl_group_members m ON m.user_id = u.id WHERE m.group_id = ? ORDER BY u.username').all(group.id).map(row => row.username), corePermissions: permissionsFor('group', group.id, core), projectPermissions: Object.fromEntries(projects.map(item => [item.id, permissionsFor('group', group.id, project, item.id)])), wildcardProjectPermissions: permissionsFor('group', group.id, project, '*') }));
    return { corePermissions: CORE_PERMISSIONS, projectPermissions: PROJECT_PERMISSIONS, users, groups, projects };
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
    this.pendingAdministratorGrants.delete(username);
    this.pendingUsers.set(username, null);
    return username;
  }
  stageGrantAll(username) {
    username = normalizeUsername(username);
    if (!this.runningUser(username)) throw new Error('User not found.');
    this.pendingAdministratorGrants.add(username);
    return username;
  }
  get pendingChanges() {
    return new Set([...this.pendingUsers.keys(), ...this.pendingAdministratorGrants]).size;
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
      const administrators = this.db.prepare("SELECT id FROM acl_groups WHERE name = 'Administrators' COLLATE NOCASE").get();
      for (const username of this.pendingAdministratorGrants) {
        this.db.prepare('INSERT OR IGNORE INTO acl_group_members (group_id, user_id) SELECT ?, id FROM users WHERE username = ?').run(administrators.id, username);
      }
      for (const [token, session] of this.volatileSessions) {
        const user = this.db.prepare('SELECT id FROM users WHERE username = ?').get(session.username);
        if (user && session.expiresAt > Date.now()) this.db.prepare('INSERT OR REPLACE INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').run(token, user.id, session.csrfToken, session.expiresAt);
      }
      restore = beforeCommit?.();
      this.db.exec('COMMIT');
      for (const [username, user] of this.pendingUsers) if (user) this.ensureFirstAdministrator(username);
      this.pendingUsers.clear(); this.pendingAdministratorGrants.clear(); this.volatileSessions.clear();
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
      if (!this.hasCore(user.username, 'login')) throw authError('This account is not allowed to sign in.', 403);
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
    if (temporary) return temporary.expiresAt > Date.now() && this.runningUser(temporary.username) && this.hasCore(temporary.username, 'login') ? { ...temporary } : null;
    const row = this.db.prepare('SELECT s.csrf_token, s.expires_at, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').get(digest(token), Date.now());
    return row && !this.pendingUsers.has(row.username) && this.hasCore(row.username, 'login') ? { username: row.username, csrfToken: row.csrf_token, expiresAt: row.expires_at } : null;
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
module.exports = { Auth, normalizeUsername, validatePassword, hashPassword, CORE_PERMISSIONS, PROJECT_PERMISSIONS };

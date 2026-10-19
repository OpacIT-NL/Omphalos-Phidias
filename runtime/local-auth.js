'use strict';

const crypto = require('node:crypto');
const argon2 = require('argon2');

const SESSION_MS = 24 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32 };
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
let dummyHash;

function authError(message, status = 401, retryAfter) {
  return Object.assign(new Error(message), { status, retryAfter });
}

function normalizeUsername(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(value.trim())) {
    throw authError('Use a username of 3–64 letters, numbers, dots, underscores or hyphens, starting with a letter or number.', 400);
  }
  return value.trim().toLowerCase();
}

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw authError('Enter a valid email address.', 400);
  return email;
}

function validatePassword(password) {
  if (typeof password !== 'string' || [...password].length < 12 || Buffer.byteLength(password) > 1024) {
    throw authError('Use a password of at least 12 characters and at most 1,024 bytes.', 400);
  }
}

function cookieValue(request, name) {
  const header = String(request?.headers?.cookie || '');
  const part = header.split(';').map(value => value.trim()).find(value => value.startsWith(name + '='));
  return part ? part.slice(name.length + 1) : null;
}

class LocalDatabaseAuth {
  constructor(database, { cookieName = 'phidias_local_session' } = {}) {
    this.database = database;
    this.cookieName = cookieName;
    this.sessions = new Map();
    this.attempts = new Map();
    this.pending = 0;
  }

  consumeAttempt(ip, username) {
    const now = Date.now();
    for (const [key, state] of this.attempts) if (state.expiresAt <= now) this.attempts.delete(key);
    const limits = [[digest(`ip:${ip || 'unknown'}`), 20], [digest(`username:${username}`), 10]];
    for (const [key, limit] of limits) {
      const state = this.attempts.get(key);
      if (state?.count >= limit) throw authError('Too many sign-in attempts. Try again later.', 429, Math.max(1, Math.ceil((state.expiresAt - now) / 1000)));
    }
    for (const [key] of limits) {
      const state = this.attempts.get(key);
      this.attempts.set(key, { count: (state?.count || 0) + 1, expiresAt: now + ATTEMPT_WINDOW_MS });
    }
  }

  async login(username, password, ip) {
    username = typeof username === 'string' ? username.trim() : '';
    this.consumeAttempt(ip, username.toLocaleLowerCase());
    if (this.pending >= 2) throw authError('Sign-in is busy. Try again shortly.', 429, 2);
    this.pending++;
    try {
      const [rows] = await this.database.execute('SELECT `id`,`username`,`password_hash` FROM `users` WHERE `username` = ? LIMIT 1', [username]);
      const user = rows[0];
      const storedHash = typeof user?.password_hash === 'string' && user.password_hash.startsWith('$argon2id$') ? user.password_hash : null;
      const fallback = await (dummyHash ||= argon2.hash(crypto.randomBytes(32), PASSWORD_OPTIONS));
      const validPassword = typeof password === 'string' && Buffer.byteLength(password) <= 1024;
      let matches = false;
      try { matches = await argon2.verify(storedHash || fallback, validPassword ? password : 'invalid-password'); } catch {}
      if (!user || !storedHash || !validPassword || !matches) throw authError('Invalid username or password.');

      return this.createSession(user);
    } finally {
      this.pending--;
    }
  }

  async register({ username, password, confirmPassword, email, acceptTerms, acceptPrivacy }, ip) {
    username = normalizeUsername(username);
    email = normalizeEmail(email);
    validatePassword(password);
    if (password !== confirmPassword) throw authError('The passwords do not match.', 400);
    if (!acceptTerms) throw authError('You must accept the terms and conditions.', 400);
    if (!acceptPrivacy) throw authError('You must accept the privacy policy.', 400);
    this.consumeAttempt(ip, `register:${username}`);
    if (this.pending >= 2) throw authError('Registration is busy. Try again shortly.', 429, 2);
    this.pending++;
    try {
      const passwordHash = await argon2.hash(password, PASSWORD_OPTIONS);
      let result;
      try {
        [result] = await this.database.execute(
          'INSERT INTO `users` (`username`,`email`,`password_hash`) VALUES (?,?,?)',
          [username, email, passwordHash]
        );
      } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062) throw authError('That username or email address is already registered.', 409);
        throw error;
      }
      if (result?.insertId === undefined || result?.insertId === null) throw new Error('The Application Database did not return the new user ID');
      return this.createSession({ id: result.insertId, username, email });
    } finally {
      this.pending--;
    }
  }

  createSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    const session = {
      userid: String(user.id),
      username: String(user.username),
      ...(user.email ? { email: String(user.email) } : {}),
      expiresAt: Date.now() + SESSION_MS
    };
    this.sessions.set(digest(token), session);
    return { token, ...session };
  }

  browserToken(request) {
    return cookieValue(request, this.cookieName);
  }

  browserSession(request) {
    const token = this.browserToken(request);
    if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
    const key = digest(token), session = this.sessions.get(key), now = Date.now();
    if (!session || session.expiresAt <= now) {
      if (session) this.sessions.delete(key);
      return null;
    }
    session.expiresAt = now + SESSION_MS;
    return { userid: session.userid, username: session.username, ...(session.email ? { email: session.email } : {}), expiresAt: session.expiresAt };
  }

  sessionStatus(request) {
    const token = this.browserToken(request);
    if (!token) return 'missing-token';
    if (!/^[a-f0-9]{64}$/.test(token)) return 'malformed-token';
    const session = this.sessions.get(digest(token));
    if (!session) return 'unknown-token';
    if (session.expiresAt <= Date.now()) return 'expired';
    return 'valid';
  }

  logout(request) {
    const token = this.browserToken(request);
    const session = this.browserSession(request);
    if (token) this.sessions.delete(digest(token));
    return session;
  }

  browserCookie(token, secure = false) {
    return `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  }

  clearBrowserCookie(secure = false) {
    return `${this.cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
  }

  close() {
    this.sessions.clear();
    this.attempts.clear();
  }
}

module.exports = { LocalDatabaseAuth, cookieValue, normalizeUsername, normalizeEmail, validatePassword };

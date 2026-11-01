'use strict';

const crypto = require('node:crypto');

const SESSION_MS = 24 * 60 * 60 * 1000;
const PERSISTENT_COOKIE_SECONDS = 2147483647;
const PERSISTENT_TOUCH_MS = 5 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
let dummyHash;
let argon2;

function passwordLibrary() {
  argon2 ||= require('./password-hash');
  return argon2;
}

function passwordOptions() {
  const library = passwordLibrary();
  return { type: library.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32 };
}

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

  async login(username, password, ip, remember = false) {
    username = typeof username === 'string' ? username.trim() : '';
    this.consumeAttempt(ip, username.toLocaleLowerCase());
    if (this.pending >= 2) throw authError('Sign-in is busy. Try again shortly.', 429, 2);
    this.pending++;
    try {
      const passwordHasher = passwordLibrary();
      const [rows] = await this.database.execute('SELECT `id`,`username`,`password_hash`,`allow_login` FROM `users` WHERE `username` = ? LIMIT 1', [username]);
      const user = rows[0];
      const storedHash = typeof user?.password_hash === 'string' && user.password_hash.startsWith('$argon2id$') ? user.password_hash : null;
      const fallback = await (dummyHash ||= passwordHasher.hash(crypto.randomBytes(32), passwordOptions()));
      const validPassword = typeof password === 'string' && Buffer.byteLength(password) <= 1024;
      let matches = false;
      try { matches = await passwordHasher.verify(storedHash || fallback, validPassword ? password : 'invalid-password'); } catch {}
      if (!user || !storedHash || !validPassword || !matches) throw authError('Invalid username or password.');
      if (Number(user.allow_login) !== 1) throw authError('This account is not allowed to sign in.', 403);

      return this.createSession(user, remember);
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
      const passwordHash = await passwordLibrary().hash(password, passwordOptions());
      let result;
      try {
        [result] = await this.database.execute(
          'INSERT INTO `users` (`username`,`email`,`password_hash`,`allow_login`) VALUES (?,?,?,1)',
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

  async changePassword({ username, currentPassword, newPassword, confirmNewPassword }, ip) {
    username = typeof username === 'string' ? username.trim() : '';
    validatePassword(newPassword);
    if (newPassword !== confirmNewPassword) throw authError('The new passwords do not match.', 400);
    this.consumeAttempt(ip, `change-password:${username.toLocaleLowerCase()}`);
    if (this.pending >= 2) throw authError('Password change is busy. Try again shortly.', 429, 2);
    this.pending++;
    try {
      const passwordHasher = passwordLibrary();
      const [rows] = await this.database.execute('SELECT `id`,`username`,`password_hash`,`allow_login` FROM `users` WHERE `username` = ? LIMIT 1', [username]);
      const user = rows[0];
      const storedHash = typeof user?.password_hash === 'string' && user.password_hash.startsWith('$argon2id$') ? user.password_hash : null;
      const fallback = await (dummyHash ||= passwordHasher.hash(crypto.randomBytes(32), passwordOptions()));
      const validCurrentPassword = typeof currentPassword === 'string' && Buffer.byteLength(currentPassword) <= 1024;
      let matches = false;
      try { matches = await passwordHasher.verify(storedHash || fallback, validCurrentPassword ? currentPassword : 'invalid-password'); } catch {}
      if (!user || !storedHash || !validCurrentPassword || !matches) throw authError('Invalid username or current password.');
      if (Number(user.allow_login) !== 1) throw authError('This account is not allowed to change its password.', 403);

      const passwordHash = await passwordHasher.hash(newPassword, passwordOptions());
      const [result] = await this.database.execute(
        'UPDATE `users` SET `password_hash` = ? WHERE `id` = ? AND `password_hash` = ?',
        [passwordHash, user.id, storedHash]
      );
      if (result?.affectedRows !== undefined && Number(result.affectedRows) !== 1) throw authError('The password changed during this request. Try again.', 409);
      await this.database.execute('DELETE FROM `sessions` WHERE `user_id` = ?', [user.id]);
      for (const [key, session] of this.sessions) if (session.userid === String(user.id)) this.sessions.delete(key);
      return { userid: String(user.id), username: String(user.username) };
    } finally {
      this.pending--;
    }
  }

  async createSession(user, remember = false) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const session = {
      userid: String(user.id),
      username: String(user.username),
      ...(user.email ? { email: String(user.email) } : {}),
      remembered: Boolean(remember),
      expiresAt: remember ? null : now + SESSION_MS,
      lastPersistedAt: now
    };
    const tokenHash = digest(token);
    if (remember) {
      await this.database.execute(
        'INSERT INTO `sessions` (`token_hash`,`user_id`,`created_at`,`last_used_at`) VALUES (?,?,?,?)',
        [tokenHash, user.id, now, now]
      );
    }
    this.sessions.set(tokenHash, session);
    return { token, ...this.publicSession(session) };
  }

  publicSession(session) {
    return {
      userid: session.userid,
      username: session.username,
      ...(session.email ? { email: session.email } : {}),
      remembered: session.remembered,
      expiresAt: session.expiresAt
    };
  }

  browserToken(request) {
    return cookieValue(request, this.cookieName);
  }

  async browserSession(request) {
    const token = this.browserToken(request);
    if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
    const key = digest(token), now = Date.now();
    let session = this.sessions.get(key);
    if (session) {
      if (!session.remembered && session.expiresAt <= now) {
        this.sessions.delete(key);
        return null;
      }
      if (session.remembered && now - session.lastPersistedAt >= PERSISTENT_TOUCH_MS) {
        await this.database.execute('UPDATE `sessions` SET `last_used_at` = ? WHERE `token_hash` = ?', [now, key]);
        session.lastPersistedAt = now;
      } else if (!session.remembered) {
        session.expiresAt = now + SESSION_MS;
      }
      return this.publicSession(session);
    }

    const [rows] = await this.database.execute(
      'SELECT `u`.`id`,`u`.`username`,`u`.`allow_login` FROM `sessions` AS `s` INNER JOIN `users` AS `u` ON `u`.`id` = `s`.`user_id` WHERE `s`.`token_hash` = ? LIMIT 1',
      [key]
    );
    const user = rows[0];
    if (!user || Number(user.allow_login) !== 1) {
      if (user) await this.database.execute('DELETE FROM `sessions` WHERE `token_hash` = ?', [key]);
      return null;
    }
    session = {
      userid: String(user.id),
      username: String(user.username),
      remembered: true,
      expiresAt: null,
      lastPersistedAt: now
    };
    this.sessions.set(key, session);
    await this.database.execute('UPDATE `sessions` SET `last_used_at` = ? WHERE `token_hash` = ?', [now, key]);
    return this.publicSession(session);
  }

  sessionStatus(request) {
    const token = this.browserToken(request);
    if (!token) return 'missing-token';
    if (!/^[a-f0-9]{64}$/.test(token)) return 'malformed-token';
    const session = this.sessions.get(digest(token));
    if (!session) return 'unknown-token';
    if (!session.remembered && session.expiresAt <= Date.now()) return 'expired';
    return 'valid';
  }

  async logout(request) {
    const token = this.browserToken(request);
    const session = await this.browserSession(request);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const key = digest(token);
      this.sessions.delete(key);
      if (session?.remembered) await this.database.execute('DELETE FROM `sessions` WHERE `token_hash` = ?', [key]);
    }
    return session;
  }

  browserCookie(token, secure = false, remember = false) {
    const persistence = remember ? `; Max-Age=${PERSISTENT_COOKIE_SECONDS}` : '';
    return `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict${persistence}${secure ? '; Secure' : ''}`;
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

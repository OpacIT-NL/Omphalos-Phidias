'use strict';
const argon2 = require('argon2');
const { normalizeUsername } = require('./auth');
const { version } = require('../package.json');
const ENABLE_PASSWORD_OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32 };
const PROMPTS = { disabled: 'Console$> ', enabled: 'Console#> ', config: 'Config#> ' };
function words(line) {
  const result = [];
  const pattern = /\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"']+))/gy;
  let position = 0, match;
  while (position < line.trimEnd().length) {
    pattern.lastIndex = position; match = pattern.exec(line);
    if (!match) throw new Error('Unclosed quote or invalid command syntax.');
    result.push(match[1] !== undefined ? JSON.parse(`"${match[1]}"`) : match[2] ?? match[3]);
    position = pattern.lastIndex;
  }
  return result;
}
function displayConfig(document) {
  const copy = structuredClone(document);
  copy.console.enablePasswordHash = copy.console.enablePasswordHash ? '[configured; hidden]' : null;
  if (copy.auth.mysql?.password) copy.auth.mysql.password = '[configured; hidden]';
  return JSON.stringify(copy, null, 2);
}
class CommandConsole {
  constructor({ config, auth, logger, ask, write, shutdown, status = () => '' }) {
    Object.assign(this, { config, auth, logger, ask, write, shutdown, status });
    const transportAsk = this.ask;
    this.ask = async (prompt, secret = false) => {
      const value = await transportAsk(prompt, secret);
      this.logInput(value, secret);
      return value;
    };
    this.mode = 'disabled'; this.stopped = false; this.failedEnables = 0; this.enableBlockedUntil = 0;
  }
  get prompt() { return PROMPTS[this.mode]; }
  get dirty() { return this.config.dirty() || this.auth.pendingChanges > 0; }
  cancel() { if (this.mode === 'config') this.mode = 'enabled'; }
  async password() {
    const password = await this.ask('Password (hidden): ', true);
    if (password !== await this.ask('Confirm password (hidden): ', true)) throw new Error('Passwords do not match.');
    return password;
  }
  help(mode = this.mode) {
    if (mode === 'disabled') return this.write('enable (en) | show version | help (?)\nUse enable to enter privileged mode.');
    if (mode === 'enabled') return this.write('configure terminal (conf t) | show running-config (show run)\nshow startup-config (show start) | show users | show status | show version\ncopy running-config startup-config (copy run start)\ndisable (dis) | exit | shutdown | help (?)');
    this.write('host <IPv4/IPv6> | port <1-65535> | log-level <0-4> | file-log-level <0-4>\nprojects-directory <path> | auth database <path> | auth secure-cookies <true|false>\nauth storage mysql | auth storage sqlite [path]\nauth broker enabled <true|false> | auth broker host <IPv4/IPv6> | auth broker port <1-65535>\nconsole force-input-log <true|false>\nusername <name> (create/update with a hidden password prompt)\nuser create <name> | user password <name> | user delete <name> | user <name> grant_all | no username <name>\nenable secret (or enable password) | no enable secret\nexit (or end) | disable (dis) | do <enabled command> | help (?)\nStorage changes migrate all users, sessions, ACLs, and credentials during copy run start.');
  }
  logInput(value, secret = false) {
    if (!this.config.running.console.forceInputLog) return;
    const write = this.logger.forceInfo || this.logger.info;
    write.call(this.logger, 'Console input (%s): %s', secret ? 'hidden' : this.mode, secret ? '[hidden]' : String(value));
  }
  async execute(line) {
    try {
      this.logInput(line);
      const args = words(line.trim()); if (!args.length) return;
      const lower = args.map(value => value.toLowerCase()), command = lower.join(' ');
      if (command === '?' || command === 'help') return this.help();
      if (this.mode === 'disabled') {
        if (command === 'show version') return this.write(`OpacIT Omphalos Phidias v${version}`);
        if (!['enable', 'en'].includes(command)) throw new Error('Insufficient privileges. Use enable first.');
        if (Date.now() < this.enableBlockedUntil) throw new Error('Enable is temporarily locked. Try again in 30 seconds.');
        const hash = this.config.running.console.enablePasswordHash;
        if (hash) {
          this.write('Enter the enable password at the hidden prompt below.');
          const password = await this.ask('Enable password (hidden): ', true);
          const valid = typeof password === 'string' && await argon2.verify(hash, password);
          if (!valid) {
            if (++this.failedEnables >= 3) { this.enableBlockedUntil = Date.now() + 30000; this.failedEnables = 0; }
            this.logger.warning('Console enable authentication failed');
            throw new Error('Invalid enable password.');
          }
        }
        this.failedEnables = 0; this.mode = 'enabled';
        this.write('Privileged mode enabled.'); return;
      }
      if (this.mode === 'config') {
        if (lower[0] === 'do') return await this.enabled(args.slice(1));
        if (['exit', 'end'].includes(command)) { this.mode = 'enabled'; this.write('Left configuration mode.'); return; }
        if (['disable', 'dis'].includes(command)) { this.mode = 'disabled'; this.write('Console privileges disabled.'); return; }
        return await this.configure(args);
      }
      await this.enabled(args);
    } catch (error) { this.write(`% ${error.message}`); }
  }
  async enabled(args) {
    const command = args.map(value => value.toLowerCase()).join(' ');
    if (command === '?' || command === 'help') return this.help('enabled');
    if (['configure terminal', 'config terminal', 'conf terminal', 'configure t', 'config t', 'conf t'].includes(command)) { this.mode = 'config'; this.write('Enter configuration commands. Use exit to return to enabled mode.'); return; }
    if (['disable', 'dis', 'exit'].includes(command)) { this.mode = 'disabled'; this.write('Console privileges disabled.'); return; }
    if (['show running-config', 'show run'].includes(command)) {
      this.write(displayConfig(this.config.running));
      this.write(`${this.dirty ? 'Unsaved changes present.' : 'Running configuration is saved.'} Pending account changes: ${this.auth.pendingChanges}.`); return;
    }
    if (['show startup-config', 'show start'].includes(command)) return this.write(displayConfig(this.config.startup()));
    if (command === 'show users') return this.write((await this.auth.listUsers()).map(user => `${user.username} (${user.state})`).join('\n') || 'No users configured.');
    if (command === 'show status') return this.write(`${this.status()}\nMode: ${this.mode}. Unsaved changes: ${this.dirty ? 'yes' : 'no'}.`);
    if (command === 'show version') return this.write(`OpacIT Omphalos Phidias v${version}`);
    if (['copy run start', 'copy running-config startup-config', 'copy running-config start', 'copy run startup-config'].includes(command)) {
      await this.config.save(this.auth); this.logger.info('Console saved running configuration and accounts');
      this.write(`Running configuration saved to config.json. Authentication data saved to ${this.config.running.auth.provider === 'mysql' ? 'MySQL' : 'SQLite'}. Restart Phidias after changing the authentication storage backend.`); return;
    }
    if (['shutdown', 'exit server'].includes(command)) {
      if (this.dirty && (await this.ask('Unsaved changes will be lost. Type yes to shut down: ')).trim().toLowerCase() !== 'yes') { this.write('Shutdown cancelled.'); return; }
      this.write('Shutting down server.'); this.stopped = true; await this.shutdown(); return;
    }
    throw new Error('Unknown enabled command. Use help for available commands.');
  }
  async configure(args) {
    const lower = args.map(value => value.toLowerCase()), command = lower.join(' ');
    if (lower[0] === 'auth' && lower[1] === 'broker' && args.length === 4) {
      if (lower[2] === 'enabled' && ['true', 'false'].includes(lower[3])) await this.config.set(['auth', 'broker'], { ...this.config.running.auth.broker, enabled: lower[3] === 'true' });
      else if (lower[2] === 'host') await this.config.set(['auth', 'broker'], { ...this.config.running.auth.broker, host: args[3] });
      else if (lower[2] === 'port' && /^[0-9]+$/.test(args[3])) await this.config.set(['auth', 'broker'], { ...this.config.running.auth.broker, port: Number(args[3]) });
      else throw new Error('Invalid authentication broker setting.');
      this.write('Authentication broker setting changed in running configuration. Save with copy run start and restart Phidias.'); return;
    }
    if (lower[0] === 'auth' && lower[1] === 'storage' && lower[2] === 'mysql' && args.length === 3) {
      const host = (await this.ask('MySQL host: ')).trim();
      const portText = (await this.ask('MySQL port [3306]: ')).trim();
      const username = (await this.ask('MySQL username: ')).trim();
      const password = await this.ask('MySQL password (hidden): ', true);
      const database = (await this.ask('MySQL database: ')).trim();
      const port = portText ? Number(portText) : 3306;
      await this.config.set(['auth', 'mysql'], { host, port, username, password, database });
      await this.config.set(['auth', 'provider'], 'mysql');
      this.write('MySQL authentication storage staged. Use copy run start to test the connection, migrate all authentication data, and save.'); return;
    }
    if (lower[0] === 'auth' && lower[1] === 'storage' && lower[2] === 'sqlite' && args.length <= 4) {
      if (args[3]) await this.config.set(['auth', 'database'], args[3]);
      await this.config.set(['auth', 'provider'], 'sqlite');
      this.write(`SQLite authentication storage staged at ${this.config.running.auth.database}. Use copy run start to migrate and save.`); return;
    }
    if (['enable secret', 'enable password'].includes(command)) {
      const hash = await argon2.hash(await this.password(), ENABLE_PASSWORD_OPTIONS);
      await this.config.set(['console', 'enablePasswordHash'], hash);
      this.write('Enable password changed in running configuration.'); return;
    }
    if (['no enable secret', 'no enable password'].includes(command)) {
      await this.config.set(['console', 'enablePasswordHash'], null);
      this.write('Enable password removed from running configuration.'); return;
    }
    if (lower[0] === 'username' && args.length === 2) {
      const name = normalizeUsername(args[1]);
      await this.auth.stageUser(name, await this.password());
      this.write(`User ${name} updated in running configuration. Save with copy run start.`); return;
    }
    if (lower[0] === 'user' && lower[2] === 'grant_all' && args.length === 3) {
      const name = await this.auth.stageGrantAll(args[1]);
      this.write(`User ${name} granted all permissions in running configuration. Save with copy run start.`); return;
    }
    if ((lower[0] === 'user' && ['create', 'password', 'delete'].includes(lower[1]) && args.length === 3) || (lower[0] === 'no' && lower[1] === 'username' && args.length === 3)) {
      const name = normalizeUsername(args[2]);
      if (lower[0] === 'no' || lower[1] === 'delete') {
        await this.auth.stageDeleteUser(name); this.write(`User ${name} removed from running configuration. Save with copy run start.`);
      } else {
        await this.auth.stageUser(name, await this.password(), lower[1] === 'create' ? 'create' : 'reset');
        this.write(`User ${name} updated in running configuration. Save with copy run start.`);
      }
      return;
    }
    if (args.length === 2 && ['port', 'host', 'log-level', 'file-log-level', 'projects-directory'].includes(lower[0])) {
      const field = lower[0];
      const value = ['port', 'log-level', 'file-log-level'].includes(field) ? (/^[0-9]+$/.test(args[1]) ? Number(args[1]) : NaN) : args[1];
      await this.config.set([field], value);
      this.write(field === 'projects-directory' ? 'Projects directory saved in running configuration; takes effect after copy run start and restart. Files are not moved.' : `${field} changed in running configuration.`); return;
    }
    if (lower[0] === 'auth' && args.length === 3) {
      if (lower[1] === 'database') {
        await this.config.set(['auth', 'database'], args[2]);
        this.write('Database path changed in running configuration; takes effect after copy run start and restart. Accounts are saved to the currently active database; files are not moved.'); return;
      }
      if (lower[1] === 'secure-cookies' && ['true', 'false'].includes(lower[2])) {
        await this.config.set(['auth', 'secureCookies'], lower[2] === 'true');
        this.write('Secure-cookie setting changed for newly issued cookies.'); return;
      }
    }
    if (lower[0] === 'console' && lower[1] === 'force-input-log' && args.length === 3 && ['true', 'false'].includes(lower[2])) {
      await this.config.set(['console', 'forceInputLog'], lower[2] === 'true');
      this.write(`Forced console input logging ${lower[2] === 'true' ? 'enabled' : 'disabled'} in running configuration.`); return;
    }
    throw new Error('Unknown configuration command or invalid arguments. Use help; use do for enabled commands. Passwords must be entered at hidden prompts.');
  }
}
module.exports = { CommandConsole, PROMPTS };

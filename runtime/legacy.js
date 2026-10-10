'use strict';

const ACTION = 'action';
const slug = filename => filename.replace(/\.js$/i, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
const kinds = port => (port.types || []).map(type => String(type).toLowerCase());
const isAction = port => kinds(port).includes(ACTION);
const fieldType = source => {
  const type = String(source.type || '').toLowerCase();
  const sourceKinds = kinds(source);
  if (type === 'select') return 'select';
  if (type === 'number' || (sourceKinds.length && sourceKinds.every(item => ['number', 'undefined', 'unspecified'].includes(item)))) return 'number';
  return 'text';
};
const choices = option => option.options ? Object.keys(option.options) : undefined;
const defaultValue = (source, type) => {
  if (type === 'select') return choices(source)?.[0] || '';
  if (type === 'number') return 0;
  return '';
};
const port = (source, kind) => ({
  id: source.id,
  name: source.name || source.id,
  description: source.description || '',
  kind,
  types: kinds(source).filter(type => type !== ACTION),
  required: Boolean(source.required)
});

function normalizeDefinition(definition, filename) {
  if (definition.type && Array.isArray(definition.fields) && Array.isArray(definition.outputs)) {
    definition.inputPorts ||= definition.trigger ? [] : [{ id: 'action', name: 'Action', kind: ACTION, types: [] }];
    definition.outputPorts ||= definition.outputs.map(id => ({ id, name: id, kind: ACTION, types: [] }));
    return definition;
  }
  const type = slug(filename);
  const inputPorts = (definition.inputs || []).map(item => port(item, isAction(item) ? ACTION : 'value'));
  const outputPorts = (definition.outputs || []).map(item => port(item, isAction(item) ? ACTION : 'value'));
  // Value inputs are connector ports. Only declared options are editable fields.
  const fieldSources = [...(definition.options || [])];
  const fields = fieldSources.map(source => {
    const type = fieldType(source);
    return {
      key: source.id,
      label: source.name || source.id,
      description: source.description || '',
      type,
      ...(type === 'select' ? { choices: choices(source) || [] } : {}),
      default: defaultValue(source, type),
      ...(type === 'number' ? { min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER } : {})
    };
  });
  const actionOutputs = outputPorts.filter(item => item.kind === ACTION).map(item => item.id);
  let trigger;
  if (type === 'bot_initialization_event' || (definition.auto_execute && actionOutputs.length && inputPorts.length === 0)) trigger = 'startup';
  if (type === 'bot_input') trigger = 'stdin';
  if (type === 'receiver' || type === 'receiver_8x') trigger = 'receiver';
  const normalized = {
    type,
    name: definition.name || type,
    description: definition.description || 'Imported Discord App Builder block.',
    category: definition.category || 'Imported',
    hidden: Boolean(definition.hidden),
    trigger,
    fields,
    inputs: inputPorts,
    inputPorts,
    outputs: actionOutputs,
    outputPorts,
    legacy: true
  };
  Object.defineProperty(normalized, 'source', { value: definition });
  return normalized;
}

function valueFromOption(ctx, input, value) {
  value = ctx.render(value);
  if (typeof value !== 'string') return value;
  const types = input?.types || [];
  if (types.includes('number') && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  if (types.includes('date') && value.trim() !== '') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (types.some(type => ['object', 'list', 'boolean', 'null'].includes(type))) {
    try { return JSON.parse(value); } catch {}
  }
  return value;
}

async function executeLegacy(definition, ctx, block, connectedInputs, follow) {
  const source = definition.source;
  const stored = Object.create(null);
  const branches = [];
  let actionCalled;
  const actionPromise = new Promise(resolve => { actionCalled = resolve; });
  const cache = { _temp: { __VALUES: ctx.legacyValues || [] } };
  const inputByID = new Map(definition.inputPorts.map(input => [input.id, input]));
  const getInput = (id, fallback) => {
    if (Object.hasOwn(connectedInputs, id)) return connectedInputs[id];
    if (Object.hasOwn(block.options, id)) return valueFromOption(ctx, inputByID.get(id), block.options[id]);
    return fallback;
  };
  const api = {
    GetInputValue(id, _cache, _required, fallback) { return getInput(id, fallback); },
    GetOptionValue(id, _cache, fallback) {
      return Object.hasOwn(block.options, id) ? valueFromOption(ctx, inputByID.get(id), block.options[id]) : fallback;
    },
    StoreOutputValue(value, id) {
      stored[id] = value;
      ctx.values.set(`${block.id}:${id}`, value);
      ctx.vars[block.id] ||= Object.create(null);
      ctx.vars[block.id][id] = value;
      ctx.vars[id] = value;
    },
    RunNextBlock(id) {
      actionCalled();
      const branch = Promise.resolve().then(() => follow(id));
      branches.push(branch);
      return branch;
    },
    async require(name) {
      if (name === 'node-fetch') {
        return async (...args) => {
          const response = await fetch(...args);
          response.buffer = async () => Buffer.from(await response.arrayBuffer());
          return response;
        };
      }
      return require(name);
    },
    getDBB() { return ctx.shared; },
    Emitter(id, details) {
      const branch = ctx.emit(String(id), details);
      branches.push(branch);
      return branch;
    },
    ConvertRegex(value) {
      const text = String(value);
      const match = text.match(/^\/(.*)\/([a-z]*)$/i);
      return match ? new RegExp(match[1], match[2]) : new RegExp(text);
    },
    end(error) { throw error; },
    console(level, message) { (ctx.logger?.info || console.log)(`[${level}] ${message}`); },
    client: undefined
  };
  if (definition.type === 'bot_input') {
    api.StoreOutputValue(ctx.legacyValues[0], 'value');
    api.RunNextBlock('action');
    await Promise.all(branches);
    return stored;
  }
  if (definition.type === 'wait') {
    const value = getInput('time', 0);
    const factors = { milliseconds: 1, seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 };
    const delay = value instanceof Date ? value.getTime() - Date.now() : Number(value) * (factors[api.GetOptionValue('time_type')] || 1);
    await require('node:timers/promises').setTimeout(Math.max(0, delay), undefined, { signal: ctx.signal });
    api.RunNextBlock('action');
    await Promise.all(branches);
    return stored;
  }
  if (definition.type === 'ftp_down' || definition.type === 'ftp_up') {
    const ftp = require('basic-ftp');
    const client = new ftp.Client();
    try {
      await client.access({ host: String(getInput('host', '')), user: String(getInput('user', '')), password: String(getInput('pass', '')), secure: true });
      if (definition.type === 'ftp_down') await client.downloadTo(String(getInput('pathl', '')), String(getInput('pathr', '')));
      else await client.uploadFrom(String(getInput('pathl', '')), String(getInput('pathr', '')));
    } finally {
      client.close();
    }
    api.RunNextBlock('action');
    await Promise.all(branches);
    return stored;
  }
  if (definition.type === 'request_api') {
    const method = String(api.GetOptionValue('method_type', null, 'get')).toUpperCase();
    const body = getInput('body');
    const headers = source.mergeSessionHeaders(getInput('headers'), getInput('session'));
    const response = await fetch(String(getInput('url', '')), {
      method, signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(30000)]),
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(body != null && body !== '' && method !== 'GET' ? { body: typeof body === 'object' ? JSON.stringify(body) : String(body) } : {})
    });
    if (!response.ok) throw new Error(`API request failed with HTTP ${response.status}`);
    const dataType = api.GetOptionValue('data_type', null, 'text');
    const data = dataType === 'json' ? await response.json() : dataType === 'buffer' ? Buffer.from(await response.arrayBuffer()) : await response.text();
    api.StoreOutputValue(data, 'data');
    api.StoreOutputValue(source.readResponseSession(response.headers), 'session');
    api.StoreOutputValue(source.readSessionToken(response.headers, data), 'session_token');
    api.RunNextBlock('action');
    await Promise.all(branches);
    return stored;
  }
  if (definition.type === 'console_log') {
    let content = getInput('value');
    if (content === undefined) content = api.GetOptionValue('value', null, '');
    const requestedLevel = String(api.GetOptionValue('level', null, 'info')).toLowerCase();
    const level = ['info', 'warning', 'error'].includes(requestedLevel) ? requestedLevel : 'info';
    const forcedMethod = { info: 'forceInfo', warning: 'forceWarning', error: 'forceError' }[level];
    const write = ctx.forceConsoleLog ? (ctx.logger?.[forcedMethod] || ctx.logger?.[level]) : ctx.logger?.[level];
    const safeContent = ctx.redactForLog ? ctx.redactForLog(content) : content;
    if (write) write.call(ctx.logger, safeContent);
    else (level === 'error' ? console.error : level === 'warning' ? console.warn : console.info)(safeContent);
    api.RunNextBlock('action');
    await Promise.all(branches);
    return stored;
  }
  if (definition.type === 'database_query') {
    try {
      const database = await ctx.database();
      const [rows] = await database.execute(String(getInput('query', '')));
      api.StoreOutputValue(rows, 'response');
      api.RunNextBlock('action');
    } catch (error) {
      api.StoreOutputValue(error.message, 'errormsg');
      api.RunNextBlock('erroraction');
    }
    await Promise.all(branches);
    return stored;
  }
  if (definition.type === 'send_ssh_command') {
    const { Client } = require('ssh2');
    const connection = new Client();
    const credential = getInput('credential');
    const host = String(credential?.host || getInput('host', api.GetOptionValue('host', null, '')));
    const username = String(credential?.username || getInput('username', api.GetOptionValue('username', null, '')));
    const commands = String(getInput('textcommand', api.GetOptionValue('textcommand', null, ''))).split(/\\r?\\n/).filter(command => command.trim());
    const logs = [];
    try {
      await new Promise((resolve, reject) => connection.once('ready', resolve).once('error', reject).connect({
        host, port: Number(credential?.port || getInput('port', api.GetOptionValue('port', null, 22))) || 22,
        username,
        ...(credential?.privateKey ? { privateKey: String(credential.privateKey) } : { password: String(credential?.password || getInput('password', api.GetOptionValue('password', null, ''))) })
      }));
      for (const command of commands) {
        logs.push(`${username}@${host}:~$ ${command.trim()}`);
        await new Promise((resolve, reject) => connection.exec(command, (error, stream) => {
          if (error) return reject(error);
          stream.on('data', data => logs.push(String(data).trimEnd()));
          stream.stderr.on('data', data => logs.push(String(data).trimEnd()));
          stream.once('close', resolve).once('error', reject);
        }));
      }
    } finally {
      connection.end();
    }
    api.StoreOutputValue(logs.join('\\n'), 'output');
    api.RunNextBlock('action');
    await Promise.all(branches);
    return stored;
  }
  const result = source.code?.call(api, cache);
  if (result && typeof result.then === 'function') await result;
  if (!branches.length && ['wait', 'send_ssh_command'].includes(definition.type)) {
    await Promise.race([actionPromise, new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true }))]);
  }
  await Promise.all(branches);
  return stored;
}

module.exports = { normalizeDefinition, executeLegacy };

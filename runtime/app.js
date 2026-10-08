'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { validate } = require('./validate');
const { normalizeDefinition, executeLegacy } = require('./legacy');
const { parseCron, matchesCron } = require('./cron');

function loadDefinitions(directory) {
  return new Map(fs.readdirSync(directory).filter(name => /^[a-z0-9_-]+\.js$/.test(name)).map(name => {
    const filename = require.resolve(path.join(directory, name));
    delete require.cache[filename];
    const definition = normalizeDefinition(require(filename), name);
    return [definition.type, definition];
  }));
}
function render(template, context) {
  if (typeof template !== 'string') return template;
  const read = key => key.trim().split('.').reduce((value, part) => value != null && Object.hasOwn(Object(value), part) ? value[part] : undefined, context) ?? '';
  const exact = template.match(/^{{\s*([^{}]+)\s*}}$/);
  if (exact) return read(exact[1]);
  return template.replace(/{{\s*([^{}]+)\s*}}/g, (_, key) => {
    const value = read(key); return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}
async function readBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1048576) throw Object.assign(new Error('Request exceeds 1 MB'), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString();
  if (!text) return null;
  if ((request.headers['content-type'] || '').includes('application/json')) {
    try { return JSON.parse(text); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  }
  return text;
}
function normalizeRoutePath(value) {
  return value.replace(/\/+$/, '') || '/';
}
function findRoute(routes, method, pathname, predicate = () => true) {
  let match = null;
  for (const route of routes) {
    if (!predicate(route) || (route.method !== method && route.method !== 'ANY')) continue;
    const basePath = route.path;
    if (pathname !== basePath && !(basePath === '/' ? pathname.startsWith('/') : pathname.startsWith(basePath + '/'))) continue;
    if (!match || basePath.length > match.path.length || (basePath.length === match.path.length && route.method === method && match.method === 'ANY')) match = route;
  }
  return match;
}
const DEFAULT_APP_CONFIG = Object.freeze({ port: 3001, host: '0.0.0.0', 'log-level': 3, 'force-console-input-log': false, auth: Object.freeze({ database: 'data/auth.sqlite' }) });
function validateAppConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config.json must contain an object');
  value = { ...DEFAULT_APP_CONFIG, ...value };
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('config.json: port must be an integer between 1 and 65535');
  if (typeof value.host !== 'string' || !net.isIP(value.host)) throw new Error('config.json: host must be an IPv4 or IPv6 address');
  if (!Number.isInteger(value['log-level']) || value['log-level'] < 0 || value['log-level'] > 4) throw new Error('config.json: log-level must be an integer between 0 and 4');
  if (typeof value['force-console-input-log'] !== 'boolean') throw new Error('config.json: force-console-input-log must be true or false');
  const projectId = value['project-id'] ?? null, releaseChannel = value['release-channel'] ?? null;
  if ((projectId === null) !== (releaseChannel === null)) throw new Error('config.json: project-id and release-channel must be set together');
  if (projectId !== null && (typeof projectId !== 'string' || !/^[a-f0-9-]{36}$/.test(projectId))) throw new Error('config.json: project-id must be a project UUID');
  if (releaseChannel !== null && !['RC', 'Prod'].includes(releaseChannel)) throw new Error('config.json: release-channel must be RC or Prod');
  const updateUrl = value['update-url'] ?? null;
  if (updateUrl !== null) {
    if (typeof updateUrl !== 'string' || updateUrl.length > 2048) throw new Error('config.json: update-url must be an HTTP or HTTPS URL');
    let parsed;
    try { parsed = new URL(updateUrl); } catch { throw new Error('config.json: update-url must be an HTTP or HTTPS URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('config.json: update-url must be an HTTP or HTTPS URL without embedded credentials');
  }
  const auth = value.auth;
  if (!auth || typeof auth !== 'object' || Array.isArray(auth) || typeof auth.database !== 'string' || !auth.database.trim()) throw new Error('config.json: auth.database must be a SQLite file path');
  const database = value.database ?? null;
  if (database !== null && (!database || typeof database !== 'object' || Array.isArray(database) || typeof database['credential-set'] !== 'string' || !/^[a-f0-9-]{36}$/.test(database['credential-set']))) throw new Error('config.json: database must identify a credential set');
  return {
    port: value.port,
    host: value.host,
    'log-level': value['log-level'],
    'force-console-input-log': value['force-console-input-log'],
    auth: { database: auth.database },
    ...(projectId === null ? {} : { 'project-id': projectId, 'release-channel': releaseChannel }),
    ...(updateUrl ? { 'update-url': updateUrl } : {}),
    ...(database === null ? {} : { database: { 'credential-set': database['credential-set'] } })
  };
}
function loadAppConfig(directory = __dirname) {
  const filename = path.join(directory, 'config.json');
  try {
    fs.writeFileSync(filename, JSON.stringify(DEFAULT_APP_CONFIG, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  let value;
  try { value = JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid config.json: ${error.message}`);
    throw error;
  }
  return validateAppConfig(value);
}
function attachWorkflowContext(error, workspace, block, definition) {
  const failure = error instanceof Error ? error : new Error(String(error));
  failure.workflowContext ||= {
    workspaceNumberId: workspace?.numberId,
    workspaceName: workspace?.name || 'Unknown workspace',
    blockNumberId: block?.numberId,
    blockName: definition?.name || block?.type || 'Unknown block'
  };
  return failure;
}
function snapshotLogValue(value, seen = new WeakMap(), location = '$', depth = 0) {
  if (value === undefined) return '[undefined]';
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'symbol') return String(value);
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Buffer.isBuffer(value)) return { type: 'Buffer', length: value.length, data: value.toString('base64') };
  if (depth >= 25) return '[Maximum log depth reached]';
  if (seen.has(value)) return `[Circular ${seen.get(value)}]`;
  seen.set(value, location);
  if (Array.isArray(value)) return value.map((item, index) => snapshotLogValue(item, seen, `${location}[${index}]`, depth + 1));
  const result = Object.create(null);
  for (const key of Object.keys(value)) {
    try { result[key] = snapshotLogValue(value[key], seen, `${location}.${key}`, depth + 1); }
    catch (error) { result[key] = `[Unreadable: ${error.message}]`; }
  }
  return result;
}
function createApp({ directory = __dirname, document, definitions, onError, onControl = null, logger = null, clock = () => new Date(), stdin = process.stdin } = {}) {
  const reportError = onError || (error => {
    const context = error?.workflowContext;
    if (context && logger) {
      logger.error('Block triggered error (Workspace #%d: %s > Block #%d: %s): %s', context.workspaceNumberId, context.workspaceName, context.blockNumberId, context.blockName, error?.stack || error);
    } else if (context) {
      console.error(`Block triggered error (Workspace #${context.workspaceNumberId}: ${context.workspaceName} > Block #${context.blockNumberId}: ${context.blockName}):`, error);
    } else if (logger) {
      logger.error('Workflow failed: %s', error?.stack || error);
    } else {
      console.error(error);
    }
  });
  definitions ||= loadDefinitions(path.join(directory, 'blocks'));
  for (const [type, definition] of definitions) definitions.set(type, normalizeDefinition(definition, `${type}.js`));
  document ||= JSON.parse(fs.readFileSync(path.join(directory, 'workspaces.json'), 'utf8'));
  let favicon = null;
  try { favicon = fs.readFileSync(path.join(directory, 'favicon.ico')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const configFile = path.join(directory, 'config.json');
  const applicationConfig = fs.existsSync(configFile) ? validateAppConfig(JSON.parse(fs.readFileSync(configFile, 'utf8'))) : DEFAULT_APP_CONFIG;
  const deployment = Object.freeze({ projectId: applicationConfig['project-id'] || null, channel: applicationConfig['release-channel'] || null, updateUrl: applicationConfig['update-url'] || null });
  validate(document, definitions);
  const controller = new AbortController(), timers = [], stdinListeners = [], activeRuns = new Set(), routes = [], authenticationStores = new Map();
  const shared = Object.create(null);
  let started = false, stdinInterface = null, controlRequested = null, databasePool = null;
  const getDatabase = async () => {
    if (databasePool) return databasePool;
    const selected = applicationConfig.database;
    if (!selected) throw new Error('No database credential set is selected in application settings');
    const { DatabaseSync } = require('node:sqlite');
    const filename = path.resolve(directory, applicationConfig.auth.database);
    let credentials, database;
    try {
      database = new DatabaseSync(filename, { readOnly: true });
      credentials = database.prepare('SELECT host, port, username, password, database_name FROM database_credentials WHERE id = ?').get(selected['credential-set']);
    } finally { database?.close(); }
    if (!credentials) throw new Error('The selected database credential set was not found');
    const mysql = require('mysql2/promise');
    databasePool = mysql.createPool({ host: credentials.host, port: credentials.port, user: credentials.username, password: credentials.password, database: credentials.database_name, waitForConnections: true, connectionLimit: 10, queueLimit: 0 });
    return databasePool;
  };
  for (const definition of definitions.values()) {
    if (definition.legacy && typeof definition.source.init === 'function') definition.source.init(shared);
  }
  async function run(ws, trigger, request = null, response = null, seed = {}) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
    const execution = seed.execution || { vars: Object.create(null), values: new Map(), evaluated: new Set() };
    const newRunId = !seed.runId, runId = seed.runId || randomUUID();
    const runStartedAt = seed.runStartedAt || new Date().toISOString();
    const context = {
      vars: execution.vars, values: execution.values, evaluated: execution.evaluated,
      request, response, env: process.env, signal, shared, appName: document.name, directory, logger, deployment, database: getDatabase,
      legacyValues: seed.legacyValues || [], runId, loggedInUser: seed.loggedInUser || 'svc_automation',
      forceConsoleLog: applicationConfig['force-console-input-log']
    };
    context.render = value => render(value, context);
    context.setLoggedInUser = session => {
      if (session?.username) context.loggedInUser = String(session.username);
      return session;
    };
    context.controlApplication = mode => {
      if (!['stop', 'restart'].includes(mode)) throw new Error('Unknown application control request');
      if (typeof onControl !== 'function') throw new Error('Application control is unavailable in this runtime');
      if (controlRequested) return;
      controlRequested = mode;
      setImmediate(() => Promise.resolve(onControl(mode)).catch(reportError));
    };
    context.authentication = () => {
      const resolved = path.resolve(directory, applicationConfig.auth.database);
      if (!authenticationStores.has(resolved)) {
        const { WorkflowAuth } = require('./auth');
        authenticationStores.set(resolved, new WorkflowAuth(resolved));
      }
      return authenticationStores.get(resolved);
    };
    const runIdListeners = ws.blocks.filter(block => definitions.get(block.type)?.trigger === 'run_id_triggered');
    if (newRunId && ws.logAllRunsToBlock && runIdListeners.length && !seed.suppressRunIdTrigger) {
      try {
        const authorization = String(request?.headers?.authorization || '');
        const cookies = String(request?.headers?.cookie || '');
        let session = null;
        if (/^Bearer\s+[a-f0-9]{64}$/i.test(authorization)) session = context.authentication().apiSession(request, deployment);
        else if (/(?:^|;\s*)phidias_session=/.test(cookies)) session = context.authentication().browserSession(request, deployment);
        context.setLoggedInUser(session);
      } catch (error) {
        logger?.debug('Run identity lookup failed: %s', error.message);
      }
      const results = await Promise.allSettled(runIdListeners.map(listener => run(ws, listener, request, response, {
        runId,
        runStartedAt,
        loggedInUser: context.loggedInUser,
        suppressWorkspaceLog: true,
        suppressRunIdTrigger: true
      })));
      for (const result of results) if (result.status === 'rejected') reportError(result.reason);
    }
    const nodes = new Map(ws.blocks.map(block => [block.id, block]));
    const incoming = (block, port) => ws.connections.find(edge => edge.to === block.id && (edge.input || 'action') === port);
    let steps = 0;
    async function publishWorkspaceEvent(block, definition, startedAt, inputs, status, error = null) {
      if (seed.suppressWorkspaceLog || (!ws.forceLog && !ws.logAllRunsToBlock)) return;
      const outputs = Object.create(null);
      for (const port of definition.outputPorts.filter(port => port.kind === 'value')) {
        const key = `${block.id}:${port.id}`;
        if (context.values.has(key)) outputs[port.id] = snapshotLogValue(context.values.get(key));
      }
      const completedAt = new Date();
      const content = {
        timestamp: completedAt.toISOString(),
        startedAt: startedAt.toISOString(),
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        status,
        successful: status === 'completed',
        workspace: { id: ws.id, numberId: ws.numberId, name: ws.name },
        block: { id: block.id, numberId: block.numberId, type: block.type, name: definition.name },
        actionInput: inputs.actionInput,
        inputs: snapshotLogValue(inputs.values),
        options: snapshotLogValue(block.options),
        outputs,
        ...(error ? { error: snapshotLogValue(error) } : {})
      };
      if (ws.forceLog) {
        const write = logger?.forceInfo || logger?.info;
        write?.call(logger, 'Workspace run %s: user=%s content=%s', runId, context.loggedInUser, JSON.stringify(content));
      }
      if (!ws.logAllRunsToBlock) return;
      const listeners = ws.blocks.filter(candidate => candidate.type === 'workspace_log' && candidate.id !== block.id);
      const results = await Promise.allSettled(listeners.map(listener => run(ws, listener, request, response, {
        runId,
        loggedInUser: context.loggedInUser,
        logEvent: content,
        suppressWorkspaceLog: true
      })));
      for (const result of results) if (result.status === 'rejected') reportError(result.reason);
    }
    async function outputValue(edge, stack) {
      const key = `${edge.from}:${edge.output}`;
      if (context.values.has(key)) return context.values.get(key);
      const source = nodes.get(edge.from);
      if (!source) throw new Error('Value source block is missing');
      await executeBlock(source, null, stack);
      if (!context.values.has(key)) throw new Error(`${definitions.get(source.type).name} did not produce ${edge.output}`);
      return context.values.get(key);
    }
    async function executeBlock(block, actionInput = 'action', stack = new Set()) {
      try {
        return await executeBlockInner(block, actionInput, stack);
      } catch (error) {
        throw attachWorkflowContext(error, ws, block, definitions.get(block?.type));
      }
    }
    async function executeBlockInner(block, actionInput = 'action', stack = new Set()) {
      signal.throwIfAborted();
      if (++steps > 1000) throw new Error('Workflow step limit exceeded');
      const def = definitions.get(block.type);
      if (!def) throw new Error(`Unknown block: ${block.type}`);
      if (stack.has(block.id)) throw new Error('Circular value dependency');
      const nextStack = new Set(stack).add(block.id);
      const inputs = Object.create(null);
      const eventInputs = { actionInput, values: inputs };
      const startedAt = new Date();
      const followedOutputs = [];
      const queueFollow = async output => { followedOutputs.push(output); };
      const follow = async output => {
        const edge = ws.connections.find(item => item.from === block.id && item.output === output && (item.kind || 'action') === 'action');
        if (edge) await executeBlock(nodes.get(edge.to), edge.input || 'action');
      };
      const setOutput = (id, value) => {
        context.values.set(block.id + ':' + id, value);
        context.vars[block.id] ||= Object.create(null);
        context.vars[block.id][id] = value;
        context.vars[id] = value;
      };
      try {
        for (const input of def.inputPorts.filter(port => port.kind === 'value')) {
          const edge = incoming(block, input.id);
          if (edge) inputs[input.id] = await outputValue(edge, nextStack);
        }
        if (def.trigger === 'receiver' && seed.receiverID !== undefined && String(inputs.id ?? block.options.id ?? '') !== String(seed.receiverID)) return;
        if (def.legacy) {
          if (actionInput === null && context.evaluated.has(block.id)) return;
          await executeLegacy(def, context, block, inputs, queueFollow);
          context.evaluated.add(block.id);
        } else {
          if (def.trigger === 'http') {
            setOutput('body', request?.body ?? '');
            setOutput('headers', request?.headers ?? {});
          }
          if (def.trigger === 'workspace_log') {
            setOutput('logged_in_user', seed.loggedInUser || 'svc_automation');
            setOutput('content', seed.logEvent || {});
            setOutput('run_id', runId);
          }
          if (def.trigger === 'run_id_triggered') {
            const workspace = { id: ws.id, numberId: ws.numberId, name: ws.name };
            setOutput('run_id', runId);
            setOutput('started_at', runStartedAt);
            setOutput('logged_in_user', seed.loggedInUser || 'svc_automation');
            setOutput('workspace_name', ws.name);
            setOutput('workspace_number_id', ws.numberId);
            setOutput('workspace_id', ws.id);
            setOutput('workspace', workspace);
          }
          const output = def.trigger ? 'next' : await def.execute(context, block.options, inputs, setOutput);
          if (output) followedOutputs.push(output);
        }
      } catch (error) {
        await publishWorkspaceEvent(block, def, startedAt, eventInputs, 'failed', error);
        throw error;
      }
      await publishWorkspaceEvent(block, def, startedAt, eventInputs, 'completed');
      for (const output of followedOutputs) await follow(output);
    }
    context.emit = async (id, details = {}) => {
      const workspaces = details.restriction_type === 'all' ? document.workspaces.filter(item => item.active) : [ws];
      const tasks = [];
      for (const targetWorkspace of workspaces) {
        for (const receiver of targetWorkspace.blocks.filter(block => ['receiver', 'receiver_8x'].includes(block.type))) {
          tasks.push(run(targetWorkspace, receiver, request, response, {
            receiverID: id,
            legacyValues: details.values || [],
            execution,
            runId,
            loggedInUser: context.loggedInUser
          }));
        }
      }
      await Promise.all(tasks);
    };
    await executeBlock(trigger);
    return context.vars;
  }
  function track(promise) {
    activeRuns.add(promise); promise.then(() => activeRuns.delete(promise), () => activeRuns.delete(promise)); return promise;
  }
  function connectedStaticValue(ws, block, input) {
    if (Object.hasOwn(block.options || {}, input)) return { known: true, value: block.options[input] };
    const edge = ws.connections.find(item => item.to === block.id && item.input === input && (item.kind || 'action') === 'value');
    if (!edge) return { known: false };
    const source = ws.blocks.find(item => item.id === edge.from);
    return source && Object.hasOwn(source.options || {}, edge.output)
      ? { known: true, value: source.options[edge.output] }
      : { known: false };
  }
  function reachableLogin(startWorkspace, trigger) {
    const queue = [{ workspace: startWorkspace, id: trigger.id }], visited = new Set();
    while (queue.length) {
      const { workspace, id } = queue.shift(), visitKey = `${workspace.id}:${id}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);
      const current = workspace.blocks.find(block => block.id === id);
      if (current?.type === 'display_login') return { workspace, block: current };
      for (const edge of workspace.connections) {
        if (edge.from === id && (edge.kind || 'action') === 'action') queue.push({ workspace, id: edge.to });
      }
      if (!['emitter', 'emitter_8x'].includes(current?.type)) continue;
      const emitterID = connectedStaticValue(workspace, current, 'id');
      const targetWorkspaces = current.options.restriction_type === 'all' ? document.workspaces.filter(item => item.active) : [workspace];
      for (const targetWorkspace of targetWorkspaces) {
        for (const receiver of targetWorkspace.blocks.filter(block => ['receiver', 'receiver_8x'].includes(block.type))) {
          const receiverID = connectedStaticValue(targetWorkspace, receiver, 'id');
          if (emitterID.known && receiverID.known && String(emitterID.value) !== String(receiverID.value)) continue;
          queue.push({ workspace: targetWorkspace, id: receiver.id });
        }
      }
    }
    return null;
  }
  for (const ws of document.workspaces.filter(ws => ws.active)) {
    for (const block of ws.blocks.filter(block => block.type === 'http')) {
      const login = reachableLogin(ws, block);
      routes.push({ method: block.options.method, path: normalizeRoutePath(block.options.path), ws, block, loginBlock: login?.block, loginWorkspace: login?.workspace });
    }
  }
  const server = http.createServer(async (req, res) => {
    const requestStarted = Date.now();
    let requestPath = '(invalid URL)';
    res.on('finish', () => {
      if (res.statusCode >= 400 && res.statusCode < 500) logger?.warning('Request rejected: %s %s (%d)', req.method, requestPath, res.statusCode);
      logger?.debug('Request completed: %s %s (%d, %d ms)', req.method, requestPath, res.statusCode, Date.now() - requestStarted);
    });
    const deadline = setTimeout(() => { if (!res.writableEnded) { res.writeHead(504); res.end('Workflow timed out'); } }, 60000);
    res.on('close', () => clearTimeout(deadline));
    try {
      const url = new URL(req.url, 'http://localhost');
      requestPath = url.pathname;
      logger?.debug('Request received: %s %s', req.method, requestPath);
      if (url.pathname === '/favicon.ico' && ['GET', 'HEAD'].includes(req.method) && favicon) {
        res.writeHead(200, { 'content-type': 'image/x-icon', 'content-length': favicon.length, 'cache-control': 'public, max-age=86400' });
        res.end(req.method === 'HEAD' ? undefined : favicon); return;
      }
      let route = findRoute(routes, req.method, url.pathname), loginSubmission = false;
      if (!route && req.method === 'POST') {
        route = findRoute(routes, 'GET', url.pathname, candidate => candidate.method === 'GET' && candidate.loginBlock);
        loginSubmission = Boolean(route);
      }
      if (!route) { res.writeHead(404); res.end('Not found'); return; }
      const subpath = route.path === '/' ? url.pathname : url.pathname.slice(route.path.length) || '/';
      const request = { method: req.method, path: url.pathname, endpoint: route.path, subpath, query: Object.fromEntries(url.searchParams), headers: req.headers, body: await readBody(req), ip: req.socket.remoteAddress, loginSubmission };
      await track(run(loginSubmission ? route.loginWorkspace : route.ws, loginSubmission ? route.loginBlock : route.block, request, res));
      if (!res.writableEnded) { res.writeHead(204); res.end(); }
    } catch (error) {
      reportError(error);
      if (!res.writableEnded) { res.writeHead(error.status || 500); res.end(error.status ? error.message : 'Workflow failed'); }
    }
  });
  server.requestTimeout = 65000;
  return {
    name: document.name,
    server,
    async start(port, host) {
      if (started) throw new Error('Application already started');
      if (port === undefined || host === undefined) {
        const config = loadAppConfig(directory);
        port ??= process.env.PORT === undefined ? config.port : Number(process.env.PORT);
        host ??= process.env.HOST || config.host;
      }
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); });
      started = true;
      for (const ws of document.workspaces.filter(ws => ws.active)) for (const block of ws.blocks) {
        const trigger = definitions.get(block.type).trigger;
        if (trigger === 'startup') track(run(ws, block)).catch(reportError);
        if (trigger === 'stdin') {
          const listener = line => {
            track(run(ws, block, null, null, { legacyValues: [line] })).catch(reportError);
          };
          stdinInterface ||= readline.createInterface({ input: stdin, terminal: false, crlfDelay: Infinity });
          stdinListeners.push(listener);
          stdinInterface.on('line', listener);
        }
        if (block.type === 'interval') {
          let running = false;
          timers.push(setInterval(async () => {
            if (running) return;
            running = true;
            try { await track(run(ws, block)); } catch (error) { reportError(error); } finally { running = false; }
          }, block.options.seconds * 1000));
        }
        if (trigger === 'cron') {
          const schedule = parseCron(block.options.expression);
          let lastMinute = '';
          timers.push(setInterval(() => {
            const now = clock(), minute = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
            if (matchesCron(schedule, now) && minute !== lastMinute) {
              lastMinute = minute;
              track(run(ws, block)).catch(reportError);
            }
          }, 1000));
        }
      }
      return server.address();
    },
    async stop() {
      controller.abort(); timers.forEach(clearInterval);
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      await Promise.allSettled([...activeRuns]);
      stdinListeners.forEach(listener => stdinInterface?.off('line', listener));
      stdinInterface?.close();
      for (const authentication of authenticationStores.values()) authentication.close();
      authenticationStores.clear();
      if (databasePool) { await databasePool.end(); databasePool = null; }
    }
  };
}
if (require.main === module) {
  const config = loadAppConfig(__dirname);
  const { createLogger, installConsoleLogger } = require('./logger');
  const logger = createLogger({ level: config['log-level'], directory: path.join(__dirname, 'log') });
  installConsoleLogger(logger);
  const lifecycle = (...values) => typeof logger.notice === 'function'
    ? logger.notice(...values)
    : process.stdout.write(require('node:util').format(...values) + '\n');
  let app, stopping = false;
  const launch = async () => {
    app = createApp({ logger, onControl: mode => stop(`workflow ${mode}`, mode === 'restart') });
    const address = await app.start();
    lifecycle('%s listening on %s:%d', app.name, address.address, address.port);
  };
  const stop = async (reason, restart = false) => {
    if (stopping) return;
    stopping = true;
    lifecycle('Stopping %s (%s)', app.name, reason);
    try {
      await app.stop(); lifecycle('%s stopped', app.name);
      if (restart) {
        logger.startNewCycle?.();
        lifecycle('Restarting %s', app.name);
        stopping = false;
        await launch();
      }
    }
    catch (error) { logger.critical('Shutdown failed: %s', error?.stack || error); process.exitCode = 1; }
  };
  process.once('uncaughtException', error => { logger.critical('Uncaught exception: %s', error?.stack || error); process.exit(1); });
  process.once('unhandledRejection', error => { logger.critical('Unhandled rejection: %s', error?.stack || error); process.exit(1); });
  launch().catch(error => { logger.critical('Could not start application: %s', error?.stack || error); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop(signal); });
}
module.exports = { createApp, loadDefinitions, render, readBody, findRoute, normalizeRoutePath, loadAppConfig, validateAppConfig };

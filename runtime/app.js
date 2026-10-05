'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const net = require('node:net');
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
const DEFAULT_APP_CONFIG = Object.freeze({ port: 3001, host: '0.0.0.0', 'log-level': 3 });
function validateAppConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config.json must contain an object');
  value = { ...DEFAULT_APP_CONFIG, ...value };
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('config.json: port must be an integer between 1 and 65535');
  if (typeof value.host !== 'string' || !net.isIP(value.host)) throw new Error('config.json: host must be an IPv4 or IPv6 address');
  if (!Number.isInteger(value['log-level']) || value['log-level'] < 0 || value['log-level'] > 4) throw new Error('config.json: log-level must be an integer between 0 and 4');
  const projectId = value['project-id'] ?? null, releaseChannel = value['release-channel'] ?? null;
  if ((projectId === null) !== (releaseChannel === null)) throw new Error('config.json: project-id and release-channel must be set together');
  if (projectId !== null && (typeof projectId !== 'string' || !/^[a-f0-9-]{36}$/.test(projectId))) throw new Error('config.json: project-id must be a project UUID');
  if (releaseChannel !== null && !['RC', 'Prod'].includes(releaseChannel)) throw new Error('config.json: release-channel must be RC or Prod');
  return { port: value.port, host: value.host, 'log-level': value['log-level'], ...(projectId === null ? {} : { 'project-id': projectId, 'release-channel': releaseChannel }) };
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
function createApp({ directory = __dirname, document, definitions, onError, onControl = null, logger = null, clock = () => new Date() } = {}) {
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
  const configFile = path.join(directory, 'config.json');
  const applicationConfig = fs.existsSync(configFile) ? validateAppConfig(JSON.parse(fs.readFileSync(configFile, 'utf8'))) : DEFAULT_APP_CONFIG;
  const deployment = { projectId: applicationConfig['project-id'] || null, channel: applicationConfig['release-channel'] || null };
  validate(document, definitions);
  const controller = new AbortController(), timers = [], stdinListeners = [], activeRuns = new Set(), routes = [], authenticationStores = new Map();
  const shared = Object.create(null);
  let started = false, stdinInterface = null, controlRequested = null;
  for (const definition of definitions.values()) {
    if (definition.legacy && typeof definition.source.init === 'function') definition.source.init(shared);
  }
  async function run(ws, trigger, request = null, response = null, seed = {}) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
    const execution = seed.execution || { vars: Object.create(null), values: new Map(), evaluated: new Set() };
    const context = {
      vars: execution.vars, values: execution.values, evaluated: execution.evaluated,
      request, response, env: process.env, signal, shared, appName: document.name, directory, logger, deployment,
      legacyValues: seed.legacyValues || []
    };
    context.render = value => render(value, context);
    context.controlApplication = mode => {
      if (!['stop', 'restart'].includes(mode)) throw new Error('Unknown application control request');
      if (typeof onControl !== 'function') throw new Error('Application control is unavailable in this runtime');
      if (controlRequested) return;
      controlRequested = mode;
      setImmediate(() => Promise.resolve(onControl(mode)).catch(reportError));
    };
    context.authentication = filename => {
      const resolved = path.resolve(directory, String(filename || '').trim());
      if (!String(filename || '').trim()) throw new Error('Select an authentication SQLite database');
      if (!authenticationStores.has(resolved)) {
        const { WorkflowAuth } = require('./auth');
        authenticationStores.set(resolved, new WorkflowAuth(resolved));
      }
      return authenticationStores.get(resolved);
    };
    const nodes = new Map(ws.blocks.map(block => [block.id, block]));
    const incoming = (block, port) => ws.connections.find(edge => edge.to === block.id && (edge.input || 'action') === port);
    let steps = 0;
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
      for (const input of def.inputPorts.filter(port => port.kind === 'value')) {
        const edge = incoming(block, input.id);
        if (edge) inputs[input.id] = await outputValue(edge, nextStack);
      }
      if (def.trigger === 'receiver' && seed.receiverID !== undefined && String(inputs.id ?? block.options.id ?? '') !== String(seed.receiverID)) return;
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
      if (def.legacy) {
        if (actionInput === null && context.evaluated.has(block.id)) return;
        await executeLegacy(def, context, block, inputs, follow);
        context.evaluated.add(block.id);
      } else {
        if (def.trigger === 'http') {
          setOutput('body', request?.body ?? '');
          setOutput('headers', request?.headers ?? {});
        }
        const output = def.trigger ? 'next' : await def.execute(context, block.options, inputs, setOutput);
        if (output) await follow(output);
      }
    }
    context.emit = async (id, details = {}) => {
      const workspaces = details.restriction_type === 'all' ? document.workspaces.filter(item => item.active) : [ws];
      const tasks = [];
      for (const targetWorkspace of workspaces) {
        for (const receiver of targetWorkspace.blocks.filter(block => ['receiver', 'receiver_8x'].includes(block.type))) {
          tasks.push(run(targetWorkspace, receiver, request, response, { receiverID: id, legacyValues: details.values || [], execution }));
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
          const listener = line => track(run(ws, block, null, null, { legacyValues: [line] })).catch(reportError);
          stdinInterface ||= readline.createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });
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
      if (restart) { lifecycle('Restarting %s', app.name); stopping = false; await launch(); }
    }
    catch (error) { logger.critical('Shutdown failed: %s', error?.stack || error); process.exitCode = 1; }
  };
  process.once('uncaughtException', error => { logger.critical('Uncaught exception: %s', error?.stack || error); process.exit(1); });
  process.once('unhandledRejection', error => { logger.critical('Unhandled rejection: %s', error?.stack || error); process.exit(1); });
  launch().catch(error => { logger.critical('Could not start application: %s', error?.stack || error); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop(signal); });
}
module.exports = { createApp, loadDefinitions, render, readBody, findRoute, normalizeRoutePath, loadAppConfig, validateAppConfig };

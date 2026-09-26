'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { validate } = require('./validate');
const { normalizeDefinition, executeLegacy } = require('./legacy');

function loadDefinitions(directory) {
  return new Map(fs.readdirSync(directory).filter(name => /^[a-z0-9_-]+\.js$/.test(name)).map(name => {
    const definition = normalizeDefinition(require(path.join(directory, name)), name);
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
function createApp({ directory = __dirname, document, definitions, onError = console.error } = {}) {
  definitions ||= loadDefinitions(path.join(directory, 'blocks'));
  for (const [type, definition] of definitions) definitions.set(type, normalizeDefinition(definition, `${type}.js`));
  document ||= JSON.parse(fs.readFileSync(path.join(directory, 'workspaces.json'), 'utf8'));
  validate(document, definitions);
  const controller = new AbortController(), timers = [], stdinListeners = [], activeRuns = new Set(), routes = new Map();
  const shared = Object.create(null);
  let started = false, stdinInterface = null;
  for (const definition of definitions.values()) {
    if (definition.legacy && typeof definition.source.init === 'function') definition.source.init(shared);
  }
  async function run(ws, trigger, request = null, response = null, seed = {}) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
    const context = {
      vars: Object.create(null), values: new Map(), evaluated: new Set(),
      request, response, env: process.env, signal, shared,
      legacyValues: seed.legacyValues || []
    };
    context.render = value => render(value, context);
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
      const follow = async output => {
        const edge = ws.connections.find(item => item.from === block.id && item.output === output && (item.kind || 'action') === 'action');
        if (edge) await executeBlock(nodes.get(edge.to), edge.input || 'action');
      };
      if (def.legacy) {
        if (actionInput === null && context.evaluated.has(block.id)) return;
        await executeLegacy(def, context, block, inputs, follow);
        context.evaluated.add(block.id);
      } else {
        const output = def.trigger ? 'next' : await def.execute(context, block.options, inputs);
        if (output) await follow(output);
      }
    }
    context.emit = async (id, details = {}) => {
      const workspaces = details.restriction_type === 'all' ? document.workspaces.filter(item => item.active) : [ws];
      const tasks = [];
      for (const targetWorkspace of workspaces) {
        for (const receiver of targetWorkspace.blocks.filter(block => ['receiver', 'receiver_8x'].includes(block.type))) {
          if (String(context.render(receiver.options.id ?? '')) === id) {
            tasks.push(run(targetWorkspace, receiver, null, null, { legacyValues: details.values || [] }));
          }
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
  for (const ws of document.workspaces.filter(ws => ws.active)) {
    for (const block of ws.blocks.filter(block => block.type === 'http')) routes.set(`${block.options.method} ${block.options.path}`, { ws, block });
  }
  const server = http.createServer(async (req, res) => {
    const deadline = setTimeout(() => { if (!res.writableEnded) { res.writeHead(504); res.end('Workflow timed out'); } }, 60000);
    res.on('close', () => clearTimeout(deadline));
    try {
      const url = new URL(req.url, 'http://localhost');
      const route = routes.get(`${req.method} ${url.pathname}`);
      if (!route) { res.writeHead(404); res.end('Not found'); return; }
      const request = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body: await readBody(req) };
      await track(run(route.ws, route.block, request, res));
      if (!res.writableEnded) { res.writeHead(204); res.end(); }
    } catch (error) {
      onError(error);
      if (!res.writableEnded) { res.writeHead(error.status || 500); res.end(error.status ? error.message : 'Workflow failed'); }
    }
  });
  server.requestTimeout = 65000;
  return {
    server,
    async start(port = Number(process.env.PORT || 3001), host = process.env.HOST || '0.0.0.0') {
      if (started) throw new Error('Application already started');
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); });
      started = true;
      for (const ws of document.workspaces.filter(ws => ws.active)) for (const block of ws.blocks) {
        const trigger = definitions.get(block.type).trigger;
        if (trigger === 'startup') track(run(ws, block)).catch(onError);
        if (trigger === 'stdin') {
          const listener = line => track(run(ws, block, null, null, { legacyValues: [line] })).catch(onError);
          stdinInterface ||= readline.createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });
          stdinListeners.push(listener);
          stdinInterface.on('line', listener);
        }
        if (block.type === 'interval') {
          let running = false;
          timers.push(setInterval(async () => {
            if (running) return;
            running = true;
            try { await track(run(ws, block)); } catch (error) { onError(error); } finally { running = false; }
          }, block.options.seconds * 1000));
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
    }
  };
}
if (require.main === module) {
  const app = createApp();
  app.start().then(address => console.log(`Phidias application listening on ${address.address}:${address.port}`)).catch(error => { console.error(error); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.stop().catch(console.error));
}
module.exports = { createApp, loadDefinitions, render, readBody };

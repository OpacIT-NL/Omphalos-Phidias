'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { validate } = require('./validate');

function loadDefinitions(directory) {
  return new Map(fs.readdirSync(directory).filter(name => /^[a-z0-9_-]+\.js$/.test(name)).map(name => {
    const definition = require(path.join(directory, name));
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
  document ||= JSON.parse(fs.readFileSync(path.join(directory, 'workspaces.json'), 'utf8'));
  validate(document, definitions);
  const controller = new AbortController(), timers = [], activeRuns = new Set(), routes = new Map();
  let started = false;
  async function run(ws, trigger, request = null, response = null) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
    const context = { vars: Object.create(null), request, response, env: process.env, signal };
    context.render = value => render(value, context);
    const nodes = new Map(ws.blocks.map(block => [block.id, block]));
    let block = trigger, steps = 0;
    while (block) {
      signal.throwIfAborted();
      if (++steps > 1000) throw new Error('Workflow step limit exceeded');
      const def = definitions.get(block.type);
      const output = def.trigger ? 'next' : await def.execute(context, block.options);
      const edge = ws.connections.find(edge => edge.from === block.id && edge.output === output);
      block = edge ? nodes.get(edge.to) : null;
    }
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
        if (block.type === 'startup') track(run(ws, block)).catch(onError);
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
    }
  };
}
if (require.main === module) {
  const app = createApp();
  app.start().then(address => console.log(`Phidias application listening on ${address.address}:${address.port}`)).catch(error => { console.error(error); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.stop().catch(console.error));
}
module.exports = { createApp, loadDefinitions, render, readBody };

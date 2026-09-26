'use strict';
const safeID = /^[a-zA-Z0-9_-]{1,80}$/;
function validate(document, definitions) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!document || document.version !== 1 || typeof document.name !== 'string' || !document.name.trim() || document.name.length > 100) fail('Invalid project name or format version');
  if (!Array.isArray(document.workspaces) || !document.workspaces.length || document.workspaces.length > 100) fail('A project needs 1–100 workspaces');
  const workspaceIDs = new Set(), routes = new Set();
  for (const ws of document.workspaces) {
    if (!ws || typeof ws.id !== 'string' || !safeID.test(ws.id) || workspaceIDs.has(ws.id)) fail('Invalid or duplicate workspace ID');
    workspaceIDs.add(ws.id);
    if (typeof ws.name !== 'string' || !ws.name.trim() || ws.name.length > 100 || typeof ws.active !== 'boolean') fail('Invalid workspace name or active state');
    if (!Array.isArray(ws.blocks) || ws.blocks.length > 1000 || !Array.isArray(ws.connections) || ws.connections.length > 4000) fail('Invalid workspace graph');
    const nodes = new Map(), edgeIDs = new Set();
    for (const block of ws.blocks) {
      if (!block || typeof block.id !== 'string' || !safeID.test(block.id) || nodes.has(block.id)) fail('Invalid or duplicate block ID');
      const def = definitions.get(block.type);
      if (!def) fail(`Unknown block: ${block.type}`);
      if (!Number.isFinite(block.x) || !Number.isFinite(block.y) || !block.options || typeof block.options !== 'object' || Array.isArray(block.options)) fail('Invalid block position or options');
      for (const field of def.fields) {
        const value = block.options[field.key];
        if (field.type === 'number') {
          if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max || (block.type === 'respond' && !Number.isInteger(value))) fail(`Invalid ${def.name}: ${field.label}`);
        } else if (typeof value !== 'string' || value.length > 50000 || (field.choices && !field.choices.includes(value))) fail(`Invalid ${def.name}: ${field.label}`);
      }
      if (['set', 'request'].includes(block.type) && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(block.options.name ?? block.options.variable)) fail('Invalid variable name');
      if (block.type === 'http') {
        if (!/^\/[^?#\s]*$/.test(block.options.path)) fail('HTTP path must start with / and contain no query or whitespace');
        const route = `${block.options.method} ${block.options.path}`;
        if (ws.active && routes.has(route)) fail(`Duplicate HTTP endpoint: ${route}`);
        if (ws.active) routes.add(route);
      }
      nodes.set(block.id, block);
    }
    const outgoing = new Map();
    for (const edge of ws.connections) {
      if (!edge || typeof edge.id !== 'string' || !safeID.test(edge.id) || edgeIDs.has(edge.id)) fail('Invalid or duplicate connection ID');
      edgeIDs.add(edge.id);
      const source = nodes.get(edge.from), target = nodes.get(edge.to);
      if (!source || !target || !definitions.get(source.type).outputs.includes(edge.output) || definitions.get(target.type).trigger) fail('Invalid connection or port');
      const key = `${edge.from}:${edge.output}`;
      if (outgoing.has(key)) fail('Each output accepts one connection');
      outgoing.set(key, edge.to);
    }
    const visited = new Set(), visiting = new Set();
    function visit(id) {
      if (visiting.has(id)) fail('Loops are not supported; use an interval trigger');
      if (visited.has(id)) return;
      visiting.add(id);
      for (const port of definitions.get(nodes.get(id).type).outputs) {
        const next = outgoing.get(`${id}:${port}`); if (next) visit(next);
      }
      visiting.delete(id); visited.add(id);
    }
    for (const id of nodes.keys()) visit(id);
  }
  return document;
}
module.exports = { validate, safeID };

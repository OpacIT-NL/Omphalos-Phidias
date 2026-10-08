'use strict';
const safeID = /^[a-zA-Z0-9_-]{1,80}$/;
const { parseCron } = require('./cron');
const normalizeRoutePath = value => value.replace(/\/+$/, '') || '/';
function assignMissingNumberIds(items) {
  const used = new Set(items.filter(item => Number.isInteger(item?.numberId) && item.numberId > 0).map(item => item.numberId));
  let next = 1;
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (item.numberId !== undefined && item.numberId !== null) continue;
    while (used.has(next)) next++;
    item.numberId = next; used.add(next); next++;
  }
}
function ensureNumberIds(document) {
  if (!Array.isArray(document?.workspaces)) return document;
  assignMissingNumberIds(document.workspaces);
  for (const workspace of document.workspaces) if (Array.isArray(workspace?.blocks)) assignMissingNumberIds(workspace.blocks);
  return document;
}
function validate(document, definitions) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!document || document.version !== 1 || typeof document.name !== 'string' || !document.name.trim() || document.name.length > 100) fail('Invalid project name or format version');
  const categories = document.workspaceCategories ?? [];
  if (!Array.isArray(categories) || categories.length > 100) fail('A project can have at most 100 workspace categories');
  const categoryIDs = new Set();
  for (const category of categories) {
    if (!category || typeof category.id !== 'string' || !safeID.test(category.id) || categoryIDs.has(category.id)) fail('Invalid or duplicate workspace category ID');
    if (typeof category.name !== 'string' || !category.name.trim() || category.name.length > 100) fail('Invalid workspace category name');
    categoryIDs.add(category.id);
  }
  if (!Array.isArray(document.workspaces) || !document.workspaces.length || document.workspaces.length > 100) fail('A project needs 1–100 workspaces');
  ensureNumberIds(document);
  const workspaceIDs = new Set(), workspaceNumberIds = new Set(), routes = new Set();
  for (const ws of document.workspaces) {
    if (!ws || typeof ws.id !== 'string' || !safeID.test(ws.id) || workspaceIDs.has(ws.id)) fail('Invalid or duplicate workspace ID');
    workspaceIDs.add(ws.id);
    if (!Number.isInteger(ws.numberId) || ws.numberId < 1 || workspaceNumberIds.has(ws.numberId)) fail('Invalid or duplicate workspace number ID');
    workspaceNumberIds.add(ws.numberId);
    if (typeof ws.name !== 'string' || !ws.name.trim() || ws.name.length > 100 || typeof ws.active !== 'boolean') fail('Invalid workspace name or active state');
    ws.forceLog ??= false;
    ws.logAllRunsToBlock ??= false;
    if (typeof ws.forceLog !== 'boolean' || typeof ws.logAllRunsToBlock !== 'boolean') fail('Invalid workspace logging settings');
    if (ws.categoryId !== undefined && ws.categoryId !== null && (typeof ws.categoryId !== 'string' || !categoryIDs.has(ws.categoryId))) fail('Invalid workspace category');
    if (!Array.isArray(ws.blocks) || ws.blocks.length > 1000 || !Array.isArray(ws.connections) || ws.connections.length > 4000) fail('Invalid workspace graph');
    const nodes = new Map(), edgeIDs = new Set(), blockNumberIds = new Set();
    for (const block of ws.blocks) {
      if (!block || typeof block.id !== 'string' || !safeID.test(block.id) || nodes.has(block.id)) fail('Invalid or duplicate block ID');
      if (!Number.isInteger(block.numberId) || block.numberId < 1 || blockNumberIds.has(block.numberId)) fail('Invalid or duplicate block number ID');
      blockNumberIds.add(block.numberId);
      const def = definitions.get(block.type);
      if (!def) fail(`Unknown block: ${block.type}`);
      if (!Number.isFinite(block.x) || !Number.isFinite(block.y) || !block.options || typeof block.options !== 'object' || Array.isArray(block.options)) fail('Invalid block position or options');
      if (block.width !== undefined && (!Number.isFinite(block.width) || block.width < 240)) fail('Invalid block width');
      if (block.height !== undefined && (!Number.isFinite(block.height) || block.height < 120)) fail('Invalid block height');
      for (const field of def.fields) {
        if (!Object.hasOwn(block.options, field.key) && field.default !== undefined) {
          block.options[field.key] = block.type === 'respond' && field.key === 'format' ? 'Auto' : structuredClone(field.default);
        }
        const value = block.options[field.key];
        if (field.type === 'number') {
          if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max || (block.type === 'respond' && !Number.isInteger(value))) fail(`Invalid ${def.name}: ${field.label}`);
        } else if (typeof value !== 'string' || value.length > 50000 || (field.choices && !field.choices.includes(value))) fail(`Invalid ${def.name}: ${field.label}`);
      }
      if (['set', 'request'].includes(block.type) && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(block.options.name ?? block.options.variable)) fail('Invalid variable name');
      if (block.type === 'http') {
        if (!/^\/[^?#\s]*$/.test(block.options.path)) fail('HTTP path must start with / and contain no query or whitespace');
        const route = `${block.options.method} ${normalizeRoutePath(block.options.path)}`;
        if (ws.active && routes.has(route)) fail(`Duplicate HTTP endpoint: ${route}`);
        if (ws.active) routes.add(route);
      }
      if (block.type === 'cron') {
        try { parseCron(block.options.expression); } catch (error) { fail(error.message); }
      }
      nodes.set(block.id, block);
    }
    const outgoing = new Map(), incoming = new Set();
    for (const edge of ws.connections) {
      if (!edge || typeof edge.id !== 'string' || !safeID.test(edge.id) || edgeIDs.has(edge.id)) fail('Invalid or duplicate connection ID');
      edgeIDs.add(edge.id);
      const source = nodes.get(edge.from), target = nodes.get(edge.to);
      if (!source || !target) fail('Invalid connection or port');
      const sourceDef = definitions.get(source.type), targetDef = definitions.get(target.type);
      const output = sourceDef.outputPorts.find(port => port.id === edge.output);
      const inputID = edge.input || targetDef.inputPorts.find(port => port.kind === 'action')?.id;
      const input = targetDef.inputPorts.find(port => port.id === inputID);
      if (!output || !input || output.kind !== input.kind || (edge.kind && edge.kind !== output.kind)) fail('Invalid connection or incompatible port');
      if (output.kind === 'value' && output.types.length && input.types.length &&
          !output.types.includes('unspecified') && !input.types.includes('unspecified') &&
          !output.types.some(type => input.types.includes(type))) fail('Connected value types are incompatible');
      const outputKey = `${edge.from}:${edge.output}`;
      const inputKey = `${edge.to}:${input.id}`;
      if (input.kind === 'value' && incoming.has(inputKey)) fail('Each value input accepts one connection');
      if (output.kind === 'action' && outgoing.has(outputKey)) fail('Each action output accepts one connection');
      incoming.add(inputKey);
      const targets = outgoing.get(outputKey) || [];
      targets.push(edge.to); outgoing.set(outputKey, targets);
    }
    const visited = new Set(), visiting = new Set();
    function visit(id) {
      if (visiting.has(id)) fail('Loops are not supported; use an interval trigger');
      if (visited.has(id)) return;
      visiting.add(id);
      for (const port of definitions.get(nodes.get(id).type).outputPorts) {
        for (const next of outgoing.get(`${id}:${port.id}`) || []) visit(next);
      }
      visiting.delete(id); visited.add(id);
    }
    for (const id of nodes.keys()) visit(id);
  }
  return document;
}
module.exports = { validate, safeID, ensureNumberIds };

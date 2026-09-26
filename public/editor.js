'use strict';
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : 'id-' + Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('');
let project = null, definitions = [], workspaceID = null, selected = null, selectedEdge = null, pending = null;
let csrfToken = '';
let dirty = false, generation = 0, saving = null, view = { x: 0, y: 60, zoom: 1 }, toastTimer;
const ws = () => project?.workspaces.find(item => item.id === workspaceID);
const def = type => definitions.find(item => item.type === type);
const icons = { Triggers: '↗', Actions: '↳', Logic: '◇', Data: '≡' };
function toast(message, error = false) {
  $('#toast').textContent = message; $('#toast').className = error ? 'error' : ''; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, error ? 9000 : 4000);
}
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, ...options.headers } });
  if (!response.ok) {
    if (response.status === 401) $('#sign-in-again').hidden = false;
    const body = await response.json();
    throw Object.assign(new Error(response.status === 401 ? 'Your session expired. Use Sign in again, then return here to save your changes.' : body.error), { status: response.status });
  }
  return response.json();
}
function handle(action) { return (...args) => Promise.resolve().then(() => action(...args)).catch(error => toast(error.message, true)); }
function modal(title, fields, submit = 'Continue') {
  return new Promise(resolve => {
    const dialog = $('#form-dialog'); $('#dialog-title').textContent = title; $('#dialog-submit').textContent = submit; $('#dialog-error').textContent = '';
    $('#dialog-fields').innerHTML = fields.map(field => `<label class="field"><span>${escapeHTML(field.label)}</span><input name="${escapeHTML(field.name)}" type="${field.type || 'text'}" ${field.type === 'checkbox' ? (field.value ? 'checked' : '') : `value="${escapeHTML(field.value || '')}" maxlength="${field.type === 'password' ? 1000 : 100}" required`} autocomplete="off"></label>`).join('');
    dialog.returnValue = ''; dialog.showModal();
    dialog.addEventListener('close', () => {
      if (dialog.returnValue !== 'default') return resolve(null);
      const values = Object.fromEntries(fields.map(field => { const input = dialog.querySelector(`[name="${field.name}"]`); return [field.name, field.type === 'checkbox' ? input.checked : input.value.trim()]; }));
      resolve(values);
    }, { once: true });
  });
}
function markDirty() { dirty = true; generation++; $('#save-state').textContent = 'Unsaved changes'; }
async function refreshProjects() {
  const projects = await api('/api/projects');
  $('#projects').innerHTML = '<option value="">Select a project</option>' + projects.map(item => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)}</option>`).join('');
  $('#projects').value = project?.id || '';
  return projects;
}
async function openProject(id) {
  if (!id) return;
  if (saving) await saving;
  if (dirty && !confirm('Discard unsaved changes and open another project?')) { $('#projects').value = project.id; return; }
  const [document, library] = await Promise.all([api(`/api/projects/${id}`), api(`/api/projects/${id}/blocks`)]);
  project = document; definitions = library; workspaceID = document.workspaces[0].id;
  dirty = false; generation = 0; selected = selectedEdge = pending = null; view = { x: 0, y: 60, zoom: 1 };
  $('#projects').value = id; $('#save-state').textContent = 'Saved to server';
  for (const selector of ['#save', '#export', '#add-workspace', '#workspace-settings']) $(selector).disabled = false;
  render(); fit();
}
async function createProject() {
  const values = await modal('Create an automation', [{ name: 'name', label: 'Project name', value: 'My automation' }], 'Create project');
  if (!values) return;
  if (dirty && !confirm('Discard unsaved changes and create a project?')) return;
  const created = await api('/api/projects', { method: 'POST', body: JSON.stringify(values) });
  dirty = false; await refreshProjects(); await openProject(created.id);
  toast('Project created. Your first endpoint is ready to configure.');
}
async function save() {
  if (!project) return;
  if (saving) { await saving; if (dirty) return save(); return; }
  if (!dirty) return;
  const snapshot = JSON.stringify(project), savedGeneration = generation;
  $('#save-state').textContent = 'Saving…';
  saving = (async () => {
    const saved = await api(`/api/projects/${project.id}`, { method: 'PUT', body: snapshot });
    project.revision = saved.revision; project.updatedAt = saved.updatedAt;
    dirty = savedGeneration !== generation;
    $('#save-state').textContent = dirty ? 'Unsaved changes' : 'Saved to server';
    await refreshProjects();
  })();
  try { await saving; } catch (error) { $('#save-state').textContent = 'Save failed'; throw error; } finally { saving = null; }
}
function render() {
  $('#welcome').hidden = Boolean(project);
  $('#project-title').textContent = project?.name || 'Build something that runs itself.';
  $('#workspace-status').textContent = ws() ? (ws().active ? 'WORKSPACE ACTIVE' : 'WORKSPACE PAUSED') : 'SERVER HOSTED';
  $('#tabs').innerHTML = (project?.workspaces || []).map(item => `<button class="${item.id === workspaceID ? 'active' : ''}" data-workspace="${item.id}">${escapeHTML(item.name)}${item.active ? '' : ' · paused'}</button>`).join('');
  renderLibrary(); renderGraph(); renderInspector();
}
function renderLibrary() {
  const query = $('#search').value.toLowerCase();
  $('#block-count').textContent = definitions.length;
  const groups = ['Triggers', 'Actions', 'Logic', 'Data', ...definitions.map(item => item.category)];
  $('#library').innerHTML = [...new Set(groups)].map(category => {
    const items = definitions.filter(item => item.category === category && `${item.name} ${item.description}`.toLowerCase().includes(query));
    return items.length ? `<div class="category">${escapeHTML(category)}</div>${items.map(item => `<button class="library-block" data-type="${escapeHTML(item.type)}" data-category="${escapeHTML(category)}" title="${escapeHTML(item.description)}" draggable="true"><span class="block-icon">${icons[category] || '□'}</span>${escapeHTML(item.name)}</button>`).join('')}` : '';
  }).join('');
}
function renderGraph() {
  $('#nodes').innerHTML = (ws()?.blocks || []).map(block => {
    const definition = def(block.type);
    const summary = Object.values(block.options).map(value => String(value)).filter(Boolean).join(' · ');
    return `<article class="node ${selected === block.id ? 'selected' : ''}" data-node="${block.id}" style="left:${block.x}px;top:${block.y}px"><div class="node-head"><span class="block-icon">${icons[definition.category] || '□'}</span><div><div class="node-title">${escapeHTML(definition.name)}</div><div class="node-category">${escapeHTML(definition.category)}</div></div></div>${definition.trigger ? '' : `<button class="port input" data-input="${block.id}" aria-label="Connect input of ${escapeHTML(definition.name)}" title="Input"></button>`}<div class="node-summary">${escapeHTML(summary || definition.description)}</div><div class="ports">${definition.outputs.map(output => `<div class="port-row">${escapeHTML(output)}<button class="port ${pending?.from === block.id && pending.output === output ? 'pending' : ''}" data-output="${escapeHTML(output)}" data-from="${block.id}" aria-label="Connect ${escapeHTML(output)} output of ${escapeHTML(definition.name)}" title="Connect ${escapeHTML(output)}"></button></div>`).join('')}</div></article>`;
  }).join('');
  updateView(); requestAnimationFrame(renderWires);
}
function renderWires() {
  if (!ws()) { $('#wires').innerHTML = ''; return; }
  const worldRect = $('#world').getBoundingClientRect();
  const point = element => { const box = element.getBoundingClientRect(); return { x: (box.x + box.width / 2 - worldRect.x) / view.zoom, y: (box.y + box.height / 2 - worldRect.y) / view.zoom }; };
  $('#wires').innerHTML = ws().connections.map(edge => {
    const from = document.querySelector(`[data-from="${CSS.escape(edge.from)}"][data-output="${CSS.escape(edge.output)}"]`), to = document.querySelector(`[data-input="${CSS.escape(edge.to)}"]`);
    if (!from || !to) return '';
    const a = point(from), b = point(to), curve = Math.max(60, Math.abs(b.x - a.x) * .5);
    return `<path data-edge="${edge.id}" class="${selectedEdge === edge.id ? 'selected' : ''}" d="M ${a.x} ${a.y} C ${a.x + curve} ${a.y}, ${b.x - curve} ${b.y}, ${b.x} ${b.y}"/>`;
  }).join('');
}
function renderInspector() {
  if (selectedEdge) {
    $('#inspector').innerHTML = '<h2>Connection</h2><p class="description">Execution follows this wire to the next block.</p><button id="remove-edge" class="danger">Delete connection</button>';
    $('#remove-edge').onclick = deleteSelection; return;
  }
  const block = ws()?.blocks.find(item => item.id === selected);
  if (!block) { $('#inspector').innerHTML = '<div class="empty-inspector">Select a block<p>Configure its options and connect it to the next step.</p></div>'; return; }
  const definition = def(block.type);
  $('#inspector').innerHTML = `<h2>${escapeHTML(definition.name)}</h2><p class="description">${escapeHTML(definition.description)}</p>${definition.fields.map(field => {
    const value = block.options[field.key];
    const input = field.type === 'select' ? `<select data-field="${field.key}">${field.choices.map(choice => `<option ${value === choice ? 'selected' : ''}>${escapeHTML(choice)}</option>`).join('')}</select>` : field.type === 'number' ? `<input type="number" data-field="${field.key}" value="${escapeHTML(value)}" min="${field.min}" max="${field.max}" step="any">` : `<textarea data-field="${field.key}" spellcheck="false">${escapeHTML(value)}</textarea>`;
    return `<label class="field"><span>${escapeHTML(field.label)}</span>${input}</label>`;
  }).join('')}<button id="duplicate-node">Duplicate block</button><button id="remove-node" class="danger">Delete block</button>`;
  $('#inspector').querySelectorAll('[data-field]').forEach(input => input.addEventListener('input', () => {
    block.options[input.dataset.field] = input.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value;
    markDirty(); renderGraph();
  }));
  $('#remove-node').onclick = deleteSelection;
  $('#duplicate-node').onclick = () => { const clone = structuredClone(block); clone.id = uid(); clone.x += 40; clone.y += 180; ws().blocks.push(clone); selected = clone.id; markDirty(); renderGraph(); renderInspector(); };
}
function deleteSelection() {
  if (!ws()) return;
  if (selected) { ws().blocks = ws().blocks.filter(item => item.id !== selected); ws().connections = ws().connections.filter(edge => edge.from !== selected && edge.to !== selected); }
  else if (selectedEdge) ws().connections = ws().connections.filter(edge => edge.id !== selectedEdge);
  else return;
  selected = selectedEdge = pending = null; markDirty(); renderGraph(); renderInspector();
}
function addBlock(type, position) {
  if (!ws()) return;
  const definition = def(type); if (!definition) return;
  const rect = $('#viewport').getBoundingClientRect();
  const block = { id: uid(), type, x: position?.x ?? (rect.width / 2 - view.x) / view.zoom - 125, y: position?.y ?? (rect.height / 2 - view.y) / view.zoom - 50, options: Object.fromEntries(definition.fields.map(field => [field.key, field.default])) };
  ws().blocks.push(block); selected = block.id; selectedEdge = null; markDirty(); renderGraph(); renderInspector();
}
function connect(to) {
  if (!pending) { toast('Click an output port first, then this input.'); return; }
  if (pending.from === to) { toast('A block cannot connect to itself.', true); return; }
  const connections = ws().connections.filter(edge => edge.from !== pending.from || edge.output !== pending.output);
  const seen = new Set();
  function reaches(id) { if (id === pending.from) return true; if (seen.has(id)) return false; seen.add(id); return connections.filter(edge => edge.from === id).some(edge => reaches(edge.to)); }
  if (reaches(to)) { toast('This connection would create a loop. Use an interval trigger instead.', true); return; }
  connections.push({ id: uid(), ...pending, to }); ws().connections = connections; pending = null; markDirty(); renderGraph();
  $('#hint').textContent = 'Connected · Select a wire and press Delete to remove it';
}
function updateView() { $('#world').style.transform = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`; $('#reset-view').textContent = `${Math.round(view.zoom * 100)}%`; }
function zoom(amount, x = $('#viewport').clientWidth / 2, y = $('#viewport').clientHeight / 2) {
  const next = Math.max(.25, Math.min(2, view.zoom * amount)), ratio = next / view.zoom;
  view.x = x - (x - view.x) * ratio; view.y = y - (y - view.y) * ratio; view.zoom = next; updateView();
}
function fit() {
  if (!ws()?.blocks.length) { view = { x: 0, y: 60, zoom: 1 }; updateView(); return; }
  const blocks = ws().blocks, left = Math.min(...blocks.map(b => b.x)), top = Math.min(...blocks.map(b => b.y));
  const width = Math.max(...blocks.map(b => b.x + 250)) - left, height = Math.max(...blocks.map(b => b.y + 180)) - top;
  const viewport = $('#viewport'); view.zoom = Math.max(.25, Math.min(1, (viewport.clientWidth - 80) / width, (viewport.clientHeight - 180) / height));
  view.x = (viewport.clientWidth - width * view.zoom) / 2 - left * view.zoom; view.y = Math.max(100, (viewport.clientHeight - height * view.zoom) / 2) - top * view.zoom; updateView();
}
$('#library').addEventListener('click', event => { const button = event.target.closest('[data-type]'); if (button) addBlock(button.dataset.type); });
$('#library').addEventListener('dragstart', event => { const button = event.target.closest('[data-type]'); if (button) event.dataTransfer.setData('text/sentinel-block', button.dataset.type); });
$('#viewport').addEventListener('dragover', event => event.preventDefault());
$('#viewport').addEventListener('drop', event => { event.preventDefault(); const rect = $('#viewport').getBoundingClientRect(); addBlock(event.dataTransfer.getData('text/sentinel-block'), { x: (event.clientX - rect.x - view.x) / view.zoom, y: (event.clientY - rect.y - view.y) / view.zoom }); });
$('#viewport').addEventListener('click', event => {
  const output = event.target.closest('[data-output]'), input = event.target.closest('[data-input]'), edge = event.target.closest('[data-edge]');
  if (output) { pending = { from: output.dataset.from, output: output.dataset.output }; renderGraph(); $('#hint').textContent = 'Now click an input port · Escape to cancel'; }
  else if (input) connect(input.dataset.input);
  else if (edge) { selectedEdge = edge.dataset.edge; selected = null; renderGraph(); renderInspector(); }
});
$('#viewport').addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('button, [data-edge]')) return;
  const node = event.target.closest('[data-node]');
  const block = node ? ws()?.blocks.find(item => item.id === node.dataset.node) : null;
  if (block) { selected = block.id; selectedEdge = null; document.querySelectorAll('.node').forEach(el => el.classList.toggle('selected', el.dataset.node === selected)); renderInspector(); }
  else { selected = selectedEdge = null; renderInspector(); document.querySelectorAll('.node').forEach(el => el.classList.remove('selected')); renderWires(); }
  const start = { x: event.clientX, y: event.clientY, baseX: block ? block.x : view.x, baseY: block ? block.y : view.y }; let moved = false;
  const viewport = $('#viewport'); viewport.setPointerCapture(event.pointerId);
  const move = event => {
    const dx = event.clientX - start.x, dy = event.clientY - start.y; if (Math.abs(dx) + Math.abs(dy) < 3 && !moved) return; moved = true;
    if (block) { block.x = Math.round(start.baseX + dx / view.zoom); block.y = Math.round(start.baseY + dy / view.zoom); node.style.left = `${block.x}px`; node.style.top = `${block.y}px`; renderWires(); }
    else { view.x = start.baseX + dx; view.y = start.baseY + dy; updateView(); }
  };
  const stop = () => { viewport.removeEventListener('pointermove', move); viewport.removeEventListener('pointerup', stop); viewport.removeEventListener('pointercancel', stop); if (block && moved) markDirty(); };
  viewport.addEventListener('pointermove', move); viewport.addEventListener('pointerup', stop); viewport.addEventListener('pointercancel', stop);
});
$('#viewport').addEventListener('wheel', event => { event.preventDefault(); const rect = $('#viewport').getBoundingClientRect(); zoom(event.deltaY < 0 ? 1.08 : 1 / 1.08, event.clientX - rect.x, event.clientY - rect.y); }, { passive: false });
$('#tabs').addEventListener('click', event => { const button = event.target.closest('[data-workspace]'); if (!button) return; workspaceID = button.dataset.workspace; selected = selectedEdge = pending = null; render(); fit(); });
$('#add-workspace').onclick = handle(async () => {
  const values = await modal('Add workspace', [{ name: 'name', label: 'Workspace name', value: 'New workspace' }], 'Add workspace');
  if (!values) return;
  const workspace = { id: uid(), name: values.name, active: true, blocks: [], connections: [] }; project.workspaces.push(workspace); workspaceID = workspace.id;
  selected = selectedEdge = pending = null; markDirty(); render(); fit();
});
$('#workspace-settings').onclick = handle(async () => {
  const values = await modal('Project & workspace', [{ name: 'project', label: 'Project name', value: project.name }, { name: 'name', label: 'Workspace name', value: ws().name }, { name: 'active', label: 'Run this workspace in the exported application', type: 'checkbox', value: ws().active }], 'Apply');
  if (!values) return;
  project.name = values.project; ws().name = values.name; ws().active = values.active; markDirty(); render();
});
$('#search').oninput = renderLibrary;
$('#projects').onchange = handle(event => openProject(event.target.value));
$('#new-project').onclick = $('#welcome-create').onclick = handle(createProject);
$('#save').onclick = handle(async () => { await save(); toast('Project saved to the server.'); });
$('#export').onclick = handle(async () => {
  if (!project) return;
  await save(); if (dirty) await save();
  const response = await fetch(`/api/projects/${project.id}/export`);
  if (!response.ok) { if (response.status === 401) $('#sign-in-again').hidden = false; throw new Error((await response.json()).error); }
  const url = URL.createObjectURL(await response.blob()), link = document.createElement('a'); link.href = url; link.download = `${project.name.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'automation'}.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Application exported. Extract the ZIP and run node app.js.');
});
$('#zoom-in').onclick = () => zoom(1.2); $('#zoom-out').onclick = () => zoom(1 / 1.2); $('#reset-view').onclick = () => zoom(1 / view.zoom); $('#fit').onclick = fit;
window.addEventListener('keydown', event => {
  if ($('#form-dialog').open) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); handle(save)(); }
  if (event.key === 'Escape') { pending = null; renderGraph(); }
  if (['Delete', 'Backspace'].includes(event.key) && !event.target.closest('input,textarea,select,[contenteditable]')) { event.preventDefault(); deleteSelection(); }
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('resize', renderWires);
async function refreshSession() {
  const session = await api('/api/session');
  csrfToken = session.csrfToken;
  $('#account-name').textContent = session.username;
  $('#sign-in-again').hidden = true;
}
$('#logout').onclick = handle(async () => {
  if (saving) await saving;
  if (dirty && !confirm('Sign out and discard unsaved changes?')) return;
  try { await api('/api/logout', { method: 'POST', body: '{}' }); }
  catch (error) { if (error.status !== 401) throw error; }
  dirty = false; window.location.replace('/login');
});
// Re-authentication in another tab can rotate the session without losing edits.
window.addEventListener('focus', () => { refreshSession().catch(() => {}); });
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
async function bootstrap() {
  try {
    await refreshSession();
    const projects = await refreshProjects();
    if (projects.length) await openProject(projects[0].id);
  } catch (error) {
    if (error.status === 401) { window.location.replace('/login'); return; }
    throw error;
  }
}
handle(bootstrap)();

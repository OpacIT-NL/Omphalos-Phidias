'use strict';
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : 'id-' + Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('');
const initials = name => String(name || 'Project').split(/[\s_-]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
let project = null, projects = [], definitions = [], workspaceID = null, selectedEdge = null, pending = null;
let csrfToken = '', dirty = false, generation = 0, saving = null, view = { x: 0, y: 60, zoom: 1 }, toastTimer;
const selectedBlocks = new Set(), openWorkspaceIDs = new Set();
let blockClipboard = null, workspaceClipboard = null, clipboardKind = null, pasteSequence = 0, workspaceContextID = null, draggedWorkspaceID = null;
let templateNames = [], templateOriginalName = null, templateDirty = false;
let pickerWorldPosition = null;
let geometryFrame = 0;
let portDrag = null, suppressPortClick = false;
const observedNodeSizes = new WeakMap();
const nodeResizeObserver = new ResizeObserver(entries => {
  for (const entry of entries) {
    const node = entry.target;
    if (!node.isConnected || !project) continue;
    const size = { width: Math.round(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width), height: Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height) };
    const previous = observedNodeSizes.get(node);
    observedNodeSizes.set(node, size);
    if (!previous || (previous.width === size.width && previous.height === size.height)) continue;
    const block = ws()?.blocks.find(item => item.id === node.dataset.node);
    if (!block) continue;
    block.width = size.width; block.height = size.height; markDirty();
  }
  scheduleNodeGeometry();
});
const ws = () => project?.workspaces.find(item => item.id === workspaceID);
const def = type => definitions.find(item => item.type === type);
const nextNumberId = items => Math.max(0, ...items.map(item => Number.isInteger(item.numberId) && item.numberId > 0 ? item.numberId : 0)) + 1;
const defaultNodeWidth = block => (def(block.type)?.fields.length ? 500 : 300);
const nodeWidth = block => Number.isFinite(block.width) ? block.width : defaultNodeWidth(block);
const nodeHeight = block => Number.isFinite(block.height) ? block.height : 300;
const typeColors = { action: '#23a559', string: '#e67e22', number: '#168df0', boolean: '#d42ee7', object: '#6f42c1', array: '#e83e8c', unspecified: '#8b949e' };

function toast(message, error = false) {
  $('#toast').textContent = message; $('#toast').className = error ? 'error' : ''; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, error ? 9000 : 4000);
}
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, ...options.headers } });
  if (!response.ok) {
    if (response.status === 401) $('#sign-in-again').hidden = false;
    const body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(response.status === 401 ? 'Your session expired. Use Sign in again, then return here to save your changes.' : body.error || 'The request failed.'), { status: response.status });
  }
  return response.json();
}
function handle(action) { return (...args) => Promise.resolve().then(() => action(...args)).catch(error => toast(error.message, true)); }
function modalField(field) {
  const name = escapeHTML(field.name), label = escapeHTML(field.label);
  if (field.type === 'select') {
    const choices = (field.choices || []).map(choice => typeof choice === 'object' ? choice : { value: choice, label: choice });
    const options = choices.map(choice => '<option value="' + escapeHTML(choice.value) + '" ' + (String(field.value ?? '') === String(choice.value) ? 'selected' : '') + '>' + escapeHTML(choice.label) + '</option>').join('');
    return '<label class="field"><span>' + label + '</span><select name="' + name + '" autocomplete="off">' + options + '</select></label>';
  }
  const checked = field.type === 'checkbox' && field.value ? 'checked' : '';
  const value = field.type === 'checkbox' ? '' : 'value="' + escapeHTML(field.value || '') + '"';
  const maxlength = field.type === 'password' ? 1000 : 100;
  return '<label class="field"><span>' + label + '</span><input name="' + name + '" type="' + (field.type || 'text') + '" ' + checked + ' ' + value + ' maxlength="' + maxlength + '" required autocomplete="off"></label>';
}
function modal(title, fields, submit = 'Continue') {
  return new Promise(resolve => {
    const dialog = $('#form-dialog'); $('#dialog-title').textContent = title; $('#dialog-submit').textContent = submit; $('#dialog-error').textContent = '';
    $('#dialog-fields').innerHTML = fields.map(modalField).join('');
    dialog.returnValue = ''; dialog.showModal();
    const selectedField = fields.find(field => field.selectOnOpen);
    if (selectedField) requestAnimationFrame(() => {
      const input = dialog.querySelector('[name="' + CSS.escape(selectedField.name) + '"]');
      input?.focus(); input?.select?.();
    });
    dialog.addEventListener('close', () => {
      if (dialog.returnValue !== 'default') return resolve(null);
      resolve(Object.fromEntries(fields.map(field => { const input = dialog.querySelector('[name="' + CSS.escape(field.name) + '"]'); return [field.name, field.type === 'checkbox' ? input.checked : input.value.trim()]; })));
    }, { once: true });
  });
}
function markDirty() { dirty = true; generation++; $('#save-state').textContent = 'Unsaved changes'; $('#save').disabled = false; }
function clearSelection(clearPending = false) {
  selectedBlocks.clear(); selectedEdge = null;
  if (clearPending) pending = null;
}
function selectBlock(id, additive = false) {
  if (!additive) selectedBlocks.clear();
  if (additive && selectedBlocks.has(id)) selectedBlocks.delete(id);
  else selectedBlocks.add(id);
  selectedEdge = null;
}
function updateBlockSelection() {
  document.querySelectorAll('.node').forEach(node => node.classList.toggle('selected', selectedBlocks.has(node.dataset.node)));
}
function selectionSnapshot() {
  const workspace = ws();
  if (!workspace || !selectedBlocks.size) return null;
  const ids = new Set(selectedBlocks);
  return {
    blocks: workspace.blocks.filter(block => ids.has(block.id)).map(block => structuredClone(block)),
    connections: workspace.connections.filter(edge => ids.has(edge.from) && ids.has(edge.to)).map(edge => structuredClone(edge))
  };
}
function pasteSnapshot(snapshot, offsetX, offsetY) {
  const workspace = ws();
  if (!workspace || !snapshot?.blocks.length) return 0;
  const idMap = new Map(snapshot.blocks.map(block => [block.id, uid()]));
  let numberId = nextNumberId(workspace.blocks);
  const blocks = snapshot.blocks.map(block => ({ ...structuredClone(block), id: idMap.get(block.id), numberId: numberId++, x: block.x + offsetX, y: block.y + offsetY }));
  const connections = snapshot.connections.map(edge => ({ ...structuredClone(edge), id: uid(), from: idMap.get(edge.from), to: idMap.get(edge.to) }));
  workspace.blocks.push(...blocks); workspace.connections.push(...connections);
  selectedBlocks.clear(); blocks.forEach(block => selectedBlocks.add(block.id)); selectedEdge = pending = null;
  markDirty(); closeContextMenu(); renderGraph();
  return blocks.length;
}
function copySelection() {
  const snapshot = selectionSnapshot();
  if (!snapshot) return false;
  blockClipboard = snapshot; clipboardKind = 'blocks'; pasteSequence = 0;
  toast('Copied ' + snapshot.blocks.length + ' block' + (snapshot.blocks.length === 1 ? '' : 's') + ' and ' + snapshot.connections.length + ' wire' + (snapshot.connections.length === 1 ? '' : 's') + '.');
  return true;
}
function pasteSelection() {
  if (clipboardKind !== 'blocks' || !blockClipboard || !ws()) return false;
  pasteSequence += 1;
  const count = pasteSnapshot(blockClipboard, pasteSequence * 40, pasteSequence * 40);
  if (count) toast('Pasted ' + count + ' block' + (count === 1 ? '' : 's') + '.');
  return count > 0;
}
function copyWorkspace() {
  const workspace = ws();
  if (!workspace) return false;
  workspaceClipboard = { projectId: project.id, workspace: structuredClone(workspace) };
  clipboardKind = 'workspace';
  toast('Copied workspace ' + workspace.name + '.');
  return true;
}
function copiedWorkspaceName(name) {
  const names = new Set(project.workspaces.map(item => item.name.toLocaleLowerCase()));
  const root = (name + ' copy').slice(0, 100);
  if (!names.has(root.toLocaleLowerCase())) return root;
  for (let number = 2; number < 1000; number++) {
    const suffix = ' copy ' + number;
    const candidate = name.slice(0, 100 - suffix.length) + suffix;
    if (!names.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return ('Workspace ' + uid()).slice(0, 100);
}
function pasteWorkspace() {
  if (clipboardKind !== 'workspace' || !workspaceClipboard || !project) return false;
  const source = workspaceClipboard.workspace;
  const missing = source.blocks.find(block => !def(block.type));
  if (missing) { toast('Cannot paste this workspace because block type ' + missing.type + ' is not available in this project.', true); return false; }
  const blockIDs = new Map(source.blocks.map(block => [block.id, uid()]));
  const categoryIDs = new Set((project.workspaceCategories || []).map(category => category.id));
  const workspace = {
    ...structuredClone(source),
    id: uid(),
    numberId: nextNumberId(project.workspaces),
    name: copiedWorkspaceName(source.name),
    categoryId: workspaceClipboard.projectId === project.id && categoryIDs.has(source.categoryId) ? source.categoryId : null,
    blocks: source.blocks.map(block => ({ ...structuredClone(block), id: blockIDs.get(block.id) })),
    connections: source.connections.map(edge => ({ ...structuredClone(edge), id: uid(), from: blockIDs.get(edge.from), to: blockIDs.get(edge.to) }))
  };
  project.workspaces.push(workspace); openWorkspaceIDs.add(workspace.id); workspaceID = workspace.id; clearSelection(true); markDirty(); render(); requestAnimationFrame(fit);
  toast('Pasted workspace ' + workspace.name + '.');
  return true;
}
function renderProjects() {
  $('#project-orbs').innerHTML = projects.map((item, index) => `<button class="project-orb color-${index % 7} ${project?.id === item.id && $('#home-screen').hidden ? 'active' : ''}" data-project="${escapeHTML(item.id)}" title="${escapeHTML(item.name)}">${escapeHTML(initials(item.name))}</button>`).join('');
  $('#project-count').textContent = `${projects.length} project${projects.length === 1 ? '' : 's'}`;
  $('#recent-projects').innerHTML = projects.length ? projects.map(item => `<button data-project="${escapeHTML(item.id)}"><span class="recent-project-icon">◇</span><span><strong>${escapeHTML(item.name)}</strong><small>${item.updatedAt ? `Updated ${escapeHTML(new Date(item.updatedAt).toLocaleString())}` : 'Stored on this server'}</small></span><span>›</span></button>`).join('') : '<div class="home-empty"><span>◇</span><strong>No projects yet</strong><small>Create a project to start building.</small></div>';
}
async function refreshProjects() { projects = await api('/api/projects'); renderProjects(); return projects; }
function setProjectControls(enabled) {
  for (const selector of ['#export', '#versions', '#templates', '#add-workspace', '#add-workspace-category']) $(selector).disabled = !enabled;
  for (const selector of ['#workspace-settings', '#add-block']) $(selector).disabled = !enabled || !ws();
  $('#save').disabled = !enabled || !dirty;
}
function showHome() {
  closePicker(); closeContextMenu();
  $('#home-screen').hidden = false; $('#editor').hidden = true;
  $('#workspace-sidebar').classList.add('empty'); $('.sidebar-empty').hidden = false; $('.sidebar-project').hidden = true;
  $('[data-home]').classList.add('active'); renderProjects();
}
async function openProject(id) {
  if (!id || (project?.id === id && $('#editor').hidden === false)) return;
  if (saving) await saving;
  if (dirty && !confirm('Discard unsaved changes and open another project?')) return;
  const [document, library] = await Promise.all([api(`/api/projects/${id}`), api(`/api/projects/${id}/blocks`)]);
  project = document; definitions = library; workspaceID = document.workspaces[0]?.id || null;
  openWorkspaceIDs.clear(); document.workspaces.forEach(workspace => openWorkspaceIDs.add(workspace.id));
  dirty = false; generation = 0; clearSelection(true); view = { x: 0, y: 60, zoom: 1 };
  $('#save-state').textContent = 'Saved to server'; setProjectControls(true);
  $('#home-screen').hidden = true; $('#editor').hidden = false;
  $('#workspace-sidebar').classList.remove('empty'); $('.sidebar-empty').hidden = true; $('.sidebar-project').hidden = false; $('[data-home]').classList.remove('active');
  render(); requestAnimationFrame(fit);
}
async function createProject() {
  const values = await modal('Create a project', [{ name: 'name', label: 'Project name', value: 'My automation' }], 'Create project');
  if (!values) return;
  if (dirty && !confirm('Discard unsaved changes and create a project?')) return;
  const created = await api('/api/projects', { method: 'POST', body: JSON.stringify(values) });
  dirty = false; await refreshProjects(); await openProject(created.id);
  toast('Project created. Right-click the canvas to add a block.');
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
    dirty = savedGeneration !== generation; $('#save-state').textContent = dirty ? 'Unsaved changes' : 'Saved to server';
    await refreshProjects(); setProjectControls(true);
  })();
  try { await saving; } catch (error) { $('#save-state').textContent = 'Save failed'; throw error; } finally { saving = null; }
}
function latestURL(version, channel) {
  const url = channel === 'Prod' ? version?.prodUrl : version?.rcUrl;
  return url ? url.replace(/[^/]+$/, 'latest.zip') : null;
}
function renderVersions(versions) {
  const rcLatest = versions.find(version => version.channels.includes('RC'));
  const prodLatest = versions.find(version => version.channels.includes('Prod'));
  $('#version-latest').innerHTML = [
    rcLatest ? `<a href="${escapeHTML(latestURL(rcLatest, 'RC'))}" download>Download latest RC</a>` : '<span>No RC build yet</span>',
    prodLatest ? `<a href="${escapeHTML(latestURL(prodLatest, 'Prod'))}" download>Download latest Prod</a>` : '<span>No production build yet</span>'
  ].join('');
  $('#version-list').innerHTML = versions.length ? versions.map(version => {
    const current = version.revision === project.revision;
    const links = [version.rcUrl && `<a href="${escapeHTML(version.rcUrl)}" download>RC ZIP</a>`, version.prodUrl && `<a href="${escapeHTML(version.prodUrl)}" download>Prod ZIP</a>`].filter(Boolean).join('');
    return `<article class="version-row" data-revision="${version.revision}"><div class="version-main"><strong>Revision ${version.revision}</strong><span>${escapeHTML(new Date(version.createdAt).toLocaleString())}</span><small>${escapeHTML(version.name)}</small></div><div class="version-channels"><b class="channel rc">RC</b>${version.channels.includes('Prod') ? '<b class="channel prod">PROD</b>' : ''}${current ? '<b class="channel current">CURRENT</b>' : ''}</div><div class="version-links">${links}</div><div class="version-actions">${version.channels.includes('Prod') ? '' : '<button type="button" data-version-action="promote">Promote to Prod</button>'}<button type="button" data-version-action="restore" ${current ? 'disabled' : ''}>Restore</button><button type="button" class="danger" data-version-action="delete" ${current ? 'disabled' : ''}>Delete</button></div></article>`;
  }).join('') : '<div class="version-empty"><strong>No saved revisions yet</strong><span>Save the project to create its first RC build.</span></div>';
}
async function refreshVersions() {
  const versions = await api(`/api/projects/${project.id}/versions`);
  renderVersions(versions);
}
function renderDeploymentConfigs(configurations) {
  for (const channel of ['RC', 'Prod']) {
    const form = document.querySelector(`[data-deployment-channel="${channel}"]`);
    const config = configurations[channel] || { host: '0.0.0.0', port: 3001, 'log-level': 3 };
    form.elements.host.value = config.host;
    form.elements.port.value = config.port;
    form.elements['log-level'].value = config['log-level'];
  }
}
async function saveDeploymentConfig(form) {
  const channel = form.dataset.deploymentChannel;
  const config = { host: form.elements.host.value.trim(), port: Number(form.elements.port.value), 'log-level': Number(form.elements['log-level'].value) };
  const configurations = await api(`/api/projects/${project.id}/deployment-configs/${channel}`, { method: 'PUT', body: JSON.stringify(config) });
  renderDeploymentConfigs(configurations);
  toast(`${channel} deployment settings saved.`);
}
async function openVersionManager() {
  if (!project) return;
  if (dirty) await save();
  const [versions, configurations] = await Promise.all([api(`/api/projects/${project.id}/versions`), api(`/api/projects/${project.id}/deployment-configs`)]);
  renderVersions(versions); renderDeploymentConfigs(configurations);
  $('#version-dialog').showModal();
}
async function versionAction(button) {
  const revision = Number(button.closest('[data-revision]').dataset.revision), action = button.dataset.versionAction;
  if (action === 'promote') {
    if (!confirm(`Promote revision ${revision} to production? This updates the Prod latest.zip file.`)) return;
    await api(`/api/projects/${project.id}/versions/${revision}/promote`, { method: 'POST', body: '{}' });
    await refreshVersions(); toast(`Revision ${revision} promoted to Prod.`); return;
  }
  if (action === 'delete') {
    if (!confirm(`Delete revision ${revision} from RC and Prod? This cannot be undone.`)) return;
    await api(`/api/projects/${project.id}/versions/${revision}`, { method: 'DELETE', body: '{}' });
    await refreshVersions(); toast(`Revision ${revision} deleted.`); return;
  }
  if (action === 'restore') {
    if (!confirm(`Restore revision ${revision}? It will be saved as a new RC revision.`)) return;
    const restored = await api(`/api/projects/${project.id}/versions/${revision}/restore`, { method: 'POST', body: JSON.stringify({ revision: project.revision }) });
    project = restored; workspaceID = restored.workspaces[0]?.id || null;
    openWorkspaceIDs.clear(); restored.workspaces.forEach(workspace => openWorkspaceIDs.add(workspace.id));
    dirty = false; generation = 0; clearSelection(true); view = { x: 0, y: 60, zoom: 1 };
    $('#save-state').textContent = 'Saved to server'; $('#version-dialog').close();
    await refreshProjects(); setProjectControls(true); render(); requestAnimationFrame(fit);
    toast(`Revision ${revision} restored as revision ${restored.revision}.`);
  }
}
function renderTemplateList() {
  $('#template-list').innerHTML = templateNames.length ? templateNames.map(name => `<button type="button" data-template-name="${escapeHTML(name)}" class="${name === templateOriginalName ? 'active' : ''}"><span>◇</span><strong>${escapeHTML(name)}</strong></button>`).join('') : '<p>No templates yet</p>';
}
function setTemplateState(message = '') {
  $('#template-state').textContent = message || (templateDirty ? 'Unsaved template changes' : templateOriginalName ? 'Saved' : '');
  $('#template-save').disabled = !templateDirty;
  $('#template-delete').disabled = !templateOriginalName;
}
function clearTemplateEditor() {
  templateOriginalName = null; templateDirty = false;
  $('#template-name').value = ''; $('#template-contents').value = '';
  $('#template-name').disabled = true; $('#template-contents').disabled = true;
  setTemplateState(); renderTemplateList();
}
async function selectTemplate(name, force = false) {
  if (!force && templateDirty && !confirm('Discard unsaved template changes?')) return;
  const template = await api(`/api/projects/${project.id}/templates/${encodeURIComponent(name)}`);
  templateOriginalName = template.name; templateDirty = false;
  $('#template-name').disabled = false; $('#template-contents').disabled = false;
  $('#template-name').value = template.name; $('#template-contents').value = template.contents;
  setTemplateState(); renderTemplateList();
}
function newTemplate(type = 'html') {
  if (templateDirty && !confirm('Discard unsaved template changes?')) return;
  templateOriginalName = null; templateDirty = true;
  $('#template-name').disabled = false; $('#template-contents').disabled = false;
  $('#template-name').value = type === 'css' ? 'styles.css' : 'template.html';
  $('#template-contents').value = type === 'css' ? ':root {\n  color-scheme: light dark;\n}\n\nbody {\n  margin: 0;\n  font-family: system-ui, sans-serif;\n}\n' : '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>%title%</title>\n  <style>%styles%</style>\n</head>\n<body>\n  %content%\n</body>\n</html>\n';
  setTemplateState(); renderTemplateList(); $('#template-name').focus(); $('#template-name').select();
}
async function openTemplateEditor() {
  if (!project) return;
  if (dirty) await save();
  templateNames = await api(`/api/projects/${project.id}/templates`);
  clearTemplateEditor(); $('#template-dialog').showModal();
  if (templateNames.length) await selectTemplate(templateNames[0], true);
}
async function saveTemplate() {
  const name = $('#template-name').value.trim();
  if (!name) throw new Error('Enter a template filename.');
  setTemplateState('Saving…');
  try {
    const result = await api(`/api/projects/${project.id}/templates/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ contents: $('#template-contents').value, previousName: templateOriginalName, revision: project.revision }) });
    project.revision = result.project.revision; project.updatedAt = result.project.updatedAt;
    templateOriginalName = result.template.name; templateDirty = false;
    templateNames = await api(`/api/projects/${project.id}/templates`);
    setTemplateState(); renderTemplateList(); await refreshProjects(); setProjectControls(true);
    toast(`Template ${result.template.name} saved as project revision ${project.revision}.`);
  } catch (error) { setTemplateState(); throw error; }
}
async function deleteTemplate() {
  if (!templateOriginalName || !confirm(`Delete ${templateOriginalName}? This creates a new project revision.`)) return;
  const name = templateOriginalName;
  const saved = await api(`/api/projects/${project.id}/templates/${encodeURIComponent(name)}`, { method: 'DELETE', body: JSON.stringify({ revision: project.revision }) });
  project.revision = saved.revision; project.updatedAt = saved.updatedAt;
  templateNames = await api(`/api/projects/${project.id}/templates`); clearTemplateEditor();
  if (templateNames.length) await selectTemplate(templateNames[0], true);
  await refreshProjects(); setProjectControls(true); toast(`Template ${name} deleted.`);
}
function closeTemplateEditor() {
  if (templateDirty && !confirm('Close the template editor and discard unsaved changes?')) return;
  templateDirty = false; $('#template-dialog').close();
}
function workspaceCategoryChoices() {
  return [{ value: '', label: 'Uncategorized' }, ...(project?.workspaceCategories || []).map(category => ({ value: category.id, label: category.name }))];
}
function workspaceRow(item) {
  return '<button class="workspace-row ' + (item.id === workspaceID ? 'active ' : '') + (item.active ? '' : 'disabled') + '" data-workspace="' + escapeHTML(item.id) + '" draggable="true" title="Drag to reorder or move to another category"><span class="workspace-number">#' + escapeHTML(item.numberId) + '</span><span>' + escapeHTML(item.name) + '</span>' + (item.active ? '' : '<i>PAUSED</i>') + '</button>';
}
function workspaceGroup(category, items) {
  const id = category?.id || '', name = category?.name || 'Uncategorized';
  return '<section class="workspace-category" data-workspace-category="' + escapeHTML(id) + '"><div class="workspace-category-title"><span>⌄</span><strong>' + escapeHTML(name) + '</strong><small>' + items.length + '</small><button data-add-workspace-to-category="' + escapeHTML(id) + '" title="Add workspace to ' + escapeHTML(name) + '" aria-label="Add workspace to ' + escapeHTML(name) + '">＋</button></div>' + items.map(workspaceRow).join('') + '</section>';
}
function render() {
  $('#project-title').textContent = project?.name || '';
  const currentWorkspace = ws();
  $('#workspace-status').textContent = currentWorkspace ? (currentWorkspace.active ? 'Workspace active' : 'Workspace paused') : 'No workspace open';
  $('#workspace-settings').disabled = !currentWorkspace; $('#add-block').disabled = !currentWorkspace;
  const categories = project?.workspaceCategories || [];
  const knownCategories = new Set(categories.map(category => category.id));
  const groups = categories.map(category => workspaceGroup(category, project.workspaces.filter(item => item.categoryId === category.id)));
  const uncategorized = (project?.workspaces || []).filter(item => !item.categoryId || !knownCategories.has(item.categoryId));
  groups.push(workspaceGroup(null, uncategorized));
  $('#workspace-list').innerHTML = groups.join('');
  $('#tabs').innerHTML = (project?.workspaces || []).filter(item => openWorkspaceIDs.has(item.id)).map(item => '<div class="workspace-tab ' + (item.id === workspaceID ? 'active' : '') + '"><button class="workspace-tab-select" data-workspace="' + escapeHTML(item.id) + '"><span>◇</span><span>' + escapeHTML(item.name) + ' #' + escapeHTML(item.numberId) + '</span><span>' + (item.active ? '' : '○') + '</span></button><button class="workspace-tab-close" data-close-workspace="' + escapeHTML(item.id) + '" title="Close workspace tab" aria-label="Close ' + escapeHTML(item.name) + ' tab">×</button></div>').join('');
  renderProjects(); renderLibrary(); renderGraph();
}
function renderLibrary() {
  const query = $('#search').value.toLowerCase();
  const categories = [...new Set(['Triggers', 'Actions', 'Logic', 'Data', ...definitions.map(item => item.category)])];
  const html = categories.map(category => {
    const items = definitions.filter(item => item.category === category && `${item.name} ${item.description}`.toLowerCase().includes(query));
    return items.length ? `<section><h3>${escapeHTML(category)}</h3>${items.map(item => `<button data-type="${escapeHTML(item.type)}"><strong>${escapeHTML(item.name)}</strong><span>${escapeHTML(item.description)}</span></button>`).join('')}</section>` : '';
  }).join('');
  $('#library').innerHTML = html || '<p class="no-results">No blocks found.</p>';
}
function optionEditor(field, value) {
  const key = escapeHTML(field.key), label = escapeHTML(field.label);
  const textClass = ['select', 'number', 'checkbox'].includes(field.type) ? '' : ' text-option-field';
  const open = `<label class="option-field${textClass}" data-option-field="${key}"><span>${label}</span>`;
  if (field.type === 'select') return `${open}<select class="option-control" data-field="${key}">${(field.choices || []).map(choice => `<option value="${escapeHTML(choice)}" ${value === choice ? 'selected' : ''}>${escapeHTML(choice)}</option>`).join('')}</select></label>`;
  if (field.type === 'number') return `${open}<input class="option-control" type="number" data-field="${key}" value="${escapeHTML(value)}" ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''} step="any"></label>`;
  if (field.type === 'checkbox') return `${open}<input class="option-checkbox" type="checkbox" data-field="${key}" ${value ? 'checked' : ''}></label>`;
  return `${open}<textarea class="option-control" data-field="${key}" spellcheck="false">${escapeHTML(value)}</textarea></label>`;
}
function portColor(port) { return typeColors[port.kind === 'action' ? 'action' : (port.types?.[0] || 'unspecified')] || typeColors.unspecified; }
function renderGraph() {
  const workspace = ws();
  $('#canvas-empty').hidden = !workspace || workspace.blocks.length > 0;
  $('#nodes').innerHTML = (workspace?.blocks || []).map(block => {
    const definition = def(block.type) || { name: block.type, category: 'Unknown', description: 'Unknown block', fields: [], outputs: [], inputPorts: [], outputPorts: [] };
    const inputs = definition.inputPorts || [];
    const outputs = definition.outputPorts || (definition.outputs || []).map(id => ({ id, name: id, kind: 'action', types: [] }));
    const inputHTML = inputs.map(port => `<div class="port-row input-row" data-port-kind="${port.kind}" data-field-link="${escapeHTML(port.id)}"><button class="port input" style="--port-color:${portColor(port)}" data-input="${block.id}" data-port="${escapeHTML(port.id)}" data-kind="${port.kind}" data-types="${escapeHTML((port.types || []).join(','))}" aria-label="Connect ${escapeHTML(port.name)} input"></button><span>${escapeHTML(port.name)}</span></div>`).join('');
    const outputHTML = outputs.map(port => `<div class="port-row output-row" data-port-kind="${port.kind}" data-field-link="${escapeHTML(port.id)}"><span>${escapeHTML(port.name)}</span><button class="port ${pending?.from === block.id && pending.output === port.id ? 'pending' : ''}" style="--port-color:${portColor(port)}" data-output="${escapeHTML(port.id)}" data-from="${block.id}" data-kind="${port.kind}" data-types="${escapeHTML((port.types || []).join(','))}" aria-label="Connect ${escapeHTML(port.name)} output"></button></div>`).join('');
    const optionHTML = definition.fields.map(field => optionEditor(field, block.options[field.key])).join('');
    const classes = [inputs.length && 'has-inputs', definition.fields.length && 'has-options', outputs.length && 'has-outputs'].filter(Boolean).join(' ');
    const height = Number.isFinite(block.height) ? `;height:${block.height}px` : '';
    return `<article class="node ${selectedBlocks.has(block.id) ? 'selected' : ''}" data-node="${block.id}" style="left:${block.x}px;top:${block.y}px;width:${nodeWidth(block)}px${height}"><div class="node-head"><span class="block-number">#${escapeHTML(block.numberId)}</span><strong>${escapeHTML(definition.name)}</strong><span class="node-category">[${escapeHTML(definition.category)}]</span><span class="drag-grip">⠿</span></div><div class="node-body ${classes}" style="--port-row-count:${Math.max(inputs.length, outputs.length, 1)}"><div class="port-column input-ports">${inputHTML}</div><div class="option-column">${optionHTML || (!inputs.length && !outputs.length ? `<p>${escapeHTML(definition.description)}</p>` : '')}</div><div class="port-column output-ports">${outputHTML}</div></div></article>`;
  }).join('');
  $('#nodes').querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', () => {
      const block = workspace.blocks.find(item => item.id === input.closest('[data-node]').dataset.node);
      block.options[input.dataset.field] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value;
      markDirty(); requestAnimationFrame(renderWires);
    });
  });
  nodeResizeObserver.disconnect();
  $('#nodes').querySelectorAll('.node').forEach(node => nodeResizeObserver.observe(node));
  updateView(); scheduleNodeGeometry();
}
function scheduleNodeGeometry() {
  if (geometryFrame) return;
  geometryFrame = requestAnimationFrame(() => { geometryFrame = 0; renderWires(); });
}
function wirePath(a, b) {
  const curve = Math.max(60, Math.abs(b.x - a.x) * .5);
  return `M ${a.x} ${a.y} C ${a.x + curve} ${a.y}, ${b.x - curve} ${b.y}, ${b.x} ${b.y}`;
}
function renderWires() {
  if (!ws()) { $('#wires').innerHTML = ''; return; }
  const worldRect = $('#world').getBoundingClientRect();
  const point = element => { const box = element.getBoundingClientRect(); return { x: (box.x + box.width / 2 - worldRect.x) / view.zoom, y: (box.y + box.height / 2 - worldRect.y) / view.zoom }; };
  const paths = ws().connections.map(edge => {
    const inputID = edge.input || 'action';
    const from = document.querySelector(`[data-from="${CSS.escape(edge.from)}"][data-output="${CSS.escape(edge.output)}"]`), to = document.querySelector(`[data-input="${CSS.escape(edge.to)}"][data-port="${CSS.escape(inputID)}"]`);
    if (!from || !to) return '';
    const path = wirePath(point(from), point(to));
    const selectedClass = selectedEdge === edge.id ? ' selected' : '';
    return `<g class="wire${selectedClass}" data-edge="${edge.id}"><path class="wire-hit" d="${path}"/><path class="wire-line" style="--wire-color:${from.style.getPropertyValue('--port-color')}" d="${path}"/></g>`;
  }).join('');
  let preview = '';
  if (portDrag?.portElement?.isConnected) {
    const anchor = point(portDrag.portElement);
    const cursor = { x: (portDrag.pointerX - worldRect.x) / view.zoom, y: (portDrag.pointerY - worldRect.y) / view.zoom };
    const color = portDrag.portElement.style.getPropertyValue('--port-color');
    preview = `<path class="dragging-wire" style="--wire-color:${color}" d="${wirePath(anchor, cursor)}"/>`;
  }
  $('#wires').innerHTML = paths + preview;
}
function finishPortDrag(drag, target) {
  if (!target || !target.matches('[data-output], [data-input]')) { toast('Drop on a compatible port to connect.'); return; }
  if (drag.origin === 'output' && target.hasAttribute('data-input')) {
    pending = { from: drag.portData.from, output: drag.portData.output, kind: drag.portData.kind, types: drag.portData.types.split(',').filter(Boolean) };
    connect(target.dataset.input, target.dataset.port, target.dataset.kind, target.dataset.types.split(',').filter(Boolean));
    return;
  }
  if (drag.origin === 'input' && target.hasAttribute('data-output')) {
    pending = { from: target.dataset.from, output: target.dataset.output, kind: target.dataset.kind, types: target.dataset.types.split(',').filter(Boolean) };
    connect(drag.portData.input, drag.portData.port, drag.portData.kind, drag.portData.types.split(',').filter(Boolean));
    return;
  }
  toast('Drop onto the opposite port type.');
}
function clickPort(port) {
  if (port.hasAttribute('data-output')) {
    pending = { from: port.dataset.from, output: port.dataset.output, kind: port.dataset.kind, types: port.dataset.types.split(',').filter(Boolean) };
    renderGraph(); $('#hint').textContent = 'Now click a compatible input port · Escape to cancel';
  } else if (port.hasAttribute('data-input')) {
    connect(port.dataset.input, port.dataset.port, port.dataset.kind, port.dataset.types.split(',').filter(Boolean));
  }
}
function startPortDrag(event, port) {
  if (!ws() || event.button !== 0) return;
  portDrag = {
    origin: port.hasAttribute('data-output') ? 'output' : 'input',
    portElement: port,
    portData: { ...port.dataset },
    pointerX: event.clientX,
    pointerY: event.clientY,
    moved: false
  };
  const viewport = $('#viewport');
  viewport.setPointerCapture(event.pointerId);
  const move = current => {
    if (!portDrag) return;
    const dx = current.clientX - event.clientX, dy = current.clientY - event.clientY;
    if (!portDrag.moved && Math.hypot(dx, dy) < 8) return;
    portDrag.moved = true; pending = null; portDrag.pointerX = current.clientX; portDrag.pointerY = current.clientY; renderWires();
  };
  const stop = current => {
    viewport.removeEventListener('pointermove', move); viewport.removeEventListener('pointerup', stop); viewport.removeEventListener('pointercancel', cancel);
    const drag = portDrag; portDrag = null; renderWires();
    if (!drag || !current) return;
    if (!drag.moved) { suppressPortClick = true; clickPort(drag.portElement); return; }
    suppressPortClick = true;
    const target = document.elementFromPoint(current.clientX, current.clientY)?.closest('[data-output], [data-input]');
    finishPortDrag(drag, target);
  };
  const cancel = () => {
    viewport.removeEventListener('pointermove', move); viewport.removeEventListener('pointerup', stop); viewport.removeEventListener('pointercancel', cancel);
    portDrag = null; renderWires();
  };
  viewport.addEventListener('pointermove', move); viewport.addEventListener('pointerup', stop); viewport.addEventListener('pointercancel', cancel);
}
function deleteSelection() {
  const workspace = ws();
  if (!workspace) return;
  if (selectedBlocks.size) {
    const ids = new Set(selectedBlocks);
    workspace.blocks = workspace.blocks.filter(item => !ids.has(item.id));
    workspace.connections = workspace.connections.filter(edge => !ids.has(edge.from) && !ids.has(edge.to));
  } else if (selectedEdge) workspace.connections = workspace.connections.filter(edge => edge.id !== selectedEdge);
  else return;
  clearSelection(true); markDirty(); closeContextMenu(); renderGraph();
}
function duplicateSelection() {
  const snapshot = selectionSnapshot();
  if (!snapshot) return;
  const count = pasteSnapshot(snapshot, 38, 54);
  if (count) toast('Duplicated ' + count + ' block' + (count === 1 ? '' : 's') + '.');
}
function addBlock(type, position = pickerWorldPosition) {
  if (!ws()) return;
  const definition = def(type); if (!definition) return;
  const rect = $('#viewport').getBoundingClientRect();
  const width = definition.fields.length ? 500 : 300;
  const block = { id: uid(), numberId: nextNumberId(ws().blocks), type, x: Math.round(position?.x ?? (rect.width / 2 - view.x) / view.zoom - width / 2), y: Math.round(position?.y ?? (rect.height / 2 - view.y) / view.zoom - 80), width, options: Object.fromEntries(definition.fields.map(field => [field.key, field.default])) };
  ws().blocks.push(block); selectBlock(block.id); markDirty(); closePicker(); renderGraph();
}
function connect(to, input, kind, types) {
  if (!pending) { toast('Click an output port first, then this input.'); return; }
  if (pending.from === to) { toast('A block cannot connect to itself.', true); return; }
  if (pending.kind !== kind) { toast('Action ports connect to actions; value ports connect to values.', true); return; }
  const compatible = kind === 'action' || !pending.types.length || !types.length || pending.types.includes('unspecified') || types.includes('unspecified') || pending.types.some(type => types.includes(type));
  if (!compatible) { toast('These value port types are incompatible.', true); return; }
  let connections = ws().connections.filter(edge => edge.to !== to || (edge.input || 'action') !== input);
  if (kind === 'action') connections = connections.filter(edge => edge.from !== pending.from || edge.output !== pending.output);
  const seen = new Set();
  function reaches(id) { if (id === pending.from) return true; if (seen.has(id)) return false; seen.add(id); return connections.filter(edge => edge.from === id).some(edge => reaches(edge.to)); }
  if (reaches(to)) { toast('This connection would create a loop. Use an interval trigger instead.', true); return; }
  const { types: _types, ...connection } = pending;
  connections.push({ id: uid(), ...connection, to, input, kind }); ws().connections = connections; pending = null; markDirty(); renderGraph();
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
  const width = Math.max(...blocks.map(block => block.x + nodeWidth(block))) - left, height = Math.max(...blocks.map(block => block.y + nodeHeight(block))) - top, viewport = $('#viewport');
  view.zoom = Math.max(.25, Math.min(1, (viewport.clientWidth - 80) / width, (viewport.clientHeight - 100) / height));
  view.x = (viewport.clientWidth - width * view.zoom) / 2 - left * view.zoom; view.y = (viewport.clientHeight - height * view.zoom) / 2 - top * view.zoom; updateView();
}
function openPicker(clientX, clientY) {
  if (!ws()) return;
  closeContextMenu();
  const viewportRect = $('#viewport').getBoundingClientRect();
  pickerWorldPosition = { x: (clientX - viewportRect.x - view.x) / view.zoom, y: (clientY - viewportRect.y - view.y) / view.zoom };
  const picker = $('#block-picker'), width = 340, height = 450;
  picker.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, clientX))}px`; picker.style.top = `${Math.max(50, Math.min(innerHeight - height - 8, clientY))}px`;
  $('#picker-shade').hidden = false; picker.hidden = false; $('#search').value = ''; renderLibrary(); requestAnimationFrame(() => $('#search').focus());
}
function closePicker() { $('#picker-shade').hidden = true; $('#block-picker').hidden = true; pickerWorldPosition = null; }
function openContextMenu(x, y, allowDuplicate = true) {
  const menu = $('#context-menu'), duplicate = $('#duplicate-node');
  $('#workspace-context-menu').hidden = true;
  duplicate.hidden = !allowDuplicate;
  duplicate.querySelector('span').textContent = selectedBlocks.size > 1 ? 'Duplicate selected blocks' : 'Duplicate block';
  menu.style.left = Math.min(innerWidth - 220, x) + 'px'; menu.style.top = Math.min(innerHeight - 90, y) + 'px'; $('#context-shade').hidden = false; menu.hidden = false;
}
function openWorkspaceContextMenu(id, x, y) {
  const workspace = project?.workspaces.find(item => item.id === id);
  if (!workspace) return;
  workspaceContextID = id; closePicker(); $('#context-menu').hidden = true;
  const menu = $('#workspace-context-menu');
  $('#workspace-context-toggle span').textContent = workspace.active ? 'Deactivate workspace' : 'Activate workspace';
  $('#workspace-context-toggle').firstChild.textContent = workspace.active ? '○ ' : '● ';
  menu.style.left = Math.min(innerWidth - 245, x) + 'px'; menu.style.top = Math.min(innerHeight - 165, y) + 'px';
  $('#context-shade').hidden = false; menu.hidden = false;
}
function closeContextMenu() {
  $('#context-shade').hidden = true; $('#context-menu').hidden = true; $('#workspace-context-menu').hidden = true; workspaceContextID = null;
}
function selectWorkspace(id) {
  if (!project?.workspaces.some(workspace => workspace.id === id)) return;
  openWorkspaceIDs.add(id); workspaceID = id; clearSelection(true); render(); requestAnimationFrame(fit);
}
function closeWorkspaceTab(id) {
  if (!openWorkspaceIDs.has(id)) return;
  const open = project.workspaces.filter(workspace => openWorkspaceIDs.has(workspace.id));
  const index = open.findIndex(workspace => workspace.id === id);
  openWorkspaceIDs.delete(id);
  if (workspaceID === id) {
    const remaining = project.workspaces.filter(workspace => openWorkspaceIDs.has(workspace.id));
    workspaceID = remaining[Math.min(index, remaining.length - 1)]?.id || null;
    clearSelection(true);
  }
  render();
  if (workspaceID) requestAnimationFrame(fit);
}

$('#library').addEventListener('click', event => { const button = event.target.closest('[data-type]'); if (button) addBlock(button.dataset.type); });
$('#search').oninput = renderLibrary;
$('#picker-shade').onclick = closePicker;
$('#context-shade').onclick = closeContextMenu;
$('#dialog-cancel').onclick = () => $('#form-dialog').close('cancel');
$('#duplicate-node').onclick = duplicateSelection;
$('#remove-selection').onclick = deleteSelection;
$('#viewport').addEventListener('contextmenu', event => {
  event.preventDefault(); const node = event.target.closest('[data-node]'), edge = event.target.closest('[data-edge]');
  if (node) {
    if (!selectedBlocks.has(node.dataset.node)) selectBlock(node.dataset.node);
    else selectedEdge = null;
    renderGraph(); openContextMenu(event.clientX, event.clientY);
  } else if (edge) {
    selectedBlocks.clear(); selectedEdge = edge.dataset.edge; renderGraph(); openContextMenu(event.clientX, event.clientY, false);
  } else openPicker(event.clientX, event.clientY);
});
$('#viewport').addEventListener('click', event => {
  if (suppressPortClick) { suppressPortClick = false; event.preventDefault(); return; }
  const output = event.target.closest('[data-output]'), input = event.target.closest('[data-input]'), edge = event.target.closest('[data-edge]');
  if (output || input) clickPort(output || input);
  else if (edge) { selectedBlocks.clear(); selectedEdge = edge.dataset.edge; renderGraph(); }
});
function startMarqueeSelection(event) {
  const viewport = $('#viewport'), box = $('#selection-box'), viewportRect = viewport.getBoundingClientRect();
  const origin = { x: event.clientX, y: event.clientY }, existing = new Set(selectedBlocks);
  let moved = false;
  viewport.setPointerCapture(event.pointerId);
  const move = current => {
    const dx = current.clientX - origin.x, dy = current.clientY - origin.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    const left = Math.min(origin.x, current.clientX), right = Math.max(origin.x, current.clientX);
    const top = Math.min(origin.y, current.clientY), bottom = Math.max(origin.y, current.clientY);
    box.hidden = false; box.style.left = left - viewportRect.left + 'px'; box.style.top = top - viewportRect.top + 'px';
    box.style.width = right - left + 'px'; box.style.height = bottom - top + 'px';
    selectedBlocks.clear(); existing.forEach(id => selectedBlocks.add(id));
    document.querySelectorAll('.node').forEach(node => {
      const rect = node.getBoundingClientRect();
      if (rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom) selectedBlocks.add(node.dataset.node);
    });
    selectedEdge = null; updateBlockSelection(); renderWires();
  };
  const stop = () => {
    viewport.removeEventListener('pointermove', move); viewport.removeEventListener('pointerup', stop); viewport.removeEventListener('pointercancel', stop);
    box.hidden = true; box.removeAttribute('style');
  };
  viewport.addEventListener('pointermove', move); viewport.addEventListener('pointerup', stop); viewport.addEventListener('pointercancel', stop);
}
$('#viewport').addEventListener('pointerdown', event => {
  const port = event.target.closest('[data-output], [data-input]');
  if (port && event.button === 0) { startPortDrag(event, port); return; }
  if (event.button !== 0 || event.target.closest('button,input,textarea,select,[data-edge]')) return;
  const node = event.target.closest('[data-node]'), workspace = ws(), block = node ? workspace?.blocks.find(item => item.id === node.dataset.node) : null;
  if (!block && event.shiftKey) { startMarqueeSelection(event); return; }
  const additive = event.ctrlKey || event.metaKey || event.shiftKey;
  if (block) {
    if (additive) selectBlock(block.id, true);
    else if (!selectedBlocks.has(block.id)) selectBlock(block.id);
    else selectedEdge = null;
    updateBlockSelection();
  } else {
    clearSelection(); updateBlockSelection(); renderWires();
  }
  if (block && !event.target.closest('.node-head')) return;
  const movingBlocks = block && selectedBlocks.has(block.id) ? workspace.blocks.filter(item => selectedBlocks.has(item.id)) : [];
  const basePositions = new Map(movingBlocks.map(item => [item.id, { x: item.x, y: item.y }]));
  const start = { x: event.clientX, y: event.clientY, baseX: view.x, baseY: view.y }; let moved = false;
  const viewport = $('#viewport'); viewport.setPointerCapture(event.pointerId);
  const move = current => {
    const dx = current.clientX - start.x, dy = current.clientY - start.y; if (Math.abs(dx) + Math.abs(dy) < 3 && !moved) return; moved = true;
    if (block) {
      for (const item of movingBlocks) {
        const base = basePositions.get(item.id);
        item.x = Math.round(base.x + dx / view.zoom); item.y = Math.round(base.y + dy / view.zoom);
        const element = document.querySelector('[data-node="' + CSS.escape(item.id) + '"]');
        if (element) { element.style.left = item.x + 'px'; element.style.top = item.y + 'px'; }
      }
      renderWires();
    } else { view.x = start.baseX + dx; view.y = start.baseY + dy; updateView(); }
  };
  const stop = () => { viewport.removeEventListener('pointermove', move); viewport.removeEventListener('pointerup', stop); viewport.removeEventListener('pointercancel', stop); if (block && moved && movingBlocks.length) markDirty(); };
  viewport.addEventListener('pointermove', move); viewport.addEventListener('pointerup', stop); viewport.addEventListener('pointercancel', stop);
});
$('#viewport').addEventListener('wheel', event => { event.preventDefault(); const rect = $('#viewport').getBoundingClientRect(); zoom(event.deltaY < 0 ? 1.08 : 1 / 1.08, event.clientX - rect.x, event.clientY - rect.y); }, { passive: false });
function clearWorkspaceDropIndicators() {
  document.querySelectorAll('.workspace-row.drop-before,.workspace-row.drop-after').forEach(row => row.classList.remove('drop-before', 'drop-after'));
  document.querySelectorAll('.workspace-category.drop-category').forEach(category => category.classList.remove('drop-category'));
}
function moveWorkspace(draggedID, categoryID, targetID = null, after = false) {
  const workspace = project?.workspaces.find(item => item.id === draggedID);
  if (!workspace || draggedID === targetID) return;
  const category = categoryID && project.workspaceCategories?.some(item => item.id === categoryID) ? categoryID : null;
  project.workspaces = project.workspaces.filter(item => item.id !== draggedID);
  workspace.categoryId = category;
  if (targetID) {
    const targetIndex = project.workspaces.findIndex(item => item.id === targetID);
    project.workspaces.splice(targetIndex + (after ? 1 : 0), 0, workspace);
  } else {
    let lastCategoryIndex = -1;
    for (let index = 0; index < project.workspaces.length; index++) {
      if ((project.workspaces[index].categoryId || null) === category) lastCategoryIndex = index;
    }
    project.workspaces.splice(lastCategoryIndex + 1, 0, workspace);
  }
  markDirty(); render();
}
$('#workspace-list').addEventListener('dragstart', event => {
  const row = event.target.closest('[data-workspace]');
  if (!row) return;
  draggedWorkspaceID = row.dataset.workspace; row.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', draggedWorkspaceID);
});
$('#workspace-list').addEventListener('dragover', event => {
  if (!draggedWorkspaceID) return;
  const category = event.target.closest('[data-workspace-category]');
  if (!category) return;
  event.preventDefault(); event.dataTransfer.dropEffect = 'move'; clearWorkspaceDropIndicators();
  const row = event.target.closest('[data-workspace]');
  if (row && row.dataset.workspace !== draggedWorkspaceID) {
    row.classList.add(event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2 ? 'drop-after' : 'drop-before');
  } else category.classList.add('drop-category');
});
$('#workspace-list').addEventListener('drop', event => {
  if (!draggedWorkspaceID) return;
  const category = event.target.closest('[data-workspace-category]');
  if (!category) return;
  event.preventDefault();
  const row = event.target.closest('[data-workspace]');
  const after = Boolean(row && row.classList.contains('drop-after'));
  const targetID = row?.dataset.workspace || null, categoryID = category.dataset.workspaceCategory || null;
  const draggedID = draggedWorkspaceID; draggedWorkspaceID = null; clearWorkspaceDropIndicators();
  moveWorkspace(draggedID, categoryID, targetID, after);
});
$('#workspace-list').addEventListener('dragend', event => {
  event.target.closest('[data-workspace]')?.classList.remove('dragging');
  draggedWorkspaceID = null; clearWorkspaceDropIndicators();
});
$('#workspace-list').addEventListener('click', event => {
  const add = event.target.closest('[data-add-workspace-to-category]');
  if (add) handle(() => addWorkspace(add.dataset.addWorkspaceToCategory || ''))();
});
$('#tabs').addEventListener('click', event => {
  const close = event.target.closest('[data-close-workspace]');
  if (close) { event.stopPropagation(); closeWorkspaceTab(close.dataset.closeWorkspace); }
});
for (const selector of ['#tabs', '#workspace-list']) {
  $(selector).addEventListener('click', event => { const button = event.target.closest('[data-workspace]'); if (button) selectWorkspace(button.dataset.workspace); });
  $(selector).addEventListener('contextmenu', event => {
    const button = event.target.closest('[data-workspace]');
    if (!button) return;
    event.preventDefault(); event.stopPropagation(); openWorkspaceContextMenu(button.dataset.workspace, event.clientX, event.clientY);
  });
}
for (const selector of ['#project-orbs', '#recent-projects']) $(selector).addEventListener('click', event => { const button = event.target.closest('[data-project]'); if (button) handle(openProject)(button.dataset.project); });
function contextWorkspace() {
  return project?.workspaces.find(item => item.id === workspaceContextID);
}
$('#workspace-context-settings').onclick = () => {
  const id = workspaceContextID;
  closeContextMenu();
  if (!id) return;
  selectWorkspace(id); $('#workspace-settings').click();
};
$('#workspace-context-duplicate').onclick = () => {
  const workspace = contextWorkspace();
  if (!workspace) return;
  workspaceClipboard = { projectId: project.id, workspace: structuredClone(workspace) }; clipboardKind = 'workspace';
  closeContextMenu(); pasteWorkspace();
};
$('#workspace-context-toggle').onclick = () => {
  const workspace = contextWorkspace();
  if (!workspace) return;
  workspace.active = !workspace.active;
  const active = workspace.active;
  closeContextMenu(); markDirty(); render();
  toast((active ? 'Activated ' : 'Deactivated ') + workspace.name + '.');
};
$('#workspace-context-delete').onclick = () => {
  const workspace = contextWorkspace();
  if (!workspace) return;
  if (project.workspaces.length === 1) { closeContextMenu(); toast('A project must keep at least one workspace.', true); return; }
  if (!confirm('Delete workspace "' + workspace.name + '" and all of its blocks and wires?')) return;
  const index = project.workspaces.indexOf(workspace);
  project.workspaces.splice(index, 1); openWorkspaceIDs.delete(workspace.id);
  if (workspaceID === workspace.id) { workspaceID = project.workspaces[Math.min(index, project.workspaces.length - 1)].id; openWorkspaceIDs.add(workspaceID); }
  closeContextMenu(); clearSelection(true); markDirty(); render(); requestAnimationFrame(fit);
  toast('Deleted workspace ' + workspace.name + '.');
};
async function addWorkspace(categoryId = '') {
  const values = await modal('Add workspace', [
    { name: 'name', label: 'Workspace name', value: 'New workspace', selectOnOpen: true }
  ], 'Add workspace');
  if (!values) return;
  const validCategory = project.workspaceCategories?.some(category => category.id === categoryId) ? categoryId : null;
  const workspace = { id: uid(), numberId: nextNumberId(project.workspaces), name: values.name, categoryId: validCategory, active: true, blocks: [], connections: [] };
  project.workspaces.push(workspace); openWorkspaceIDs.add(workspace.id); workspaceID = workspace.id; clearSelection(true); markDirty(); render(); fit();
}
$('#add-workspace').onclick = handle(() => addWorkspace());
$('#add-workspace-category').onclick = handle(async () => {
  const values = await modal('Add workspace category', [{ name: 'name', label: 'Category name', value: 'New category', selectOnOpen: true }], 'Add category');
  if (!values) return;
  project.workspaceCategories ||= [];
  project.workspaceCategories.push({ id: uid(), name: values.name });
  markDirty(); render();
});
$('#workspace-settings').onclick = handle(async () => {
  const workspace = ws();
  const values = await modal('Project and workspace', [
    { name: 'project', label: 'Project name', value: project.name },
    { name: 'name', label: 'Workspace name', value: workspace.name },
    { name: 'categoryId', label: 'Workspace category', type: 'select', value: workspace.categoryId || '', choices: workspaceCategoryChoices() },
    { name: 'active', label: 'Run this workspace in the exported application', type: 'checkbox', value: workspace.active }
  ], 'Apply');
  if (!values) return;
  project.name = values.project; workspace.name = values.name; workspace.categoryId = values.categoryId || null; workspace.active = values.active; markDirty(); render();
});
for (const form of document.querySelectorAll('[data-deployment-channel]')) form.onsubmit = handle(async event => { event.preventDefault(); await saveDeploymentConfig(form); });
for (const selector of ['#new-project', '#rail-new-project', '#home-new-project']) $(selector).onclick = handle(createProject);
for (const selector of ['#show-home', '[data-home]']) $(selector).onclick = showHome;
for (const selector of ['#add-block', '#empty-add-block']) $(selector).onclick = () => { const rect = $('#viewport').getBoundingClientRect(); openPicker(rect.left + rect.width / 2 - 170, rect.top + Math.min(100, rect.height / 3)); };
$('#save').onclick = handle(async () => { await save(); toast('Project saved to the server.'); });
$('#versions').onclick = handle(openVersionManager);
$('#templates').onclick = handle(openTemplateEditor);
$('#version-close').onclick = () => $('#version-dialog').close();
$('#version-list').onclick = event => { const button = event.target.closest('[data-version-action]'); if (button) handle(() => versionAction(button))(); };
$('#template-new-html').onclick = () => newTemplate('html');
$('#template-new-css').onclick = () => newTemplate('css');
$('#template-save').onclick = handle(saveTemplate);
$('#template-delete').onclick = handle(deleteTemplate);
$('#template-close').onclick = closeTemplateEditor;
$('#template-list').onclick = event => { const button = event.target.closest('[data-template-name]'); if (button) handle(() => selectTemplate(button.dataset.templateName))(); };
for (const selector of ['#template-name', '#template-contents']) $(selector).addEventListener('input', () => { templateDirty = true; setTemplateState(); });
$('#template-contents').addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  event.preventDefault();
  const input = event.currentTarget, start = input.selectionStart, end = input.selectionEnd;
  input.setRangeText('  ', start, end, 'end'); input.dispatchEvent(new Event('input', { bubbles: true }));
});
$('#template-dialog').addEventListener('cancel', event => { event.preventDefault(); closeTemplateEditor(); });
$('#export').onclick = handle(async () => {
  if (!project) return; await save(); if (dirty) await save();
  const response = await fetch(`/api/projects/${project.id}/export`);
  if (!response.ok) { if (response.status === 401) $('#sign-in-again').hidden = false; throw new Error((await response.json()).error); }
  const url = URL.createObjectURL(await response.blob()), link = document.createElement('a'); link.href = url; link.download = `${project.name.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'automation'}.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Application exported. Extract the ZIP and run node app.js.');
});
$('#zoom-in').onclick = () => zoom(1.2); $('#zoom-out').onclick = () => zoom(1 / 1.2); $('#reset-view').onclick = () => zoom(1 / view.zoom); $('#fit').onclick = fit;
const themes = ['system', 'light', 'dark'];
function setTheme(theme) { document.documentElement.dataset.theme = theme; localStorage.setItem('phidias-theme', theme); $('#theme-toggle').title = `Appearance: ${theme}`; }
setTheme(localStorage.getItem('phidias-theme') || 'system');
$('#theme-toggle').onclick = () => setTheme(themes[(themes.indexOf(document.documentElement.dataset.theme) + 1) % themes.length]);
window.addEventListener('keydown', event => {
  if ($('#form-dialog').open || $('#version-dialog').open || $('#template-dialog').open) return;
  const command = event.ctrlKey || event.metaKey;
  const editing = event.target.closest?.('input,textarea,select,[contenteditable]');
  const key = event.key.toLowerCase();
  if (command && key === 's') { event.preventDefault(); handle(save)(); }
  if (command && key === 'c' && !editing && (selectedBlocks.size || (!selectedEdge && ws()))) {
    event.preventDefault(); if (selectedBlocks.size) copySelection(); else copyWorkspace();
  }
  if (command && key === 'v' && !editing && clipboardKind) {
    event.preventDefault(); if (clipboardKind === 'blocks') pasteSelection(); else pasteWorkspace();
  }
  if (event.key === 'Escape') { if (!$('#block-picker').hidden) closePicker(); else if (!$('#context-menu').hidden) closeContextMenu(); else { pending = null; renderGraph(); } }
  if (['Delete', 'Backspace'].includes(event.key) && !editing) { event.preventDefault(); deleteSelection(); }
});
window.addEventListener('beforeunload', event => { if (dirty || templateDirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('resize', renderWires);
async function refreshSession() { const session = await api('/api/session'); csrfToken = session.csrfToken; $('#account-name').textContent = session.username; $('#sign-in-again').hidden = true; }
$('#logout').onclick = handle(async () => {
  if (saving) await saving; if (dirty && !confirm('Sign out and discard unsaved changes?')) return;
  try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch (error) { if (error.status !== 401) throw error; }
  dirty = false; window.location.replace('/login');
});
window.addEventListener('focus', () => { refreshSession().catch(() => {}); });
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
async function bootstrap() {
  try { await refreshSession(); await refreshProjects(); showHome(); }
  catch (error) { if (error.status === 401) { window.location.replace('/login'); return; } throw error; }
}
handle(bootstrap)();

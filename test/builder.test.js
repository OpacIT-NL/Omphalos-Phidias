'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('../server');
const { createLogger } = require('../lib/logger');
const { Store } = require('../lib/store');
const { CommandConsole } = require('../lib/console');
const { createApp, loadDefinitions, render, loadAppConfig } = require('../runtime/app');
const { validate } = require('../runtime/validate');
const { crc32 } = require('../lib/zip');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinel-test-'));
  const repositoryDirectory = path.join(directory, 'repo');
  const logger = createLogger({ level: 0, directory: path.join(directory, 'logs') });
  const { server, store, auth, setCommandConsoleFactory } = await createServer({ directory, repositoryDirectory, authDatabase: path.join(directory, 'auth.sqlite'), secureCookies: false, logger });
  const consoleConfig = { running: { console: { enablePasswordHash: null } }, dirty: () => false };
  setCommandConsoleFactory(({ ask, write }) => new CommandConsole({ config: consoleConfig, auth, logger, ask, write, shutdown: async () => {}, status: () => 'Test listener' }));
  await auth.createUser('tester', 'a-test-password-12345');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await fs.rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const rawCall = (route, method = 'GET', body, headers = {}) => fetch(base + route, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const login = await rawCall('/api/login', 'POST', { username: 'tester', password: 'a-test-password-12345' });
  assert.equal(login.status, 200);
  const session = await login.json();
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': session.csrfToken };
  const call = (route, method = 'GET', body, extra = {}) => rawCall(route, method, body, { ...headers, ...extra });
  return { directory, repositoryDirectory, store, auth, call, rawCall, headers, base };
}
function zipEntries(zip) {
  const extracted = new Map(); let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const length = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extraLength = zip.readUInt16LE(offset + 28);
    const filename = zip.subarray(offset + 30, offset + 30 + nameLength).toString(), start = offset + 30 + nameLength + extraLength;
    const contents = zip.subarray(start, start + length);
    assert.equal(crc32(contents), zip.readUInt32LE(offset + 14));
    extracted.set(filename, contents); offset = start + length;
  }
  assert.equal(zip.readUInt32LE(offset), 0x02014b50);
  return extracted;
}

test('project creation, atomic saves, conflicts, reload, and downloadable ZIP', async t => {
  const { store, call, directory } = await fixture(t);
  const response = await call('/api/projects', 'POST', { name: 'My project' }); assert.equal(response.status, 201);
  const project = await response.json(), endpoint = `/api/projects/${project.id}`;
  const library = await (await call(endpoint + '/blocks')).json();
  const replyFormat = library.find(block => block.type === 'respond').fields.find(field => field.key === 'format');
  assert.equal(replyFormat.default, 'JSON'); assert.ok(replyFormat.choices.includes('HTML'));
  for (const file of ['app.js', 'favicon.ico', 'workspaces.json', 'html', 'blocks/api_endpoint.js', 'blocks/get_sub_endpoint_by_name.js', 'blocks/linux_command.js', 'blocks/update_app.js', 'validate.js', 'cron.js', 'auth.js', 'logger.js', 'package.json']) await fs.access(path.join(directory, project.id, file));
  assert.equal(project.appConfig, null);
  assert.deepEqual(project.workspaceCategories, []);
  assert.equal(project.workspaces[0].numberId, 1);
  assert.deepEqual(project.workspaces[0].blocks.map(block => block.numberId), [1, 2]);
  const defaultExportConfig = JSON.parse(zipEntries(await store.export(project.id)).get('config.json'));
  assert.deepEqual(defaultExportConfig, { port: 3001, host: '0.0.0.0', 'log-level': 3, 'force-console-input-log': false, auth: { database: path.join(directory, 'auth.sqlite') }, 'project-id': project.id, 'release-channel': 'RC' });
  const probe = require('node:net').createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const configuredPort = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  assert.deepEqual(await (await call(endpoint + '/deployment-configs')).json(), { RC: null, Prod: null });
  const deploymentSettings = await call(endpoint + '/deployment-configs/RC', 'PUT', { port: configuredPort, host: '127.0.0.1', 'log-level': 4, 'force-console-input-log': true });
  assert.equal(deploymentSettings.status, 200);
  project.workspaceCategories = [{ id: 'public-api', name: 'Public API' }];
  project.workspaces[0].categoryId = 'public-api';
  project.workspaces[0].blocks[1].width = 740;
  project.workspaces[0].blocks[1].height = 420;
  project.workspaces[0].blocks[1].options.body = 'Updated application';
  const results = await Promise.all([call(endpoint, 'PUT', project), call(endpoint, 'PUT', project)]);
  assert.deepEqual(results.map(res => res.status).sort(), [200, 409]);
  const stored = await store.get(project.id); assert.equal(stored.revision, 2); assert.equal(stored.workspaces[0].blocks[1].options.body, 'Updated application');
  assert.equal(stored.workspaces[0].blocks[1].width, 740); assert.equal(stored.workspaces[0].blocks[1].height, 420);
  assert.deepEqual(stored.workspaceCategories, [{ id: 'public-api', name: 'Public API' }]); assert.equal(stored.workspaces[0].categoryId, 'public-api');
  assert.equal((await (await call('/api/projects')).json()).length, 1);
  await fs.copyFile(path.join(directory, project.id, 'blocks/api_endpoint.js'), path.join(directory, project.id, 'blocks/http.js'));
  const archive = await call(endpoint + '/export'); assert.equal(archive.headers.get('content-type'), 'application/zip');
  const zip = Buffer.from(await archive.arrayBuffer());
  const extracted = zipEntries(zip);
  const exportedProject = JSON.parse(extracted.get('workspaces.json'));
  assert.equal(exportedProject.revision, 2); assert.equal(exportedProject.workspaceCategories[0].name, 'Public API'); assert.equal(exportedProject.workspaces[0].categoryId, 'public-api');
  assert.equal(exportedProject.workspaces[0].blocks[1].width, 740); assert.equal(exportedProject.workspaces[0].blocks[1].height, 420);
  assert.equal(exportedProject.workspaces[0].numberId, 1); assert.deepEqual(exportedProject.workspaces[0].blocks.map(block => block.numberId), [1, 2]);
  assert.ok(extracted.has('auth.js'));
  assert.ok(extracted.has('logger.js'));
  assert.equal(extracted.get('application.key').length, 32);
  assert.deepEqual(extracted.get('favicon.ico').subarray(0, 4), Buffer.from([0, 0, 1, 0]));
  assert.equal(JSON.parse(extracted.get('package.json')).dependencies.argon2, '^0.45.1');
  for (const name of ['api_endpoint.js', 'api_call.js', 'api_reply.js']) assert.ok(extracted.has(`blocks/${name}`));
  for (const name of ['json_to_cartesian_chart.js', 'json_to_circular_chart.js', 'chart_helpers.cjs']) assert.ok(extracted.has(`blocks/${name}`));
  for (const name of ['math_operation.js', 'percentage_calculator.js', 'aggregate_numbers.js', 'transform_json_numbers.js', 'math_helpers.cjs']) assert.ok(extracted.has(`blocks/${name}`));
  for (const name of ['http.js', 'request.js', 'respond.js']) assert.equal(extracted.has(`blocks/${name}`), false);
  const deployedConfig = JSON.stringify({ port: configuredPort, host: '127.0.0.1', 'log-level': 4, 'force-console-input-log': true, auth: { database: path.join(directory, 'auth.sqlite') }, 'project-id': project.id, 'release-channel': 'RC' }, null, 2) + '\n';
  assert.equal(extracted.get('config.json').toString(), deployedConfig);
  const deployment = path.join(directory, 'isolated-export'); await fs.mkdir(deployment);
  for (const [filename, data] of extracted) { const destination = path.join(deployment, filename); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, data); }
  const childEnvironment = { ...process.env }; delete childEnvironment.PORT; delete childEnvironment.HOST;
  const child = spawn(process.execPath, ['app.js'], { cwd: deployment, env: childEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Export did not start')); }, 5000);
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/My project listening on 127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    child.once('error', reject); child.stderr.on('data', chunk => { clearTimeout(timeout); reject(new Error(String(chunk))); });
  });
  assert.equal(Number(address), configuredPort);
  assert.equal(await fs.readFile(path.join(deployment, 'config.json'), 'utf8'), deployedConfig);
  const runtimeResponse = await fetch(`http://127.0.0.1:${address}/hello`); assert.equal(runtimeResponse.status, 200); assert.equal(await runtimeResponse.text(), 'Updated application');
  const runtimeFavicon = await fetch(`http://127.0.0.1:${address}/favicon.ico`);
  assert.equal(runtimeFavicon.status, 200); assert.equal(runtimeFavicon.headers.get('content-type'), 'image/x-icon');
  assert.deepEqual(Buffer.from(await runtimeFavicon.arrayBuffer()), extracted.get('favicon.ico'));
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
  const runtimeLogs = await fs.readdir(path.join(deployment, 'log'));
  assert.equal(runtimeLogs.length, 1); assert.match(runtimeLogs[0], /^\d{4}-\d{2}-\d{2}-1\.txt$/);
  const runtimeLog = await fs.readFile(path.join(deployment, 'log', runtimeLogs[0]), 'utf8');
  assert.match(runtimeLog, /\[INFO\] My project listening on 127\.0\.0\.1:/);
  assert.match(runtimeLog, /\[INFO\] My project stopped/);
  assert.match(runtimeLog, /\[DEBUG\] Request completed: GET \/hello \(200,/);
});

test('projects import from uploaded ZIP files and same-origin repository URLs', async t => {
  const { call, base, headers, store } = await fixture(t);
  const source = await (await call('/api/projects', 'POST', { name: 'Imported source' })).json();
  source.workspaces[0].name = 'Imported workflow';
  source.workspaces[0].blocks[1].options.body = 'Imported response';
  const saved = await (await call(`/api/projects/${source.id}`, 'PUT', source)).json();
  const exported = await call(`/api/projects/${source.id}/export`);
  const uploaded = await fetch(`${base}/api/projects/import`, { method: 'POST', headers: { ...headers, 'content-type': 'application/zip' }, body: Buffer.from(await exported.arrayBuffer()) });
  assert.equal(uploaded.status, 201);
  const uploadedProject = await uploaded.json();
  assert.notEqual(uploadedProject.id, source.id);
  assert.equal(uploadedProject.name, 'Imported source');
  assert.equal(uploadedProject.revision, 1);
  assert.equal(uploadedProject.workspaces[0].name, 'Imported workflow');
  assert.equal(uploadedProject.workspaces[0].blocks[1].options.body, 'Imported response');
  assert.ok(uploadedProject.access.includes('edit'));

  const fromURL = await call('/api/projects/import-url', 'POST', { url: `${base}/repo/Imported-sourceRC/latest.zip` });
  assert.equal(fromURL.status, 201);
  const urlProject = await fromURL.json();
  assert.notEqual(urlProject.id, source.id); assert.notEqual(urlProject.id, uploadedProject.id);
  assert.equal(urlProject.name, 'Imported source');
  assert.equal(urlProject.workspaces[0].blocks[1].options.body, 'Imported response');

  const { zip } = require('../lib/zip');
  await assert.rejects(() => store.importArchive(zip([['../workspaces.json', JSON.stringify(saved)]])), /unsafe path/);
});

test('saved revisions publish to a browsable RC repository and can be promoted, restored, and deleted', async t => {
  const { call, rawCall, base, directory } = await fixture(t);
  const project = await (await call('/api/projects', 'POST', { name: 'Delphi' })).json();
  const endpoint = `/api/projects/${project.id}`;
  const rcUpdateUrl = 'https://builder.example/repo/DelphiRC/latest.zip';
  const prodUpdateUrl = 'https://builder.example/repo/DelphiProd/latest.zip';
  assert.equal((await call(endpoint + '/deployment-configs/RC', 'PUT', { port: 7779, host: '127.0.0.1', 'log-level': 4, 'force-console-input-log': true, 'update-url': rcUpdateUrl })).status, 200);
  assert.equal((await call(endpoint + '/deployment-configs/Prod', 'PUT', { port: 7778, host: '0.0.0.0', 'log-level': 2, 'update-url': prodUpdateUrl })).status, 200);
  project.workspaces[0].blocks[1].options.body = 'revision two';
  const revisionTwo = await (await call(endpoint, 'PUT', project)).json();
  assert.equal(revisionTwo.revision, 2);

  let versions = await (await call(endpoint + '/versions')).json();
  assert.equal(versions.length, 1);
  assert.deepEqual(versions[0].channels, ['RC']);
  assert.equal(versions[0].rcUrl, '/repo/DelphiRC/delphi.rev2.zip');
  assert.equal((await rawCall(versions[0].rcUrl)).status, 200);
  const repositoryRedirect = await fetch(base + '/repo', { redirect: 'manual' });
  assert.equal(repositoryRedirect.status, 308); assert.equal(repositoryRedirect.headers.get('location'), '/repo/');
  const repositoryIndex = await rawCall('/repo/');
  assert.equal(repositoryIndex.status, 200); assert.match(await repositoryIndex.text(), /href="\/repo\/DelphiRC\/"/);
  const folderRedirect = await fetch(base + '/repo/DelphiRC', { redirect: 'manual' });
  assert.equal(folderRedirect.status, 308); assert.equal(folderRedirect.headers.get('location'), '/repo/DelphiRC/');
  const folderIndex = await rawCall('/repo/DelphiRC/');
  const folderHTML = await folderIndex.text();
  assert.equal(folderIndex.status, 200); assert.match(folderHTML, /href="\/repo\/DelphiRC\/latest\.zip"/); assert.match(folderHTML, /delphi\.rev2\.zip/);
  const repositoryHead = await fetch(base + '/repo/DelphiRC/latest.zip', { method: 'HEAD' });
  assert.equal(repositoryHead.status, 200); assert.equal(await repositoryHead.text(), '');
  assert.equal((await rawCall('/repo/Unknown/')).status, 404);
  const rcRevision = await call(versions[0].rcUrl);
  assert.equal(rcRevision.status, 200);
  const rcFiles = zipEntries(Buffer.from(await rcRevision.arrayBuffer()));
  assert.equal(rcFiles.has('application.key'), false);
  assert.equal(JSON.parse(rcFiles.get('workspaces.json')).revision, 2);
  assert.deepEqual(JSON.parse(rcFiles.get('config.json')), { port: 7779, host: '127.0.0.1', 'log-level': 4, 'force-console-input-log': true, 'update-url': rcUpdateUrl, auth: { database: path.join(directory, 'auth.sqlite') }, 'project-id': project.id, 'release-channel': 'RC' });
  assert.equal((await call('/repo/DelphiRC/latest.zip')).status, 200);

  assert.equal((await call(endpoint + '/versions/2/promote', 'POST', {})).status, 200);
  versions = await (await call(endpoint + '/versions')).json();
  assert.deepEqual(versions[0].channels, ['RC', 'Prod']);
  assert.equal(versions[0].prodUrl, '/repo/DelphiProd/delphi.rev2.zip');
  const prodBeforeNextSave = Buffer.from(await (await call('/repo/DelphiProd/latest.zip')).arrayBuffer());
  assert.equal(JSON.parse(zipEntries(prodBeforeNextSave).get('workspaces.json')).revision, 2);
  assert.deepEqual(JSON.parse(zipEntries(prodBeforeNextSave).get('config.json')), { port: 7778, host: '0.0.0.0', 'log-level': 2, 'force-console-input-log': false, 'update-url': prodUpdateUrl, auth: { database: path.join(directory, 'auth.sqlite') }, 'project-id': project.id, 'release-channel': 'Prod' });

  assert.equal((await call(endpoint + '/deployment-configs/Prod', 'PUT', { port: 7780, host: '127.0.0.1', 'log-level': 1, 'force-console-input-log': true, 'update-url': prodUpdateUrl })).status, 200);
  const reconfiguredProd = zipEntries(Buffer.from(await (await call('/repo/DelphiProd/latest.zip')).arrayBuffer()));
  assert.deepEqual(JSON.parse(reconfiguredProd.get('config.json')), { port: 7780, host: '127.0.0.1', 'log-level': 1, 'force-console-input-log': true, 'update-url': prodUpdateUrl, auth: { database: path.join(directory, 'auth.sqlite') }, 'project-id': project.id, 'release-channel': 'Prod' });

  revisionTwo.workspaces[0].blocks[1].options.body = 'revision three';
  const revisionThree = await (await call(endpoint, 'PUT', revisionTwo)).json();
  assert.equal(revisionThree.revision, 3);
  const rcLatest = Buffer.from(await (await call('/repo/DelphiRC/latest.zip')).arrayBuffer());
  assert.equal(JSON.parse(zipEntries(rcLatest).get('workspaces.json')).revision, 3);
  const prodLatest = Buffer.from(await (await call('/repo/DelphiProd/latest.zip')).arrayBuffer());
  assert.equal(JSON.parse(zipEntries(prodLatest).get('workspaces.json')).revision, 2);

  const restoredResponse = await call(endpoint + '/versions/2/restore', 'POST', { revision: 3 });
  assert.equal(restoredResponse.status, 200);
  const restored = await restoredResponse.json();
  assert.equal(restored.revision, 4);
  assert.equal(restored.workspaces[0].blocks[1].options.body, 'revision two');
  assert.equal((await call(endpoint + '/versions/4', 'DELETE', {})).status, 409);
  assert.equal((await call(endpoint + '/versions/3', 'DELETE', {})).status, 200);
  versions = await (await call(endpoint + '/versions')).json();
  assert.deepEqual(versions.map(version => version.revision), [4, 2]);
  assert.equal((await call('/repo/DelphiRC/delphi.rev3.zip')).status, 404);
});

test('RC and Prod independently package their authentication broker URLs', async t => {
  const { call } = await fixture(t);
  const project = await (await call('/api/projects', 'POST', { name: 'Brokered' })).json();
  const endpoint = `/api/projects/${project.id}`;
  const rc = { port: 7101, host: '127.0.0.1', 'log-level': 3, 'auth-storage': 'mysql', 'credential-broker-url': 'https://rc-auth.example:3443/' };
  const prod = { port: 7100, host: '127.0.0.1', 'log-level': 2, 'auth-storage': 'mysql', 'credential-broker-url': 'https://prod-auth.example:3444' };
  assert.equal((await call(`${endpoint}/deployment-configs/RC`, 'PUT', rc)).status, 200);
  assert.equal((await call(`${endpoint}/deployment-configs/Prod`, 'PUT', prod)).status, 200);
  const configurations = await (await call(`${endpoint}/deployment-configs`)).json();
  assert.equal(configurations.RC['credential-broker-url'], 'https://rc-auth.example:3443');
  assert.equal(configurations.Prod['credential-broker-url'], 'https://prod-auth.example:3444');
  const exported = zipEntries(Buffer.from(await (await call(`${endpoint}/export`)).arrayBuffer()));
  assert.deepEqual(JSON.parse(exported.get('config.json')).auth, { provider: 'mysql', broker: { url: 'https://rc-auth.example:3443' } });
  assert.equal(exported.get('application.key').length, 32);
  assert.equal((await call(`${endpoint}/deployment-configs/RC`, 'PUT', { ...rc, 'credential-broker-url': null })).status, 400);
});

test('version cleanup deletes only old RC-only revisions and preserves production builds', async t => {
  const { call } = await fixture(t);
  let project = await (await call('/api/projects', 'POST', { name: 'Cleanup' })).json();
  const endpoint = `/api/projects/${project.id}`;
  const saveRevision = async label => {
    project.workspaces[0].blocks[1].options.body = label;
    const response = await call(endpoint, 'PUT', project);
    assert.equal(response.status, 200);
    project = await response.json();
  };
  await saveRevision('revision two');
  await saveRevision('revision three');
  assert.equal((await call(endpoint + '/versions/3/promote', 'POST', {})).status, 200);
  await saveRevision('revision four');
  await saveRevision('revision five');

  const cleanupResponse = await call(endpoint + '/versions/cleanup-rc', 'POST', { beforeRevision: 5 });
  assert.equal(cleanupResponse.status, 200);
  assert.deepEqual(await cleanupResponse.json(), { deleted: [2, 4], skippedProd: [3], skippedCurrent: [] });
  const versions = await (await call(endpoint + '/versions')).json();
  assert.deepEqual(versions.map(version => version.revision), [5, 3]);
  assert.deepEqual(versions.find(version => version.revision === 3).channels, ['RC', 'Prod']);
  assert.equal((await call('/repo/CleanupRC/cleanup.rev2.zip')).status, 404);
  assert.equal((await call('/repo/CleanupRC/cleanup.rev4.zip')).status, 404);
  assert.equal((await call('/repo/CleanupRC/cleanup.rev3.zip')).status, 200);
  assert.equal((await call('/repo/CleanupProd/cleanup.rev3.zip')).status, 200);
  assert.equal(JSON.parse(zipEntries(Buffer.from(await (await call('/repo/CleanupRC/latest.zip')).arrayBuffer())).get('workspaces.json')).revision, 5);
  assert.equal(JSON.parse(zipEntries(Buffer.from(await (await call('/repo/CleanupProd/latest.zip')).arrayBuffer())).get('workspaces.json')).revision, 3);
  assert.equal((await call(endpoint + '/versions/cleanup-rc', 'POST', { beforeRevision: '5' })).status, 400);
});

test('database credential sets stay in auth.sqlite and selected application settings resolve at runtime', async t => {
  const { call, auth, directory } = await fixture(t);
  const project = await (await call('/api/projects', 'POST', { name: 'Database app' })).json();
  const createdResponse = await call('/api/database-credentials', 'POST', { name: 'Reporting', host: 'mysql.internal', port: 3307, username: 'reporter', password: 'super-secret', database: 'reports' });
  assert.equal(createdResponse.status, 201);
  const credential = await createdResponse.json();
  const loggingResponse = await call('/api/database-credentials', 'POST', { name: 'Logging', host: 'logs.internal', port: 3308, username: 'logger', password: 'logging-secret', database: 'chronos' });
  assert.equal(loggingResponse.status, 201);
  const loggingCredential = await loggingResponse.json();
  assert.equal(Object.hasOwn(credential, 'password'), false);
  const listed = await (await call('/api/database-credentials')).json();
  assert.equal(listed.length, 2); assert.ok(listed.every(item => !Object.hasOwn(item, 'password')));
  const endpoint = `/api/projects/${project.id}`;
  const saved = await call(endpoint + '/deployment-configs/RC', 'PUT', { port: 3001, host: '127.0.0.1', 'log-level': 3, 'database-credential-set': credential.id, 'logging-database-credential-set': loggingCredential.id });
  assert.equal(saved.status, 200);
  const archive = zipEntries(Buffer.from(await (await call(endpoint + '/export')).arrayBuffer()));
  const config = JSON.parse(archive.get('config.json'));
  assert.deepEqual(config.auth, { database: path.join(directory, 'auth.sqlite') });
  assert.deepEqual(config.database, { 'credential-set': credential.id });
  assert.deepEqual(config['logging-database'], { 'credential-set': loggingCredential.id });
  assert.doesNotMatch(archive.get('config.json').toString(), /super-secret/);
  assert.doesNotMatch(archive.get('config.json').toString(), /logging-secret/);
  assert.doesNotMatch(archive.get('workspaces.json').toString(), /super-secret/);
  assert.equal((await call(`/api/database-credentials/${credential.id}`, 'DELETE', {})).status, 409);
  assert.equal((await call(`/api/database-credentials/${loggingCredential.id}`, 'DELETE', {})).status, 409);
  assert.equal(auth.databaseCredential(credential.id).password, 'super-secret');
  assert.equal(auth.databaseCredential(loggingCredential.id).password, 'logging-secret');
});

test('startup migration removes authentication database options and their incoming wires', async t => {
  const { call, directory, repositoryDirectory } = await fixture(t);
  const project = await (await call('/api/projects', 'POST', { name: 'Legacy login project' })).json();
  const workspace = project.workspaces[0];
  const authenticationTypes = ['display_login', 'check_if_logged_in', 'login_through_api', 'check_api_token', 'logout', 'get_current_logged_in_user'];
  workspace.blocks.push({ id: 'legacy-path', numberId: 3, type: 'text', x: 0, y: 0, options: { text: '/old/auth.sqlite' } });
  authenticationTypes.forEach((type, index) => {
    workspace.blocks.push({ id: `legacy-auth-${index}`, numberId: index + 4, type, x: 0, y: 0, options: { database: '/old/auth.sqlite', ...(['logout', 'get_current_logged_in_user'].includes(type) ? { sessionType: 'Browser' } : {}) } });
    workspace.connections.push({ id: `legacy-database-wire-${index}`, from: 'legacy-path', output: 'text', to: `legacy-auth-${index}`, input: 'database', kind: 'value' });
  });
  const filename = path.join(directory, project.id, 'workspaces.json');
  await fs.writeFile(filename, JSON.stringify(project, null, 2));
  await new Store(directory, repositoryDirectory).init();
  const migrated = JSON.parse(await fs.readFile(filename, 'utf8'));
  for (const type of authenticationTypes) {
    const block = migrated.workspaces[0].blocks.find(item => item.type === type);
    assert.equal(Object.hasOwn(block.options, 'database'), false);
  }
  assert.equal(migrated.workspaces[0].connections.some(connection => connection.input === 'database'), false);
});

test('HTML templates are edited through the API, included in builds, and restored with revisions', async t => {
  const { call } = await fixture(t);
  const project = await (await call('/api/projects', 'POST', { name: 'Templates' })).json();
  const endpoint = `/api/projects/${project.id}`;
  assert.deepEqual(await (await call(endpoint + '/templates')).json(), []);

  let response = await call(endpoint + '/templates/page.html', 'PUT', { contents: '<h1>%title%</h1>', previousName: null, revision: 1 });
  assert.equal(response.status, 200);
  let saved = await response.json(); assert.equal(saved.project.revision, 2);
  assert.deepEqual(await (await call(endpoint + '/templates')).json(), ['page.html']);
  assert.deepEqual(await (await call(endpoint + '/templates/page.html')).json(), { name: 'page.html', contents: '<h1>%title%</h1>', revision: 2 });
  let archive = zipEntries(Buffer.from(await (await call('/repo/TemplatesRC/latest.zip')).arrayBuffer()));
  assert.equal(archive.get('html/page.html').toString(), '<h1>%title%</h1>');

  response = await call(endpoint + '/templates/page.html', 'PUT', { contents: '<main>%content%</main>', previousName: 'page.html', revision: 2 });
  saved = await response.json(); assert.equal(saved.project.revision, 3);
  const restored = await (await call(endpoint + '/versions/2/restore', 'POST', { revision: 3 })).json();
  assert.equal(restored.revision, 4);
  assert.equal((await (await call(endpoint + '/templates/page.html')).json()).contents, '<h1>%title%</h1>');

  response = await call(endpoint + '/templates/home.html', 'PUT', { contents: '<h1>%title%</h1>', previousName: 'page.html', revision: 4 });
  saved = await response.json(); assert.equal(saved.project.revision, 5);
  assert.equal((await call(endpoint + '/templates/page.html')).status, 404);
  assert.equal((await call(endpoint + '/templates/home.html', 'PUT', { contents: 'duplicate', previousName: null, revision: 5 })).status, 409);
  response = await call(endpoint + '/templates/home.html', 'DELETE', { revision: 5 });
  assert.equal(response.status, 200); assert.equal((await response.json()).revision, 6);
  assert.deepEqual(await (await call(endpoint + '/templates')).json(), []);
  archive = zipEntries(Buffer.from(await (await call('/repo/TemplatesRC/latest.zip')).arrayBuffer()));
  assert.equal(archive.has('html/home.html'), false);
  response = await call(endpoint + '/templates/styles.css', 'PUT', { contents: 'body { color: purple; }', previousName: null, revision: 6 });
  assert.equal(response.status, 200); assert.equal((await response.json()).project.revision, 7);
  assert.deepEqual(await (await call(endpoint + '/templates')).json(), ['styles.css']);
  archive = zipEntries(Buffer.from(await (await call('/repo/TemplatesRC/latest.zip')).arrayBuffer()));
  assert.equal(archive.get('html/styles.css').toString(), 'body { color: purple; }');
  const updatedCSS = 'body { color: purple; }\n\n.dashboard { display: grid; }';
  response = await call(endpoint + '/templates/styles.css', 'PUT', { contents: updatedCSS, previousName: 'styles.css', revision: 7 });
  assert.equal(response.status, 200); assert.equal((await response.json()).project.revision, 8);
  assert.equal((await (await call(endpoint + '/templates/styles.css')).json()).contents, updatedCSS);
  archive = zipEntries(Buffer.from(await (await call('/repo/TemplatesRC/latest.zip')).arrayBuffer()));
  assert.equal(archive.get('html/styles.css').toString(), updatedCSS);

  const largerCSS = Array.from({ length: 700 }, (_, index) => `.panel-${index} { color: rgb(${index % 255} 120 180); }`).join('\n');
  response = await call(endpoint + '/templates/styles.css', 'PUT', { contents: largerCSS, previousName: 'styles.css', revision: 8 });
  assert.equal(response.status, 200);
  saved = await response.json(); assert.equal(saved.project.revision, 9); assert.equal(saved.template.contents, largerCSS);
  assert.equal((await (await call(endpoint + '/templates/styles.css')).json()).contents, largerCSS);
  archive = zipEntries(Buffer.from(await (await call('/repo/TemplatesRC/latest.zip')).arrayBuffer()));
  assert.equal(archive.get('html/styles.css').toString(), largerCSS);
});

test('password login, protected routes, CSRF, logout, malformed requests and traversal', async t => {
  const { call, rawCall, headers, base } = await fixture(t);
  assert.equal((await rawCall('/api/projects')).status, 401);
  assert.equal((await rawCall('/api/projects', 'GET', undefined, { authorization: 'Bearer old-builder-token' })).status, 401);
  const wrong = await rawCall('/api/login', 'POST', { username: 'tester', password: 'wrong' });
  const missing = await rawCall('/api/login', 'POST', { username: 'unknown', password: 'wrong' });
  assert.equal(wrong.status, 401); assert.equal(missing.status, 401); assert.deepEqual(await wrong.json(), await missing.json());
  const page = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(page.status, 303); assert.equal(page.headers.get('location'), '/login');
  const loginHTML = await (await fetch(base + '/login')).text();
  assert.match(loginHTML, /autocomplete="current-password"/); assert.match(loginHTML, /rel="icon" href="\/favicon\.ico"/);
  const builderFavicon = await fetch(base + '/favicon.ico');
  assert.equal(builderFavicon.status, 200); assert.equal(builderFavicon.headers.get('content-type'), 'image/x-icon');
  assert.deepEqual(Buffer.from(await builderFavicon.arrayBuffer()).subarray(0, 4), Buffer.from([0, 0, 1, 0]));
  assert.equal((await call('/api/projects')).status, 200);
  const editorPage = await fetch(base + '/', { headers: { cookie: headers.cookie } });
  const editorHTML = await editorPage.text();
  assert.match(editorHTML, /rel="icon" href="\/favicon\.ico"/);
  assert.doesNotMatch(editorHTML, /id="app-settings"/);
  assert.match(editorHTML, /data-deployment-channel="RC"/);
  assert.match(editorHTML, /data-deployment-channel="Prod"/);
  assert.equal((await rawCall('/api/projects', 'POST', { name: 'Denied' }, { cookie: headers.cookie })).status, 403);
  assert.equal((await call('/api/projects', 'POST', { name: 'Denied' }, { 'x-csrf-token': 'wrong' })).status, 403);
  assert.equal((await call('/api/projects', 'POST', { name: 'Denied' }, { origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await call('/api/login', 'POST', { username: 'tester', password: 'a-test-password-12345' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await call('/api/projects/%2e%2e%2fsecret')).status, 400);
  assert.equal((await fetch(base + '/api/projects', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{broken' })).status, 400);
  assert.equal((await call('/api/projects', 'POST', null)).status, 400);
  assert.equal((await call('/api/projects', 'POST', { name: 'x'.repeat(1048577) })).status, 413);
  assert.equal((await fetch(base + '/server.js')).status, 404);
  assert.equal((await fetch(base + '/data/auth.sqlite')).status, 404);
  const project = await (await call('/api/projects', 'POST', { name: 'Private' })).json();
  assert.equal((await rawCall(`/api/projects/${project.id}/export`)).status, 401);
  const logout = await call('/api/logout', 'POST', {}); assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await call('/api/projects')).status, 401);
});

test('users and groups receive additive core and per-project ACL permissions', async t => {
  const { call, rawCall } = await fixture(t);
  const administratorSession = await (await call('/api/session')).json();
  assert.equal(administratorSession.permissions.manageUsers, true);
  const project = await (await call('/api/projects', 'POST', { name: 'Restricted' })).json();
  const endpoint = `/api/projects/${project.id}`;
  assert.equal((await call('/api/access/users', 'POST', { username: 'viewer', password: 'viewer-password-123' })).status, 201);
  let model = await (await call('/api/access')).json();
  const viewer = model.users.find(user => user.username === 'viewer');
  assert.ok(viewer); assert.deepEqual(viewer.corePermissions, []);
  assert.equal((await rawCall('/api/login', 'POST', { username: 'viewer', password: 'viewer-password-123' })).status, 403);

  assert.equal((await call(`/api/access/grants/core/user/${viewer.id}`, 'PUT', { permissions: ['login'] })).status, 200);
  assert.equal((await call(`/api/access/grants/projects/${project.id}/user/${viewer.id}`, 'PUT', { permissions: ['view'] })).status, 200);
  const login = await rawCall('/api/login', 'POST', { username: 'viewer', password: 'viewer-password-123' });
  assert.equal(login.status, 200);
  const viewerSession = await login.json();
  const viewerHeaders = { cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': viewerSession.csrfToken };
  const viewerCall = (route, method = 'GET', body) => rawCall(route, method, body, viewerHeaders);
  const viewerSessionModel = await (await viewerCall('/api/session')).json();
  assert.equal(viewerSessionModel.permissions.manageUsers, false);
  assert.equal(viewerSessionModel.permissions.console, false);
  assert.equal((await viewerCall('/api/console/reset', 'POST', {})).status, 403);
  const visible = await (await viewerCall('/api/projects')).json();
  assert.deepEqual(visible.map(item => item.id), [project.id]); assert.deepEqual(visible[0].access, ['view']);
  assert.equal((await viewerCall(endpoint)).status, 200);
  assert.equal((await viewerCall(endpoint, 'PUT', project)).status, 403);
  assert.equal((await viewerCall('/api/projects', 'POST', { name: 'Denied' })).status, 403);
  assert.equal((await viewerCall('/api/access')).status, 403);

  const groupResponse = await call('/api/access/groups', 'POST', { name: 'Developers' });
  const group = await groupResponse.json();
  assert.equal((await call(`/api/access/groups/${group.id}/members`, 'PUT', { usernames: ['viewer'] })).status, 200);
  assert.equal((await call(`/api/access/grants/projects/${project.id}/group/${group.id}`, 'PUT', { permissions: ['edit'] })).status, 200);
  const editable = await (await viewerCall(endpoint)).json(); editable.workspaces[0].blocks[1].options.body = 'group edit';
  assert.equal((await viewerCall(endpoint, 'PUT', editable)).status, 200);
  assert.equal((await viewerCall(endpoint + '/versions/2/promote', 'POST', {})).status, 403);

  assert.equal((await call(`/api/access/grants/projects/${project.id}/user/${viewer.id}`, 'PUT', { permissions: ['view', 'promote', 'delete'] })).status, 200);
  assert.equal((await viewerCall(endpoint + '/versions/2/promote', 'POST', {})).status, 200);
  assert.equal((await viewerCall(endpoint, 'DELETE', {})).status, 200);
  assert.equal((await call(endpoint)).status, 404);

  assert.equal((await call(`/api/access/grants/core/user/${viewer.id}`, 'PUT', { permissions: [] })).status, 200);
  assert.equal((await viewerCall('/api/session')).status, 401);
  model = await (await call('/api/access')).json();
  assert.ok(model.groups.find(item => item.name === 'Administrators').members.includes('tester'));
});

test('editor console is permission-gated and every reset starts disabled', async t => {
  const { call } = await fixture(t);
  let response = await call('/api/console/reset', 'POST', {});
  assert.equal(response.status, 200);
  let state = await response.json();
  assert.equal(state.mode, 'disabled'); assert.equal(state.prompt, 'Console$> ');

  response = await call('/api/console/input', 'POST', { input: 'enable' });
  state = await response.json();
  assert.equal(state.mode, 'enabled'); assert.equal(state.prompt, 'Console#> ');

  response = await call('/api/console/reset', 'POST', {});
  state = await response.json();
  assert.equal(state.mode, 'disabled'); assert.equal(state.prompt, 'Console$> ');
});

test('block cache endpoint clears project helper modules and returns fresh definitions', async t => {
  const { call, store } = await fixture(t);
  const project = await (await call('/api/projects', 'POST', { name: 'Cache reload' })).json();
  const blocks = path.join(store.location(project.id), 'blocks');
  const helper = path.join(blocks, 'cache_probe_helper.cjs');
  const definition = path.join(blocks, 'cache_probe.js');
  await fs.writeFile(helper, "module.exports = 'Old block name';\n");
  await fs.writeFile(definition, "const name = require('./cache_probe_helper.cjs'); module.exports = { type: 'cache_probe', name, category: 'Test', fields: [], outputs: [] };\n");

  let library = await (await call(`/api/projects/${project.id}/blocks`)).json();
  assert.equal(library.find(block => block.type === 'cache_probe').name, 'Old block name');
  await fs.writeFile(helper, "module.exports = 'Fresh block name';\n");
  library = await (await call(`/api/projects/${project.id}/blocks`)).json();
  assert.equal(library.find(block => block.type === 'cache_probe').name, 'Old block name');

  const cleared = await (await call(`/api/projects/${project.id}/blocks/cache`, 'DELETE', {})).json();
  assert.ok(cleared.cleared > 0);
  assert.equal(cleared.definitions.find(block => block.type === 'cache_probe').name, 'Fresh block name');
});

test('validation rejects dangling wires, duplicate routes, loops, and invalid options', async t => {
  const { store } = await fixture(t), project = await store.create('Validation');
  const definitions = store.definitions(project.id);
  const reject = (modify, pattern) => { const copy = structuredClone(project); modify(copy.workspaces[0], copy); assert.throws(() => validate(copy, definitions), pattern); };
  reject(ws => { ws.connections[0].to = 'missing'; }, /Invalid connection/);
  reject(ws => { ws.blocks.push({ ...structuredClone(ws.blocks[0]), id: 'duplicate', numberId: 3 }); }, /Duplicate HTTP/);
  reject(ws => { ws.blocks[1].options.status = 999; }, /Status code/);
  reject(ws => { ws.blocks[1].type = '../server'; }, /Unknown block/);
  reject(ws => {
    ws.blocks[1] = { id: 'response', type: 'log', x: 0, y: 0, options: { message: 'cycle' } };
    ws.connections.push({ id: 'cycle', from: 'response', output: 'next', to: 'response' });
  }, /Loops/);
  reject(ws => { ws.connections.push({ ...ws.connections[0], id: 'second' }); }, /one connection/);
  reject((ws, document) => { document.workspaceCategories = [{ id: 'api', name: 'API' }]; ws.categoryId = 'missing'; }, /workspace category/);
  reject((ws, document) => { document.workspaceCategories = [{ id: 'api', name: 'API' }, { id: 'api', name: 'Duplicate' }]; }, /duplicate workspace category/);
  reject(ws => { ws.blocks[1].numberId = ws.blocks[0].numberId; }, /duplicate block number ID/);
  reject(ws => { ws.blocks[1].width = 100; }, /Invalid block width/);
  reject(ws => { ws.blocks[1].height = 100; }, /Invalid block height/);
  reject((ws, document) => { const duplicate = structuredClone(ws); duplicate.id = 'other'; document.workspaces.push(duplicate); }, /duplicate workspace number ID/);
  const legacy = structuredClone(project);
  delete legacy.workspaces[0].numberId;
  legacy.workspaces[0].blocks.forEach(block => delete block.numberId);
  assert.doesNotThrow(() => validate(legacy, definitions));
  assert.equal(legacy.workspaces[0].numberId, 1); assert.deepEqual(legacy.workspaces[0].blocks.map(block => block.numberId), [1, 2]);
  const enormous = structuredClone(project); enormous.workspaces[0].blocks[1].width = 100000; enormous.workspaces[0].blocks[1].height = 100000; assert.doesNotThrow(() => validate(enormous, definitions));
  const paused = structuredClone(project.workspaces[0]); paused.id = 'paused'; paused.numberId = 2; paused.active = false; project.workspaces.push(paused); assert.doesNotThrow(() => validate(project, definitions));
  await assert.rejects(store.saveDeploymentConfig(project.id, 'RC', { port: 70000, host: '127.0.0.1' }), /Application port/);
  await assert.rejects(store.saveDeploymentConfig(project.id, 'Prod', { port: 3001, host: 'localhost', 'log-level': 3 }), /Application host/);
  await assert.rejects(store.saveDeploymentConfig(project.id, 'RC', { port: 3001, host: '127.0.0.1', 'log-level': 5 }), /Application log level/);
  await assert.rejects(store.saveDeploymentConfig(project.id, 'RC', { port: 3001, host: '127.0.0.1', 'force-console-input-log': 'yes' }), /true or false/);
  await assert.rejects(store.saveDeploymentConfig(project.id, 'RC', { port: 3001, host: '127.0.0.1', 'update-url': 'ftp://updates.example/latest.zip' }), /HTTP or HTTPS/);
});

test('runtime logs the workspace and block numeric IDs for workflow errors', async t => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  definitions.set('failing_request', {
    type: 'failing_request', name: 'Request API', category: 'Actions', description: 'Test failure', fields: [], outputs: [],
    async execute() { throw new Error('upstream unavailable'); }
  });
  const document = { version: 1, name: 'Errors', workspaces: [{
    id: 'main', numberId: 1, name: 'MyWorkspace', active: true,
    blocks: [
      { id: 'endpoint', numberId: 1, type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/fail' } },
      { id: 'request', numberId: 14, type: 'failing_request', x: 0, y: 0, options: {} }
    ],
    connections: [{ id: 'next', from: 'endpoint', output: 'next', to: 'request', input: 'action', kind: 'action' }]
  }] };
  const messages = [];
  const logger = {
    error: (...values) => messages.push(require('node:util').format(...values)),
    warning() {}, debug() {}
  };
  const app = createApp({ document, definitions, logger });
  const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const response = await fetch(`http://127.0.0.1:${address.port}/fail`);
  assert.equal(response.status, 500); assert.equal(await response.text(), 'Workflow failed');
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Block triggered error \(Workspace #1: MyWorkspace > Block #14: Request API\):/);
  assert.match(messages[0], /upstream unavailable/);
});

test('runtime HTTP payloads, variables, conditions, outbound requests and failures', async t => {
  const { store } = await fixture(t), project = await store.create('Runtime');
  const workspace = project.workspaces[0];
  workspace.blocks = [
    { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'POST', path: '/echo' } },
    { id: 'set', type: 'set', x: 0, y: 0, options: { name: 'payload', value: '{{request.body}}' } },
    { id: 'if', type: 'condition', x: 0, y: 0, options: { left: '{{vars.payload.name}}', operator: 'equals', right: 'Sentinel' } },
    { id: 'yes', type: 'respond', x: 0, y: 0, options: { status: 201, body: '{{vars.payload}}' } },
    { id: 'no', type: 'respond', x: 0, y: 0, options: { status: 400, body: 'Incorrect name' } }
  ];
  workspace.connections = [
    { id: 'a', from: 'http', output: 'next', to: 'set' }, { id: 'b', from: 'set', output: 'next', to: 'if' },
    { id: 'c', from: 'if', output: 'true', to: 'yes' }, { id: 'd', from: 'if', output: 'false', to: 'no' }
  ];
  const errors = [], app = createApp({ document: project, definitions: store.definitions(project.id), onError: err => errors.push(err) });
  const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(base + '/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sentinel' }) });
  assert.equal(response.status, 201); assert.deepEqual(await response.json(), { name: 'Sentinel' });
  assert.equal((await fetch(base + '/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
  assert.equal((await fetch(base + '/unknown')).status, 404);
  assert.equal((await fetch(base + '/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' })).status, 400);
  const requestBlock = require('../blocks/api_call');
  const ctx = { vars: {}, render: value => value, signal: new AbortController().signal };
  assert.equal(await requestBlock.execute(ctx, { method: 'POST', url: base + '/echo', body: '{"name":"Sentinel"}', headers: '{}', variable: 'result' }), 'next');
  assert.equal(ctx.vars.result.status, 201);
  assert.deepEqual(ctx.vars.result.body, { name: 'Sentinel' });
  assert.match(ctx.vars.result.headers['content-type'], /^application\/json/);
  let receivedAPIKey = '', receivedContentType = '', receivedBody = '';
  const upstream = require('node:http').createServer(async (request, response) => {
    receivedAPIKey = request.headers['x-api-key'];
    receivedContentType = request.headers['content-type'] || '';
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    receivedBody = Buffer.concat(chunks).toString();
    response.setHeader('x-upstream-header', 'available');
    response.end('upstream response');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { upstream.close(resolve); upstream.closeAllConnections(); }));
  const outputValues = {};
  const upstreamURL = 'http://127.0.0.1:' + upstream.address().port;
  assert.equal(await requestBlock.execute(ctx, { method: 'GET', url: upstreamURL, body: '', headers: '{"x-api-key":"configured"}', variable: 'upstream' }, {}, (id, value) => { outputValues[id] = value; }), 'next');
  assert.equal(receivedAPIKey, 'configured');
  assert.equal(ctx.vars.upstream.headers['x-upstream-header'], 'available');
  assert.equal(outputValues.headers['x-upstream-header'], 'available');
  assert.equal(await requestBlock.execute(ctx, { method: 'POST', format: 'HTML', url: upstreamURL, body: '<main>Hello</main>', headers: '{}', variable: 'html' }), 'next');
  assert.equal(receivedContentType, 'text/html; charset=utf-8');
  assert.equal(receivedBody, '<main>Hello</main>');
  assert.equal(errors.length, 1);
});

test('HTTP endpoints match sub-paths and expose the unmatched sub-endpoint', async t => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const document = { version: 1, name: 'Sub-endpoints', workspaces: [{
    id: 'main', name: 'Main', active: true,
    blocks: [
      { id: 'systems', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/systems' } },
      { id: 'subpath', type: 'get_sub_endpoint_by_name', x: 0, y: 0, options: {} },
      { id: 'response', type: 'respond', x: 0, y: 0, options: { status: 200, body: 'fallback', headers: '{}' } },
      { id: 'exact', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/systems/exact' } },
      { id: 'exact-response', type: 'respond', x: 0, y: 0, options: { status: 200, body: 'exact endpoint', headers: '{}' } }
    ],
    connections: [
      { id: 'a', from: 'systems', output: 'next', to: 'subpath', input: 'action', kind: 'action' },
      { id: 'b', from: 'subpath', output: 'next', to: 'response', input: 'action', kind: 'action' },
      { id: 'c', from: 'subpath', output: 'sub_endpoint', to: 'response', input: 'body', kind: 'value' },
      { id: 'd', from: 'exact', output: 'next', to: 'exact-response', input: 'action', kind: 'action' }
    ]
  }] };
  const app = createApp({ document, definitions });
  const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;
  for (const [requestPath, expected] of [['/systems', '/'], ['/systems/vhins', '/vhins'], ['/systems/vhins/status?full=true', '/vhins/status']]) {
    const response = await fetch(base + requestPath);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), expected);
  }
  const exact = await fetch(base + '/systems/exact');
  assert.equal(exact.status, 200);
  assert.equal(await exact.text(), 'exact endpoint');
  assert.equal((await fetch(base + '/systematic')).status, 404);
});

test('HTTP endpoint body output connects to HTTP response body input', async t => {
  const { store } = await fixture(t), project = await store.create('HTTP body ports');
  const workspace = project.workspaces[0];
  workspace.blocks = [
    { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'POST', path: '/body' } },
    { id: 'response', type: 'respond', x: 0, y: 0, options: { status: 200, body: 'fallback', headers: '{"x-response-header":"present"}' } },
    { id: 'headers-http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/headers' } },
    { id: 'headers-response', type: 'respond', x: 0, y: 0, options: { status: 200, body: 'fallback', headers: '{}' } },
    { id: 'html-http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/html' } },
    { id: 'html-response', type: 'respond', x: 0, y: 0, options: { status: 200, format: 'HTML', body: '<main>Hello from HTML</main>', headers: '{}' } }
  ];
  workspace.connections = [
    { id: 'action', from: 'http', output: 'next', to: 'response', input: 'action', kind: 'action' },
    { id: 'body', from: 'http', output: 'body', to: 'response', input: 'body', kind: 'value' },
    { id: 'headers-action', from: 'headers-http', output: 'next', to: 'headers-response', input: 'action', kind: 'action' },
    { id: 'headers-value', from: 'headers-http', output: 'headers', to: 'headers-response', input: 'body', kind: 'value' },
    { id: 'html-action', from: 'html-http', output: 'next', to: 'html-response', input: 'action', kind: 'action' }
  ];
  const definitions = store.definitions(project.id);
  assert.ok(definitions.get('http').outputPorts.find(port => port.id === 'body').types.includes('text'));
  const replyFormat = definitions.get('respond').fields.find(field => field.key === 'format');
  const callFormat = definitions.get('request').fields.find(field => field.key === 'format');
  assert.equal(replyFormat.default, 'JSON'); assert.ok(replyFormat.choices.includes('HTML'));
  assert.equal(callFormat.default, 'JSON'); assert.ok(callFormat.choices.includes('HTML'));
  const responseBodyTypes = definitions.get('respond').inputPorts.find(port => port.id === 'body').types;
  assert.ok(responseBodyTypes.includes('list'));
  assert.ok(responseBodyTypes.includes('object'));
  const mergeLists = definitions.get('merge_lists');
  assert.doesNotThrow(() => validate({
    version: 1, name: 'HTTP list compatibility', workspaces: [{ id: 'main', name: 'Main', active: false,
      blocks: [
        { id: 'lists', type: 'merge_lists', x: 0, y: 0, options: Object.fromEntries(mergeLists.fields.map(field => [field.key, field.default])) },
        { id: 'response', type: 'respond', x: 0, y: 0, options: { status: 200, body: 'fallback', headers: '{"x-response-header":"present"}' } }
      ],
      connections: [{ id: 'body', from: 'lists', output: 'list', to: 'response', input: 'body', kind: 'value' }]
    }]
  }, definitions));
  const merge = definitions.get('merge_texts');
  const textInputDocument = {
    version: 1, name: 'HTTP text compatibility', workspaces: [{ id: 'main', name: 'Main', active: true,
      blocks: [
        { id: 'http', type: 'http', x: 0, y: 0, options: { method: 'POST', path: '/text' } },
        { id: 'merge', type: 'merge_texts', x: 0, y: 0, options: Object.fromEntries(merge.fields.map(field => [field.key, field.default])) }
      ],
      connections: [{ id: 'body', from: 'http', output: 'body', to: 'merge', input: 'text1', kind: 'value' }]
    }]
  };
  assert.doesNotThrow(() => validate(textInputDocument, definitions));
  const app = createApp({ document: project, definitions });
  const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}/body`;
  const text = await fetch(base, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'plain text' });
  assert.equal(text.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(text.headers.get('x-response-header'), 'present');
  assert.equal(await text.text(), 'plain text');
  const json = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true }) });
  assert.equal(json.headers.get('content-type'), 'application/json; charset=utf-8');

  assert.deepEqual(await json.json(), { ok: true });
  const reflectedHeaders = await fetch(base.replace('/body', '/headers'), { headers: { 'x-client-header': 'received' } });
  assert.equal(reflectedHeaders.status, 200);
  assert.equal((await reflectedHeaders.json())['x-client-header'], 'received');
  const html = await fetch(base.replace('/body', '/html'));
  assert.equal(html.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await html.text(), '<main>Hello from HTML</main>');
});

test('JSON-to-HTML table block converts objects and connects to file content', async () => {
  const block = require('../blocks/convert_json_to_html_table');
  const html = block.convertJSONToHTMLTable(JSON.stringify([
    { Name: 'Alice', Access: '<admin>', Details: { active: true } },
    { Name: 'Bob', Age: 42 }
  ]));
  assert.match(html, /^<table>/);
  assert.match(html, /<th>Name<\/th><th>Access<\/th><th>Details<\/th><th>Age<\/th>/);
  assert.match(html, /<td>&lt;admin&gt;<\/td>/);
  assert.equal((html.match(/<table>/g) || []).length, 2);
  assert.match(html, /<th>active<\/th>/);
  assert.match(html, /<td>true<\/td>/);
  assert.match(html, /<td>Bob<\/td><td><\/td><td><\/td><td>42<\/td>/);
  assert.equal(block.convertJSONToHTMLTable([]), '<table>\n  <tbody></tbody>\n</table>');
  const layered = block.convertJSONToHTMLTable({
    System: 'vhins',
    Services: [{ Name: 'API', Ports: [3001, 3002] }, { Name: '<Admin>' }]
  });
  assert.equal((layered.match(/<table>/g) || []).length, 3);
  assert.match(layered, /<th>Services<\/th>/);
  assert.match(layered, /<th>Name<\/th><th>Ports<\/th>/);
  assert.match(layered, /<th>Value<\/th>/);
  assert.match(layered, /<td>&lt;Admin&gt;<\/td>/);
  assert.throws(() => block.convertJSONToHTMLTable('{broken'), /valid JSON text/);
  const circular = {}; circular.self = circular;
  assert.throws(() => block.convertJSONToHTMLTable(circular), /circular objects/);
  const outputs = {};
  assert.equal(await block.execute({}, {}, { json: { Key: 'Value' } }, (id, value) => { outputs[id] = value; }), 'next');
  assert.match(outputs.html, /<th>Key<\/th>/);
  assert.match(outputs.html, /<td>Value<\/td>/);

  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  const write = definitions.get('write_file');
  assert.doesNotThrow(() => validate({ version: 1, name: 'HTML file', workspaces: [{
    id: 'main', name: 'Main', active: false,
    blocks: [
      { id: 'table', type: 'convert_json_to_html_table', x: 0, y: 0, options: {} },
      { id: 'file', type: 'write_file', x: 0, y: 0, options: Object.fromEntries(write.fields.map(field => [field.key, field.default])) }
    ],
    connections: [{ id: 'html-file', from: 'table', output: 'html', to: 'file', input: 'content', kind: 'value' }]
  }] }, definitions));
});

test('Linux commands run as the automation user and expose success and error output', async t => {
  const { store } = await fixture(t), project = await store.create('Linux commands');
  const workspace = project.workspaces[0];
  workspace.blocks = [
    { id: 'success-http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/success' } },
    { id: 'success-command', type: 'linux_command', x: 0, y: 0, options: { command: 'id -u', directory: '', timeout: 5 } },
    { id: 'success-response', type: 'respond', x: 0, y: 0, options: { status: 200, body: 'missing output' } },
    { id: 'error-http', type: 'http', x: 0, y: 0, options: { method: 'GET', path: '/error' } },
    { id: 'error-command', type: 'linux_command', x: 0, y: 0, options: { command: 'printf failure >&2; exit 7', directory: '', timeout: 5 } },
    { id: 'error-response', type: 'respond', x: 0, y: 0, options: { status: 500, body: 'missing error' } }
  ];
  workspace.connections = [
    { id: 's1', from: 'success-http', output: 'next', to: 'success-command', input: 'action', kind: 'action' },
    { id: 's2', from: 'success-command', output: 'success', to: 'success-response', input: 'action', kind: 'action' },
    { id: 's3', from: 'success-command', output: 'stdout', to: 'success-response', input: 'body', kind: 'value' },
    { id: 'e1', from: 'error-http', output: 'next', to: 'error-command', input: 'action', kind: 'action' },
    { id: 'e2', from: 'error-command', output: 'error', to: 'error-response', input: 'action', kind: 'action' },
    { id: 'e3', from: 'error-command', output: 'stderr', to: 'error-response', input: 'body', kind: 'value' }
  ];
  const definitions = store.definitions(project.id);
  const app = createApp({ document: project, definitions });
  const address = await app.start(0, '127.0.0.1'); t.after(() => app.stop());
  const base = `http://127.0.0.1:${address.port}`;
  const success = await fetch(base + '/success');
  assert.equal(success.status, 200);
  assert.equal((await success.text()).trim(), String(process.getuid()));
  const failure = await fetch(base + '/error');
  assert.equal(failure.status, 500);
  assert.equal(await failure.text(), 'failure');
  const direct = await require('../blocks/linux_command').runCommand('exit 7', '', 5, new AbortController().signal);
  assert.equal(direct.exitCode, 7);
  assert.equal(direct.failed, true);
});

test('Stop App and Restart App request graceful runtime control', async t => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks'));
  for (const [type, expected] of [['stop_app', 'stop'], ['restart_app', 'restart']]) {
    const document = { version: 1, name: 'Runtime control', workspaces: [{ id: 'main', name: 'Main', active: true, blocks: [
      { id: 'endpoint', type: 'http', x: 0, y: 0, options: { method: 'POST', path: '/control' } },
      { id: 'control', type, x: 0, y: 0, options: {} }
    ], connections: [{ id: 'run-control', from: 'endpoint', output: 'next', to: 'control', input: 'action', kind: 'action' }] }] };
    let resolveControl;
    const controlled = new Promise(resolve => { resolveControl = resolve; });
    const app = createApp({ document, definitions: loadDefinitions(path.resolve(__dirname, '../blocks')), onControl: resolveControl });
    const address = await app.start(0, '127.0.0.1');
    const response = await fetch(`http://127.0.0.1:${address.port}/control`, { method: 'POST' });
    assert.equal(response.status, 204); assert.equal(await controlled, expected);
    await app.stop();
  }
  assert.equal(definitions.get('stop_app').category, 'System');
  assert.equal(definitions.get('restart_app').category, 'System');
});

test('Update Application follows the configured release channel and command sequence', async () => {
  const block = require('../blocks/update_app');
  const commands = [], lines = [];
  const ctx = {
    directory: '/srv/delphi',
    deployment: { channel: 'RC', updateUrl: 'https://builder.example/repo/DelphiRC/latest.zip' },
    signal: new AbortController().signal,
    logger: { forceInfo(_format, message) { lines.push(message); } }
  };
  const output = await block.performUpdate(ctx, async (executable, args, display) => {
    commands.push({ executable, args, display });
    return { failed: false, exitCode: 0, output: '' };
  });
  assert.deepEqual(commands, [
    { executable: 'rm', args: ['-f', 'current.zip'], display: 'rm current.zip' },
    { executable: 'wget', args: ['-O', 'latest.zip', ctx.deployment.updateUrl], display: `wget ${ctx.deployment.updateUrl}` },
    { executable: 'unzip', args: ['-o', 'latest.zip'], display: 'unzip -o latest.zip' }
  ]);
  assert.deepEqual(lines, [
    '[SYSTEM] Updating to latest RC revision...',
    '[UpdateManager] Deleting current zip',
    '[UpdateManager] Downloading latest version',
    '[UpdateManager] Unzipping latest.zip',
    '[UpdateManager] Update completed',
    '[SYSTEM] New version installed. Please restart the Node server to apply the update.'
  ]);
  assert.match(output, /latest RC revision/);
  await assert.rejects(block.performUpdate({ ...ctx, deployment: { channel: 'Prod', updateUrl: null } }, async () => {}), /No update URL.*Prod/);
});

test('startup and interval triggers, disabled workspaces, clean shutdown', async t => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks')); let runs = 0;
  definitions.set('count', { type: 'count', fields: [], outputs: [], execute: async () => { runs++; } });
  const workspace = { id: 'main', name: 'Main', active: true, blocks: [
    { id: 'start', type: 'startup', x: 0, y: 0, options: {} },
    { id: 'interval', type: 'interval', x: 0, y: 0, options: { seconds: 1 } },
    { id: 'counter', type: 'count', x: 0, y: 0, options: {} }
  ], connections: [{ id: 'a', from: 'start', output: 'next', to: 'counter' }, { id: 'b', from: 'interval', output: 'next', to: 'counter' }] };
  const document = { version: 1, name: 'Timers', workspaces: [workspace, { ...structuredClone(workspace), id: 'off', active: false }] };
  const app = createApp({ document, definitions }); t.after(() => app.stop()); await app.start(0, '127.0.0.1'); assert.equal(runs, 1);
  await new Promise(resolve => setTimeout(resolve, 1150)); assert.equal(runs, 2); await app.stop();
  await new Promise(resolve => setTimeout(resolve, 1050)); assert.equal(runs, 2);
});

test('cron triggers follow five-field local schedules and reject invalid expressions', async t => {
  const definitions = loadDefinitions(path.resolve(__dirname, '../blocks')); let runs = 0;
  definitions.set('count', { type: 'count', fields: [], outputs: [], execute: async () => { runs++; } });
  let now = new Date(2026, 0, 15, 12, 34, 0);
  const workspace = { id: 'main', name: 'Main', active: true, blocks: [
    { id: 'cron', type: 'cron', x: 0, y: 0, options: { expression: '* * * * *' } },
    { id: 'counter', type: 'count', x: 0, y: 0, options: {} }
  ], connections: [{ id: 'a', from: 'cron', output: 'next', to: 'counter' }] };
  const document = { version: 1, name: 'Cron', workspaces: [workspace] };
  const app = createApp({ document, definitions, clock: () => now }); t.after(() => app.stop()); await app.start(0, '127.0.0.1');
  await new Promise(resolve => setTimeout(resolve, 1100)); assert.equal(runs, 1);
  now = new Date(now.getTime() + 60000); await new Promise(resolve => setTimeout(resolve, 1100)); assert.equal(runs, 2);
  const invalid = structuredClone(document); invalid.workspaces[0].blocks[0].options.expression = 'not cron';
  assert.throws(() => validate(invalid, definitions), /Cron expression/);
  await app.stop();
});

test('generated app config is created once, validated, and preserved', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-app-config-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  assert.deepEqual(loadAppConfig(directory), { port: 3001, host: '0.0.0.0', 'log-level': 3, 'force-console-input-log': false, auth: { database: 'data/auth.sqlite' } });
  const filename = path.join(directory, 'config.json');
  const configured = JSON.stringify({ port: 4321, host: '127.0.0.1' }, null, 2) + '\n';
  await fs.writeFile(filename, configured);
  assert.deepEqual(loadAppConfig(directory), { port: 4321, host: '127.0.0.1', 'log-level': 3, 'force-console-input-log': false, auth: { database: 'data/auth.sqlite' } });
  assert.equal(await fs.readFile(filename, 'utf8'), configured);
  await fs.writeFile(filename, '{broken');
  assert.throws(() => loadAppConfig(directory), /Invalid config.json/);
  await fs.writeFile(filename, JSON.stringify({ port: 4321, host: '127.0.0.1', 'force-console-input-log': 'yes' }));
  assert.throws(() => loadAppConfig(directory), /force-console-input-log/);
  await fs.writeFile(filename, JSON.stringify({ port: 4321, host: '127.0.0.1', database: { 'credential-set': 'bad', 'auth-database': '/tmp/auth.sqlite' } }));
  assert.throws(() => loadAppConfig(directory), /database/);
  await fs.writeFile(filename, JSON.stringify({ port: 4321, host: '127.0.0.1', 'logging-database': { 'credential-set': 'bad' } }));
  assert.throws(() => loadAppConfig(directory), /logging-database/);
});

test('templates preserve objects and do not traverse prototypes or evaluate code', () => {
  const context = { vars: { value: { a: 1 }, text: 'hello' } };
  assert.deepEqual(render('{{vars.value}}', context), { a: 1 });
  assert.equal(render('Value: {{vars.value}}', context), 'Value: {"a":1}');
  assert.equal(render('{{vars.constructor}}', context), '');
  assert.equal(render('{{process.exit()}}', context), '');
});

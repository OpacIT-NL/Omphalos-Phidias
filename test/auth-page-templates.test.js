'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { renderAuthPage } = require('../blocks/auth_page.cjs');

test('authentication pages render editable project templates and escape submitted values', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-auth-pages-'));
  const htmlDirectory = path.join(directory, 'html');
  await fs.mkdir(htmlDirectory);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await fs.writeFile(path.join(htmlDirectory, 'login.html'), '<main>%app_name%|%action%|%error%|%username%</main><style>%login_css%</style>');
  await fs.writeFile(path.join(htmlDirectory, 'register.html'), '<main>%app_name%|%action%|%error%|%username%|%email%</main><style>%login_css%</style>');
  await fs.writeFile(path.join(htmlDirectory, 'login.css'), '.custom-auth { color: purple; }');

  const login = await renderAuthPage(directory, 'login', {
    appName: 'A & B', action: '/login?next="home"', error: '<invalid>', username: '"alice"'
  });
  assert.equal(login, '<main>A &amp; B|/login?next=&quot;home&quot;|&lt;invalid&gt;|&quot;alice&quot;</main><style>.custom-auth { color: purple; }</style>');
  assert.doesNotMatch(login, /remember_me/);

  await fs.writeFile(path.join(htmlDirectory, 'login.html'), '<form><input name="username"><button type="submit">Sign in</button></form><style>%login_css%</style>');
  const localLogin = await renderAuthPage(directory, 'login', { localLogin: true, remember: true });
  assert.match(localLogin, /name="remember_me"[^>]+checked/);
  assert.ok(localLogin.indexOf('name="remember_me"') < localLogin.indexOf('<button'));

  await fs.writeFile(path.join(htmlDirectory, 'login.css'), '.custom-auth { color: green; }');
  const registration = await renderAuthPage(directory, 'register', {
    appName: 'Application', action: '/register', error: '', username: 'alice', email: 'a+b@example.test'
  });
  assert.match(registration, /alice\|a\+b@example\.test/);
  assert.match(registration, /color: green/);
  assert.doesNotMatch(registration, /color: purple/);
});

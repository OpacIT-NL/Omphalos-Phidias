'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const templateNames = Object.freeze({ login: 'login.html', register: 'register.html' });

async function renderAuthPage(directory, kind, values = {}) {
  const templateName = templateNames[kind];
  if (!templateName) throw new Error(`Unknown authentication page: ${kind}`);
  const htmlDirectory = path.join(directory, 'html');
  let template;
  let css;
  try {
    [template, css] = await Promise.all([
      fs.readFile(path.join(htmlDirectory, templateName), 'utf8'),
      fs.readFile(path.join(htmlDirectory, 'login.css'), 'utf8')
    ]);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Authentication template not found in the html folder: ${path.basename(error.path || templateName)}`);
    throw error;
  }
  const replacements = {
    app_name: escapeHTML(values.appName),
    action: escapeHTML(values.action),
    error: escapeHTML(values.error),
    username: escapeHTML(values.username),
    email: escapeHTML(values.email),
    login_css: css
  };
  return template.replace(/%(app_name|action|error|username|email|login_css)%/g, (_match, key) => replacements[key]);
}

async function sendAuthPage(ctx, kind, status, values = {}) {
  const html = await renderAuthPage(ctx.directory || process.cwd(), kind, {
    appName: ctx.appName || 'Application', action: ctx.request.path, ...values
  });
  ctx.response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  ctx.response.end(html);
}

module.exports = { escapeHTML, renderAuthPage, sendAuthPage };

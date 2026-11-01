'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const templateNames = Object.freeze({ login: 'login.html', register: 'register.html', changePassword: 'change-password.html' });

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
  const localLoginOptions = kind === 'login' && values.localLogin
    ? `<label class="auth-consent auth-remember"><input name="remember_me" type="checkbox" value="yes"${values.remember ? ' checked' : ''}> <span>Remember me</span></label>`
    : '';
  const hasLocalLoginPlaceholder = template.includes('%local_login_options%');
  const replacements = {
    app_name: escapeHTML(values.appName),
    action: escapeHTML(values.action),
    error: escapeHTML(values.error),
    username: escapeHTML(values.username),
    email: escapeHTML(values.email),
    login_css: css,
    logo: '/logo.png',
    local_login_options: localLoginOptions
  };
  let html = template.replace(/%(app_name|action|error|username|email|login_css|logo|local_login_options)%/g, (_match, key) => replacements[key]);
  if (localLoginOptions && !hasLocalLoginPlaceholder) {
    const submitButton = /<button\b[^>]*type=["']submit["'][^>]*>/i;
    html = submitButton.test(html) ? html.replace(submitButton, `${localLoginOptions}\n      $&`) : html.replace(/<\/form>/i, `${localLoginOptions}\n    </form>`);
  }
  return html;
}

async function sendAuthPage(ctx, kind, status, values = {}) {
  const html = await renderAuthPage(ctx.directory || process.cwd(), kind, {
    appName: ctx.appName || 'Application', action: ctx.request.path, ...values
  });
  ctx.response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin', 'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  ctx.response.end(html);
}

module.exports = { escapeHTML, renderAuthPage, sendAuthPage };

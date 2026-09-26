'use strict';
const form = document.querySelector('#login-form');
const password = document.querySelector('#password');
const toggle = document.querySelector('#toggle-password');
const submit = document.querySelector('#sign-in');
const error = document.querySelector('#login-error');
toggle.addEventListener('click', () => {
  const show = password.type === 'password';
  password.type = show ? 'text' : 'password';
  toggle.textContent = show ? 'Hide' : 'Show';
  toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  toggle.setAttribute('aria-pressed', String(show));
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled) return;
  error.textContent = ''; submit.disabled = true; submit.textContent = 'Signing in…';
  try {
    const response = await fetch('/api/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: document.querySelector('#username').value.trim(), password: password.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to sign in. Please try again.');
    password.value = '';
    window.location.replace('/');
  } catch (err) {
    error.textContent = err instanceof TypeError ? 'Cannot reach the server. Please try again.' : err.message;
  } finally { submit.disabled = false; submit.textContent = 'Sign in'; }
});

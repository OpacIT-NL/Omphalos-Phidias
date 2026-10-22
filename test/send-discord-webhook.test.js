'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const block = require('../blocks/send_discord_webhook');

const discordURL = 'https://discord.com/api/webhooks/123456789/secret-token';

function context() {
  return {
    signal: new AbortController().signal,
    secretValues: new Set(),
    revealSecret: value => value?.secret ?? value,
    request: { headers: { host: 'internal:3001', 'x-forwarded-host': 'pluralpage.example', 'x-forwarded-proto': 'https' }, socket: {} }
  };
}

test('Send Discord Webhook sends a bounded JSON message and disables mentions by default', async t => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ id: 'message-1', content: 'Hello @everyone' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { global.fetch = originalFetch; });
  const ctx = context(), outputs = {};
  const result = await block.execute(ctx, { allow_mentions: 'No' }, {
    webhook_url: { secret: discordURL },
    message: 'Hello @everyone',
    username: 'PluralPage'
  }, (name, value) => { outputs[name] = value; });

  assert.equal(result, 'success');
  assert.equal(new URL(request.url).searchParams.get('wait'), 'true');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(request.options.body), {
    content: 'Hello @everyone',
    allowed_mentions: { parse: [] },
    username: 'PluralPage',
    avatar_url: 'https://pluralpage.example/logo.png'
  });
  assert.equal(outputs.http_status, 200);
  assert.deepEqual(outputs.response, { id: 'message-1', content: 'Hello @everyone' });
  assert.equal(outputs.error_message, '');
  assert.deepEqual([...ctx.secretValues], [discordURL]);
});

test('Send Discord Webhook exposes Discord errors without leaking the webhook URL', async t => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ message: 'The resource is being rate limited.' }), { status: 429 });
  t.after(() => { global.fetch = originalFetch; });
  const outputs = {};
  const result = await block.execute(context(), { allow_mentions: 'Yes' }, {
    webhook_url: discordURL,
    message: 'Hello'
  }, (name, value) => { outputs[name] = value; });
  assert.equal(result, 'error');
  assert.equal(outputs.http_status, 429);
  assert.deepEqual(outputs.response, { message: 'The resource is being rate limited.' });
  assert.match(outputs.error_message, /HTTP 429.*rate limited/);
  assert.doesNotMatch(outputs.error_message, /secret-token/);
});

test('Send Discord Webhook validates Discord URLs and Discord field limits before sending', async t => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return new Response(null, { status: 204 }); };
  t.after(() => { global.fetch = originalFetch; });
  for (const [inputs, error] of [
    [{ webhook_url: 'https://example.test/api/webhooks/1/token', message: 'Hello' }, /official Discord/],
    [{ webhook_url: 'https://discord.com/not-a-webhook', message: 'Hello' }, /webhook endpoint/],
    [{ webhook_url: discordURL, message: '' }, /Message is required/],
    [{ webhook_url: discordURL, message: 'x'.repeat(2001) }, /2000 characters/],
    [{ webhook_url: discordURL, message: 'Hello', username: 'x'.repeat(81) }, /80 characters/]
  ]) {
    const outputs = {};
    assert.equal(await block.execute(context(), {}, inputs, (name, value) => { outputs[name] = value; }), 'error');
    assert.match(outputs.error_message, error);
    assert.equal(outputs.http_status, 0);
  }
  assert.equal(calls, 0);
});

test('Send Discord Webhook omits the icon when no public request origin is available', async t => {
  const originalFetch = global.fetch;
  let payload;
  global.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ id: 'message-2' }), { status: 200 });
  };
  t.after(() => { global.fetch = originalFetch; });
  const ctx = context();
  delete ctx.request;
  assert.equal(await block.execute(ctx, {}, { webhook_url: discordURL, message: 'Scheduled message' }, () => {}), 'success');
  assert.equal(Object.hasOwn(payload, 'avatar_url'), false);
});

'use strict';

const DISCORD_HOSTS = new Set([
  'discord.com',
  'canary.discord.com',
  'ptb.discord.com',
  'discordapp.com',
  'canary.discordapp.com',
  'ptb.discordapp.com'
]);

function webhookURL(value) {
  let url;
  try { url = new URL(String(value ?? '').trim()); }
  catch { throw new Error('Discord Webhook URL is invalid'); }
  if (url.protocol !== 'https:' || !DISCORD_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('Discord Webhook URL must use an official Discord HTTPS host');
  }
  if (!/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[^/]+\/?$/.test(url.pathname)) {
    throw new Error('Discord Webhook URL must be a Discord API webhook endpoint');
  }
  url.searchParams.set('wait', 'true');
  return url.toString();
}

function applicationIconURL(request) {
  const headers = request?.headers;
  if (!headers) return '';
  const first = value => String(value || '').split(',')[0].trim();
  const host = first(headers['x-forwarded-host'] || headers.host);
  if (!host || /[\r\n]/.test(host)) return '';
  const forwardedProtocol = first(headers['x-forwarded-proto']).toLowerCase();
  const protocol = forwardedProtocol === 'https' ? 'https:' : forwardedProtocol === 'http' ? 'http:' : request.socket?.encrypted ? 'https:' : 'http:';
  try { return new URL('/logo.png', `${protocol}//${host}`).toString(); }
  catch { return ''; }
}

async function responseBody(response, limit = 1048576) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > limit) throw new Error('Discord response exceeds 1 MB');
    chunks.push(Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

module.exports = {
  type: 'send_discord_webhook',
  name: 'Send Discord Webhook',
  category: 'Internet Stuff',
  description: 'Sends a message to a Discord webhook and uses the application icon as its avatar. Mentions are disabled by default.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'webhook_url', name: 'Webhook URL', kind: 'value', types: ['text', 'secret'], required: true },
    { id: 'message', name: 'Message', kind: 'value', types: ['text'], required: true },
    { id: 'username', name: 'Username', kind: 'value', types: ['text'] }
  ],
  fields: [
    { key: 'allow_mentions', label: 'Allow @mentions', type: 'select', choices: ['No', 'Yes'], default: 'No' }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Sent', kind: 'action', types: [] },
    { id: 'error', name: 'Action (Error)', kind: 'action', types: [] },
    { id: 'http_status', name: 'HTTP Status', kind: 'value', types: ['number'] },
    { id: 'response', name: 'Discord Response', kind: 'value', types: ['object', 'text', 'null'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  async execute(ctx, options, inputs, setOutput) {
    const reveal = typeof ctx.revealSecret === 'function' ? ctx.revealSecret : value => value;
    let secret = '';
    try {
      secret = String(reveal(inputs.webhook_url) ?? '').trim();
      if (secret) ctx.secretValues?.add(secret);
      const url = webhookURL(secret);
      const content = String(inputs.message ?? '');
      if (!content.trim()) throw new Error('Discord Webhook Message is required');
      if (content.length > 2000) throw new Error('Discord Webhook Message cannot exceed 2000 characters');
      const username = String(inputs.username ?? '').trim();
      if (username.length > 80) throw new Error('Discord Webhook Username cannot exceed 80 characters');
      const avatar = applicationIconURL(ctx.request);
      const payload = {
        content,
        allowed_mentions: options?.allow_mentions === 'Yes' ? { parse: ['users', 'roles', 'everyone'] } : { parse: [] },
        ...(username ? { username } : {}),
        ...(avatar ? { avatar_url: avatar } : {})
      };
      const signals = [AbortSignal.timeout(30000)];
      if (ctx.signal) signals.unshift(ctx.signal);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals)
      });
      const body = await responseBody(response);
      setOutput('http_status', response.status);
      setOutput('response', body);
      if (!response.ok) {
        const detail = body && typeof body === 'object' ? body.message : typeof body === 'string' ? body : '';
        setOutput('error_message', `Discord webhook returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
        return 'error';
      }
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      if (ctx.signal?.aborted) throw error;
      const message = secret ? String(error.message || error).split(secret).join('[REDACTED]') : String(error.message || error);
      setOutput('http_status', 0);
      setOutput('response', null);
      setOutput('error_message', message);
      return 'error';
    }
  },
  applicationIconURL,
  responseBody,
  webhookURL
};

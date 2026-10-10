'use strict';
const http = require('node:http');
const crypto = require('node:crypto');

const MAX_SKEW_MS = 60_000;
const signatureText = ({ projectId, channel, timestamp, nonce }) => `${projectId}\n${channel}\n${timestamp}\n${nonce}`;
const responseKey = (applicationKey, nonce) => crypto.hkdfSync('sha512', applicationKey, Buffer.from(nonce, 'hex'), Buffer.from('phidias/auth-broker/v1'), 32);
function signRequest(applicationKey, request) {
  return crypto.createHmac('sha512', applicationKey).update(signatureText(request)).digest('hex');
}
function encryptResponse(applicationKey, request, value) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', responseKey(applicationKey, request.nonce), iv);
  cipher.setAAD(Buffer.from(signatureText(request)));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { algorithm: 'AES-256-GCM', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}
function decryptResponse(applicationKey, request, value) {
  if (value?.algorithm !== 'AES-256-GCM') throw new Error('Unsupported broker response encryption');
  const decipher = crypto.createDecipheriv('aes-256-gcm', responseKey(applicationKey, request.nonce), Buffer.from(value.iv, 'base64'));
  decipher.setAAD(Buffer.from(signatureText(request))); decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}
function createAuthBroker({ auth, mysqlConfig, logger }) {
  const nonces = new Map();
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    try {
      if (req.method !== 'POST' || req.url !== '/v1/bootstrap') return send(404, { error: 'Not found' });
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'Send application/json' });
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 16_384) throw Object.assign(new Error('Request too large'), { status: 413 }); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const { projectId, channel, timestamp, nonce, signature } = body || {};
      if (!/^[a-f0-9-]{36}$/.test(projectId || '') || !['RC', 'Prod'].includes(channel) || !Number.isSafeInteger(timestamp) || !/^[a-f0-9]{32}$/.test(nonce || '') || !/^[a-f0-9]{128}$/.test(signature || '')) return send(400, { error: 'Invalid bootstrap request' });
      const now = Date.now();
      for (const [value, expires] of nonces) if (expires <= now) nonces.delete(value);
      if (Math.abs(now - timestamp) > MAX_SKEW_MS || nonces.has(`${projectId}:${nonce}`)) return send(401, { error: 'Expired or replayed bootstrap request' });
      const key = await auth.applicationKey(projectId);
      if (!key) return send(401, { error: 'Unknown application' });
      const expected = signRequest(key, { projectId, channel, timestamp, nonce });
      if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return send(401, { error: 'Invalid application signature' });
      if (!mysqlConfig) return send(503, { error: 'MySQL authentication storage is not configured' });
      nonces.set(`${projectId}:${nonce}`, now + MAX_SKEW_MS);
      logger?.info('Authentication bootstrap issued for project %s (%s)', projectId, channel);
      return send(200, encryptResponse(key, { projectId, channel, timestamp, nonce }, { mysql: mysqlConfig, issuedAt: now, expiresAt: now + 300_000 }));
    } catch (error) {
      logger?.error('Authentication broker request failed: %s', error.message);
      return send(error.status || 400, { error: error.status ? error.message : 'Invalid bootstrap request' });
    }
  });
  return server;
}
module.exports = { createAuthBroker, signRequest, encryptResponse, decryptResponse, signatureText };

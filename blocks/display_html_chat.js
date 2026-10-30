'use strict';

const { identifier, normalizeMembers, proxyChoices } = require('./chat_helpers.cjs');

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const scriptJSON = value => JSON.stringify(value).replace(/[<\u2028\u2029]/g, character => ({ '<': '\\u003c', '\u2028': '\\u2028', '\u2029': '\\u2029' })[character]);

function chatHTML(configuration) {
  const choices = Array.isArray(configuration.proxyChoices) ? configuration.proxyChoices : proxyChoices(configuration.members || []);
  configuration = { ...configuration, proxyChoices: choices };
  const config = scriptJSON(configuration);
  const defaultChoice = Math.max(0, choices.findIndex(choice => choice.memberID === configuration.defaultMemberID));
  const choiceLabel = choice => choice.proxyIndex < 0
    ? choice.memberName
    : `${choice.memberName} — ${choice.prefix || ''}text${choice.suffix || ''}`;
  return `<section class="phidias-chat" data-phidias-chat="${escapeHTML(configuration.token)}">
  <header class="phidias-chat__header">
    <div><h2>${escapeHTML(configuration.title || 'Chat')}</h2><p data-chat-status>Connecting…</p></div>
  </header>
  <div class="phidias-chat__messages" data-chat-messages role="log" aria-live="polite" aria-relevant="additions"></div>
  <form class="phidias-chat__composer" data-chat-composer>
    <label class="phidias-chat__proxy" data-chat-proxy-wrap${!configuration.internal && choices.length ? '' : ' hidden'}>
      <span>Send as</span>
      <select data-chat-proxy>${choices.map((choice, index) => `<option value="${index}"${index === defaultChoice ? ' selected' : ''}>${escapeHTML(choiceLabel(choice))}</option>`).join('')}</select>
    </label>
    <label class="phidias-chat__message-field"><span class="phidias-chat__sr-only">Message</span><textarea data-chat-input rows="2" maxlength="4000" placeholder="Write a message…" required></textarea></label>
    <button type="submit" data-chat-send>Send</button>
  </form>
</section>
<style>
.phidias-chat{--chat-bg:#171a20;--chat-panel:#20242b;--chat-raised:#292e37;--chat-border:#39414d;--chat-text:#edf0f4;--chat-muted:#9ca5b2;--chat-accent:#69b7e6;display:grid;grid-template-rows:auto minmax(260px,1fr) auto;min-height:440px;overflow:hidden;border:1px solid var(--chat-border);border-radius:6px;background:var(--chat-panel);color:var(--chat-text);font:400 14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}.phidias-chat *{box-sizing:border-box}.phidias-chat__header{padding:14px 17px;border-bottom:1px solid var(--chat-border);background:var(--chat-raised)}.phidias-chat__header h2{margin:0;font-size:15px}.phidias-chat__header p{margin:2px 0 0;color:var(--chat-muted);font-size:11px}.phidias-chat__messages{display:flex;flex-direction:column;gap:10px;overflow:auto;padding:16px}.phidias-chat__empty{margin:auto;color:var(--chat-muted)}.phidias-chat__item{max-width:min(78%,680px);align-self:flex-start}.phidias-chat__item[data-own="true"]{align-self:flex-end}.phidias-chat__meta{display:flex;gap:7px;margin:0 4px 3px;color:var(--chat-muted);font-size:10px}.phidias-chat__item[data-own="true"] .phidias-chat__meta{justify-content:flex-end}.phidias-chat__bubble{margin:0;padding:9px 11px;border:1px solid var(--chat-border);border-radius:5px;background:var(--chat-raised);white-space:pre-wrap;overflow-wrap:anywhere}.phidias-chat__item[data-own="true"] .phidias-chat__bubble{border-color:#426779;background:#1d3441}.phidias-chat__composer{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:9px;align-items:end;padding:12px;border-top:1px solid var(--chat-border);background:#1b1f25}.phidias-chat__proxy{display:grid;gap:4px;color:var(--chat-muted);font-size:10px}.phidias-chat select,.phidias-chat textarea{border:1px solid var(--chat-border);border-radius:4px;background:var(--chat-bg);color:var(--chat-text);font:inherit}.phidias-chat select{height:38px;padding:0 8px}.phidias-chat textarea{width:100%;min-height:38px;max-height:130px;resize:vertical;padding:8px 10px}.phidias-chat textarea:focus,.phidias-chat select:focus{border-color:var(--chat-accent);outline:2px solid rgb(105 183 230 / 20%)}.phidias-chat button{height:38px;border:1px solid #5798bd;border-radius:4px;padding:0 15px;background:#397da5;color:#fff;font:inherit;font-weight:650;cursor:pointer}.phidias-chat button:disabled{cursor:wait;opacity:.6}.phidias-chat__sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:600px){.phidias-chat{min-height:calc(100dvh - 170px);border-radius:0}.phidias-chat__composer{grid-template-columns:1fr auto}.phidias-chat__proxy{grid-column:1/-1}.phidias-chat__item{max-width:90%}}
</style>
<script>
(() => {
  const script = document.currentScript;
  const root = script && script.previousElementSibling && script.previousElementSibling.previousElementSibling;
  if (!root || !root.matches("[data-phidias-chat]")) return;
  const config = ${config};
  const endpoint = "/_phidias/chat/" + encodeURIComponent(config.token) + "/messages";
  const messages = root.querySelector("[data-chat-messages]");
  const status = root.querySelector("[data-chat-status]");
  const form = root.querySelector("[data-chat-composer]");
  const input = root.querySelector("[data-chat-input]");
  const proxy = root.querySelector("[data-chat-proxy]");
  const send = root.querySelector("[data-chat-send]");
  let after = 0, timer = 0, stopped = false;
  const label = item => item.sender_member_name || item.sender_member_id || item.sender_system_name || item.sender_system_id || "Unknown";
  const append = item => {
    root.querySelector(".phidias-chat__empty")?.remove();
    const article = document.createElement("article");
    article.className = "phidias-chat__item";
    article.dataset.messageId = String(item.id);
    article.dataset.own = String(item.sender_system_id) === String(config.systemID) ? "true" : "false";
    const meta = document.createElement("div"); meta.className = "phidias-chat__meta";
    const sender = document.createElement("strong"); sender.textContent = label(item);
    const time = document.createElement("time"); const date = new Date(Number(item.created_at)); time.dateTime = date.toISOString(); time.textContent = date.toLocaleString();
    const body = document.createElement("p"); body.className = "phidias-chat__bubble"; body.textContent = String(item.body || "");
    meta.append(sender, time); article.append(meta, body); messages.append(article);
    after = Math.max(after, Number(item.id) || 0);
  };
  const poll = async () => {
    if (stopped || !root.isConnected) return;
    try {
      const response = await fetch(endpoint + "?after=" + encodeURIComponent(after), { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const payload = await response.json();
      const pinned = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
      for (const item of payload.messages || []) append(item);
      if (!messages.children.length) { const empty = document.createElement("p"); empty.className = "phidias-chat__empty"; empty.textContent = "No messages yet."; messages.append(empty); }
      if (pinned) messages.scrollTop = messages.scrollHeight;
      status.textContent = "Connected";
    } catch (error) { status.textContent = "Reconnecting…"; }
    timer = window.setTimeout(poll, config.refreshMs);
  };
  form.addEventListener("submit", async event => {
    event.preventDefault(); const body = input.value.trim(); if (!body) return;
    send.disabled = true;
    try {
      const choice = proxy && config.proxyChoices ? config.proxyChoices[Number(proxy.value)] : null;
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-phidias-chat-token": config.token }, body: JSON.stringify({ body, member_id: choice ? choice.memberID : "", proxy_index: choice ? choice.proxyIndex : -1 }) });
      if (!response.ok) throw new Error((await response.text()) || ("HTTP " + response.status));
      input.value = ""; const item = await response.json(); append(item); messages.scrollTop = messages.scrollHeight; status.textContent = "Connected";
    } catch (error) { status.textContent = String(error.message || error); }
    finally { send.disabled = false; input.focus(); }
  });
  poll();
  window.addEventListener("pagehide", () => { stopped = true; clearTimeout(timer); }, { once: true });
})();
</script>`;
}

module.exports = {
  type: 'display_html_chat', name: 'Display HTML Chat', category: 'Chat',
  description: 'Outputs a secure, auto-refreshing HTML chat connected to the Application Database. The page must have an authenticated browser session.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'conversation_id', name: 'Conversation ID', kind: 'value', types: ['text', 'number'], required: true },
    { id: 'viewer_system_id', name: 'Viewer System ID', kind: 'value', types: ['text'], required: true },
    { id: 'viewer_system_name', name: 'Viewer System Name', kind: 'value', types: ['text'] },
    { id: 'viewer_member_id', name: 'Viewer Member ID', kind: 'value', types: ['text'] },
    { id: 'members', name: 'PluralKit Member List', kind: 'value', types: ['list', 'object', 'text'] },
    { id: 'title', name: 'Chat Title', kind: 'value', types: ['text'] }
  ],
  fields: [{ key: 'refresh_seconds', label: 'Refresh every seconds', type: 'number', default: 3, min: 1, max: 60 }],
  outputs: ['next', 'error'],
  outputPorts: [{ id: 'next', name: 'Ready', kind: 'action', types: [] }, { id: 'error', name: 'Error', kind: 'action', types: [] }, { id: 'html', name: 'Chat HTML', kind: 'value', types: ['text'] }, { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }],
  async execute(ctx, options, inputs, setOutput) {
    try {
      if (typeof ctx.createChatView !== 'function') throw new Error('HTML chat is unavailable in this runtime');
      const systemID = identifier(inputs.viewer_system_id, 'Viewer System ID');
      const memberID = identifier(inputs.viewer_member_id, 'Viewer Member ID', false);
      const members = normalizeMembers(inputs.members);
      if (memberID && !members.some(member => member.id === memberID)) members.unshift({ id: memberID, name: memberID, displayName: memberID, proxyTags: [] });
      const view = await ctx.createChatView({ conversationID: inputs.conversation_id, systemID, systemName: String(inputs.viewer_system_name || systemID).slice(0, 191), memberID, members });
      const choices = proxyChoices(members);
      setOutput('html', chatHTML({ token: view.token, internal: view.internal, systemID, title: String(inputs.title || view.title || 'Chat').slice(0, 191), members, proxyChoices: choices, defaultMemberID: memberID, refreshMs: Number(options.refresh_seconds) * 1000 }));
      setOutput('error_message', ''); return 'next';
    } catch (error) { setOutput('error_message', error.message); return 'error'; }
  },
  chatHTML, scriptJSON
};

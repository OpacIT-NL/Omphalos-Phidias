'use strict';

const DISCORD_CDN = 'https://cdn.discordapp.com/emojis';
const MAX_SNOWFLAKE = (1n << 64n) - 1n;
const DISCORD_EMOJI = /(?:<|&lt;)(a?):([A-Za-z0-9_]{2,32}):(\d{1,20})(?:>|&gt;)/gi;

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function emojiSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return 24;
  return Math.max(8, Math.min(256, Math.round(size)));
}

function imageRequestSize(renderedSize) {
  const minimum = Math.max(16, renderedSize);
  return Math.min(4096, 2 ** Math.ceil(Math.log2(minimum)));
}

function validSnowflake(value) {
  try {
    const id = BigInt(value);
    return id > 0n && id <= MAX_SNOWFLAKE;
  } catch {
    return false;
  }
}

function emojiTag(name, id, animated, requestedSize) {
  const size = emojiSize(requestedSize);
  const cdnSize = imageRequestSize(size);
  const query = `size=${cdnSize}${animated ? '&animated=true' : ''}`;
  const source = `${DISCORD_CDN}/${id}.webp?${query}`;
  const label = `:${name}:`;
  return `<img class="phidias-discord-emoji" src="${escapeHTML(source)}" alt="${escapeHTML(label)}" title="${escapeHTML(label)}" loading="lazy" decoding="async" width="${size}" height="${size}" style="display:inline-block;width:${size}px;height:${size}px;max-width:100%;object-fit:contain;vertical-align:-0.25em">`;
}

function convertDiscordEmojisToHTML(value, requestedSize = 24) {
  return String(value ?? '').replace(DISCORD_EMOJI, (match, animated, name, id) => {
    if (!validSnowflake(id)) return match;
    return emojiTag(name, id, animated.toLowerCase() === 'a', requestedSize);
  });
}

module.exports = {
  type: 'convert_discord_emojis_to_html',
  name: 'Convert Discord Emojis to HTML',
  category: 'HTML',
  description: 'Converts Discord custom emoji tokens such as <:name:id> and <a:name:id> into inline images from Discord\'s CDN.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'html', name: 'HTML', kind: 'value', types: ['html', 'text'], required: true }
  ],
  fields: [
    { key: 'size', label: 'Emoji size (pixels)', type: 'number', default: 24, min: 8, max: 256 }
  ],
  outputs: ['next'],
  outputPorts: [
    { id: 'next', name: 'Converted', kind: 'action', types: [] },
    { id: 'html', name: 'HTML', kind: 'value', types: ['html', 'text'] }
  ],
  async execute(_ctx, options, inputs, setOutput) {
    setOutput('html', convertDiscordEmojisToHTML(inputs.html, options?.size));
    return 'next';
  },
  convertDiscordEmojisToHTML,
  emojiSize,
  imageRequestSize,
  validSnowflake
};

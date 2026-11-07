'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const block = require('../blocks/convert_discord_emojis_to_html');
const wireColors = require('../public/wire-colors');

test('Convert Discord Emojis to HTML converts static and animated custom emojis', () => {
  const result = block.convertDiscordEmojisToHTML(
    'Static <:hehe:1386484990946316388> animated <a:dance_party:392938283556143104>',
    24
  );

  assert.equal((result.match(/class="phidias-discord-emoji"/g) || []).length, 2);
  assert.match(result, /src="https:\/\/cdn\.discordapp\.com\/emojis\/1386484990946316388\.webp\?size=32"/);
  assert.match(result, /src="https:\/\/cdn\.discordapp\.com\/emojis\/392938283556143104\.webp\?size=32&amp;animated=true"/);
  assert.match(result, /alt=":hehe:" title=":hehe:"/);
  assert.match(result, /width="24" height="24"/);
});

test('Convert Discord Emojis to HTML works after escaped HTML table conversion', () => {
  const table = '<table><tbody><tr><td>&lt;:hehe:1386484990946316388&gt;</td><td>Kept</td></tr></tbody></table>';
  const result = block.convertDiscordEmojisToHTML(table, 32);

  assert.match(result, /^<table>/);
  assert.match(result, /<td><img class="phidias-discord-emoji"/);
  assert.match(result, /width="32" height="32"/);
  assert.match(result, /<td>Kept<\/td>/);
});

test('Convert Discord Emojis to HTML preserves plain text and malformed tokens', () => {
  const content = 'Unicode 😀 <:x:1386484990946316388> <:valid_name:0> <:valid_name:18446744073709551616> <not-an-emoji>';
  assert.equal(block.convertDiscordEmojisToHTML(content), content);
});

test('Convert Discord Emojis to HTML bounds rendering and CDN request sizes', () => {
  assert.equal(block.emojiSize(undefined), 24);
  assert.equal(block.emojiSize(1), 8);
  assert.equal(block.emojiSize(9000), 256);
  assert.equal(block.imageRequestSize(8), 16);
  assert.equal(block.imageRequestSize(65), 128);

  const result = block.convertDiscordEmojisToHTML('<:hehe:1386484990946316388>', 9000);
  assert.match(result, /\.webp\?size=256/);
  assert.match(result, /width="256" height="256"/);
  assert.match(result, /object-fit:contain/);
});

test('Convert Discord Emojis to HTML exposes typed ports and executes as a value block', async () => {
  const outputs = {};
  const outcome = await block.execute(
    {},
    { size: 40 },
    { html: '<:hehe:1386484990946316388>' },
    (id, value) => { outputs[id] = value; }
  );

  assert.equal(outcome, 'next');
  assert.match(outputs.html, /\.webp\?size=64/);
  assert.match(outputs.html, /width="40" height="40"/);
  assert.equal(block.fields.find(field => field.key === 'size').default, 24);
  assert.equal(block.inputPorts.find(port => port.id === 'html').name, 'HTML');
  assert.deepEqual(block.inputPorts.find(port => port.id === 'html').types, ['html', 'text']);
  assert.equal(wireColors.typeForPort(block.inputPorts.find(port => port.id === 'html')), 'html');
  assert.deepEqual(block.outputPorts.find(port => port.id === 'html').types, ['html', 'text']);
});

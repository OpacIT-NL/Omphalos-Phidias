'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const block = require('../blocks/convert_image_links_to_html');

test('Convert Image Links to HTML recognizes Markdown, HTML, and bare image links', () => {
  const result = block.convertImageLinksToHTML([
    '[https://pic.d6-system.nl/cecil9.png](https://pic.d6-system.nl/cecil9.png)',
    '[Portrait](https://pic.example/member.JPEG?size=large)',
    '<a href="https://pic.example/animated.gif">Animation</a>',
    'https://pic.example/photo.webp',
    'https://pic.example/scan.bmp'
  ].join('\n'));
  assert.equal((result.match(/<img /g) || []).length, 5);
  assert.match(result, /src="https:\/\/pic\.d6-system\.nl\/cecil9\.png" alt=""/);
  assert.match(result, /src="https:\/\/pic\.example\/member\.JPEG\?size=large" alt="Portrait"/);
  assert.match(result, /src="https:\/\/pic\.example\/animated\.gif" alt="Animation"/);
  assert.match(result, /loading="lazy" decoding="async"/);
});

test('Convert Image Links to HTML rejects unsupported and unsafe URLs and escapes attributes', () => {
  const unsupported = '[File](https://example.test/file.svg) [Text](https://example.test/file.txt)';
  assert.equal(block.convertImageLinksToHTML(unsupported), unsupported);
  assert.equal(block.supportedImageURL('javascript:alert(1).png'), null);
  assert.equal(block.supportedImageURL('data:image/png;base64,abc'), null);
  const result = block.convertImageLinksToHTML('[A & B](https://example.test/image.jpg?x=1&y=2)');
  assert.match(result, /src="https:\/\/example\.test\/image\.jpg\?x=1&amp;y=2"/);
  assert.match(result, /alt="A &amp; B"/);
});

test('Convert Image Links to HTML applies a responsive configurable maximum width', () => {
  const automatic = block.convertImageLinksToHTML('https://example.test/image.png');
  const limited = block.convertImageLinksToHTML('https://example.test/image.png', 640.4);
  assert.doesNotMatch(automatic, /style=/);
  assert.match(limited, /style="width:auto;max-width:min\(100%, 640px\);height:auto"/);
  assert.equal(block.maximumWidth(0), null);
  assert.equal(block.maximumWidth('invalid'), null);
  assert.equal(block.maximumWidth(9000), 4096);
});

test('Convert Image Links to HTML exposes typed ports and executes as a value block', async () => {
  const outputs = {};
  assert.equal(await block.execute({}, { max_width: 480 }, { content: 'https://example.test/image.png' }, (id, value) => { outputs[id] = value; }), 'next');
  assert.match(outputs.html, /^<img class="phidias-linked-image"/);
  assert.match(outputs.html, /max-width:min\(100%, 480px\)/);
  assert.equal(block.fields.find(field => field.key === 'max_width').default, 0);
  assert.deepEqual(block.inputPorts.find(port => port.id === 'content').types, ['text']);
  assert.deepEqual(block.outputPorts.find(port => port.id === 'html').types, ['text']);
});

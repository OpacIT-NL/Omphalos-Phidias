'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clientToWorld, pasteOffset } = require('../public/editor-clipboard');

test('clipboard pointer coordinates account for viewport position, pan, and zoom', () => {
  const point = clientToWorld(
    { clientX: 460, clientY: 260 },
    { left: 100, top: 20 },
    { x: 40, y: 60, zoom: 2 }
  );
  assert.deepEqual(point, { x: 160, y: 90 });
});

test('single and multi-block paste offsets place the group origin at the pointer', () => {
  assert.deepEqual(pasteOffset([{ x: 300, y: 200 }], { x: 50, y: 70 }), { x: -250, y: -130 });
  const blocks = [{ x: 300, y: 200 }, { x: 530, y: 420 }, { x: 410, y: 260 }];
  const offset = pasteOffset(blocks, { x: 50, y: 70 });
  const pasted = blocks.map(block => ({ x: block.x + offset.x, y: block.y + offset.y }));
  assert.deepEqual(pasted, [{ x: 50, y: 70 }, { x: 280, y: 290 }, { x: 160, y: 130 }]);
});

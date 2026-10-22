'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decodePNGDataURL, pngToICO, validatePNG } = require('../lib/app-icon');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('app icons validate PNG data and produce an ICO containing that PNG', () => {
  assert.deepEqual(validatePNG(png), { png, width: 1, height: 1 });
  assert.deepEqual(decodePNGDataURL(`data:image/png;base64,${png.toString('base64')}`), png);
  const ico = pngToICO(png);
  assert.deepEqual(ico.subarray(0, 6), Buffer.from([0, 0, 1, 0, 1, 0]));
  assert.equal(ico.readUInt32LE(14), png.length);
  assert.equal(ico.readUInt32LE(18), 22);
  assert.deepEqual(ico.subarray(22), png);
  assert.throws(() => decodePNGDataURL('data:image/jpeg;base64,AAAA'), /PNG data URL/);
  assert.throws(() => validatePNG(Buffer.from('not an image')), /valid PNG header/);
});

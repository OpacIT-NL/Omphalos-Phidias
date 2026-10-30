'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { entries, crc32 } = require('../lib/zip');

function deflatedZip(name, contents) {
  const filename = Buffer.from(name), data = Buffer.from(contents), compressed = zlib.deflateRawSync(data), crc = crc32(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x808, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(filename.length, 26);
  const descriptor = Buffer.alloc(16); descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(crc, 4); descriptor.writeUInt32LE(compressed.length, 8); descriptor.writeUInt32LE(data.length, 12);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x808, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
  const directoryOffset = local.length + filename.length + compressed.length + descriptor.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(directoryOffset, 16);
  return Buffer.concat([local, filename, compressed, descriptor, central, filename, end]);
}

test('ZIP reader imports Deflate entries that use data descriptors', () => {
  const archive = deflatedZip('folder/workspaces.json', '{"name":"Imported"}');
  assert.deepEqual(entries(archive).map(([name, contents]) => [name, contents.toString()]), [['folder/workspaces.json', '{"name":"Imported"}']]);
});

test('ZIP reader enforces expanded-size limits', () => {
  const archive = deflatedZip('large.txt', 'x'.repeat(2048));
  assert.throws(() => entries(archive, { maxEntrySize: 1024 }), /expands beyond/);
});

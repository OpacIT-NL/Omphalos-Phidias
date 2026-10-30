'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../blocks/get_linux_status_over_ssh');

test('Linux status storage parser reports filesystem, inode, device, and aggregate usage', () => {
  const filesystems = `Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda2 104857600 52428800 52428800 50% /\n/dev/sdb1 209715200 52428800 157286400 25% /srv/data\n`;
  const inodes = `Filesystem Inodes IUsed IFree IUse% Mounted on\n/dev/sda2 1000000 100000 900000 10% /\n/dev/sdb1 2000000 500000 1500000 25% /srv/data\n`;
  const devices = JSON.stringify({ blockdevices: [{ name: 'sda', type: 'disk', size: 107374182400, rota: false }] });
  const result = _test.storage(filesystems, inodes, devices);
  assert.equal(result.filesystems.length, 2);
  assert.deepEqual(result.filesystems[1], { filesystem: '/dev/sdb1', mount: '/srv/data', totalBytes: 214748364800, usedBytes: 53687091200, availableBytes: 161061273600, usedPercent: 25, inodes: { total: 2000000, used: 500000, available: 1500000, usedPercent: 25 } });
  assert.equal(result.totalBytes, 322122547200);
  assert.equal(result.usedBytes, 107374182400);
  assert.equal(result.availableBytes, 214748364800);
  assert.equal(result.usedPercent, 33.33);
  assert.equal(result.devices[0].name, 'sda');
});

test('Linux status parsers tolerate unavailable storage tools and add memory percentage', () => {
  assert.deepEqual(_test.storage('df: not found', '', 'lsblk: not found'), { totalBytes: 0, usedBytes: 0, availableBytes: 0, usedPercent: 0, filesystems: [], devices: 'lsblk: not found' });
  assert.deepEqual(_test.memory('MemTotal:       1000 kB\nMemAvailable:    250 kB\nSwapTotal:       500 kB\nSwapFree:        100 kB'), { totalBytes: 1024000, availableBytes: 256000, usedBytes: 768000, usedPercent: 75, swapTotalBytes: 512000, swapFreeBytes: 102400 });
});

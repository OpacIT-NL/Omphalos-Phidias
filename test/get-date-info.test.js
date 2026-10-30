'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const block = require('../blocks/get_date_info');

test('Get Date Info returns UTC Unix timestamps and the correctly numbered time fields', () => {
  const date = new Date('2026-10-08T23:48:12.759Z');
  assert.equal(block.getDateInfo(date, 1, 'utc'), 1791503292);
  assert.equal(block.getDateInfo(date, 10, 'utc'), 23);
  assert.equal(block.getDateInfo(date, 11, 'utc'), 48);
  assert.equal(block.getDateInfo(date, 12, 'utc'), 12);
  assert.equal(block.getDateInfo(date, 13, 'utc'), 759);
  assert.equal(block.getDateInfo(date, 14, 'utc'), 'UTC');
});

test('Get Date Info rejects invalid dates and unknown selections', () => {
  assert.throws(() => block.getDateInfo('invalid', 1, 'utc'), /valid date/);
  assert.throws(() => block.getDateInfo(new Date(), 99, 'local'), /Unknown date information/);
});

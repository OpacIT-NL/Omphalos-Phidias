'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const argon2 = require('../lib/password-hash');

const options = {
  type: argon2.argon2id,
  salt: Buffer.alloc(16, 1),
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32
};

test('portable Argon2id implementation preserves standard PHC hashes', async () => {
  const encoded = await argon2.hash('test password', options);
  assert.equal(
    encoded,
    '$argon2id$v=19$m=65536,t=3,p=1$AQEBAQEBAQEBAQEBAQEBAQ$prLWs8ZgXOaTjw6BEICwxd9QsWHkhDDXmUE6YKib1Hs'
  );
  assert.equal(await argon2.verify(encoded, 'test password'), true);
  assert.equal(await argon2.verify(encoded, 'wrong password'), false);
});

test('portable Argon2id implementation supports empty passwords used by the console', async () => {
  const encoded = await argon2.hash('', options);
  assert.match(encoded, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.equal(await argon2.verify(encoded, ''), true);
  assert.equal(await argon2.verify(encoded, 'not empty'), false);
});

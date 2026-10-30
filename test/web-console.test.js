'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WebConsoleSession } = require('../lib/web-console');

test('web console resumes hidden prompts without returning their value', async () => {
  let ask, write;
  const session = new WebConsoleSession(transport => {
    ({ ask, write } = transport);
    return {
      mode: 'disabled',
      get prompt() { return this.mode === 'disabled' ? 'Console$> ' : 'Console#> '; },
      async execute(command) {
        if (command !== 'enable') return write('Unknown command');
        write('Enter the enable password below.');
        if (await ask('Enable password (hidden): ', true) !== 'correct') return write('% Invalid password.');
        this.mode = 'enabled'; write('Privileged mode enabled.');
      },
      cancel() {}
    };
  });

  assert.deepEqual(session.snapshot(), { output: [], mode: 'disabled', prompt: 'Console$> ', secret: false, busy: false });
  let state = await session.submit('enable');
  assert.equal(state.prompt, 'Enable password (hidden): '); assert.equal(state.secret, true);
  state = await session.submit('correct');
  if (state.busy) { await new Promise(resolve => setImmediate(resolve)); state = session.snapshot(); }
  assert.equal(state.mode, 'enabled'); assert.equal(state.prompt, 'Console#> '); assert.equal(state.secret, false);
  assert.ok(state.output.includes('Privileged mode enabled.'));
  assert.doesNotMatch(JSON.stringify(state), /correct/);
  session.close();
});

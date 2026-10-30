'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { Terminal } = require('../lib/terminal');

test('redirected stdin accepts AMP-style commands and returns the prompt with the input', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', chunk => { text += chunk; });

  const commands = [];
  const engine = {
    prompt: 'Console$> ',
    stopped: false,
    cancel() {},
    async execute(command) {
      commands.push(command);
      this.stopped = true;
    }
  };
  const terminal = new Terminal({ input, output });
  const running = terminal.run(engine);
  input.end('enable\n');
  await running;

  assert.deepEqual(commands, ['enable']);
  assert.equal(text, 'Console$> enable\n');
});

test('redirected password input is not repeated in application output', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', chunk => { text += chunk; });
  const terminal = new Terminal({ input, output });

  const answer = terminal.ask('Password: ', true);
  input.write('a private AMP password\n');
  assert.equal(await answer, 'a private AMP password');
  assert.equal(text, 'Password: \n');
  terminal.close();
});

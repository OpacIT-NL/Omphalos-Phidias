'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { commitsBetween, releaseNotes } = require('../scripts/generate-release-notes');

function git(cwd, ...arguments_) {
  return execFileSync('git', arguments_, { cwd, encoding: 'utf8' }).trim();
}

test('release notes contain every commit title and description since the previous tag', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phidias-release-notes-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  git(directory, 'init');
  git(directory, 'config', 'user.name', 'Phidias Test');
  git(directory, 'config', 'user.email', 'test@phidias.invalid');
  await fs.writeFile(path.join(directory, 'change.txt'), 'initial\n');
  git(directory, 'add', 'change.txt');
  git(directory, 'commit', '-m', 'Initial release');
  git(directory, 'tag', 'v1.0.0');

  await fs.appendFile(path.join(directory, 'change.txt'), 'first\n');
  git(directory, 'commit', '-am', 'Add first feature', '-m', 'Explains the first feature.\n\nIncludes migration details.');
  const firstHash = git(directory, 'rev-parse', 'HEAD');
  await fs.appendFile(path.join(directory, 'change.txt'), 'second\n');
  git(directory, 'commit', '-am', 'Fix second feature');
  const secondHash = git(directory, 'rev-parse', 'HEAD');
  git(directory, 'tag', 'v1.1.0');

  const commits = commitsBetween('v1.1.0', 'v1.0.0', directory);
  assert.deepEqual(commits, [
    { hash: firstHash, title: 'Add first feature', description: 'Explains the first feature.\n\nIncludes migration details.' },
    { hash: secondHash, title: 'Fix second feature', description: '' }
  ]);
  assert.equal(releaseNotes('v1.1.0', 'v1.0.0', commits), `## Changes since \`v1.0.0\`\n\n### Add first feature\n\n_Commit \`${firstHash.slice(0, 7)}\`_\n\nExplains the first feature.\n\nIncludes migration details.\n\n### Fix second feature\n\n_Commit \`${secondHash.slice(0, 7)}\`_\n`);
});

test('release notes handle an empty release range', () => {
  assert.equal(releaseNotes('v1.1.0', 'v1.0.0', []), '## Changes since `v1.0.0`\n\nNo commits were added since the previous release.\n');
});

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function git(arguments_, cwd) {
  return execFileSync('git', arguments_, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function commitsBetween(currentTag, previousTag, cwd = process.cwd()) {
  const range = previousTag ? `${previousTag}..${currentTag}` : currentTag;
  const output = git(['log', '--reverse', '--format=%H%x1f%s%x1f%b%x1e', range], cwd);
  return output.split('\x1e').map(record => record.trim()).filter(Boolean).map(record => {
    const [hash = '', title = '', ...body] = record.split('\x1f');
    return { hash: hash.trim(), title: title.trim(), description: body.join('\x1f').trim() };
  });
}

function releaseNotes(currentTag, previousTag, commits) {
  const heading = previousTag
    ? `Changes since \`${previousTag}\``
    : `Changes included in \`${currentTag}\``;
  const sections = commits.map(commit => {
    const description = commit.description ? `\n\n${commit.description}` : '';
    return `### ${commit.title || '(untitled commit)'}\n\n_Commit \`${commit.hash.slice(0, 7)}\`_${description}`;
  });
  return `## ${heading}\n\n${sections.length ? sections.join('\n\n') : 'No commits were added since the previous release.'}\n`;
}

async function main() {
  const [currentTag, previousTag = '', outputFile = 'dist/release-notes.md'] = process.argv.slice(2);
  if (!currentTag) throw new Error('Usage: node scripts/generate-release-notes.js <current-tag> [previous-tag] [output-file]');
  const notes = releaseNotes(currentTag, previousTag, commitsBetween(currentTag, previousTag));
  await fs.mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
  await fs.writeFile(outputFile, notes);
  console.log(`Created ${outputFile} from ${previousTag ? `${previousTag}..${currentTag}` : currentTag}.`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { commitsBetween, releaseNotes };

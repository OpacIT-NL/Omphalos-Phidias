'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { zip } = require('../lib/zip');

async function main() {
  const tag = process.argv[2];
  if (!tag || tag.length > 200) throw new Error('Usage: node scripts/package-release.js <version-tag> (for example v0.0.1)');
  const version = tag.replace(/^v/, '');
  // SemVer, including prerelease/build identifiers; reject ambiguous release labels.
  const number = '(0|[1-9][0-9]*)';
  const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
  const semver = new RegExp(`^${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
  if (!semver.test(version)) throw new Error('Release tag must be a semantic version, such as v0.0.1 or v1.0.0-rc.1.');
  const root = path.resolve(__dirname, '..');
  const files = [];
  async function add(relative) {
    const source = path.join(root, relative);
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink()) throw new Error(`Release inputs must not be symlinks: ${relative}`);
    if (stat.isDirectory()) {
      for (const entry of (await fs.readdir(source)).sort()) await add(`${relative}/${entry}`);
    } else if (stat.isFile()) {
      let contents = await fs.readFile(source);
      if (relative === 'package.json' || relative === 'package-lock.json') {
        const metadata = JSON.parse(contents);
        metadata.version = version;
        if (relative === 'package-lock.json') metadata.packages[''].version = version;
        contents = JSON.stringify(metadata, null, 2) + '\n';
      }
      files.push([relative, contents]);
    } else throw new Error(`Unsupported release input: ${relative}`);
  }
  // Explicit application inputs prevent local accounts, projects, and dependencies
  // from being included when this command is also run on an installed builder.
  for (const filename of ['server.js', 'package.json', 'package-lock.json', 'README.md', 'LICENSE', '.env.example']) await add(filename);
  for (const directory of ['blocks', 'lib', 'public', 'runtime', 'scripts', 'test']) await add(directory);
  // Ship fresh defaults, never a server administrator's local configuration.
  files.push(['config.json', JSON.stringify({ port: 3000, auth: { database: 'data/auth.sqlite', secureCookies: false } }, null, 2) + '\n']);
  const archive = zip(files);
  const output = path.join(root, 'dist');
  await fs.mkdir(output, { recursive: true });
  const filename = 'amp-release.zip';
  await fs.writeFile(path.join(output, filename), archive);
  await fs.writeFile(path.join(output, `${filename}.sha256`), `${createHash('sha256').update(archive).digest('hex')}  ${filename}\n`);
  console.log(`Created dist/${filename} (version ${version}, ${files.length} files) and SHA-256 checksum.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_ENTRIES = 10000;

async function listFolder(folderPath, recursive, signal) {
  const root = path.resolve(folderPath);
  const entries = [], files = [], folders = [];
  async function visit(directory) {
    signal?.throwIfAborted();
    const children = await fs.readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      signal?.throwIfAborted();
      if (entries.length >= MAX_ENTRIES) throw new Error(`Folder listing exceeds ${MAX_ENTRIES.toLocaleString('en-US')} entries`);
      const absolutePath = path.join(directory, child.name);
      const relativePath = path.relative(root, absolutePath);
      const stats = await fs.lstat(absolutePath);
      const type = child.isDirectory() ? 'folder' : child.isSymbolicLink() ? 'symbolic-link' : child.isFile() ? 'file' : 'other';
      entries.push({ name: child.name, path: absolutePath, relativePath, type, size: child.isDirectory() ? null : stats.size, modifiedAt: stats.mtime.toISOString() });
      if (child.isDirectory()) {
        folders.push(absolutePath);
        if (recursive) await visit(absolutePath);
      } else files.push(absolutePath);
    }
  }
  await visit(root);
  return { entries, files, folders };
}

module.exports = {
  type: 'list_folder_contents',
  name: 'List Folder Contents',
  category: 'File Management',
  description: 'Lists the files and subfolders inside a folder, with optional recursive traversal.',
  inputPorts: [
    { id: 'action', name: 'Action', kind: 'action', types: [] },
    { id: 'folder_path', name: 'Folder Path', kind: 'value', types: ['text'], required: true }
  ],
  outputs: ['success', 'error'],
  outputPorts: [
    { id: 'success', name: 'Success', kind: 'action', types: [] },
    { id: 'error', name: 'Error', kind: 'action', types: [] },
    { id: 'entries', name: 'Entries', kind: 'value', types: ['list'] },
    { id: 'files', name: 'Files', kind: 'value', types: ['list'] },
    { id: 'folders', name: 'Folders', kind: 'value', types: ['list'] },
    { id: 'error_message', name: 'Error Message', kind: 'value', types: ['text'] }
  ],
  fields: [
    { key: 'recursive', label: 'Include nested contents', type: 'select', choices: ['No', 'Yes'], default: 'No' }
  ],
  async execute(ctx, options, inputs, setOutput) {
    const folderPath = typeof inputs.folder_path === 'string' ? inputs.folder_path.trim() : '';
    if (!folderPath) {
      setOutput('entries', []); setOutput('files', []); setOutput('folders', []);
      setOutput('error_message', 'Folder Path is required');
      return 'error';
    }
    try {
      const result = await listFolder(folderPath, options.recursive === 'Yes', ctx.signal);
      setOutput('entries', result.entries); setOutput('files', result.files); setOutput('folders', result.folders);
      setOutput('error_message', '');
      return 'success';
    } catch (error) {
      if (ctx.signal?.aborted) throw error;
      setOutput('entries', []); setOutput('files', []); setOutput('folders', []);
      setOutput('error_message', error.message);
      return 'error';
    }
  },
  listFolder
};

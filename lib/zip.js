'use strict';
const zlib = require('node:zlib');
// Uncompressed ZIP archives; no external binaries or npm packages required.
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const local = [], central = []; let offset = 0;
  for (const [filename, contents] of files) {
    const name = Buffer.from(filename), data = Buffer.from(contents), crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8);
    entry.writeUInt16LE(33, 14); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, name); offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function entries(archive, { maxFiles = 5000, maxEntrySize = 100 * 1024 * 1024, maxTotalSize = 500 * 1024 * 1024 } = {}) {
  archive = Buffer.from(archive);
  let eocd = -1;
  for (let offset = archive.length - 22, minimum = Math.max(0, archive.length - 65557); offset >= minimum; offset--) {
    if (archive.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('Invalid ZIP archive');
  const count = archive.readUInt16LE(eocd + 10), directorySize = archive.readUInt32LE(eocd + 12), directoryOffset = archive.readUInt32LE(eocd + 16);
  if (count > maxFiles) throw new Error(`ZIP archive contains more than ${maxFiles} entries`);
  if (directoryOffset + directorySize > eocd) throw new Error('Invalid ZIP central directory');
  const files = []; let offset = directoryOffset, totalSize = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP central directory');
    const flags = archive.readUInt16LE(offset + 8), method = archive.readUInt16LE(offset + 10), expectedCRC = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20), size = archive.readUInt32LE(offset + 24), nameLength = archive.readUInt16LE(offset + 28), extraLength = archive.readUInt16LE(offset + 30), commentLength = archive.readUInt16LE(offset + 32), localOffset = archive.readUInt32LE(offset + 42);
    if (flags & 1) throw new Error('Encrypted ZIP archives are not supported');
    if (![0, 8].includes(method)) throw new Error(`Unsupported ZIP compression method ${method}`);
    if (size > maxEntrySize || (totalSize += size) > maxTotalSize) throw new Error('ZIP archive expands beyond the allowed size');
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString(flags & 0x800 ? 'utf8' : 'utf8');
    if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid ZIP local header');
    const localNameLength = archive.readUInt16LE(localOffset + 26), localExtraLength = archive.readUInt16LE(localOffset + 28), dataStart = localOffset + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressedSize;
    if (dataEnd > archive.length) throw new Error('Invalid ZIP archive');
    const compressed = archive.subarray(dataStart, dataEnd), contents = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: maxEntrySize });
    if (contents.length !== size || crc32(contents) !== expectedCRC) throw new Error(`ZIP entry failed integrity validation: ${name}`);
    files.push([name, contents]);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
function replaceFile(archive, filename, contents) {
  const files = entries(archive).filter(([name]) => name !== filename);
  if (contents !== null && contents !== undefined) files.push([filename, contents]);
  return zip(files);
}
module.exports = { zip, crc32, entries, replaceFile };

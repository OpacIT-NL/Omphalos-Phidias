'use strict';
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
function entries(archive) {
  const files = []; let offset = 0;
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const flags = archive.readUInt16LE(offset + 6), method = archive.readUInt16LE(offset + 8);
    if ((flags & 0x08) || method !== 0) throw new Error('Unsupported ZIP archive');
    const length = archive.readUInt32LE(offset + 18), nameLength = archive.readUInt16LE(offset + 26), extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30, dataStart = nameStart + nameLength + extraLength, end = dataStart + length;
    if (end > archive.length) throw new Error('Invalid ZIP archive');
    files.push([archive.subarray(nameStart, nameStart + nameLength).toString(), archive.subarray(dataStart, end)]);
    offset = end;
  }
  if (offset + 4 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP archive');
  return files;
}
function replaceFile(archive, filename, contents) {
  const files = entries(archive).filter(([name]) => name !== filename);
  if (contents !== null && contents !== undefined) files.push([filename, contents]);
  return zip(files);
}
module.exports = { zip, crc32, entries, replaceFile };

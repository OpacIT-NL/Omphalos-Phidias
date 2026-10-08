'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const sizes = [16, 24, 32, 48, 64, 128, 256];
const samples = 4;
const colors = {
  navy: [17, 24, 33, 255],
  mint: [127, 224, 186, 255],
  mintLight: [205, 255, 235, 255],
  teal: [62, 183, 144, 255]
};
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0); name.copy(output, 4); data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return output;
}
function roundedRect(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(right - radius, x));
  const cy = Math.max(top + radius, Math.min(bottom - radius, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}
const circle = (x, y, cx, cy, radius) => (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
function segment(x, y, ax, ay, bx, by, width) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= (width / 2) ** 2;
}
function builderPixel(x, y) {
  if (!roundedRect(x, y, .035, .035, .965, .965, .19)) return [0, 0, 0, 0];
  let color = colors.navy;
  if (roundedRect(x, y, .255, .19, .405, .82, .055) || roundedRect(x, y, .33, .19, .765, .57, .17)) color = colors.mint;
  if (roundedRect(x, y, .405, .285, .635, .475, .075)) color = colors.navy;
  if (circle(x, y, .79, .78, .055)) color = colors.teal;
  return color;
}
function applicationPixel(x, y) {
  if (!roundedRect(x, y, .035, .035, .965, .965, .19)) return [0, 0, 0, 0];
  let color = colors.mint;
  const line = segment(x, y, .30, .31, .70, .29, .085) || segment(x, y, .30, .31, .69, .70, .085) || segment(x, y, .30, .31, .30, .72, .085);
  if (line) color = colors.navy;
  for (const [cx, cy, radius] of [[.29, .30, .145], [.71, .28, .12], [.70, .71, .12], [.29, .73, .12]]) {
    if (circle(x, y, cx, cy, radius)) color = colors.navy;
    if (circle(x, y, cx, cy, radius * .43)) color = colors.mintLight;
  }
  return color;
}
function render(size, pixel) {
  const data = Buffer.alloc(size * size * 4), scale = samples * samples;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const total = [0, 0, 0, 0];
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      const color = pixel((px + (sx + .5) / samples) / size, (py + (sy + .5) / samples) / size);
      for (let channel = 0; channel < 4; channel++) total[channel] += color[channel];
    }
    const offset = (py * size + px) * 4;
    for (let channel = 0; channel < 4; channel++) data[offset + channel] = Math.round(total[channel] / scale);
  }
  return data;
}
function png(size, pixel) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  const rgba = render(size, pixel), rows = [];
  for (let row = 0; row < size; row++) rows.push(Buffer.from([0]), rgba.subarray(row * size * 4, (row + 1) * size * 4));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function ico(pixel) {
  const images = sizes.map(size => png(size, pixel));
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const size = sizes[index], entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size; header[entry + 1] = size === 256 ? 0 : size;
    header[entry + 2] = 0; header[entry + 3] = 0;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8); header.writeUInt32LE(offset, entry + 12); offset += image.length;
  });
  return Buffer.concat([header, ...images]);
}

const root = path.resolve(__dirname, '..');
fs.writeFileSync(path.join(root, 'public', 'favicon.ico'), ico(builderPixel));
fs.writeFileSync(path.join(root, 'runtime', 'favicon.ico'), ico(applicationPixel));

'use strict';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const maxIconBytes = 1024 * 1024;

function validatePNG(value) {
  const png = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (!png.length || png.length > maxIconBytes) throw Object.assign(new Error('The app icon must be a PNG no larger than 1 MiB'), { status: png.length > maxIconBytes ? 413 : 400 });
  if (png.length < 33 || !png.subarray(0, 8).equals(pngSignature) || png.readUInt32BE(8) !== 13 || png.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw Object.assign(new Error('The app icon does not contain a valid PNG header'), { status: 400 });
  }
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  if (!width || !height || width > 256 || height > 256) throw Object.assign(new Error('The normalized app icon must be between 1 and 256 pixels on each side'), { status: 400 });
  if (png[24] !== 8 || ![2, 3, 4, 6].includes(png[25])) throw Object.assign(new Error('The app icon must use an 8-bit RGB, indexed, grayscale-alpha, or RGBA PNG format'), { status: 400 });
  if (png.subarray(-12, -8).readUInt32BE(0) !== 0 || png.subarray(-8, -4).toString('ascii') !== 'IEND') throw Object.assign(new Error('The app icon PNG is incomplete'), { status: 400 });
  return { png, width, height };
}

function pngToICO(value) {
  const { png, width, height } = validatePNG(value);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = width === 256 ? 0 : width;
  header[7] = height === 256 ? 0 : height;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);
  return Buffer.concat([header, png]);
}

function decodePNGDataURL(value) {
  if (typeof value !== 'string') throw Object.assign(new Error('The app icon must be sent as a PNG data URL'), { status: 400 });
  const match = value.match(/^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) throw Object.assign(new Error('The app icon must be sent as a PNG data URL'), { status: 400 });
  let png;
  try { png = Buffer.from(match[1], 'base64'); } catch { throw Object.assign(new Error('The app icon contains invalid base64 data'), { status: 400 }); }
  return validatePNG(png).png;
}

module.exports = { decodePNGDataURL, pngToICO, validatePNG, maxIconBytes };

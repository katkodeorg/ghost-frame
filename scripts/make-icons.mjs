// Generates the PWA icons in public/icons without any image dependencies.
// Run with: npm run icons
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [11, 11, 11];
const YELLOW = [255, 214, 10];
const WHITE = [255, 255, 255];

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Design in unit space centred on (0,0), spanning roughly [-0.5, 0.5].
function layers(x, y) {
  const out = [];
  const d = Math.hypot(x, y + 0.02);
  // Ghost: translucent white disc, offset slightly.
  if (Math.hypot(x + 0.05, y + 0.06) < 0.2) out.push([WHITE, 0.35]);
  // Solid yellow ring.
  if (Math.abs(d - 0.2) < 0.028) out.push([YELLOW, 1]);
  // Viewfinder corner brackets.
  const e = 0.36, len = 0.14, t = 0.045;
  const ax = Math.abs(x), ay = Math.abs(y);
  const inH = ay > e - t && ay < e && ax > e - len && ax < e;
  const inV = ax > e - t && ax < e && ay > e - len && ay < e;
  if (inH || inV) out.push([YELLOW, 1]);
  return out;
}

function render(size, contentScale) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const ux = ((px + (sx + 0.5) / ss) / size - 0.5) / contentScale;
          const uy = ((py + (sy + 0.5) / ss) / size - 0.5) / contentScale;
          let c = [...BG];
          for (const [col, a] of layers(ux, uy)) c = c.map((v, i) => v * (1 - a) + col[i] * a);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const i = (py * size + px) * 4;
      buf[i] = r / (ss * ss);
      buf[i + 1] = g / (ss * ss);
      buf[i + 2] = b / (ss * ss);
      buf[i + 3] = 255;
    }
  }
  return png(size, buf);
}

mkdirSync('public/icons', { recursive: true });
const targets = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['maskable-512.png', 512, 0.72], // keep content inside the maskable safe zone
  ['apple-touch-icon.png', 180, 0.9],
];
for (const [name, size, scale] of targets) {
  writeFileSync(`public/icons/${name}`, render(size, scale));
  console.log('wrote', name);
}

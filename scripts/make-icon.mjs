/**
 * Draws the app icon and writes app-icon.png (1024 px), with nothing but Node.
 *
 *     node scripts/make-icon.mjs
 *     npx tauri icon app-icon.png     # fans it out into src-tauri/icons/
 *
 * Two cards on the site's night-ink tile: one behind, drawn as an outline,
 * and one in front on the paper colour with a gold term line and two ink
 * lines for the definition. Every shape is a rounded box drawn as a signed
 * distance field, which antialiases cleanly at one sample per pixel.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SIZE = 1024;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'app-icon.png');

const INK = [22, 19, 15];
const PAPER = [233, 223, 201];
const GOLD = [214, 160, 58];
const SOFT = [120, 108, 90];

/** Signed distance to a rounded box centred at (cx, cy), half size (hw, hh). */
function box(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

const cover = (d) => Math.min(1, Math.max(0, 0.5 - d));

const px = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let c = [0, 0, 0];
    let a = 0;
    const paint = (col, alpha) => {
      if (alpha <= 0) return;
      const na = alpha + a * (1 - alpha);
      c = c.map((v, i) => (col[i] * alpha + v * a * (1 - alpha)) / (na || 1));
      a = na;
    };

    // Tile (macOS-style inset so it sits well beside other icons).
    paint(INK, cover(box(x, y, 512, 512, 432, 432, 190)));
    // Back card: outline only.
    const back = box(x, y, 580, 420, 250, 170, 44);
    paint(SOFT, cover(Math.abs(back) - 14));
    // Front card.
    paint(PAPER, cover(box(x, y, 460, 590, 270, 185, 48)));
    // Term line (gold) and two definition lines (ink).
    paint(GOLD, cover(box(x, y, 400, 520, 150, 26, 26)));
    paint(INK, cover(box(x, y, 440, 620, 190, 16, 16)) * 0.75);
    paint(INK, cover(box(x, y, 390, 680, 140, 16, 16)) * 0.75);

    const o = (y * SIZE + x) * 4;
    px[o] = Math.round(c[0]);
    px[o + 1] = Math.round(c[1]);
    px[o + 2] = Math.round(c[2]);
    px[o + 3] = Math.round(a * 255);
  }
}

// ---- PNG encoding -------------------------------------------------------------

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
writeFileSync(
  OUT,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
console.log(`wrote ${OUT}`);

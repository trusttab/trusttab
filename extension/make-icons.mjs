#!/usr/bin/env node
/**
 * Generates the extension's PNG icons (Chrome doesn't accept SVG icons) with
 * no image dependencies: a dark rounded tile with a white check mark, drawn
 * with 4x supersampling for smooth edges. The icon is deliberately neutral,
 * never a status color, because the toolbar icon doesn't show a site's status.
 *
 *   node extension/make-icons.mjs
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const TILE = [24, 24, 27]; // zinc-900
const MARK = [255, 255, 255];
const SAMPLES = 4;

/** Coverage (0..1) of the rounded tile and of the check stroke at unit coordinates. */
function shapes(x, y) {
  const r = 0.22;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  const inTile = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

  // Check mark: two segments with a thick stroke.
  const segments = [
    [0.27, 0.53, 0.44, 0.7],
    [0.44, 0.7, 0.75, 0.33],
  ];
  const width = 0.085;
  const onMark = segments.some(([x1, y1, x2, y2]) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    return (x - (x1 + t * dx)) ** 2 + (y - (y1 + t * dy)) ** 2 <= width * width;
  });
  return { inTile, onMark: inTile && onMark };
}

function renderRgba(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let tile = 0;
      let mark = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const { inTile, onMark } = shapes((px + (sx + 0.5) / SAMPLES) / size, (py + (sy + 0.5) / SAMPLES) / size);
          if (inTile) tile++;
          if (onMark) mark++;
        }
      }
      const n = SAMPLES * SAMPLES;
      const alpha = tile / n;
      const markShare = tile ? mark / tile : 0;
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(TILE[c] * (1 - markShare) + MARK[c] * markShare);
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const rgba = renderRgba(size);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(path.join(here, "icons", `icon-${size}.png`), png(size));
}
console.log("Wrote extension/icons/icon-{16,32,48,128}.png");

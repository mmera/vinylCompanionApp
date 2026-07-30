#!/usr/bin/env node
/**
 * Renders Crate's icon — a vinyl record — at every size the PWA needs.
 *
 * The icon is drawn in code rather than exported from a design tool. A record
 * is radially symmetric, so every pixel is a function of its distance from the
 * centre, which makes the whole thing about forty lines of arithmetic — and it
 * stays editable. Nudging a groove or the label size is a number here, not a
 * round trip through a binary nobody can diff.
 *
 * PNG encoding uses node:zlib directly (deflate + crc32 are all a PNG needs),
 * so this pulls in no dependency and CI never has to install one.
 *
 * Output is deliberately RGB with no alpha channel: iOS renders a transparent
 * apple-touch-icon as a black box.
 *
 *   node scripts/make-icons.mjs        (npm run icons)
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── PNG container ───────────────────────────────────────────────────────────

function chunk(type, data) {
  const header = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  header.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([header, data])) >>> 0, data.length + 8);
  return out;
}

function encodePng(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2: truecolour, no alpha
  // Bytes 10–12 stay zero: deflate, adaptive filtering, no interlace.

  // Each scanline is prefixed with its filter type. None (0) throughout —
  // these images compress fine without per-row prediction.
  const stride = size * 3;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y += 1) {
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── The record ──────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;

// From src/theme.js — the icon should look like it came out of the same app.
const TILE_CENTRE = [0x1e, 0x1e, 0x1e];
const TILE_EDGE = [0x0f, 0x0f, 0x0f]; // colors.background
const DISC_BASE = 0x0b;
const RIM = 0x2e;

// Light runs upper-left to lower-right. A band through the centre gives the
// two-lobed sheen that reads as vinyl rather than as a dark circle.
const SHEEN_ANGLE = Math.PI / 4;
const SHEEN_WIDTH = 0.38;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (v) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

/**
 * Colour at (x, y), both in 0..1 across the tile. Writes into `out` rather
 * than allocating — this runs tens of millions of times per icon.
 */
function sample(x, y, opts, out) {
  const { discR, groovePeriod } = opts;

  // Tile: a slight lift behind the record so the icon doesn't read as a hole
  // on a dark wallpaper.
  const bt = smoothstep(Math.hypot(x - 0.5, y - 0.42) / 0.72);
  const dr = Math.hypot(x - 0.5, y - 0.5);

  if (dr > discR) {
    // Contact shadow, so the disc sits *on* the tile.
    const shadow = 1 - smoothstep((dr - discR) / (discR * 0.06));
    for (let i = 0; i < 3; i += 1) {
      out[i] = mix(mix(TILE_CENTRE[i], TILE_EDGE[i], bt), 6, shadow * 0.55);
    }
    return;
  }

  const labelR = discR * 0.352; // a 10cm label on a 30cm record
  const holeR = discR * 0.045;

  if (dr < holeR) {
    // Spindle hole punches back through to the tile.
    for (let i = 0; i < 3; i += 1) out[i] = mix(TILE_CENTRE[i], TILE_EDGE[i], bt);
    return;
  }

  if (dr < labelR) {
    // The one bright thing in the icon, and the reason it still reads at 60px.
    // A faint top-to-bottom fall keeps it from looking like a pasted circle.
    const shade = mix(255, 238, smoothstep((y - 0.5 + labelR) / (2 * labelR)));
    out[0] = shade;
    out[1] = shade;
    out[2] = shade;
    return;
  }

  const nx = (x - 0.5) / discR;
  const ny = (y - 0.5) / discR;
  const perp = -nx * Math.sin(SHEEN_ANGLE) + ny * Math.cos(SHEEN_ANGLE);
  const sheen = Math.exp(-(perp * perp) / (2 * SHEEN_WIDTH * SHEEN_WIDTH));

  let v = DISC_BASE;

  if (groovePeriod) {
    const groove = 0.5 + 0.5 * Math.cos((TAU * dr) / groovePeriod);
    // A slow envelope over the rings, so they read as a few broad bands
    // instead of one uniform texture.
    const env = 0.55 + 0.45 * Math.sin(dr * 61);
    // Grooves are only really visible where the light catches them.
    v += groove * env * 18 * (0.3 + 0.9 * sheen);
  }

  v += sheen * 34;

  // Seat the label with a shadow just outside it.
  v = mix(v, 3, (1 - smoothstep((dr - labelR) / (discR * 0.03))) * 0.85);

  // Hairline rim, so the disc separates from the tile even where the sheen is
  // dark. Floored in absolute terms so it survives the smallest sizes.
  const rimW = Math.max(discR * 0.012, 0.0016);
  v = mix(v, RIM, smoothstep((dr - (discR - rimW)) / rimW) * 0.9);

  out[0] = v;
  out[1] = v;
  out[2] = v;
}

function render(size, discR) {
  /*
   * Optical scaling: a groove period fixed in tile-fractions collapses to
   * sub-pixel noise on a small icon and averages out to flat grey. Hold the
   * rings to a minimum width in *pixels* instead, and drop them entirely below
   * favicon size where they would only be mud.
   */
  const groovePeriod = size >= 64 ? Math.max(0.0055, 3 / size) : 0;
  const ss = size >= 512 ? 3 : 4; // supersampling — this is the anti-aliasing
  const samples = ss * ss;

  const buf = Buffer.alloc(size * size * 3);
  const opts = { discR, groovePeriod };
  const c = [0, 0, 0];

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        const y = (py + (sy + 0.5) / ss) / size;
        for (let sx = 0; sx < ss; sx += 1) {
          sample((px + (sx + 0.5) / ss) / size, y, opts, c);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const i = (py * size + px) * 3;
      buf[i] = Math.round(clamp01(r / samples / 255) * 255);
      buf[i + 1] = Math.round(clamp01(g / samples / 255) * 255);
      buf[i + 2] = Math.round(clamp01(b / samples / 255) * 255);
    }
  }

  return buf;
}

// ── Targets ─────────────────────────────────────────────────────────────────

/*
 * `any` icons are full-bleed: iOS applies its own rounded-corner mask, so the
 * art must not be pre-rounded. `maskable` icons are cropped to a circle at 80%
 * of the width by Android, which would shave the rim off a full-bleed disc —
 * hence the smaller radius on those two.
 */
const TARGETS = [
  { file: 'public/icons/icon-1024.png', size: 1024, discR: 0.44 },
  { file: 'public/icons/icon-512.png', size: 512, discR: 0.44 },
  { file: 'public/icons/icon-192.png', size: 192, discR: 0.44 },
  { file: 'public/icons/icon-180.png', size: 180, discR: 0.44 }, // apple-touch-icon
  { file: 'public/icons/icon-167.png', size: 167, discR: 0.44 }, // iPad Pro
  { file: 'public/icons/icon-152.png', size: 152, discR: 0.44 }, // iPad
  { file: 'public/icons/icon-maskable-512.png', size: 512, discR: 0.36 },
  { file: 'public/icons/icon-maskable-192.png', size: 192, discR: 0.36 },
  // Expo turns this into dist/favicon.ico, so the browser tab matches.
  { file: 'assets/favicon.png', size: 48, discR: 0.46 },
];

const tty = process.stdout.isTTY;
console.log(tty ? '\x1b[1mCrate — icons\x1b[0m' : 'Crate — icons');

for (const { file, size, discR } of TARGETS) {
  const png = encodePng(size, render(size, discR));
  await writeFile(path.join(root, file), png);
  const label = tty ? '\x1b[32m  ok\x1b[0m' : '  ok';
  console.log(`${label}    ${file}  ${size}×${size}, ${(png.length / 1024).toFixed(1)} kB`);
}

console.log('');

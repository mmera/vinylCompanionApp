#!/usr/bin/env node
/**
 * Pre-flight check for Crate's two external APIs.
 *
 * Verifies credentials and — more importantly — the exact request shapes the
 * app depends on, so a broken contract surfaces here instead of on a phone in
 * front of a record shelf. Needs no device, no simulator, and no Expo server.
 *
 *   node scripts/smoke-test.mjs                    # contract check
 *   node scripts/smoke-test.mjs cover.jpg          # also test real recognition
 *
 * Node 18+ (uses built-in fetch). Reads .env from the project root.
 */

import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── tiny .env reader (no dependency) ────────────────────────────────────────
function loadEnv() {
  const file = path.join(root, '.env');
  if (!existsSync(file)) return {};
  const env = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = { ...loadEnv(), ...process.env };
const PLACEHOLDER = /^x+$|^sk-ant-x+$/i;
const value = (key) => {
  const raw = (env[key] ?? '').trim();
  return !raw || PLACEHOLDER.test(raw) ? '' : raw;
};

const CLAUDE_API_KEY = value('EXPO_PUBLIC_CLAUDE_API_KEY');
const SPOTIFY_CLIENT_ID = value('EXPO_PUBLIC_SPOTIFY_CLIENT_ID');
const SPOTIFY_CLIENT_SECRET = value('EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET');
const CLAUDE_MODEL = value('EXPO_PUBLIC_CLAUDE_MODEL') || 'claude-sonnet-5';

// ── output helpers ──────────────────────────────────────────────────────────
const tty = process.stdout.isTTY;
const paint = (code, text) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
const dim = (t) => paint('2', t);
const bold = (t) => paint('1', t);

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  const mark = ok ? paint('32', '  PASS') : paint('31', '  FAIL');
  console.log(`${mark}  ${name}`);
  if (detail) console.log(dim(`        ${detail.split('\n').join('\n        ')}`));
}
function note(text) {
  console.log(dim(`        ${text}`));
}
function section(title) {
  console.log(`\n${bold(title)}`);
}

// ── 1. Spotify: auth ────────────────────────────────────────────────────────
async function spotifyToken() {
  const credentials = Buffer.from(
    `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`,
  ).toString('base64');

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} — ${body.slice(0, 160)}`);
  }
  return (await response.json()).access_token;
}

// ── 2. Spotify: search + the preview_url question ───────────────────────────
async function spotifyChecks() {
  section('Spotify');

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    record('credentials present', false, 'Set EXPO_PUBLIC_SPOTIFY_CLIENT_ID and _SECRET in .env');
    return;
  }

  let token;
  try {
    token = await spotifyToken();
    record('client-credentials auth', true);
  } catch (error) {
    record('client-credentials auth', false, error.message);
    return;
  }

  const get = async (url) => {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };

  // The exact query shape findAlbum() uses for a scanner hit.
  let album;
  try {
    const query = encodeURIComponent('album:Rumours artist:Fleetwood Mac');
    const body = await get(`https://api.spotify.com/v1/search?q=${query}&type=album&limit=5`);
    album = body.albums?.items?.[0];
    if (!album) throw new Error('fielded album search returned no results');
    record('album search (fielded query)', true, `${album.artists[0].name} — ${album.name}`);
  } catch (error) {
    record('album search (fielded query)', false, error.message);
    return;
  }

  try {
    const body = await get(`https://api.spotify.com/v1/albums/${album.id}/tracks?limit=50`);
    const tracks = body.items ?? [];
    const withPreview = tracks.filter((track) => track.preview_url).length;

    record('tracklist fetch', true, `${tracks.length} tracks`);

    if (withPreview > 0) {
      record('preview clips available', true, `${withPreview}/${tracks.length} tracks playable`);
    } else {
      // Not a failure of the app — a property of the Spotify app being used.
      console.log(`${paint('33', '  WARN')}  preview clips available`);
      note('0 tracks returned a preview_url.');
      note('Spotify stopped serving previews to apps created after 2024-11-27,');
      note('so the in-app Preview button will stay disabled. "Open in Spotify"');
      note('is unaffected. Nothing to fix in Crate.');
    }
  } catch (error) {
    record('tracklist fetch', false, error.message);
  }
}

// ── 3. Claude: the request contract the scanner depends on ──────────────────
const IDENTIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    identified: { type: 'boolean' },
    artist: { type: 'string' },
    album: { type: 'string' },
    year: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['identified', 'artist', 'album', 'year', 'confidence'],
  additionalProperties: false,
};

const MEDIA_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

async function claudeChecks(imagePath) {
  section('Claude');

  if (!CLAUDE_API_KEY) {
    record('credentials present', false, 'Set EXPO_PUBLIC_CLAUDE_API_KEY in .env');
    return;
  }

  // Falls back to a repo asset purely to exercise the contract — the model
  // should answer identified:false for it, which is itself a valid result.
  const isRealCover = Boolean(imagePath);
  const file = imagePath ? path.resolve(imagePath) : path.join(root, 'assets', 'icon.png');

  if (!existsSync(file)) {
    record('test image', false, `Not found: ${file}`);
    return;
  }

  const mediaType = MEDIA_TYPES[path.extname(file).toLowerCase()];
  if (!mediaType) {
    record('test image', false, `Unsupported image type: ${path.extname(file)}`);
    return;
  }

  const base64 = (await readFile(file)).toString('base64');

  const started = Date.now();
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 256,
        thinking: { type: 'disabled' },
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: IDENTIFICATION_SCHEMA },
        },
        system:
          'You identify vinyl record album covers. Set identified=true only when you ' +
          'recognize the album. Never guess.',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: 'What album cover is this?' },
            ],
          },
        ],
      }),
    });
  } catch (error) {
    record('reachable', false, error.message);
    return;
  }

  const elapsed = Date.now() - started;

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error?.message) detail += ` — ${body.error.message}`;
    } catch {
      /* non-JSON error body */
    }

    record(`request shape accepted (${CLAUDE_MODEL})`, false, detail);

    if (response.status === 400) {
      note('');
      note('A 400 here means the model rejected the request shape the scanner');
      note('sends. Check src/services/claude.js — most likely `thinking`,');
      note('`output_config.effort`, or `output_config.format`.');
    }
    if (response.status === 404) {
      note(`Model "${CLAUDE_MODEL}" is unavailable on this account.`);
      note('Set EXPO_PUBLIC_CLAUDE_MODEL in .env to one you can access.');
    }
    if (response.status === 401 || response.status === 403) {
      note('Key rejected. Check EXPO_PUBLIC_CLAUDE_API_KEY, and that the');
      note('account has credit.');
    }
    return;
  }

  record(`request shape accepted (${CLAUDE_MODEL})`, true, `round trip ${elapsed}ms`);

  const payload = await response.json();
  const text = (payload.content ?? []).find((block) => block.type === 'text')?.text;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    record('structured output is valid JSON', false, `Got: ${String(text).slice(0, 120)}`);
    return;
  }

  const missing = IDENTIFICATION_SCHEMA.required.filter((key) => !(key in parsed));
  record(
    'structured output matches schema',
    missing.length === 0,
    missing.length ? `Missing keys: ${missing.join(', ')}` : JSON.stringify(parsed),
  );

  const usage = payload.usage ?? {};
  note(`tokens: ${usage.input_tokens ?? '?'} in / ${usage.output_tokens ?? '?'} out`);

  if (isRealCover) {
    if (parsed.identified) {
      record('recognized the supplied cover', true, `${parsed.artist} — ${parsed.album} (${parsed.year})`);
    } else {
      console.log(`${paint('33', '  WARN')}  recognized the supplied cover`);
      note('Model returned identified:false. Try a clearer, well-cropped, ');
      note('front-facing shot of a reasonably well-known sleeve.');
    }
  } else {
    note('Contract only — pass an album cover image path to test recognition:');
    note('  node scripts/smoke-test.mjs ~/Desktop/cover.jpg');
  }
}

// ── run ─────────────────────────────────────────────────────────────────────
console.log(bold('\nCrate — API smoke test'));
console.log(dim('Verifies credentials and the request shapes the app depends on.'));

await spotifyChecks();
await claudeChecks(process.argv[2]);

const failed = results.filter((result) => !result.ok);
console.log('');
if (failed.length === 0) {
  console.log(paint('32', bold('All checks passed — safe to run on a device.')));
} else {
  console.log(paint('31', bold(`${failed.length} check(s) failed:`)));
  for (const result of failed) console.log(paint('31', `  · ${result.name}`));
}
console.log('');
process.exit(failed.length === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * Post-processes `expo export --platform web` output into a deployable PWA.
 *
 * Expo generates index.html for us but knows nothing about manifests or
 * service workers (SDK 50 dropped built-in PWA support), so we inject those
 * tags here rather than maintaining a forked HTML template.
 *
 * It also audits the bundle for leaked credentials. Crate is deployed to a
 * public URL, so that check is a hard gate: the script exits non-zero and the
 * deploy fails rather than publishing a key.
 *
 *   node scripts/build-web.mjs [dist-dir]
 */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(root, process.argv[2] ?? 'dist');

// Must match app.config.js, which uses the same variable for the bundle's
// asset URLs. Keep the two in step or the page loads and the JS 404s.
const DEFAULT_BASE_PATH = '/vinylCompanionApp';
function resolveBasePath() {
  const raw = process.env.PAGES_BASE_PATH;
  if (raw === undefined) return DEFAULT_BASE_PATH;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
const BASE_URL = resolveBasePath();
// Directory form, always with a trailing slash: "/vinylCompanionApp/" or "/".
const BASE_DIR = `${BASE_URL}/`;

const tty = process.stdout.isTTY;
const paint = (code, text) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
const ok = (text) => console.log(`${paint('32', '  ok')}    ${text}`);
const warn = (text) => console.log(`${paint('33', '  warn')}  ${text}`);
const fail = (text) => console.log(`${paint('31', '  FAIL')}  ${text}`);

if (!existsSync(dist)) {
  fail(`No export found at ${dist}. Run: npx expo export --platform web`);
  process.exit(1);
}

console.log(paint('1', '\nCrate — web post-build'));

// ── 1. Inject PWA tags into index.html ──────────────────────────────────────
const indexPath = path.join(dist, 'index.html');
if (!existsSync(indexPath)) {
  fail('index.html missing from the export.');
  process.exit(1);
}

let html = await readFile(indexPath, 'utf8');

// Expo already emits its own theme-color from app.json, so only add ours when
// it isn't there — two of them is harmless but confusing to read.
const themeColorTag = html.includes('name="theme-color"')
  ? ''
  : '\n    <meta name="theme-color" content="#0F0F0F" />';

/*
 * Camera access needs a secure context, so the scanner is dead over plain
 * HTTP — silently, with only a console error. GitHub Pages serves HTTPS on
 * *.github.io always, but a custom domain stays HTTP until its certificate is
 * issued and "Enforce HTTPS" is ticked, and any link to http:// keeps working
 * afterwards.
 *
 * Upgrading in the page removes that whole class of confusion. It runs first
 * in <head>, before the bundle loads, so there is no flash of a broken app.
 * localhost is exempt — it counts as secure, and dev servers are HTTP.
 */
const HTTPS_UPGRADE = `
    <script>
      (function () {
        var host = location.hostname;
        var isLocal =
          host === 'localhost' ||
          host === '127.0.0.1' ||
          host === '[::1]' ||
          host.endsWith('.local');
        if (location.protocol === 'http:' && !isLocal) {
          location.replace(
            'https://' + location.host + location.pathname + location.search + location.hash
          );
        }
      })();
    </script>
`;

const HEAD_TAGS = `
    <link rel="manifest" href="${BASE_DIR}manifest.webmanifest" />${themeColorTag}
    <meta name="color-scheme" content="dark" />
    <meta name="description" content="Identify album covers with your camera and keep track of the records you own." />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Crate" />
    <link rel="apple-touch-icon" href="${BASE_DIR}icons/icon-1024.png" />
`;

const SW_REGISTRATION = `
    <script>
      // Registered after load so it never competes with the app bundle for
      // bandwidth on a first visit.
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
          navigator.serviceWorker
            .register('${BASE_DIR}sw.js', { scope: '${BASE_DIR}' })
            .catch(function (error) {
              console.warn('Service worker registration failed:', error);
            });
        });
      }
    </script>
`;

if (html.includes('manifest.webmanifest')) {
  warn('index.html already carries PWA tags — skipping injection.');
} else {
  if (!html.includes('</head>') || !html.includes('<head>')) {
    fail('index.html has no <head> to inject into.');
    process.exit(1);
  }
  // The upgrade goes first so it runs before the bundle is even requested.
  html = html.replace('<head>', `<head>${HTTPS_UPGRADE}`);
  html = html.replace('</head>', `${HEAD_TAGS}  </head>`);
  html = html.replace('</body>', `${SW_REGISTRATION}  </body>`);
  await writeFile(indexPath, html);
  ok(`injected HTTPS upgrade, manifest, iOS meta tags, and SW registration`);
  ok(`base path: ${BASE_DIR}`);
}

// ── 1b. Rewrite the manifest for the active base path ───────────────────────
// public/manifest.webmanifest is checked in with the default paths; rewrite
// them so a different PAGES_BASE_PATH doesn't produce a manifest whose
// start_url points somewhere that doesn't exist.
const manifestPath = path.join(dist, 'manifest.webmanifest');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const updated = { ...manifest, start_url: BASE_DIR, scope: BASE_DIR, id: BASE_DIR };
  if (JSON.stringify(updated) !== JSON.stringify(manifest)) {
    await writeFile(manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
    ok(`manifest start_url/scope/id set to ${BASE_DIR}`);
  }
}

// ── 2. Confirm the static assets Pages needs actually made it across ────────
const required = ['manifest.webmanifest', 'sw.js', '.nojekyll', 'icons/icon-1024.png'];
let missing = false;
for (const file of required) {
  if (existsSync(path.join(dist, file))) {
    ok(`present: ${file}`);
  } else {
    fail(`missing: ${file} (should be copied from public/)`);
    missing = true;
  }
}
if (missing) {
  fail('Expected files from public/ did not reach the export.');
  process.exit(1);
}

// GitHub Pages runs Jekyll, which silently drops directories beginning with an
// underscore — and Expo puts the entire JS bundle in _expo/. Without this file
// the deployed site is a blank page.
ok('.nojekyll present — _expo/ will survive GitHub Pages');

// ── 3. Hard gate: no credentials in the published bundle ────────────────────
async function* walk(dir) {
  for (const entry of await readdir(dir)) {
    const full = path.join(dir, entry);
    if ((await stat(full)).isDirectory()) yield* walk(full);
    else yield full;
  }
}

// NOTE: EXPO_PUBLIC_SPOTIFY_CLIENT_ID is deliberately absent. Under PKCE the
// client ID is a public identifier meant to ship in the bundle; the secret is
// what must never appear, and it is no longer used at all.
const SECRET_PATTERNS = [
  { name: 'Claude API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'EXPO_PUBLIC_CLAUDE_API_KEY value', re: /EXPO_PUBLIC_CLAUDE_API_KEY["'\s:=]+["'][^"']{12,}/ },
  {
    name: 'EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET value',
    re: /EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET["'\s:=]+["'][^"']{12,}/,
  },
];

const leaks = [];
for await (const file of walk(dist)) {
  if (!/\.(js|html|json|map|webmanifest)$/.test(file)) continue;
  const contents = await readFile(file, 'utf8');
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(contents)) {
      leaks.push({ file: path.relative(dist, file), name });
    }
  }
}

if (leaks.length) {
  console.log('');
  fail('Credentials found in the build output — refusing to continue.');
  for (const leak of leaks) console.log(`        ${leak.name} in ${leak.file}`);
  console.log('');
  console.log('  Crate deploys to a public URL. Keys must be entered at runtime');
  console.log('  in Settings, never compiled in. Unset EXPO_PUBLIC_* before building.');
  console.log('');
  process.exit(1);
}
ok('no credentials found in the build output');

// ── 3b. Report whether Spotify sign-in will actually work ───────────────────
// EXPO_PUBLIC_* is inlined during the build, never read at runtime, so a
// deploy that ran before the variable was set silently produces a bundle with
// no client ID — and the only symptom is a Settings screen with no sign-in
// button. Say so here, where it is visible in the CI log.
const spotifyClientId = (process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '').trim();
if (spotifyClientId) {
  // Safe to print a fragment: under PKCE this is a public identifier, and it
  // is the only proof the variable actually reached the build.
  ok(`Spotify sign-in enabled (client ID …${spotifyClientId.slice(-4)})`);
} else {
  warn('EXPO_PUBLIC_SPOTIFY_CLIENT_ID is not set — this build has no Spotify sign-in.');
  warn('  In CI: set the SPOTIFY_CLIENT_ID repository *variable* (Settings →');
  warn('  Secrets and variables → Actions → Variables), then re-run this workflow.');
  warn('  Users of the built app can still paste a client ID in Settings.');
}

// ── 4. Report ───────────────────────────────────────────────────────────────
let bytes = 0;
let count = 0;
for await (const file of walk(dist)) {
  bytes += (await stat(file)).size;
  count += 1;
}

console.log('');
console.log(paint('32', paint('1', 'Web build ready.')));
console.log(`  ${count} files, ${(bytes / 1024 / 1024).toFixed(2)} MB in ${path.relative(root, dist)}/`);
console.log('');

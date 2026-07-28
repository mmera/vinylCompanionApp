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

const BASE_URL = '/vinylCompanionApp';

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

const HEAD_TAGS = `
    <link rel="manifest" href="${BASE_URL}/manifest.webmanifest" />${themeColorTag}
    <meta name="color-scheme" content="dark" />
    <meta name="description" content="Identify album covers with your camera and keep track of the records you own." />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Crate" />
    <link rel="apple-touch-icon" href="${BASE_URL}/icons/icon-1024.png" />
`;

const SW_REGISTRATION = `
    <script>
      // Registered after load so it never competes with the app bundle for
      // bandwidth on a first visit.
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
          navigator.serviceWorker
            .register('${BASE_URL}/sw.js', { scope: '${BASE_URL}/' })
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
  if (!html.includes('</head>')) {
    fail('index.html has no </head> to inject into.');
    process.exit(1);
  }
  html = html.replace('</head>', `${HEAD_TAGS}  </head>`);
  html = html.replace('</body>', `${SW_REGISTRATION}  </body>`);
  await writeFile(indexPath, html);
  ok('injected manifest, theme-color, iOS meta tags, and SW registration');
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

const SECRET_PATTERNS = [
  { name: 'Claude API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'EXPO_PUBLIC_CLAUDE_API_KEY value', re: /EXPO_PUBLIC_CLAUDE_API_KEY["'\s:=]+["'][^"']{12,}/ },
  {
    name: 'EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET value',
    re: /EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET["'\s:=]+["'][^"']{12,}/,
  },
  { name: 'EXPO_PUBLIC_SPOTIFY_CLIENT_ID value', re: /EXPO_PUBLIC_SPOTIFY_CLIENT_ID["'\s:=]+["'][^"']{12,}/ },
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

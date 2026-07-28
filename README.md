# Crate

A vinyl record companion. Point the camera at a record sleeve and it tells you what
you're holding; keep the ones you own in a local collection.

Runs as an iOS app via Expo Go, and as an installable PWA on GitHub Pages.
Personal use only — no accounts, no backend, no analytics. Everything lives on the device.

- **Scanner** — a live camera view that analyses what it sees every ~1.8s and identifies
  the album cover. No shutter button.
- **Collection** — records you own, stored locally, with cover art, full tracklists, and
  30-second previews.

---

## Credentials, and why there are none in this repo

Crate calls Claude and Spotify **directly from your device**. There is no server in
between, which means there is nowhere to hide a shared API key.

So the app doesn't have one. On first launch it asks for your own keys, stores them in
your browser's `localStorage` (or `AsyncStorage` on iOS), and never sends them anywhere
except to Claude and Spotify. The deployed bundle contains no credentials at all — the
build fails if it ever does (see [Deploying](#deploying-as-a-pwa)).

That's what makes it safe to host the PWA at a public URL. Anyone can visit it, but they
bring their own keys and see their own collection.

### Getting a Claude API key

1. Sign in at [platform.claude.com](https://platform.claude.com).
2. **Settings → API keys → Create key**.
3. Copy the key (starts with `sk-ant-`) into Crate's Settings screen.

The key needs credit — scanning is a paid API call. Each scan sends one downscaled
frame (~768px JPEG) and asks for a short JSON response, so per-scan cost is small, but
the scanner fires continuously while the Scanner tab is open. Switch tabs to stop it.

### Getting Spotify credentials

1. Sign in at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
2. **Create app**. Name and description can be anything.
3. Redirect URI: `http://localhost:3000` — Crate uses the Client Credentials flow and
   never redirects, but the form requires a value.
4. Tick **Web API**, then save.
5. Copy the **Client ID** and **Client secret** from the app's Settings into Crate.

No Spotify login is needed — Client Credentials grants public catalog access (search,
albums, tracks), which is all Crate reads.

---

## Running locally

### iOS (Expo Go)

```bash
npm install
npm start
```

Scan the QR code with your iPhone camera. Enter your keys in Settings on first launch.

You do **not** need a Mac or Xcode. The scanner needs a real device — the simulator has
no usable camera.

**Optional shortcut for development:** copy `.env.example` to `.env` and fill it in.
Those values pre-seed the Settings screen so you don't retype keys on every reinstall.
`.env` is gitignored and is *never* read by the web build (see below).

### Web

```bash
npm run web
```

---

## Deploying as a PWA

Pushing to the default branch builds and publishes to GitHub Pages automatically via
`.github/workflows/deploy-pages.yml`.

**One-time setup:** in the repo, go to **Settings → Pages → Build and deployment** and
set **Source** to **GitHub Actions**. Then push, or run the workflow manually from the
Actions tab.

The site lands at `https://<user>.github.io/vinylCompanionApp/`.

To install it: open that URL, then **Share → Add to Home Screen** on iOS, or the install
icon in the address bar on desktop Chrome/Edge.

### Building it yourself

```bash
npm run build:web        # → dist/
```

This runs `expo export --platform web` with `EXPO_NO_DOTENV=1`, then
`scripts/build-web.mjs`, which:

1. Injects the manifest link, theme colour, iOS meta tags, and service worker
   registration into Expo's generated `index.html`.
2. Checks the files GitHub Pages needs actually made it across.
3. **Scans every built file for credentials and exits non-zero if it finds any.**

Step 3 is the important one. `EXPO_PUBLIC_*` variables are inlined into the JS bundle at
build time, so a stray `.env` during a build would publish your keys to a public URL.
`EXPO_NO_DOTENV=1` stops `.env` being read, and the audit is the backstop — the deploy
fails rather than leaking. (This is not theoretical: it caught exactly that during
development.)

### Deployment notes

- **`public/.nojekyll` is load-bearing.** GitHub Pages runs Jekyll, which silently drops
  directories starting with `_` — and Expo puts the entire bundle in `_expo/`. Without
  that file the deployed site is a blank page.
- **The base path is hardcoded** to `/vinylCompanionApp` in `app.json`
  (`experiments.baseUrl`), `public/manifest.webmanifest`, and `scripts/build-web.mjs`.
  If you rename the repo or use a custom domain, update all three.
- **The service worker never caches API traffic.** It ignores cross-origin requests
  entirely, so Claude and Spotify calls — and the credentials in their headers — are
  never written to disk. It only caches the app shell.

---

## Browser caveats

| | |
| --- | --- |
| **iOS Safari camera** | `getUserMedia` is blocked in in-app browsers (Instagram, Slack…). Open in Safari directly, or install to the Home Screen. |
| **HTTPS required** | Camera access needs a secure context. GitHub Pages is HTTPS, so this only bites on a plain-HTTP local network test. |
| **Claude CORS** | The Messages API rejects browser requests without an explicit opt-in header. Crate sends `anthropic-dangerous-direct-browser-access`. The name warns against shipping a *shared* key to a browser — here each person supplies their own, which never leaves their device. |
| **Spotify CORS** | Verified in-app via **Test connection** rather than assumed. If your browser blocks the token request, the Settings screen tells you plainly. |

---

## Testing

### 1. Does it bundle?

```bash
npx expo export --platform ios     # native
npm run build:web                  # web + PWA + credential audit
```

Catches import errors, bad syntax, and missing dependencies without a device.

### 2. Do the APIs work?

**In the app:** Settings → **Test connection**. Verifies both APIs for real, and on web
doubles as a CORS check. This is the fastest path.

**From the command line** (uses `.env`):

```bash
npm run smoke                      # credentials + request contracts
npm run smoke -- ~/cover.jpg       # also test real cover recognition
```

The smoke test verifies that Claude accepts the exact request shape the scanner sends —
`thinking: disabled` plus `output_config.effort` and `output_config.format` together,
with a base64 image block. If that contract is wrong, scanning is completely broken, and
this catches it in seconds. It also reports whether Spotify returns preview clips for
your app.

### 3. On a device

| Check | What to look for |
| --- | --- |
| First launch | Onboarding prompts for keys; Save works; scanning starts |
| Camera permission | Denying shows the explainer, not a crash |
| Scanning | Status chip reads "Scanning…"; a sleeve produces a result card |
| Unrecognized | Point at a wall — after ~2 misses it says "Not recognized", keeps trying |
| Add to collection | Record appears at the top of the Collection grid |
| Duplicate scan | Re-scan the same record — reads "In your collection", no error |
| Tab switch | Leave Scanner mid-scan; scanning stops and resumes on return |
| Preview | Tap a track; audio plays, tapping another switches cleanly |
| Silent switch | Flip the ringer to silent — previews still audible |
| Deep link | "Open in Spotify" opens the app if installed, else the web player |
| Offline | Airplane mode — errors surface as messages, nothing crashes |
| Persistence | Force-quit and reopen; collection and keys are still there |
| PWA install | Add to Home Screen; launches standalone with no browser chrome |

### Known gaps

No unit tests. Most of the app is UI or an API call, and the smoke test covers what's
most likely to break. If this grows, `src/services/spotify.js` normalization and
`src/storage/collection.js` are the natural first candidates.

---

## How it works

### Scanning

`CameraView` captures a frame, `expo-image-manipulator` downscales it to 768px wide and
re-encodes it as a ~60%-quality JPEG, and that base64 payload goes to the Claude Messages
API as an image content block.

The request pins the response shape with **structured outputs** (a JSON schema), so the
model returns exactly `{ identified, artist, album, year, confidence }` — no prose to
parse. Thinking is disabled at `low` effort: identifying a cover is perception, not
reasoning, and the loop is latency-sensitive.

The loop is self-scheduling rather than an interval, so the next capture only starts once
the previous round trip settles and requests can never stack. It backs off to 6 seconds on
a rate limit, and stops with a message on a bad key rather than burning requests.

Once Claude names an album, the artist/title pair is resolved against Spotify search for
real cover art, tracklist, and links. If Claude recognizes a sleeve that isn't on Spotify,
the result card still shows what it found and explains what's missing.

### Collection

A single JSON array in device storage under `crate:collection:v1`, keyed by Spotify album
ID. A provider holds it in memory so every screen reads one source of truth. Re-adding an
album you already own is a no-op, not an error.

### Previews

One app-wide `expo-audio` player is reused for every track, so starting a preview anywhere
implicitly stops whatever was playing before.

> **Heads up:** Spotify stopped returning `preview_url` for apps created after
> **27 November 2024**. If your app is new, every track returns `null` and the Preview
> button is disabled with a note explaining why. That's a Spotify platform change, not a
> bug — "Open in Spotify" still works, and playback is fully implemented for any app that
> does return clips.

### Why `fetch` instead of `@anthropic-ai/sdk`

The official SDK's credential chain statically imports `node:fs` and `node:path` to
resolve keys from disk. Metro can't bundle Node built-ins for React Native, and shimming
them app-wide to satisfy a code path we never execute would be fragile. The Claude call is
one POST with a few headers — see `src/services/claude.js`.

---

## Project layout

```
App.js                        Providers + navigation container
app.json                      Expo config, PWA metadata, GitHub Pages base path
public/                       Copied verbatim into the web build
  manifest.webmanifest        PWA manifest
  sw.js                       Service worker (app shell only, never API traffic)
  .nojekyll                   Stops GitHub Pages eating _expo/
scripts/
  smoke-test.mjs              CLI check of both API contracts
  build-web.mjs               PWA injection + credential leak audit
.github/workflows/
  deploy-pages.yml            Build and deploy to GitHub Pages
src/
  theme.js                    Colors, spacing, type scale
  services/
    claude.js                 Vision identification (Messages API, structured outputs)
    spotify.js                Client Credentials auth, search, albums, tracks
  storage/
    credentials.js            Runtime key store (device-local)
    collection.js             Collection persistence
  context/
    CredentialsContext.js     Credential state + startup hydration gate
    CollectionContext.js      In-memory collection state
    PreviewPlayerContext.js   Single shared audio player
  hooks/
    useAlbumScanner.js        The capture → identify → resolve loop
  components/                 Button, AlbumArt, AlbumTile, AlbumActions, ScanResultCard, EmptyState
  screens/                    Scanner, Collection, Search, AlbumDetail, Settings
  navigation/
    RootNavigator.js          Bottom tabs + stack
```

---

## A note on the model

The original spec named `claude-sonnet-4-20250514`. That model is deprecated and past its
retirement date, so requests to it fail with a 404 — the scanner would never identify
anything. Crate defaults to **`claude-sonnet-5`**, the documented drop-in replacement.

To use a different model, set it in Settings (or `EXPO_PUBLIC_CLAUDE_MODEL` in `.env`).
Anything with vision and structured-output support will work.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| "Add your API keys" | No credentials saved yet — open Settings. |
| "Claude rejected your API key" | Bad or revoked key, or the account has no credit. |
| "Spotify rejected your credentials" | Client ID/secret mismatch — re-copy both from the dashboard. |
| Preview button always disabled | Spotify isn't returning preview clips for your app (see above). |
| Nothing gets recognized | Fill more of the frame with the sleeve, avoid glare, hold steady. |
| Camera black in the iOS simulator | Expected. Use a physical device. |
| Deployed site is blank | `.nojekyll` missing from the build, or Pages source isn't set to GitHub Actions. |
| Deploy fails on the audit step | A credential reached the bundle — check for a `.env` in CI. Working as intended. |
| PWA won't install | Needs HTTPS, a reachable manifest, and a registered service worker. Check the browser console. |

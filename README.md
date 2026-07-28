# Crate

A vinyl record companion for iOS. Point the camera at a record sleeve and it tells you
what you're holding; keep the ones you own in a local collection.

Personal use only — no accounts, no backend, no analytics. Everything lives on the device.

- **Scanner** — a live camera view that analyses what it sees every ~1.8s and identifies
  the album cover. No shutter button.
- **Collection** — records you own, stored locally, with cover art, full tracklists, and
  30-second previews.

---

## Requirements

- Node 18+
- The **Expo Go** app on an iPhone ([App Store](https://apps.apple.com/app/expo-go/id982107779))
- A Claude API key and a Spotify app (both free to create — see below)

You do **not** need a Mac or Xcode. The scanner needs a real device: the simulator has no
usable camera.

---

## Setup

```bash
npm install
cp .env.example .env     # then fill in your keys — see below
npm start
```

Scan the QR code from the terminal with your iPhone camera to open the project in Expo Go.

`.env` is gitignored. Restart the dev server after editing it — Expo inlines these values
at bundle time, so a running server won't pick up changes.

### Getting a Claude API key

1. Sign in at [platform.claude.com](https://platform.claude.com).
2. Go to **Settings → API keys** and click **Create key**.
3. Copy the key (it starts with `sk-ant-`) into `.env` as `EXPO_PUBLIC_CLAUDE_API_KEY`.

The key needs credit on the account — scanning is a paid API call. Each scan sends one
downscaled frame (~768px JPEG) and asks for a short JSON response, so cost per scan is
small, but the scanner fires continuously while the tab is open. Switch away from the
Scanner tab to stop it.

### Getting Spotify credentials

1. Sign in at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
2. Click **Create app**. Name and description can be anything.
3. For **Redirect URI** enter `http://localhost:3000` — Crate uses the Client Credentials
   flow and never redirects, but the form requires a value.
4. Check **Web API** under "Which API/SDKs are you planning to use?", then save.
5. Open the app's **Settings** and copy the **Client ID** and **Client secret** into `.env`.

No Spotify login is required to use Crate — Client Credentials grants access to public
catalog data (search, albums, tracks), which is all the app reads.

### `.env`

```sh
EXPO_PUBLIC_CLAUDE_API_KEY=sk-ant-...
EXPO_PUBLIC_SPOTIFY_CLIENT_ID=...
EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET=...

# Optional — override the vision model
# EXPO_PUBLIC_CLAUDE_MODEL=claude-sonnet-5
```

Expo only exposes variables prefixed with `EXPO_PUBLIC_` to app code, which is why the
names differ from the plain `CLAUDE_API_KEY` you may see elsewhere.

> **On key safety:** `EXPO_PUBLIC_` variables are compiled into the JavaScript bundle, so
> anyone with the built app can read them. That's an acceptable trade for a personal app
> you build and run yourself, but don't publish this to TestFlight or the App Store with
> live keys in it. A production version would put both APIs behind a small proxy server.

---

## How it works

### Scanning

`CameraView` captures a frame, `expo-image-manipulator` downscales it to 768px wide and
re-encodes it as a ~60%-quality JPEG, and that base64 payload goes to the Claude Messages
API as an image content block.

The request pins the response shape with **structured outputs** (a JSON schema), so the
model returns exactly `{ identified, artist, album, year, confidence }` and there is no
prose to parse. Thinking is disabled and effort is set to `low` — identifying a cover is
perception, not reasoning, and the loop is latency-sensitive.

The loop is self-scheduling rather than an interval: the next capture only starts once the
previous round trip settles, so a slow response can never stack requests. On a rate limit
or network error it backs off to 6 seconds; on a bad key it stops and says so rather than
burning requests.

Once Claude names an album, the artist/title pair is resolved against Spotify search to get
the real cover art, tracklist, and links. If Claude recognizes a sleeve that isn't on
Spotify, the result card still shows what it found and explains what's missing.

### Collection

Records are stored as a single JSON array in `AsyncStorage` under `crate:collection:v1`,
keyed by Spotify album ID. A `CollectionProvider` holds them in memory so the scanner,
grid, and detail screens all read the same state. Re-adding an album you already own is a
no-op, not an error — it's the natural result of scanning a record twice.

### Previews

One app-wide `expo-audio` player is reused for every track, so starting a preview anywhere
implicitly stops whatever was playing before.

> **Heads up on preview availability:** Spotify stopped returning `preview_url` for apps
> created after **27 November 2024**. If your app is new, `previewUrl` will be `null` on
> every track and the Preview button will be disabled with a note explaining why. This is a
> Spotify platform change, not a bug in Crate — "Open in Spotify" still works, and playback
> is fully implemented for any app or release that does return clips.

### Why `fetch` instead of `@anthropic-ai/sdk`

The official SDK's credential chain statically imports `node:fs` and `node:path` to resolve
keys from disk. Metro can't bundle Node built-ins for React Native, and shimming them
app-wide to satisfy a code path we never execute (Crate passes its key explicitly) would be
fragile. The Claude call here is one POST with three headers, so it uses `fetch` directly —
see `src/services/claude.js`.

---

## Testing

### 1. Does it bundle?

```bash
npx expo export --platform ios
```

Catches import errors, bad syntax, and missing dependencies across every module
without needing a device. Fast, and worth running before any device test.

### 2. Do the APIs work? (no device needed)

```bash
npm run smoke                      # credentials + request contracts
npm run smoke -- ~/cover.jpg       # also test real cover recognition
```

This is the high-value check. It verifies your keys and — more importantly — that
Claude accepts the exact request shape the scanner sends (`thinking: disabled` plus
`output_config.effort` and `output_config.format` together, with a base64 image
block). If that contract is wrong, scanning is completely broken, and this catches
it in seconds rather than in front of a record shelf.

It also tells you whether Spotify returns preview clips for *your* app, which
determines if the Preview button will ever be usable (see the note above).

Pass a photo of a real album cover to test recognition quality end to end.

### 3. On a device (Expo Go)

The camera, permission flow, and audio playback can only be verified on hardware.
Worth walking through:

| Check | What to look for |
| --- | --- |
| First launch | Camera permission prompt appears; denying shows the explainer, not a crash |
| Scanning | Status chip reads "Scanning…"; point at a sleeve and a result card slides up |
| Unrecognized | Point at a wall — after ~2 misses it says "Not recognized", keeps trying |
| Add to collection | Card's Add button; record appears at the top of the Collection grid |
| Duplicate scan | Re-scan the same record — button reads "In your collection", no error |
| Tab switch | Leave Scanner mid-scan; scanning stops (no further API calls) and resumes on return |
| Preview | Tap a track in the detail view; audio plays, tapping another switches cleanly |
| Silent switch | Flip the ringer to silent — previews should still be audible |
| Deep link | "Open in Spotify" opens the app if installed, else the web player |
| Offline | Turn on airplane mode — errors surface as messages, nothing crashes |
| Persistence | Force-quit and reopen; the collection is still there |

### Known gaps

There are no unit tests. The logic worth testing in isolation is thin — most of
the app is either UI or an API call — and the smoke test covers the parts most
likely to actually break. If this grows, `src/services/spotify.js` normalization
and `src/storage/collection.js` are the natural first candidates.

---

## Project layout

```
App.js                      Providers + navigation container
src/
  config/env.js             Reads and validates EXPO_PUBLIC_* variables
  theme.js                  Colors, spacing, type scale
  services/
    claude.js               Vision identification (Messages API, structured outputs)
    spotify.js              Client Credentials auth, search, albums, tracks
  storage/
    collection.js           AsyncStorage read/write for the collection
  context/
    CollectionContext.js    In-memory collection state
    PreviewPlayerContext.js Single shared audio player
  hooks/
    useAlbumScanner.js      The capture → identify → resolve loop
  components/               Button, AlbumArt, AlbumTile, AlbumActions, ScanResultCard, EmptyState
  screens/                  Scanner, Collection, Search, AlbumDetail
  navigation/
    RootNavigator.js        Bottom tabs + stack
```

---

## A note on the model

The original spec named `claude-sonnet-4-20250514`. That model is deprecated and past its
retirement date, so requests to it fail with a 404 — the scanner would never identify
anything. Crate defaults to **`claude-sonnet-5`**, the documented drop-in replacement.

To use a different model, set `EXPO_PUBLIC_CLAUDE_MODEL` in `.env`; nothing else needs to
change, as long as the model supports vision and structured outputs.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| "Add your API keys" on the Scanner tab | `.env` is missing values, or the dev server wasn't restarted after editing it. |
| "Claude rejected your API key" | Bad or revoked key, or the account has no credit. |
| "Spotify rejected your credentials" | Client ID/secret mismatch — re-copy both from the dashboard. |
| Preview button always disabled | Spotify isn't returning preview clips for your app (see above). |
| Nothing gets recognized | Fill more of the frame with the sleeve, avoid glare, and hold steady — it retries every ~1.8s. |
| Camera is black in the simulator | Expected. Use a physical device. |

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Runtime credential store.
 *
 * Crate ships to GitHub Pages, where the JS bundle is world-readable — so no
 * key is ever compiled into it. Credentials are entered by whoever is using
 * the app and live only in their own device storage (localStorage on web,
 * AsyncStorage natively).
 *
 * `EXPO_PUBLIC_*` values still act as a seed so local native development
 * keeps working from `.env` without retyping keys. Those are only ever
 * populated in a local build; the deployed web bundle has none.
 *
 * Reads are synchronous against an in-memory cache so the scan loop and the
 * Spotify client don't have to await storage on every call. `hydrate()` runs
 * once at startup, before anything reads.
 */

const STORAGE_KEY = 'crate:credentials:v1';

const PLACEHOLDER = /^x+$|^sk-ant-x+$/i;

function clean(value) {
  const trimmed = (value ?? '').trim();
  return !trimmed || PLACEHOLDER.test(trimmed) ? '' : trimmed;
}

/** Seeds from .env — present in local dev, empty in the deployed web build. */
const ENV_DEFAULTS = {
  claudeApiKey: clean(process.env.EXPO_PUBLIC_CLAUDE_API_KEY),
  claudeModel: clean(process.env.EXPO_PUBLIC_CLAUDE_MODEL),
};

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';

const EMPTY = {
  claudeApiKey: '',
  claudeModel: '',
  // Not a credential: a fallback for the Spotify client ID when the build was
  // made without one. See `config/spotifyConfig.js`.
  spotifyClientId: '',
};

let cache = { ...EMPTY, ...ENV_DEFAULTS };
let hydrated = false;
const listeners = new Set();

function notify() {
  for (const listener of listeners) listener(cache);
}

/** Load saved credentials. Call once, before the first API request. */
export async function hydrateCredentials() {
  if (hydrated) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Anything the user saved wins over the .env seed.
      cache = {
        claudeApiKey: clean(saved.claudeApiKey) || ENV_DEFAULTS.claudeApiKey,
        claudeModel: clean(saved.claudeModel) || ENV_DEFAULTS.claudeModel,
        spotifyClientId: clean(saved.spotifyClientId),
      };
    }
  } catch {
    // Unreadable or corrupt store — fall back to the .env seed rather than
    // blocking startup. The user can re-enter keys in Settings.
  }
  hydrated = true;
  notify();
  return cache;
}

/** Current credentials. Synchronous — safe inside the scan loop. */
export function getCredentials() {
  return cache;
}

export function getClaudeModel() {
  return cache.claudeModel || DEFAULT_CLAUDE_MODEL;
}

/**
 * Save whichever fields are present. Callers own different parts of this
 * store — the Settings form owns the Claude fields, the Spotify section owns
 * the client ID — so an omitted key means "leave it alone" rather than
 * "clear it". Without that, whichever section saved last would wipe the other.
 */
export async function saveCredentials(next) {
  const merge = (key) => (key in next ? clean(next[key]) : cache[key]);

  cache = {
    claudeApiKey: merge('claudeApiKey'),
    claudeModel: merge('claudeModel'),
    spotifyClientId: merge('spotifyClientId'),
  };
  hydrated = true;

  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch (error) {
    notify();
    throw new Error('Could not save your keys to this device.');
  }

  notify();
  return cache;
}

/**
 * Removes the keys, not the Spotify client ID — that is a public identifier
 * standing in for a missing build-time value, and dropping it here would sign
 * the user out of Spotify as a side effect of clearing their Claude key. The
 * Spotify section has its own control for forgetting it.
 */
export async function clearCredentials() {
  cache = { ...EMPTY, spotifyClientId: cache.spotifyClientId };
  hydrated = true;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // In-memory state is already cleared; a failed erase is not worth blocking on.
  }
  notify();
  return cache;
}

export function subscribeToCredentials(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasClaudeCredentials(credentials = cache) {
  return Boolean(credentials.claudeApiKey);
}

/**
 * Spotify credentials no longer live here — sign-in is PKCE (see
 * `storage/spotifySession.js`) rather than a developer ID and secret typed in
 * by the user. The one Spotify value left is `spotifyClientId`, and it is not
 * a credential: under PKCE the client ID is a public identifier that normally
 * ships in the bundle. It is kept here only as a fallback for builds made
 * without `EXPO_PUBLIC_SPOTIFY_CLIENT_ID`, so a missing build-time variable
 * leaves the app fixable instead of bricked.
 */

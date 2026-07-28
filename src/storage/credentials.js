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

export async function saveCredentials(next) {
  cache = {
    claudeApiKey: clean(next.claudeApiKey),
    claudeModel: clean(next.claudeModel),
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

export async function clearCredentials() {
  cache = { ...EMPTY };
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
 * Spotify no longer lives here — it uses a PKCE sign-in (see
 * `storage/spotifySession.js`) rather than developer credentials typed in by
 * the user. The only thing left in this store is the Claude API key.
 */

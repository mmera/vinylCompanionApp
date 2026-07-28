import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The signed-in Spotify session.
 *
 * Kept separate from `credentials.js` because it is a different kind of thing:
 * credentials are typed in by a person, this is minted by an OAuth exchange
 * and expires. Reads are synchronous against an in-memory cache so the
 * request path never awaits storage.
 */

const STORAGE_KEY = 'crate:spotify-session:v1';

// Refresh a minute early so a token can't expire mid-request.
const EXPIRY_SKEW_MS = 60_000;

let cache = null; // { accessToken, refreshToken, expiresAt, scope }
let hydrated = false;
const listeners = new Set();

function notify() {
  for (const listener of listeners) listener(cache);
}

export async function hydrateSpotifySession() {
  if (hydrated) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved?.accessToken) cache = saved;
    }
  } catch {
    // Unreadable store — behave as signed out rather than blocking startup.
  }
  hydrated = true;
  notify();
  return cache;
}

export function getSpotifySession() {
  return cache;
}

export function isSignedIn() {
  return Boolean(cache?.accessToken);
}

/** True when the access token is missing or about to expire. */
export function needsRefresh() {
  if (!cache?.accessToken) return true;
  if (!cache.expiresAt) return false;
  return cache.expiresAt - EXPIRY_SKEW_MS <= Date.now();
}

/**
 * @param {{accessToken: string, refreshToken?: string, expiresIn?: number, scope?: string}} token
 */
export async function saveSpotifySession(token) {
  cache = {
    accessToken: token.accessToken,
    // Spotify omits refresh_token on some refresh responses; keep the old one
    // rather than losing the ability to refresh again.
    refreshToken: token.refreshToken || cache?.refreshToken || null,
    expiresAt: token.expiresIn ? Date.now() + token.expiresIn * 1000 : null,
    scope: token.scope ?? cache?.scope ?? '',
  };
  hydrated = true;

  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // In-memory session still works for this run; it just won't survive a reload.
  }
  notify();
  return cache;
}

export async function clearSpotifySession() {
  cache = null;
  hydrated = true;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Already gone as far as this session is concerned.
  }
  notify();
}

export function subscribeToSpotifySession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

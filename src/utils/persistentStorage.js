import { Platform } from 'react-native';

/**
 * Browser storage is evictable by default.
 *
 * Credentials and the collection live in localStorage, which browsers are
 * free to clear under disk pressure — and iOS Safari wipes script-writable
 * storage after 7 days without a visit for sites that aren't installed to the
 * Home Screen. Losing your keys a week later looks like a bug in the app.
 *
 * The Storage API lets us ask for an exemption. Chromium grants it based on
 * engagement heuristics (installed as a PWA, bookmarked, repeat visits);
 * Safari grants it on Home Screen install. Asking is cheap and idempotent,
 * so we ask at startup and again once keys are saved — that second moment is
 * a real engagement signal and more likely to be granted.
 *
 * Nothing here is load-bearing: if the request is refused or unsupported,
 * storage still works exactly as before, it's just evictable.
 */

const NATIVE_RESULT = { supported: false, persisted: true, reason: 'native' };

function unsupported(reason) {
  return { supported: false, persisted: false, reason };
}

/** Ask the browser not to evict this origin's storage. Safe to call repeatedly. */
export async function requestPersistentStorage() {
  // Native storage is already durable — nothing to negotiate.
  if (Platform.OS !== 'web') return NATIVE_RESULT;
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return unsupported('no-storage-api');
  }
  if (typeof navigator.storage.persist !== 'function') {
    return unsupported('no-persist');
  }

  try {
    if (typeof navigator.storage.persisted === 'function') {
      const already = await navigator.storage.persisted();
      if (already) return { supported: true, persisted: true, reason: 'already-granted' };
    }
    const granted = await navigator.storage.persist();
    return { supported: true, persisted: granted, reason: granted ? 'granted' : 'denied' };
  } catch {
    // Some browsers throw in private mode rather than returning false.
    return unsupported('threw');
  }
}

/** Read current persistence without requesting it. */
export async function getPersistenceState() {
  if (Platform.OS !== 'web') return NATIVE_RESULT;
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) {
    return unsupported('no-storage-api');
  }
  try {
    return { supported: true, persisted: await navigator.storage.persisted(), reason: 'queried' };
  } catch {
    return unsupported('threw');
  }
}

/**
 * The origin credentials are bound to. Worth showing, because moving between
 * http/https or between domains silently starts from an empty store.
 */
export function storageOrigin() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
  return window.location.origin;
}

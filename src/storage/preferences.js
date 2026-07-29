import AsyncStorage from '@react-native-async-storage/async-storage';

import { SORT_MODES } from '../utils/collectionView';

/**
 * How the collection is displayed.
 *
 * Persisted, because a view preference the app forgets every launch is worse
 * than not offering one: you'd re-pick it on every visit. Kept apart from the
 * collection itself — this is about the viewer, not the records.
 */

const STORAGE_KEY = 'crate:collection-view:v1';

const VIEW_MODES = ['grid', 'list'];

const DEFAULTS = { view: 'grid', sort: 'added', name: '' };

// Long enough for "Marco's Records"; short enough to stay one line as a title.
const MAX_NAME = 40;

let cache = { ...DEFAULTS };
let hydrated = false;
const listeners = new Set();

function notify() {
  for (const listener of listeners) listener(cache);
}

/**
 * Ignore anything unrecognised — a stale or hand-edited value must not produce
 * a collection screen that renders nothing.
 *
 * Note this *whitelists*: it builds a fresh object, and runs on every write, so
 * a key that isn't listed here is silently dropped rather than passed through.
 */
function sanitize(saved) {
  return {
    view: VIEW_MODES.includes(saved?.view) ? saved.view : DEFAULTS.view,
    sort: SORT_MODES.some((mode) => mode.id === saved?.sort) ? saved.sort : DEFAULTS.sort,
    /*
     * Free text, so length and type validation rather than an enum check —
     * and deliberately NOT trimmed.
     *
     * The name field writes on every keystroke and reads its value straight
     * back from here, so trimming on write ate the space the moment it was
     * typed: a trailing space was removed before it could round-trip to the
     * input, making "Marco's Collection" impossible to type. Whitespace is
     * trimmed where the name is displayed instead, which is the only place it
     * actually matters.
     */
    name: typeof saved?.name === 'string' ? saved.name.slice(0, MAX_NAME) : DEFAULTS.name,
  };
}

export async function hydratePreferences() {
  if (hydrated) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) cache = sanitize(JSON.parse(raw));
  } catch {
    // Unreadable store — the defaults are perfectly usable.
  }
  hydrated = true;
  notify();
  return cache;
}

export function getPreferences() {
  return cache;
}

export async function savePreferences(patch) {
  cache = sanitize({ ...cache, ...patch });
  hydrated = true;
  notify();

  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Applies for this session; it just won't survive a reload.
  }
  return cache;
}

export function subscribeToPreferences(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

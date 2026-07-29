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

export const VIEW_MODES = ['grid', 'list'];

const DEFAULTS = { view: 'grid', sort: 'added' };

let cache = { ...DEFAULTS };
let hydrated = false;
const listeners = new Set();

function notify() {
  for (const listener of listeners) listener(cache);
}

/** Ignore anything unrecognised — a stale or hand-edited value must not
 *  produce a collection screen that renders nothing. */
function sanitize(saved) {
  return {
    view: VIEW_MODES.includes(saved?.view) ? saved.view : DEFAULTS.view,
    sort: SORT_MODES.some((mode) => mode.id === saved?.sort) ? saved.sort : DEFAULTS.sort,
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

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The record collection, persisted locally on device.
 *
 * Everything is stored under one key as a JSON array — a personal collection
 * is small enough that per-record keys would only add read amplification.
 */

const STORAGE_KEY = 'crate:collection:v1';

export class StorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
  }
}

/**
 * @typedef {Object} CollectionRecord
 * @property {string} id            Spotify album ID, or `manual:<uuid>` — also the dedupe key.
 * @property {string} name
 * @property {string} artist
 * @property {string} year
 * @property {string|null} imageUrl
 * @property {string|null} thumbnailUrl
 * @property {string|null} spotifyUri   Null for manual records.
 * @property {string|null} spotifyUrl   Null for manual records.
 * @property {string} [notes]           Manual records only.
 * @property {number} addedAt           Epoch ms.
 * @property {'scan'|'search'|'manual'} source
 * @property {'owned'|'wishlist'} status
 */

/**
 * Owned and wanted are the same kind of thing recorded twice over, so they
 * share a store and differ by one field. That keeps searching, sorting and
 * grouping working on the wishlist for free, and makes buying a record a field
 * change rather than a move between stores.
 *
 * Kept separate from `source`, which is provenance ('scan' | 'search' |
 * 'manual') and answers a different question. Overloading it would repeat the
 * two-sources-of-truth mistake that `isManualId` exists to avoid.
 */
export const OWNED = 'owned';
export const WISHLIST = 'wishlist';

const STATUSES = [OWNED, WISHLIST];

export function isStatus(value) {
  return STATUSES.includes(value);
}

/**
 * Records that exist only on the shelf, not in Spotify's catalog — private
 * pressings, bootlegs, most 7"s, anything out of print. Their IDs are
 * namespaced so they can never collide with a Spotify album ID, and so that
 * "is this a real catalog entry?" is answerable from the ID alone.
 */
export const MANUAL_ID_PREFIX = 'manual:';

/**
 * The ID is the single source of truth for whether a record is manual.
 *
 * `source` also records 'manual', but it is provenance metadata alongside
 * 'scan' and 'search' — treating either as sufficient would leave two facts
 * that nothing keeps in step, and only the ID is available to a caller holding
 * an ID and nothing else.
 */
export function isManualId(id) {
  return String(id ?? '').startsWith(MANUAL_ID_PREFIX);
}

export function isManualRecord(record) {
  return isManualId(record?.id);
}

/** Accessible name for a record, wherever it is rendered. */
export function recordLabel(record) {
  const base = `${record.artist}, ${record.name}`;
  return isManualRecord(record) ? `${base}, added by hand` : base;
}

function manualId() {
  // randomUUID needs a secure context and isn't in every engine Crate runs on
  // (older iOS Safari, Hermes), so fall back to something collision-proof
  // enough for a single device's collection.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${MANUAL_ID_PREFIX}${crypto.randomUUID()}`;
  }
  return `${MANUAL_ID_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function loadCollection() {
  let raw;
  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY);
  } catch (error) {
    throw new StorageError('Could not read your collection from this device.', error);
  }

  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (
      parsed
        .filter((record) => record?.id)
        /*
         * Status is defaulted here rather than by rewriting the store, so
         * every record saved before the wishlist existed reads as owned — which
         * it is — with no migration step to run, fail, or repeat. An
         * unrecognised value falls back the same way.
         */
        .map((record) => (isStatus(record.status) ? record : { ...record, status: OWNED }))
        // Newest first, so a freshly scanned record lands at the top of the grid.
        .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
    );
  } catch {
    // Corrupt payload: better to start clean than to hard-fail every launch.
    return [];
  }
}

async function persist(records) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    throw new StorageError('Could not save to your collection.', error);
  }
}

/**
 * Add an album. Re-adding one you already have is a no-op rather than an error —
 * it's the natural outcome of pointing the scanner at a record you already own.
 *
 * The exception is a record already saved under the *other* status: adding a
 * wishlisted record to the collection is how buying it gets recorded, so that
 * promotes it in place rather than reporting "already saved" and doing nothing.
 *
 * @returns {Promise<{records: CollectionRecord[], added: boolean, moved: boolean}>}
 */
export async function addToCollection(album, { source = 'scan', status = OWNED } = {}) {
  if (!album?.id) throw new StorageError('That album is missing an ID and cannot be saved.');

  const records = await loadCollection();
  const existing = records.find((record) => record.id === album.id);

  if (existing) {
    if (existing.status === status) return { records, added: false, moved: false };

    const next = records.map((record) =>
      record.id === album.id ? { ...record, status } : record,
    );
    await persist(next);
    return { records: next, added: false, moved: true };
  }

  const record = {
    id: album.id,
    name: album.name,
    artist: album.artist,
    year: album.year ?? '',
    imageUrl: album.imageUrl ?? null,
    thumbnailUrl: album.thumbnailUrl ?? album.imageUrl ?? null,
    spotifyUri: album.spotifyUri ?? `spotify:album:${album.id}`,
    spotifyUrl: album.spotifyUrl ?? `https://open.spotify.com/album/${album.id}`,
    addedAt: Date.now(),
    source,
    status,
  };

  const next = [record, ...records];
  await persist(next);
  return { records: next, added: true, moved: false };
}

/**
 * Move a record between owned and wishlist.
 *
 * Deliberately separate from `updateManualRecord`, which throws for catalog
 * IDs — status is the one field that belongs to every record regardless of
 * where it came from.
 */
export async function setRecordStatus(recordId, status) {
  if (!isStatus(status)) throw new StorageError(`Unknown status "${status}".`);

  const records = await loadCollection();
  if (!records.some((record) => record.id === recordId)) {
    throw new StorageError('That record is no longer in your collection.');
  }

  const next = records.map((record) =>
    record.id === recordId ? { ...record, status } : record,
  );
  await persist(next);
  return next;
}

/**
 * Add a record by hand. Unlike `addToCollection` there is nothing to dedupe
 * against — two different pressings of the same album are two records, and
 * only the owner can say whether that is what they meant.
 *
 * @returns {Promise<{records: CollectionRecord[], record: CollectionRecord}>}
 */
export async function addManualRecord(fields = {}, { status = OWNED } = {}) {
  const record = {
    id: manualId(),
    ...normalizeManualFields(fields),
    imageUrl: null,
    thumbnailUrl: null,
    // Explicitly null rather than a derived URL: there is no catalog entry
    // behind a manual record, so every "open in Spotify" affordance must be
    // able to tell that it has nowhere to go.
    spotifyUri: null,
    spotifyUrl: null,
    addedAt: Date.now(),
    source: 'manual',
    status: isStatus(status) ? status : OWNED,
  };

  const next = [record, ...(await loadCollection())];
  await persist(next);
  return { records: next, record };
}

function normalizeManualFields({ artist, name, year, notes }) {
  const cleanArtist = (artist ?? '').trim();
  const cleanName = (name ?? '').trim();

  if (!cleanArtist || !cleanName) {
    throw new StorageError('A record needs both an artist and an album title.');
  }

  return {
    artist: cleanArtist,
    name: cleanName,
    year: (year ?? '').trim(),
    notes: (notes ?? '').trim(),
  };
}

/** Edit a manual record. Catalog records are owned by Spotify, not by us. */
export async function updateManualRecord(recordId, fields) {
  const records = await loadCollection();
  const existing = records.find((record) => record.id === recordId);

  if (!existing) throw new StorageError('That record is no longer in your collection.');
  if (!isManualRecord(existing)) {
    throw new StorageError('Only records added by hand can be edited.');
  }

  const updated = { ...existing, ...normalizeManualFields(fields) };
  const next = records.map((record) => (record.id === recordId ? updated : record));
  await persist(next);
  return { records: next, record: updated };
}

export async function removeFromCollection(albumId) {
  const records = await loadCollection();
  const next = records.filter((record) => record.id !== albumId);
  await persist(next);
  return next;
}

export async function isInCollection(albumId) {
  const records = await loadCollection();
  return records.some((record) => record.id === albumId);
}

/**
 * Overwrite the whole collection — restoring from a backup.
 *
 * Deliberately a wholesale replace rather than a merge: a backup represents a
 * known-good state at a point in time, and silently unioning it with whatever
 * is on the device would produce a third state that never existed. The caller
 * decides whether replacing is appropriate; `useBackupSync` only does it when
 * local is empty.
 *
 * Runs the same normalisation as `loadCollection`, so a hand-edited or older
 * backup gets the same defaulting and cannot introduce records without an id.
 */
export async function replaceCollection(records) {
  if (!Array.isArray(records)) {
    throw new StorageError('That backup does not contain a collection.');
  }

  const next = records
    .filter((record) => record?.id)
    .map((record) => (isStatus(record.status) ? record : { ...record, status: OWNED }))
    .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));

  await persist(next);
  return next;
}

export async function clearCollection() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    throw new StorageError('Could not clear your collection.', error);
  }
  return [];
}

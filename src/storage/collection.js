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
 * @property {string} id            Spotify album ID — also the dedupe key.
 * @property {string} name
 * @property {string} artist
 * @property {string} year
 * @property {string|null} imageUrl
 * @property {string|null} thumbnailUrl
 * @property {string} spotifyUri
 * @property {string} spotifyUrl
 * @property {number} addedAt        Epoch ms.
 * @property {'scan'|'search'} source
 */

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
    // Newest first, so a freshly scanned record lands at the top of the grid.
    return parsed.filter((record) => record?.id).sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
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
 * Add an album. Re-adding an existing album is a no-op rather than an error —
 * it's the natural outcome of pointing the scanner at a record you already own.
 *
 * @returns {Promise<{records: CollectionRecord[], added: boolean}>}
 */
export async function addToCollection(album, { source = 'scan' } = {}) {
  if (!album?.id) throw new StorageError('That album is missing an ID and cannot be saved.');

  const records = await loadCollection();
  if (records.some((record) => record.id === album.id)) {
    return { records, added: false };
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
  };

  const next = [record, ...records];
  await persist(next);
  return { records: next, added: true };
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

export async function clearCollection() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    throw new StorageError('Could not clear your collection.', error);
  }
  return [];
}

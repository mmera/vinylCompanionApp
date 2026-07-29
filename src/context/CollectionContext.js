import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  OWNED,
  WISHLIST,
  addManualRecord,
  addToCollection,
  loadCollection,
  removeFromCollection,
  setRecordGenres,
  setRecordStatus,
  updateManualRecord,
} from '../storage/collection';
import { fetchArtistGenres } from '../services/spotify';

/**
 * Holds the collection in memory so the scanner, grid, and detail screens all
 * see the same state without re-reading AsyncStorage on every render.
 */

const CollectionContext = createContext(null);

export function CollectionProvider({ children }) {
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setRecords(await loadCollection());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /*
   * Fill in genres for anything that hasn't been looked up yet.
   *
   * Genre comes from the artist, so it needs a request the collection screen
   * can't make per render — it is looked up once, in a batch, and stored on
   * the record. Doing it here rather than at add time means records saved
   * before genres existed are filled in by the same code path, with no
   * separate migration.
   *
   * Best-effort throughout: signed out, offline, or refused all leave the
   * records untouched and sorting by genre simply groups them under "No
   * genre". `null` marks "asked, hasn't got one" so it isn't asked again.
   */
  useEffect(() => {
    if (isLoading) return undefined;

    const pending = records.filter((record) => record.artistId && !('genre' in record));
    if (!pending.length) return undefined;

    let active = true;
    (async () => {
      try {
        const byArtist = await fetchArtistGenres(pending.map((record) => record.artistId));
        if (!active) return;

        const byRecord = {};
        for (const record of pending) {
          if (record.artistId in byArtist) byRecord[record.id] = byArtist[record.artistId];
        }

        const next = await setRecordGenres(byRecord);
        if (active && next) setRecords(next);
      } catch {
        // Nothing to tell the user: the shelf works without genres.
      }
    })();

    return () => {
      active = false;
    };
  }, [records, isLoading]);

  const add = useCallback(async (album, options) => {
    const { records: next, added } = await addToCollection(album, options);
    setRecords(next);
    return added;
  }, []);

  const addManual = useCallback(async (fields, options) => {
    const { records: next, record } = await addManualRecord(fields, options);
    setRecords(next);
    return record;
  }, []);

  const updateManual = useCallback(async (recordId, fields) => {
    const { records: next, record } = await updateManualRecord(recordId, fields);
    setRecords(next);
    return record;
  }, []);

  const remove = useCallback(async (albumId) => {
    setRecords(await removeFromCollection(albumId));
  }, []);

  const setStatus = useCallback(async (recordId, status) => {
    setRecords(await setRecordStatus(recordId, status));
  }, []);

  /*
   * Two sets, not one.
   *
   * `owns()` gates every "Add to Collection" button in the app. If wishlisted
   * records counted as owned, each of those buttons would read "In your
   * collection" for a record you have explicitly not bought — the one thing
   * the wishlist exists to distinguish.
   */
  const { ownedIds, wishlistIds } = useMemo(() => {
    const owned = new Set();
    const wishlist = new Set();
    for (const record of records) {
      (record.status === WISHLIST ? wishlist : owned).add(record.id);
    }
    return { ownedIds: owned, wishlistIds: wishlist };
  }, [records]);

  const value = useMemo(
    () => ({
      records,
      ownedIds,
      wishlistIds,
      isLoading,
      error,
      add,
      addManual,
      updateManual,
      setStatus,
      remove,
      refresh,
      owns: (albumId) => ownedIds.has(albumId),
      isWishlisted: (albumId) => wishlistIds.has(albumId),
      statusOf: (albumId) =>
        ownedIds.has(albumId) ? OWNED : wishlistIds.has(albumId) ? WISHLIST : null,
    }),
    [
      records,
      ownedIds,
      wishlistIds,
      isLoading,
      error,
      add,
      addManual,
      updateManual,
      setStatus,
      remove,
      refresh,
    ],
  );

  return <CollectionContext.Provider value={value}>{children}</CollectionContext.Provider>;
}

export function useCollection() {
  const context = useContext(CollectionContext);
  if (!context) {
    throw new Error('useCollection must be used inside a CollectionProvider.');
  }
  return context;
}

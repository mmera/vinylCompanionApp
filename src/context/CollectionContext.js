import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  OWNED,
  WISHLIST,
  addManualRecord,
  addToCollection,
  loadCollection,
  removeFromCollection,
  setRecordStatus,
  subscribeToCollection,
  updateManualRecord,
} from '../storage/collection';

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
   * Pick up writes that didn't come through this context — a restore replaces
   * the whole store from useBackupSync, and the shelf has to follow it.
   *
   * The mutators below also call setRecords with the same array the store just
   * persisted, so this fires with an identical reference for those and React
   * skips the render.
   */
  useEffect(() => subscribeToCollection(setRecords), []);

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

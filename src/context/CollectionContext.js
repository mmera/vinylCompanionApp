import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  addManualRecord,
  addToCollection,
  loadCollection,
  removeFromCollection,
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

  const add = useCallback(async (album, options) => {
    const { records: next, added } = await addToCollection(album, options);
    setRecords(next);
    return added;
  }, []);

  const addManual = useCallback(async (fields) => {
    const { records: next, record } = await addManualRecord(fields);
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

  const ownedIds = useMemo(() => new Set(records.map((record) => record.id)), [records]);

  const value = useMemo(
    () => ({
      records,
      ownedIds,
      isLoading,
      error,
      add,
      addManual,
      updateManual,
      remove,
      refresh,
      owns: (albumId) => ownedIds.has(albumId),
    }),
    [records, ownedIds, isLoading, error, add, addManual, updateManual, remove, refresh],
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

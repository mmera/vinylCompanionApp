import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  addToCollection,
  loadCollection,
  removeFromCollection,
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
      remove,
      refresh,
      owns: (albumId) => ownedIds.has(albumId),
    }),
    [records, ownedIds, isLoading, error, add, remove, refresh],
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

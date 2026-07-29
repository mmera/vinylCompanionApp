import { useCallback, useEffect, useState } from 'react';

import {
  getPreferences,
  hydratePreferences,
  savePreferences,
  subscribeToPreferences,
} from '../storage/preferences';

/**
 * View and sort choice for the collection, loaded from device storage.
 *
 * Reads start from the in-memory cache so the first frame renders with
 * something sensible rather than flashing the default and then correcting
 * itself once storage answers.
 */
export function useCollectionPreferences() {
  const [preferences, setPreferences] = useState(getPreferences);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeToPreferences((next) => {
      if (active) setPreferences({ ...next });
    });

    hydratePreferences();

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const setView = useCallback((view) => savePreferences({ view }), []);
  const setSort = useCallback((sort) => savePreferences({ sort }), []);
  const setName = useCallback((name) => savePreferences({ name }), []);

  return {
    view: preferences.view,
    sort: preferences.sort,
    name: preferences.name,
    setView,
    setSort,
    setName,
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';

import { buildPayload, readBackup, writeBackup } from '../services/backup';
import { loadCollection, replaceCollection } from '../storage/collection';
import { getPreferences, savePreferences, subscribeToPreferences } from '../storage/preferences';
import { getCredentials, subscribeToCredentials } from '../storage/credentials';

/**
 * Keeps the collection mirrored to a Gist, without anyone having to remember.
 *
 * Manual export fails in exactly the situation it exists for — you forget, and
 * then storage is cleared. So this writes on change instead of on request.
 */

// Long enough that adding several records in a row is one write rather than
// one gist revision per tap.
const DEBOUNCE_MS = 5000;

export const BackupState = {
  OFF: 'off', // No token — the feature simply isn't set up.
  IDLE: 'idle',
  SAVING: 'saving',
  SAVED: 'saved',
  ERROR: 'error',
};

export function useBackupSync({ records, isLoading }) {
  const [state, setState] = useState(BackupState.OFF);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);
  const [hasToken, setHasToken] = useState(() => Boolean(getCredentials().githubToken));

  const timerRef = useRef(null);
  // What we last wrote, so an unchanged collection doesn't churn revisions.
  const lastPayloadRef = useRef(null);
  // Restore is a once-per-launch decision, not a reaction to every change.
  const restoreCheckedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = subscribeToCredentials((next) =>
      setHasToken(Boolean(next.githubToken)),
    );
    return unsubscribe;
  }, []);

  const push = useCallback(async (collection) => {
    setState(BackupState.SAVING);
    setError(null);
    try {
      const payload = buildPayload({ collection, preferences: getPreferences() });
      const result = await writeBackup(payload);
      lastPayloadRef.current = JSON.stringify({ ...payload, savedAt: 0 });
      setSavedAt(result.savedAt);
      setState(BackupState.SAVED);
      return result;
    } catch (pushError) {
      setError(pushError.message ?? 'Backup failed.');
      setState(BackupState.ERROR);
      throw pushError;
    }
  }, []);

  /*
   * Restore only into an empty collection.
   *
   * If there are records on the device, a backup could be older than they are,
   * and quietly replacing them would turn the safety net into the thing that
   * loses data. That case is a deliberate action in Settings instead.
   */
  const restore = useCallback(async () => {
    const backup = await readBackup();
    if (!backup) return null;

    const next = await replaceCollection(backup.collection);
    if (backup.preferences) await savePreferences(backup.preferences);
    setSavedAt(backup.savedAt ?? null);
    setState(BackupState.SAVED);
    return next;
  }, []);

  // Auto-restore on launch, once, and only into nothing.
  useEffect(() => {
    if (isLoading || !hasToken || restoreCheckedRef.current) return;
    restoreCheckedRef.current = true;
    if (records.length) return;

    (async () => {
      try {
        // Re-read rather than trusting the render that scheduled this: the
        // provider may have loaded records in between.
        if ((await loadCollection()).length) return;
        await restore();
      } catch {
        // A failed restore leaves an empty collection, which is where we
        // already were. Settings reports it; nothing here should block launch.
      }
    })();
  }, [isLoading, hasToken, records.length, restore]);

  // Debounced write on any change to the collection or preferences.
  useEffect(() => {
    if (isLoading || !hasToken) {
      setState(hasToken ? BackupState.IDLE : BackupState.OFF);
      return undefined;
    }

    const payload = JSON.stringify({
      ...buildPayload({ collection: records, preferences: getPreferences() }),
      savedAt: 0,
    });
    if (payload === lastPayloadRef.current) return undefined;

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      push(records).catch(() => {
        // Already surfaced through state; nothing to do here.
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timerRef.current);
  }, [records, isLoading, hasToken, push]);

  // Preference changes should back up too, without owning their own effect.
  const [prefTick, setPrefTick] = useState(0);
  useEffect(() => subscribeToPreferences(() => setPrefTick((tick) => tick + 1)), []);
  useEffect(() => {
    if (prefTick) lastPayloadRef.current = null;
  }, [prefTick]);

  return {
    state,
    savedAt,
    error,
    hasToken,
    backUpNow: () => push(records),
    restoreNow: restore,
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';

import { BackupError, buildPayload, readBackup, writeBackup } from '../services/backup';
import { loadCollection, replaceCollection } from '../storage/collection';
import { getPreferences, savePreferences, subscribeToPreferences } from '../storage/preferences';
import { getCredentials, subscribeToCredentials } from '../storage/credentials';

/**
 * Keeps the collection mirrored to a Gist, without anyone having to remember.
 *
 * Manual export fails in exactly the situation it exists for — you forget, and
 * then storage is cleared. So this writes on change instead of on request.
 *
 * The rule the whole file is built around: **an automatic write must never be
 * able to destroy the backup.** A device holding an empty collection is far
 * more often one whose storage was cleared than a collection someone emptied on
 * purpose — and that is exactly the moment the backup is the only copy left.
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
  const [gistUrl, setGistUrl] = useState(null);
  const [hasToken, setHasToken] = useState(() => Boolean(getCredentials().githubToken));

  /*
   * Automatic writes are held until the launch restore check has run.
   *
   * State rather than a ref, because the write effect below has to re-run when
   * the gate opens — a ref would change without waking anything up.
   */
  const [restoreChecked, setRestoreChecked] = useState(false);
  const restoreStartedRef = useRef(false);

  const timerRef = useRef(null);
  // What we last wrote, so an unchanged collection doesn't churn revisions.
  const lastPayloadRef = useRef(null);

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
      if (result.url) setGistUrl(result.url);
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

    if (backup.url) setGistUrl(backup.url);

    /*
     * Refuse to restore nothing over something.
     *
     * An empty backup replacing a real collection is never what was wanted, and
     * locally it is unrecoverable once done — whereas the gist keeps every
     * earlier revision, so there is somewhere better to send the person.
     */
    if (!backup.collection.length && (await loadCollection()).length) {
      throw new BackupError(
        'The backup is empty, so your collection was left alone. An earlier version may still be in the gist’s revision history.',
      );
    }

    const next = await replaceCollection(backup.collection);
    if (backup.preferences) await savePreferences(backup.preferences);

    // Treat what was just restored as already backed up, so the write effect
    // doesn't immediately push identical content back as a new revision.
    lastPayloadRef.current = JSON.stringify({
      ...buildPayload({ collection: next, preferences: getPreferences() }),
      savedAt: 0,
    });

    setSavedAt(backup.savedAt ?? null);
    setState(BackupState.SAVED);
    return next;
  }, []);

  // Auto-restore on launch, once, and only into nothing.
  useEffect(() => {
    if (isLoading || !hasToken || restoreStartedRef.current) return;
    restoreStartedRef.current = true;

    (async () => {
      try {
        // Re-read rather than trusting the render that scheduled this: the
        // provider may have loaded records in between.
        if ((await loadCollection()).length === 0) await restore();
      } catch {
        // A failed restore leaves an empty collection, which is where we
        // already were. Settings reports it; nothing here should block launch.
      } finally {
        // Opens the gate on automatic writes either way — a restore that failed
        // still had its turn, and the empty-collection guard below covers the
        // case where it failed because GitHub was unreachable.
        setRestoreChecked(true);
      }
    })();
  }, [isLoading, hasToken, restore]);

  // Debounced write on any change to the collection or preferences.
  useEffect(() => {
    if (isLoading || !hasToken) {
      setState(hasToken ? BackupState.IDLE : BackupState.OFF);
      return undefined;
    }

    // Never write ahead of the restore check. On a device whose storage was
    // cleared the first render is an empty collection, and writing that would
    // overwrite the backup with nothing before the restore could read it.
    if (!restoreChecked) return undefined;

    /*
     * Never write an empty collection automatically.
     *
     * Deleting your last record by hand is real but rare, and "Back up now"
     * records it deliberately. Storage having been cleared looks identical from
     * here and is far more common — so the automatic path always declines.
     */
    if (!records.length) return undefined;

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
  }, [records, isLoading, hasToken, restoreChecked, push]);

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
    gistUrl,
    backUpNow: () => push(records),
    restoreNow: restore,
  };
}

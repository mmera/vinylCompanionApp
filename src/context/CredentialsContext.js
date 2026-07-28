import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  clearCredentials,
  getCredentials,
  hasClaudeCredentials,
  hydrateCredentials,
  saveCredentials,
  subscribeToCredentials,
} from '../storage/credentials';
import { requestPersistentStorage, storageOrigin } from '../utils/persistentStorage';

/**
 * Exposes the credential store to the UI and gates the app until it has
 * loaded, so no screen ever renders a "missing key" state while storage is
 * still being read.
 */

const CredentialsContext = createContext(null);

export function CredentialsProvider({ children }) {
  const [credentials, setCredentials] = useState(getCredentials);
  const [isReady, setIsReady] = useState(false);
  const [persistence, setPersistence] = useState({ supported: false, persisted: false });

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeToCredentials((next) => {
      if (active) setCredentials({ ...next });
    });

    hydrateCredentials().finally(() => {
      if (active) setIsReady(true);
    });

    // Ask the browser not to evict our storage. Never blocks startup.
    requestPersistentStorage().then((state) => {
      if (active) setPersistence(state);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const save = useCallback(async (next) => {
    const saved = await saveCredentials(next);
    // Saving keys is a genuine engagement signal, and browsers weigh those
    // when deciding whether to grant persistent storage — so ask again here
    // even if the startup request was declined.
    requestPersistentStorage().then(setPersistence);
    return saved;
  }, []);

  const clear = useCallback(() => clearCredentials(), []);

  const value = useMemo(
    () => ({
      credentials,
      isReady,
      save,
      clear,
      persistence,
      origin: storageOrigin(),
      hasClaude: hasClaudeCredentials(credentials),
    }),
    [credentials, isReady, save, clear, persistence],
  );

  return <CredentialsContext.Provider value={value}>{children}</CredentialsContext.Provider>;
}

export function useCredentials() {
  const context = useContext(CredentialsContext);
  if (!context) {
    throw new Error('useCredentials must be used inside a CredentialsProvider.');
  }
  return context;
}

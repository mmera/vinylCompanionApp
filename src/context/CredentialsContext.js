import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  clearCredentials,
  getCredentials,
  hasClaudeCredentials,
  hasSpotifyCredentials,
  hydrateCredentials,
  isFullyConfigured,
  missingCredentialLabels,
  saveCredentials,
  subscribeToCredentials,
} from '../storage/credentials';

/**
 * Exposes the credential store to the UI and gates the app until it has
 * loaded, so no screen ever renders a "missing key" state while storage is
 * still being read.
 */

const CredentialsContext = createContext(null);

export function CredentialsProvider({ children }) {
  const [credentials, setCredentials] = useState(getCredentials);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeToCredentials((next) => {
      if (active) setCredentials({ ...next });
    });

    hydrateCredentials().finally(() => {
      if (active) setIsReady(true);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const save = useCallback((next) => saveCredentials(next), []);
  const clear = useCallback(() => clearCredentials(), []);

  const value = useMemo(
    () => ({
      credentials,
      isReady,
      save,
      clear,
      hasClaude: hasClaudeCredentials(credentials),
      hasSpotify: hasSpotifyCredentials(credentials),
      isConfigured: isFullyConfigured(credentials),
      missing: missingCredentialLabels(credentials),
    }),
    [credentials, isReady, save, clear],
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

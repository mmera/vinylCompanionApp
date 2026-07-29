import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { exchangeCodeAsync, useAuthRequest } from 'expo-auth-session';

import {
  BUILD_SPOTIFY_CLIENT_ID,
  SPOTIFY_DISCOVERY,
  SPOTIFY_SCOPES,
  spotifyRedirectUri,
} from '../config/spotifyConfig';
import { useCredentials } from './CredentialsContext';
import {
  clearSpotifySession,
  getSpotifySession,
  hydrateSpotifySession,
  isAccessDenied,
  saveSpotifySession,
  subscribeToSpotifySession,
} from '../storage/spotifySession';

/**
 * "Log in with Spotify" — Authorization Code + PKCE.
 *
 * expo-auth-session generates the code verifier/challenge and handles the
 * redirect on both web and native, so all we own here is exchanging the
 * returned code for tokens and persisting the session.
 */

const SpotifyAuthContext = createContext(null);

export function SpotifyAuthProvider({ children }) {
  const { credentials } = useCredentials();
  const [session, setSession] = useState(getSpotifySession);
  // Re-read on every session notification; `setAccessDenied` notifies too, so
  // a refusal mid-session re-renders the UI that reports the state.
  const [accessDenied, setAccessDeniedState] = useState(isAccessDenied);
  const [isReady, setIsReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState(null);

  const redirectUri = useMemo(() => spotifyRedirectUri(), []);

  // Read through the store rather than the module constant, so a client ID
  // saved in Settings takes effect without a reload.
  const clientId = BUILD_SPOTIFY_CLIENT_ID || credentials.spotifyClientId;

  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId,
      scopes: SPOTIFY_SCOPES,
      usePKCE: true,
      redirectUri,
    },
    SPOTIFY_DISCOVERY,
  );

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeToSpotifySession((next) => {
      if (!active) return;
      setSession(next ? { ...next } : null);
      setAccessDeniedState(isAccessDenied());
    });

    hydrateSpotifySession().finally(() => {
      if (active) setIsReady(true);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Complete the exchange once the redirect comes back with a code.
  useEffect(() => {
    if (!response) return;

    if (response.type === 'error') {
      setIsSigningIn(false);
      setError(response.params?.error_description || response.error?.message || 'Spotify sign-in failed.');
      return;
    }

    if (response.type === 'dismiss' || response.type === 'cancel') {
      setIsSigningIn(false);
      return;
    }

    if (response.type !== 'success' || !response.params?.code) return;

    let active = true;
    (async () => {
      try {
        const token = await exchangeCodeAsync(
          {
            clientId,
            code: response.params.code,
            redirectUri,
            // The verifier proves this exchange belongs to the request that
            // started the flow — the reason no client secret is needed.
            extraParams: { code_verifier: request?.codeVerifier ?? '' },
          },
          SPOTIFY_DISCOVERY,
        );

        if (!active) return;
        await saveSpotifySession({
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresIn: token.expiresIn,
          scope: token.scope,
        });
        setError(null);
      } catch (exchangeError) {
        if (active) setError(exchangeError?.message ?? 'Could not complete Spotify sign-in.');
      } finally {
        if (active) setIsSigningIn(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [response, request, redirectUri, clientId]);

  const signIn = useCallback(async () => {
    if (!clientId) {
      setError('No Spotify client ID — add one below, or set it in the build.');
      return;
    }
    if (!request) return; // Still preparing the PKCE challenge.
    setError(null);
    setIsSigningIn(true);
    try {
      await promptAsync();
    } catch (promptError) {
      setError(promptError?.message ?? 'Could not open Spotify sign-in.');
      setIsSigningIn(false);
    }
  }, [clientId, request, promptAsync]);

  const signOut = useCallback(async () => {
    await clearSpotifySession();
    setError(null);
  }, []);

  const value = useMemo(
    () => ({
      isSignedIn: Boolean(session?.accessToken),
      isReady,
      isSigningIn,
      error,
      signIn,
      signOut,
      redirectUri,
      // Signed in and refused are independent: the account can hold a perfectly
      // valid token and still not be on the app's Development Mode allowlist.
      accessDenied,
      canSignIn: Boolean(clientId) && Boolean(request),
      isConfigured: Boolean(clientId),
      // True when the client ID came from Settings rather than the build, so
      // the UI can offer to forget it.
      usingSavedClientId: !BUILD_SPOTIFY_CLIENT_ID && Boolean(clientId),
    }),
    [
      session,
      accessDenied,
      isReady,
      isSigningIn,
      error,
      signIn,
      signOut,
      redirectUri,
      request,
      clientId,
    ],
  );

  return <SpotifyAuthContext.Provider value={value}>{children}</SpotifyAuthContext.Provider>;
}

export function useSpotifyAuth() {
  const context = useContext(SpotifyAuthContext);
  if (!context) {
    throw new Error('useSpotifyAuth must be used inside a SpotifyAuthProvider.');
  }
  return context;
}

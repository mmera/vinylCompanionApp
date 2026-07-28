import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { exchangeCodeAsync, useAuthRequest } from 'expo-auth-session';

import {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_DISCOVERY,
  SPOTIFY_SCOPES,
  hasSpotifyAppConfigured,
  spotifyRedirectUri,
} from '../config/spotifyConfig';
import {
  clearSpotifySession,
  getSpotifySession,
  hydrateSpotifySession,
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
  const [session, setSession] = useState(getSpotifySession);
  const [isReady, setIsReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState(null);

  const redirectUri = useMemo(() => spotifyRedirectUri(), []);

  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: SPOTIFY_CLIENT_ID,
      scopes: SPOTIFY_SCOPES,
      usePKCE: true,
      redirectUri,
    },
    SPOTIFY_DISCOVERY,
  );

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeToSpotifySession((next) => {
      if (active) setSession(next ? { ...next } : null);
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
            clientId: SPOTIFY_CLIENT_ID,
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
  }, [response, request, redirectUri]);

  const signIn = useCallback(async () => {
    if (!hasSpotifyAppConfigured) {
      setError('This build has no Spotify client ID. See the README.');
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
  }, [request, promptAsync]);

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
      canSignIn: hasSpotifyAppConfigured && Boolean(request),
      isConfigured: hasSpotifyAppConfigured,
    }),
    [session, isReady, isSigningIn, error, signIn, signOut, redirectUri, request],
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

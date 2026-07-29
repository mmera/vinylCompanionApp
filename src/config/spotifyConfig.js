import { Platform } from 'react-native';
import { makeRedirectUri } from 'expo-auth-session';

import { getCredentials } from '../storage/credentials';

/**
 * Spotify OAuth configuration (Authorization Code + PKCE).
 *
 * PKCE exists precisely so public clients — browsers, mobile apps — can do
 * OAuth without a client secret. The client ID is *not* a secret in this flow;
 * it is expected to ship in the bundle, the same way it does in every Spotify
 * web player integration. The secret is gone entirely, which is what lets us
 * stop asking users for developer credentials.
 */

/**
 * Baked in at build time from the environment. Empty in any build made without
 * the variable set — including a deploy that ran before the repository
 * variable existed, since `EXPO_PUBLIC_*` is inlined during the build and not
 * read at runtime.
 */
export const BUILD_SPOTIFY_CLIENT_ID = (process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '').trim();

/**
 * The client ID to authorise with: whatever was compiled in, or a value the
 * user saved on this device when the build carried none. The override exists
 * so a build without the variable is recoverable in Settings rather than a
 * dead end — pasting a public identifier is a far smaller ask than waiting on
 * someone to redeploy.
 */
export function getSpotifyClientId() {
  return BUILD_SPOTIFY_CLIENT_ID || getCredentials().spotifyClientId;
}

export const SPOTIFY_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

/**
 * Catalog search, albums, and tracks are all public data, so we request no
 * scopes at all. Logging in exists to obtain a token, not to reach into
 * anyone's account — there is nothing here to consent away.
 */
export const SPOTIFY_SCOPES = [];

/**
 * Spotify matches redirect URIs exactly, so build this deterministically
 * rather than leaving it to a heuristic — whatever this returns has to be
 * pasted into the dashboard verbatim.
 *
 * On web that is the app's own root: the export is a single-page bundle with
 * no server-side routing, so any deeper path would 404 on GitHub Pages.
 */
export function spotifyRedirectUri() {
  if (Platform.OS !== 'web') {
    return makeRedirectUri({ scheme: 'crate', path: 'spotify-auth' });
  }
  if (typeof window === 'undefined') return '';
  const path = window.location.pathname.replace(/\/+$/, '');
  return `${window.location.origin}${path}/`;
}


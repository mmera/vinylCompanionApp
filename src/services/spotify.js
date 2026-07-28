import { refreshAsync } from 'expo-auth-session';

import { SPOTIFY_CLIENT_ID, SPOTIFY_DISCOVERY } from '../config/spotifyConfig';
import {
  clearSpotifySession,
  getSpotifySession,
  isSignedIn,
  needsRefresh,
  saveSpotifySession,
} from '../storage/spotifySession';

/**
 * Spotify Web API using the signed-in user's token.
 *
 * Crate previously used the Client Credentials flow, which meant asking each
 * person for a client ID and secret — developer credentials no user should
 * ever handle. Now they sign in with PKCE and we use the resulting token.
 *
 * Everything Crate reads (search, albums, tracks) is public catalog data, so
 * the token carries no scopes; signing in exists to obtain a token, not to
 * reach into anyone's account.
 */

const API_BASE = 'https://api.spotify.com/v1';

export class SpotifyError extends Error {
  constructor(message, { status, retryable = true } = {}) {
    super(message);
    this.name = 'SpotifyError';
    this.status = status;
    this.retryable = retryable;
  }
}

/** Raised when the user needs to sign in (or sign in again). */
export class SpotifyAuthRequiredError extends SpotifyError {
  constructor(message = 'Sign in with Spotify to search the catalog.') {
    super(message, { retryable: false });
    this.name = 'SpotifyAuthRequiredError';
  }
}

// Concurrent callers share one refresh rather than racing to mint tokens.
let inFlightRefresh = null;

async function refreshAccessToken() {
  const session = getSpotifySession();
  if (!session?.refreshToken) {
    await clearSpotifySession();
    throw new SpotifyAuthRequiredError('Your Spotify session expired. Sign in again.');
  }

  if (!inFlightRefresh) {
    inFlightRefresh = refreshAsync(
      { clientId: SPOTIFY_CLIENT_ID, refreshToken: session.refreshToken },
      SPOTIFY_DISCOVERY,
    )
      .then(async (token) => {
        await saveSpotifySession({
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresIn: token.expiresIn,
          scope: token.scope,
        });
        return token.accessToken;
      })
      .catch(async (error) => {
        // A rejected refresh token is terminal — drop the session so the UI
        // can offer a fresh sign-in instead of retrying forever.
        await clearSpotifySession();
        throw new SpotifyAuthRequiredError(
          `Your Spotify session could not be renewed${error?.message ? ` (${error.message})` : ''}. Sign in again.`,
        );
      })
      .finally(() => {
        inFlightRefresh = null;
      });
  }

  return inFlightRefresh;
}

async function getAccessToken() {
  if (!isSignedIn()) throw new SpotifyAuthRequiredError();
  if (needsRefresh()) return refreshAccessToken();
  return getSpotifySession().accessToken;
}

/**
 * Spotify puts the useful part in the body: {"error":{"status":400,"message":"..."}}.
 * Discarding it turns every failure into an unactionable status code, so pull it
 * out and put it in the message.
 */
async function readErrorMessage(response) {
  try {
    const body = await response.json();
    return body?.error?.message ?? body?.error_description ?? '';
  } catch {
    return '';
  }
}

async function apiGet(path, { retryOnAuthFailure = true } = {}) {
  const token = await getAccessToken();

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new SpotifyError(
      'Cannot reach Spotify. Check your connection — and if this is the web app, that your browser is not blocking the request.',
    );
  }

  // A token can be revoked before our recorded expiry; force a refresh and
  // retry once before giving up on the session.
  if (response.status === 401 && retryOnAuthFailure) {
    await refreshAccessToken();
    return apiGet(path, { retryOnAuthFailure: false });
  }

  if (response.status === 429) {
    throw new SpotifyError('Spotify rate limit reached. Try again shortly.', { status: 429 });
  }

  if (!response.ok) {
    const detail = await readErrorMessage(response);

    // Spotify answers a malformed or empty bearer token with 400 rather than
    // 401, so say what that actually means instead of echoing "400".
    if (response.status === 400 && /bearer|token/i.test(detail)) {
      throw new SpotifyAuthRequiredError(
        `Spotify rejected the access token${detail ? ` — ${detail}` : ''}. Sign in again.`,
      );
    }

    // Include the request itself. A bare status code is unactionable, and the
    // path is what pins down which parameter Spotify is objecting to.
    throw new SpotifyError(
      detail
        ? `Spotify: ${detail} (${response.status})\nRequest: ${path}`
        : `Spotify request failed (${response.status}).\nRequest: ${path}`,
      { status: response.status, retryable: response.status >= 500 },
    );
  }

  return response.json();
}

/** Pick the artwork closest to (but not below) the size we intend to render. */
function pickImage(images, preferredWidth = 640) {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((image) => (image.width ?? 0) >= preferredWidth) ?? sorted[sorted.length - 1])
    .url;
}

function normalizeAlbum(album) {
  if (!album?.id) return null;
  return {
    id: album.id,
    name: album.name,
    artist: album.artists?.map((a) => a.name).join(', ') || 'Unknown artist',
    year: album.release_date ? String(album.release_date).slice(0, 4) : '',
    imageUrl: pickImage(album.images),
    thumbnailUrl: pickImage(album.images, 300),
    totalTracks: album.total_tracks ?? null,
    albumType: album.album_type ?? null,
    spotifyUri: album.uri ?? `spotify:album:${album.id}`,
    spotifyUrl: album.external_urls?.spotify ?? `https://open.spotify.com/album/${album.id}`,
  };
}

function normalizeTrack(track) {
  return {
    id: track.id,
    name: track.name,
    trackNumber: track.track_number,
    discNumber: track.disc_number ?? 1,
    durationMs: track.duration_ms,
    previewUrl: track.preview_url ?? null,
    artist: track.artists?.map((a) => a.name).join(', ') || '',
    spotifyUri: track.uri ?? (track.id ? `spotify:track:${track.id}` : null),
    spotifyUrl: track.external_urls?.spotify ?? null,
  };
}

/**
 * Free-text album search. Used both by manual search and to resolve a
 * Claude identification into real catalog metadata.
 *
 * Note we deliberately do not send `limit`. Spotify was rejecting requests
 * with "Invalid limit" despite a documented-valid value, and the parameter
 * buys us nothing: Spotify's own default page size is 20, which is at least
 * as many results as any caller here wants. Trimming client-side is free and
 * removes a whole class of failure from the request.
 */
export async function searchAlbums(query, { limit = 20 } = {}) {
  const trimmed = query?.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({ q: trimmed, type: 'album' });
  const body = await apiGet(`/search?${params.toString()}`);

  const albums = (body.albums?.items ?? []).map(normalizeAlbum).filter(Boolean);
  const count = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : albums.length;
  return albums.slice(0, count);
}

/**
 * Resolve a Claude identification (artist + album strings) to a catalog album.
 * Falls back to a plain free-text search when the fielded query finds nothing —
 * field filters are strict and miss on small spelling differences.
 */
export async function findAlbum({ artist, album }) {
  const fielded = await searchAlbums(`album:${album} artist:${artist}`, { limit: 5 });
  if (fielded.length) return fielded[0];

  const loose = await searchAlbums(`${artist} ${album}`, { limit: 5 });
  return loose[0] ?? null;
}

export async function getAlbum(albumId) {
  const body = await apiGet(`/albums/${albumId}`);
  const album = normalizeAlbum(body);
  if (!album) throw new SpotifyError('Album not found.', { retryable: false });
  return { ...album, tracks: (body.tracks?.items ?? []).map(normalizeTrack) };
}

/** Album detail needs the full tracklist; `/albums/{id}` caps its inline list at 50. */
export async function getAlbumTracks(albumId) {
  const tracks = [];
  let next = `/albums/${albumId}/tracks?limit=50`;

  while (next) {
    const body = await apiGet(next);
    tracks.push(...(body.items ?? []).map(normalizeTrack));
    next = body.next ? body.next.replace(API_BASE, '') : null;
  }

  return tracks;
}

/**
 * Connection check for the Settings screen: runs one small search, which
 * verifies the signed-in token works and that the browser can actually reach
 * Spotify (CORS included).
 */
export async function verifySpotifyConnection() {
  const albums = await searchAlbums('Rumours Fleetwood Mac', { limit: 1 });
  if (!albums.length) {
    throw new SpotifyError('Signed in, but search returned nothing.', { retryable: true });
  }
  return albums[0];
}

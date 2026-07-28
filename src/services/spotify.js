import {
  getCredentials,
  hasSpotifyCredentials,
  subscribeToCredentials,
} from '../storage/credentials';

/**
 * Spotify Web API via the Client Credentials flow.
 *
 * No user login — this grants access to public catalog data only (search,
 * albums, tracks), which is all Crate needs. Tokens last an hour and are
 * cached in memory; concurrent callers share one in-flight token request.
 */

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

export class SpotifyError extends Error {
  constructor(message, { status, retryable = true } = {}) {
    super(message);
    this.name = 'SpotifyError';
    this.status = status;
    this.retryable = retryable;
  }
}

let cachedToken = null; // { value: string, expiresAt: number }
let inFlightToken = null;

/** base64 without Buffer — React Native's Hermes has no Node globals. */
function base64Encode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let i = 0; i < input.length; i += 3) {
    const a = input.charCodeAt(i);
    const b = input.charCodeAt(i + 1);
    const c = input.charCodeAt(i + 2);
    const bitmap = (a << 16) | ((isNaN(b) ? 0 : b) << 8) | (isNaN(c) ? 0 : c);
    output +=
      alphabet[(bitmap >> 18) & 63] +
      alphabet[(bitmap >> 12) & 63] +
      (isNaN(b) ? '=' : alphabet[(bitmap >> 6) & 63]) +
      (isNaN(c) ? '=' : alphabet[bitmap & 63]);
  }
  return output;
}

async function fetchToken() {
  const { spotifyClientId, spotifyClientSecret } = getCredentials();
  const credentials = base64Encode(`${spotifyClientId}:${spotifyClientSecret}`);

  let response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
  } catch {
    throw new SpotifyError(
      'Cannot reach Spotify. Check your connection — and if this is the web app, that your browser is not blocking the request.',
    );
  }

  if (!response.ok) {
    throw new SpotifyError(
      response.status === 400 || response.status === 401
        ? 'Spotify rejected your credentials. Check the client ID and secret in Settings.'
        : `Spotify auth failed (${response.status}).`,
      { status: response.status, retryable: response.status >= 500 },
    );
  }

  const body = await response.json();
  return {
    value: body.access_token,
    // Refresh a minute early so a token never expires mid-request.
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 - 60_000,
  };
}

async function getAccessToken() {
  if (!hasSpotifyCredentials()) {
    throw new SpotifyError('Add your Spotify credentials in Settings.', { retryable: false });
  }
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  if (!inFlightToken) {
    inFlightToken = fetchToken()
      .then((token) => {
        cachedToken = token;
        return token.value;
      })
      .finally(() => {
        inFlightToken = null;
      });
  }
  return inFlightToken;
}

async function apiGet(path, { retryOnAuthFailure = true } = {}) {
  const token = await getAccessToken();

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new SpotifyError('Cannot reach Spotify. Check your connection.');
  }

  // A token can be revoked server-side before our cached expiry; drop it and retry once.
  if (response.status === 401 && retryOnAuthFailure) {
    cachedToken = null;
    return apiGet(path, { retryOnAuthFailure: false });
  }

  if (response.status === 429) {
    throw new SpotifyError('Spotify rate limit reached. Try again shortly.', { status: 429 });
  }

  if (!response.ok) {
    throw new SpotifyError(`Spotify request failed (${response.status}).`, {
      status: response.status,
      retryable: response.status >= 500,
    });
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
 */
export async function searchAlbums(query, { limit = 20 } = {}) {
  const trimmed = query?.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({
    q: trimmed,
    type: 'album',
    limit: String(limit),
  });
  const body = await apiGet(`/search?${params.toString()}`);
  return (body.albums?.items ?? []).map(normalizeAlbum).filter(Boolean);
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

/** Reset cached auth — used by tests and by the "retry" affordance on errors. */
export function resetSpotifyToken() {
  cachedToken = null;
  inFlightToken = null;
}

// Editing credentials in Settings must invalidate a token minted with the old
// pair, otherwise the app keeps using stale auth until it expires an hour later.
subscribeToCredentials(resetSpotifyToken);

/**
 * Credential check for the Settings screen: mints a token and runs one small
 * search, which together verify the ID/secret pair and that the browser can
 * actually reach Spotify (CORS included).
 */
export async function verifySpotifyCredentials() {
  resetSpotifyToken();
  const albums = await searchAlbums('Rumours Fleetwood Mac', { limit: 1 });
  if (!albums.length) {
    throw new SpotifyError('Authenticated, but search returned nothing.', { retryable: true });
  }
  return albums[0];
}

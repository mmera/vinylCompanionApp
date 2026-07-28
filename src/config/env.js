/**
 * Environment configuration.
 *
 * Expo inlines `EXPO_PUBLIC_*` variables from `.env` at bundle time, so these
 * must be read as static property accesses — `process.env[someVariable]` will
 * not be substituted.
 */

const PLACEHOLDER = /^x+$|^sk-ant-x+$/i;

function read(value) {
  const trimmed = (value ?? '').trim();
  if (!trimmed || PLACEHOLDER.test(trimmed)) return '';
  return trimmed;
}

export const CLAUDE_API_KEY = read(process.env.EXPO_PUBLIC_CLAUDE_API_KEY);
export const SPOTIFY_CLIENT_ID = read(process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID);
export const SPOTIFY_CLIENT_SECRET = read(process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET);

/**
 * The spec named `claude-sonnet-4-20250514`, which is deprecated and past its
 * retirement date — requests to it fail with a 404. `claude-sonnet-5` is the
 * documented drop-in replacement and is what we default to. Override via
 * EXPO_PUBLIC_CLAUDE_MODEL if you need a different one.
 */
export const CLAUDE_MODEL = read(process.env.EXPO_PUBLIC_CLAUDE_MODEL) || 'claude-sonnet-5';

export const hasClaudeCredentials = Boolean(CLAUDE_API_KEY);
export const hasSpotifyCredentials = Boolean(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET);

/** Human-readable list of whatever is still missing, for onboarding empty states. */
export function missingCredentials() {
  const missing = [];
  if (!CLAUDE_API_KEY) missing.push('EXPO_PUBLIC_CLAUDE_API_KEY');
  if (!SPOTIFY_CLIENT_ID) missing.push('EXPO_PUBLIC_SPOTIFY_CLIENT_ID');
  if (!SPOTIFY_CLIENT_SECRET) missing.push('EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET');
  return missing;
}

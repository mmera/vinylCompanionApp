import { CLAUDE_API_KEY, CLAUDE_MODEL, hasClaudeCredentials } from '../config/env';

/**
 * Vision-based album cover identification via the Claude Messages API.
 *
 * This talks to the REST endpoint with `fetch` rather than @anthropic-ai/sdk:
 * the SDK's credential chain statically imports `node:fs` / `node:path` to
 * resolve keys from disk, which Metro cannot bundle for React Native. We pass
 * the key explicitly, so that whole layer is dead weight here — one POST with
 * three headers is the honest shape of this call.
 *
 * The scanner runs this on a loop, so every request is tuned for latency:
 * thinking off, low effort, a tight token cap, and a downscaled frame. The
 * response shape is pinned with structured outputs so we never have to parse
 * prose or repair malformed JSON.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export class MissingKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MissingKeyError';
  }
}

export class ClaudeError extends Error {
  constructor(message, { status, retryable = true } = {}) {
    super(message);
    this.name = 'ClaudeError';
    this.status = status;
    this.retryable = retryable;
  }
}

const IDENTIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    identified: {
      type: 'boolean',
      description:
        'True only if a real album cover is clearly visible AND you recognize which album it is.',
    },
    artist: {
      type: 'string',
      description: 'The recording artist or band. Empty string when identified is false.',
    },
    album: {
      type: 'string',
      description:
        'The album title, without any edition suffix. Empty string when identified is false.',
    },
    year: {
      type: 'string',
      description:
        'Four-digit year of the original release, e.g. "1973". Empty string if unknown or not identified.',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description: 'How certain you are about this identification.',
    },
  },
  required: ['identified', 'artist', 'album', 'year', 'confidence'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = [
  'You identify vinyl record album covers from a live camera feed.',
  '',
  'The image is a single frame from a phone camera pointed at a record sleeve. It may be',
  'blurry, tilted, partially out of frame, glare-covered, or show no album at all.',
  '',
  'Rules:',
  '- Set identified=true only when you can see an album cover AND you know which album it is.',
  '- If the frame shows no album cover, a blurred mess, or a sleeve you cannot place,',
  '  set identified=false and leave artist, album, and year as empty strings.',
  '- Never guess an artist or album to fill the fields. A wrong answer is worse than none.',
  '- Use the original release year, not a reissue year.',
  '- Report confidence honestly: "low" means you are unsure and the caller should keep scanning.',
].join('\n');

/**
 * Identify the album cover in a base64-encoded JPEG frame.
 *
 * @param {string} base64Image  Raw base64 (no `data:` prefix).
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{identified: boolean, artist: string, album: string, year: string, confidence: string}>}
 */
export async function identifyAlbumCover(base64Image, options = {}) {
  if (!hasClaudeCredentials) {
    throw new MissingKeyError('Claude API key is not configured.');
  }

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 256,
    // Recognition is a perception task, not a reasoning one — thinking would
    // only add latency to a loop that runs every couple of seconds.
    thinking: { type: 'disabled' },
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: IDENTIFICATION_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64Image },
          },
          { type: 'text', text: 'What album cover is this?' },
        ],
      },
    ],
  };

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (networkError) {
    if (networkError?.name === 'AbortError') throw networkError;
    throw new ClaudeError('Cannot reach Claude. Check your connection.');
  }

  if (!response.ok) {
    throw await buildApiError(response);
  }

  return parseIdentification(await response.json());
}

async function buildApiError(response) {
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message ?? '';
  } catch {
    // Non-JSON error body — the status code alone will have to do.
  }

  switch (response.status) {
    case 401:
    case 403:
      return new ClaudeError(
        'Claude rejected your API key. Check EXPO_PUBLIC_CLAUDE_API_KEY in .env.',
        { status: response.status, retryable: false },
      );
    case 404:
      return new ClaudeError(`Model "${CLAUDE_MODEL}" is unavailable on your account.`, {
        status: 404,
        retryable: false,
      });
    case 400:
      return new ClaudeError(detail || 'Claude rejected the request.', {
        status: 400,
        retryable: false,
      });
    case 429:
      return new ClaudeError('Hit the Claude rate limit — pausing for a moment.', {
        status: 429,
        retryable: true,
      });
    default:
      return new ClaudeError(detail || `Claude returned an error (${response.status}).`, {
        status: response.status,
        retryable: response.status >= 500,
      });
  }
}

const NOT_IDENTIFIED = {
  identified: false,
  artist: '',
  album: '',
  year: '',
  confidence: 'low',
};

function parseIdentification(payload) {
  // A refusal (or a truncated response) means we have nothing usable — treat
  // it exactly like "couldn't identify" so the scanner keeps going.
  if (payload?.stop_reason === 'refusal' || payload?.stop_reason === 'max_tokens') {
    return { ...NOT_IDENTIFIED };
  }

  const textBlock = (payload?.content ?? []).find((block) => block.type === 'text');
  if (!textBlock) return { ...NOT_IDENTIFIED };

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    // Structured outputs make this near-impossible, but a malformed body must
    // never crash the scanner loop.
    return { ...NOT_IDENTIFIED };
  }

  const artist = String(parsed.artist ?? '').trim();
  const album = String(parsed.album ?? '').trim();

  // Guard against a `true` with nothing behind it.
  if (!parsed.identified || !artist || !album) {
    return { ...NOT_IDENTIFIED };
  }

  return {
    identified: true,
    artist,
    album,
    year: String(parsed.year ?? '').trim(),
    confidence: parsed.confidence ?? 'medium',
  };
}

/** Turn an error into something worth showing a person. */
export function describeClaudeError(error) {
  if (error?.name === 'AbortError') return 'Cancelled.';
  if (error instanceof MissingKeyError || error instanceof ClaudeError) return error.message;
  return error?.message || 'Something went wrong identifying the cover.';
}

/** Rate limits and server hiccups are worth retrying; a bad key is not. */
export function isRetryableClaudeError(error) {
  if (error instanceof MissingKeyError) return false;
  if (error instanceof ClaudeError) return error.retryable;
  return true;
}

import { getCredentials } from '../storage/credentials';

/**
 * Backing the collection up to a private GitHub Gist.
 *
 * Crate's four stores live in browser storage, and browser storage is not a
 * safe place for the only copy of anything: Safari clears script-writable
 * storage after about a week without a visit unless persistence has been
 * granted, and no grant survives a reset, a new device, or "clear website
 * data". A hand-built collection is the one thing here that cannot be
 * regenerated.
 *
 * A gist is the smallest thing that fixes that. No server to run, free, and
 * *versioned* — so recovery is not limited to whatever the last write happened
 * to contain. It doubles as the export path: a gist is a JSON file at a URL,
 * readable and downloadable from github.com with no app involved.
 */

const API = 'https://api.github.com';

/**
 * The backup is found by filename, never by a stored gist ID.
 *
 * A stored ID lives in the same storage the backup exists to survive — losing
 * it would make the backup unfindable in precisely the situation it was for.
 * The token alone is enough to locate this.
 */
export const BACKUP_FILENAME = 'crate-backup.json';

const DESCRIPTION = 'Crate — record collection backup';

export class BackupError extends Error {
  constructor(message, { status, needsToken = false } = {}) {
    super(message);
    this.name = 'BackupError';
    this.status = status;
    this.needsToken = needsToken;
  }
}

function requireToken() {
  const { githubToken } = getCredentials();
  if (!githubToken) {
    throw new BackupError('Add a GitHub token in Settings to back up.', { needsToken: true });
  }
  return githubToken;
}

async function request(path, { method = 'GET', body, token } = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : null),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new BackupError('Could not reach GitHub. Check your connection.');
  }

  if (response.status === 401) {
    throw new BackupError('GitHub rejected the token — it may have expired. Replace it in Settings.', {
      status: 401,
      needsToken: true,
    });
  }

  // A token without the `gist` scope authenticates fine and then refuses the
  // work, which is worth saying precisely rather than as a bare 403.
  if (response.status === 403 || response.status === 404) {
    throw new BackupError(
      'GitHub refused the request. The token needs the "gist" scope and nothing else.',
      { status: response.status, needsToken: true },
    );
  }

  if (!response.ok) {
    throw new BackupError(`GitHub returned an error (${response.status}).`, {
      status: response.status,
    });
  }

  return response.status === 204 ? null : response.json();
}

/** The existing backup gist, or null. Matched on filename. */
export async function findBackupGist(token = requireToken()) {
  const gists = await request('/gists?per_page=100', { token });
  return (gists ?? []).find((gist) => gist?.files && BACKUP_FILENAME in gist.files) ?? null;
}

/**
 * What actually gets stored.
 *
 * Collection and preferences only. The Claude key and the Spotify session are
 * deliberately excluded — a gist is a URL that can be opened in a browser, and
 * a backup you might share or leave open must never carry live credentials.
 */
export function buildPayload({ collection, preferences }) {
  return {
    version: 1,
    savedAt: Date.now(),
    collection,
    preferences,
  };
}

export async function writeBackup(payload, { token = requireToken() } = {}) {
  const existing = await findBackupGist(token);
  const files = { [BACKUP_FILENAME]: { content: JSON.stringify(payload, null, 2) } };

  const gist = existing
    ? await request(`/gists/${existing.id}`, { method: 'PATCH', body: { files }, token })
    : await request('/gists', {
        method: 'POST',
        body: { description: DESCRIPTION, public: false, files },
        token,
      });

  return { id: gist.id, url: gist.html_url, savedAt: payload.savedAt };
}

export async function readBackup({ token = requireToken() } = {}) {
  const existing = await findBackupGist(token);
  if (!existing) return null;

  const file = existing.files[BACKUP_FILENAME];

  // Gist listings truncate large files, so re-fetch the gist for full content
  // rather than trusting what the list handed back.
  const content = file?.truncated === false && file?.content
    ? file.content
    : (await request(`/gists/${existing.id}`, { token })).files[BACKUP_FILENAME]?.content;

  if (!content) return null;

  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed?.collection)) return null;
    // The URL travels with the payload so Settings can offer a way in to the
    // gist's revision history, which is the only recovery path if the current
    // revision turns out to be the wrong one.
    return { ...parsed, url: existing.html_url ?? null };
  } catch {
    throw new BackupError('The backup file could not be read — it may be corrupt.');
  }
}

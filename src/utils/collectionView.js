/**
 * Turning a collection into something you can actually find a record in.
 *
 * All pure functions over the stored records — no React, no storage — so the
 * ordering rules can be reasoned about (and tested) on their own. A shelf of
 * three records needs none of this; a shelf of three hundred is unusable
 * without it.
 */

// Escaped rather than literal: the characters in this range are invisible in
// a source file, which makes the regex impossible to read or safely edit.
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Casefold and strip accents so "Björk" is reachable by typing "bjork" — the
 * search box is on a phone keyboard and nobody is going to long-press for ö.
 */
function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .trim();
}

// Records are shelved under the artist's name, not the article in front of it:
// The Beatles under B, A Tribe Called Quest under T. Anything else sends half
// an alphabetised collection to the T's.
const LEADING_ARTICLE = /^(?:the|a|an)\s+/;

export function sortKey(value) {
  return fold(value).replace(LEADING_ARTICLE, '');
}

/**
 * Split a query into terms so word order doesn't matter — "rumours fleetwood"
 * and "fleetwood rumours" should both find the record. Every term has to match
 * somewhere, which is what makes a second word narrow rather than widen.
 */
export function parseQuery(query) {
  return fold(query).split(/\s+/).filter(Boolean);
}

export function matchesQuery(record, terms) {
  if (!terms.length) return true;
  const haystack = `${fold(record.artist)} ${fold(record.name)} ${record.year ?? ''}`;
  return terms.every((term) => haystack.includes(term));
}

/** A–Z bucket for a name, with everything non-alphabetic collected under #. */
function initial(value) {
  const first = sortKey(value).charAt(0);
  return /[a-z]/.test(first) ? first.toUpperCase() : '#';
}

/**
 * Decade rather than year. Vinyl clusters by era, and per-year headers would
 * produce more headings than records.
 */
function decade(year) {
  const parsed = Number.parseInt(year, 10);
  if (!Number.isFinite(parsed) || parsed < 1000) return 'Year unknown';
  return `${Math.floor(parsed / 10) * 10}s`;
}

export const SORT_MODES = [
  { id: 'added', label: 'Added' },
  { id: 'artist', label: 'Artist' },
  { id: 'album', label: 'Album' },
  { id: 'year', label: 'Year' },
];

const SORTERS = {
  added: (a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0),
  artist: (a, b) =>
    sortKey(a.artist).localeCompare(sortKey(b.artist)) ||
    sortKey(a.name).localeCompare(sortKey(b.name)),
  album: (a, b) =>
    sortKey(a.name).localeCompare(sortKey(b.name)) ||
    sortKey(a.artist).localeCompare(sortKey(b.artist)),
  // Newest first, and records with no year sink to the bottom rather than
  // masquerading as year zero.
  year: (a, b) => {
    const left = Number.parseInt(a.year, 10);
    const right = Number.parseInt(b.year, 10);
    const leftOk = Number.isFinite(left);
    const rightOk = Number.isFinite(right);
    if (!leftOk && !rightOk) return sortKey(a.artist).localeCompare(sortKey(b.artist));
    if (!leftOk) return 1;
    if (!rightOk) return -1;
    return right - left || sortKey(a.artist).localeCompare(sortKey(b.artist));
  },
};

const HEADINGS = {
  artist: (record) => initial(record.artist),
  album: (record) => initial(record.name),
  year: (record) => decade(record.year),
};

/** Group a flat sorted list into `[[a, b], [c]]` rows for a fixed-column grid. */
function toRows(records, columns) {
  const rows = [];
  for (let index = 0; index < records.length; index += columns) {
    rows.push(records.slice(index, index + columns));
  }
  return rows;
}

/**
 * Filter, sort, and group in one pass.
 *
 * Returns SectionList-shaped data whose `data` is rows of records rather than
 * records: SectionList has no `numColumns`, so the grid is built by making each
 * row a single item. That keeps sticky headers and virtualisation, which a
 * FlatList with injected header rows would not.
 *
 * @returns {{sections: Array<{key: string, title: string|null, data: Array<Array>}>, total: number}}
 */
export function buildSections(records, { sort = 'added', query = '', columns = 2 } = {}) {
  const terms = parseQuery(query);
  const filtered = terms.length
    ? records.filter((record) => matchesQuery(record, terms))
    : records.slice();

  filtered.sort(SORTERS[sort] ?? SORTERS.added);

  const heading = HEADINGS[sort];

  // "Added" is chronological — letter headings over it would be noise, and a
  // single untitled section keeps the grid flush with the top of the screen.
  if (!heading) {
    return {
      total: filtered.length,
      sections: filtered.length
        ? [{ key: 'all', title: null, data: toRows(filtered, columns) }]
        : [],
    };
  }

  const sections = [];
  for (const record of filtered) {
    const title = heading(record);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.records.push(record);
    else sections.push({ key: title, title, records: [record] });
  }

  return {
    total: filtered.length,
    sections: sections.map(({ key, title, records: grouped }) => ({
      key,
      title,
      data: toRows(grouped, columns),
    })),
  };
}

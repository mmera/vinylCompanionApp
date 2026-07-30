/**
 * Turning a collection into something you can actually find a record in.
 *
 * All pure functions over the stored records — no React, no storage — so the
 * ordering rules can be reasoned about (and tested) on their own. A shelf of
 * three records needs none of this; a shelf of three hundred is unusable
 * without it.
 */

import { spacing } from '../theme';

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

/**
 * One collator for the whole module. `String.prototype.localeCompare` builds a
 * fresh collator on every call; a comparator is the last place to pay that.
 */
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

/**
 * Sorting works on a decorated copy — `{record, artistKey, nameKey, year}` —
 * so each record's keys are normalised once rather than once per comparison.
 * A comparator that calls `sortKey()` does that work O(n log n) times, which
 * at 1000 records was ~15x more `normalize('NFD')` than needed, on every
 * keystroke, since the query feeds the same memo.
 */
function decorate(record) {
  const year = Number.parseInt(record.year, 10);
  return {
    record,
    artistKey: sortKey(record.artist),
    nameKey: sortKey(record.name),
    year: Number.isFinite(year) ? year : null,
  };
}

const SORTERS = {
  added: (a, b) => (b.record.addedAt ?? 0) - (a.record.addedAt ?? 0),
  artist: (a, b) =>
    collator.compare(a.artistKey, b.artistKey) || collator.compare(a.nameKey, b.nameKey),
  album: (a, b) =>
    collator.compare(a.nameKey, b.nameKey) || collator.compare(a.artistKey, b.artistKey),
  // Newest first, and records with no year sink to the bottom rather than
  // masquerading as year zero.
  year: (a, b) => {
    if (a.year === null && b.year === null) return collator.compare(a.artistKey, b.artistKey);
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return b.year - a.year || collator.compare(a.artistKey, b.artistKey);
  },
};

const HEADINGS = {
  artist: (record) => initial(record.artist),
  album: (record) => initial(record.name),
  year: (record) => decade(record.year),
};

/**
 * How wide a cover wants to be, and how many therefore fit.
 *
 * The grid was fixed at two columns, which is right for a portrait phone and
 * wrong everywhere else — a landscape phone or a desktop window got two covers
 * the size of dinner plates and no room left to scroll. Aiming for a tile width
 * instead still lands on two in portrait and fills the shelf when there's room.
 *
 * Lives here rather than in the screen so it can be reasoned about with the
 * rest of the grid maths, and clamped at both ends: fewer than two columns is
 * what the list view is for, and more than six makes covers too small to read.
 */
export const TARGET_TILE = 170;

export function gridColumns(width, { gutter = spacing.md, margin = spacing.lg } = {}) {
  const usable = width - margin * 2;
  return Math.max(2, Math.min(6, Math.round(usable / (TARGET_TILE + gutter))));
}

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
  const matching = terms.length
    ? records.filter((record) => matchesQuery(record, terms))
    : records;

  const decorated = matching.map(decorate);
  decorated.sort(SORTERS[sort] ?? SORTERS.added);

  /*
   * "Added" is chronological, so it has no headings — letter or decade titles
   * over it would be noise. Rather than special-casing it, its heading is a
   * function returning null: every record then lands in one untitled run
   * through the same grouping loop, and an empty collection yields no sections
   * without a separate branch.
   */
  const heading = HEADINGS[sort] ?? (() => null);

  const sections = [];
  for (const { record } of decorated) {
    const title = heading(record);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.records.push(record);
    else sections.push({ key: title ?? 'all', title, records: [record] });
  }

  return {
    total: decorated.length,
    sections: sections.map(({ key, title, records: grouped }) => ({
      key,
      title,
      data: toRows(grouped, columns),
    })),
  };
}

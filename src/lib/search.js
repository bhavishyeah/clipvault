// VOLT — Search matcher pure helpers
// Total, side-effect-free functions used to filter a clip against a query and
// a set of filters (type, tag, created-date window). No I/O, no dependencies.
//
// Search scope (Req 5.1): a clip's searchable text is the union of its
//   - content (text / link body)
//   - tags (metadata.tags)
//   - filename and mime (metadata.name / metadata.mime)
//   - link preview text (metadata.preview.title / .description)
//
// Filters combine with AND (Req 5.2): a clip matches iff it satisfies the
// query AND the type filter AND the tag filter AND the date window.

/**
 * Lowercase a value if it is a string, otherwise return ''.
 * @param {unknown} v
 * @returns {string}
 */
function lower(v) {
  return typeof v === 'string' ? v.toLowerCase() : ''
}

/**
 * Collect every searchable text fragment for a clip into a lowercased array.
 * Missing/absent fields contribute nothing (no throw on partial clips).
 *
 * @param {object} clip
 * @returns {string[]} lowercased, non-empty fragments
 */
export function searchableFields(clip) {
  if (!clip || typeof clip !== 'object') return []

  const meta = clip.metadata && typeof clip.metadata === 'object' ? clip.metadata : {}
  const preview = meta.preview && typeof meta.preview === 'object' ? meta.preview : {}
  const tags = Array.isArray(meta.tags) ? meta.tags : []

  const fields = [
    clip.content,
    meta.name,
    meta.mime,
    preview.title,
    preview.description,
    ...tags,
  ]

  return fields.map(lower).filter((s) => s.length > 0)
}

/**
 * Split a raw query into lowercased, whitespace-delimited tokens. An empty or
 * whitespace-only query yields no tokens (which callers treat as "match all").
 *
 * @param {string} query
 * @returns {string[]}
 */
export function queryTokens(query) {
  return lower(query)
    .split(/\s+/)
    .filter((t) => t.length > 0)
}

/**
 * Does the clip's searchable text satisfy the query? Every token must appear
 * as a substring of at least one searchable field (tokens are ANDed; a token
 * may match different fields). An empty query matches every clip.
 *
 * @param {object} clip
 * @param {string} query
 * @returns {boolean}
 */
export function matchesQuery(clip, query) {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return true

  const fields = searchableFields(clip)
  if (fields.length === 0) return false

  return tokens.every((token) => fields.some((field) => field.includes(token)))
}

/**
 * Does the clip carry the given tag? Comparison is case-insensitive and the
 * requested tag is trimmed. An empty/absent tag filter matches every clip.
 *
 * @param {object} clip
 * @param {string} tag
 * @returns {boolean}
 */
export function matchesTag(clip, tag) {
  const wanted = lower(tag).trim()
  if (wanted.length === 0) return true

  const tags = Array.isArray(clip?.metadata?.tags) ? clip.metadata.tags : []
  return tags.some((t) => lower(t) === wanted)
}

/**
 * Does the clip's type match the requested type? A falsy type or the literal
 * 'all' matches every clip.
 *
 * @param {object} clip
 * @param {string} type
 * @returns {boolean}
 */
export function matchesType(clip, type) {
  if (!type || type === 'all') return true
  return clip?.type === type
}

/**
 * Parse a date-like value into epoch milliseconds, or null if unparseable.
 * @param {string|number|Date|null|undefined} value
 * @returns {number|null}
 */
function toTime(value) {
  if (value == null) return null
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * Is the clip's created_at within the inclusive [dateFrom, dateTo] window?
 * Either bound may be omitted for an open-ended range; omitting both matches
 * every clip. Bounds are inclusive (Req 5.2). A clip with no parseable
 * created_at fails any active bound.
 *
 * @param {object} clip
 * @param {string|number|Date} [dateFrom]
 * @param {string|number|Date} [dateTo]
 * @returns {boolean}
 */
export function matchesDateWindow(clip, dateFrom, dateTo) {
  const from = toTime(dateFrom)
  const to = toTime(dateTo)
  if (from === null && to === null) return true

  const created = toTime(clip?.created_at)
  if (created === null) return false

  if (from !== null && created < from) return false
  if (to !== null && created > to) return false
  return true
}

/**
 * Master matcher: a clip passes iff it satisfies the query and all provided
 * filters (type, tag, created-date window), combined with AND (Req 5.1, 5.2).
 * Scoped to the owner's own vault; sender filtering is out of scope (Req 5.3).
 *
 * @param {object} clip - a clip record (may be partial)
 * @param {object} [filters]
 * @param {string} [filters.query] - free-text query (tokenized on whitespace)
 * @param {string} [filters.type] - clip type or 'all'
 * @param {string} [filters.tag] - a single tag to require
 * @param {string|number|Date} [filters.dateFrom] - inclusive lower bound on created_at
 * @param {string|number|Date} [filters.dateTo] - inclusive upper bound on created_at
 * @returns {boolean}
 */
export function matchesClip(clip, { query, type, tag, dateFrom, dateTo } = {}) {
  return (
    matchesType(clip, type) &&
    matchesTag(clip, tag) &&
    matchesDateWindow(clip, dateFrom, dateTo) &&
    matchesQuery(clip, query)
  )
}

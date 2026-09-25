// VOLT — Clip tag pure helpers
// Total, side-effect-free functions for normalizing tags and maintaining the
// per-clip tag list stored under `clips.metadata.tags`. No I/O, no mutation of
// inputs: `addTag` / `removeTag` always return a new array.

/** Maximum number of tags allowed on a single clip. */
export const MAX_TAGS = 10
/** Maximum length (in characters) of a single normalized tag. */
export const MAX_TAG_LEN = 32

/**
 * Normalize a raw tag string.
 *
 * Trims leading/trailing whitespace, lowercases, and collapses runs of
 * internal whitespace to a single space. An empty result (after
 * normalization) is rejected as `null`.
 *
 * @param {string} raw - the raw tag as entered by the user
 * @returns {string | null} the normalized tag, or `null` when the input is
 *   not a string or normalizes to empty.
 */
export function normalizeTag(raw) {
  if (typeof raw !== 'string') return null
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  return normalized.length === 0 ? null : normalized
}

/**
 * Add a tag to a clip's tag list.
 *
 * The raw tag is normalized first. Adding is a no-op when the tag is invalid
 * (empty after normalization), already present (dedupe), too long, or when the
 * list is already at the maximum count. The input array is never mutated.
 *
 * @param {string[]} tags - the current tag list
 * @param {string} raw - the raw tag to add
 * @returns {{ ok: boolean, tags: string[], reason?: 'empty' | 'duplicate' | 'too_long' | 'too_many' }}
 *   On success `{ ok: true, tags }` with the new list. On rejection
 *   `{ ok: false, tags, reason }` where `tags` is the unchanged list and
 *   `reason` explains why: `'empty'` (normalizes to nothing), `'duplicate'`
 *   (already present), `'too_long'` (exceeds MAX_TAG_LEN), or `'too_many'`
 *   (list already at MAX_TAGS).
 */
export function addTag(tags, raw) {
  const current = Array.isArray(tags) ? tags : []
  const tag = normalizeTag(raw)

  if (tag === null) {
    return { ok: false, tags: current, reason: 'empty' }
  }
  if (tag.length > MAX_TAG_LEN) {
    return { ok: false, tags: current, reason: 'too_long' }
  }
  if (current.includes(tag)) {
    return { ok: false, tags: current, reason: 'duplicate' }
  }
  if (current.length >= MAX_TAGS) {
    return { ok: false, tags: current, reason: 'too_many' }
  }

  return { ok: true, tags: [...current, tag] }
}

/**
 * Remove a tag from a clip's tag list.
 *
 * The target is normalized so removal matches how the tag was stored. The
 * input array is never mutated; a new array is always returned. Removing a tag
 * that is absent yields an equal (new) array.
 *
 * @param {string[]} tags - the current tag list
 * @param {string} tag - the tag to remove (raw or normalized)
 * @returns {string[]} a new array without the target tag
 */
export function removeTag(tags, tag) {
  const current = Array.isArray(tags) ? tags : []
  const target = normalizeTag(tag)
  if (target === null) return [...current]
  return current.filter((t) => t !== target)
}

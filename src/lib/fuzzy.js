// VOLT — Fuzzy filter pure helpers
// Total, side-effect-free functions for subsequence fuzzy matching and ranking.
// Used by the command palette (Ctrl+K) to filter and order clips + commands.
// No I/O, no dependencies, and inputs are never mutated.
//
// Matching model (Req 6.2): a query matches a text when every query character
// appears in the text, in order, as a (not necessarily contiguous) subsequence.
// Matching is case-insensitive. The score rewards earlier matches, contiguous
// runs, and matches at word boundaries so the most relevant items sort first.

/**
 * Lowercase a value if it is a string, otherwise return ''.
 * @param {unknown} v
 * @returns {string}
 */
function lower(v) {
  return typeof v === 'string' ? v.toLowerCase() : ''
}

/**
 * Is `ch` a word-boundary separator (whitespace, punctuation, etc.)?
 * @param {string} ch - a single character
 * @returns {boolean}
 */
function isBoundary(ch) {
  return /[\s\-_/.:,;|()[\]{}]/.test(ch)
}

/**
 * Score how well `query` fuzzy-matches `text`.
 *
 * Returns a non-negative number: `0` means no match (the query is not a
 * subsequence of the text), and a higher positive score means a stronger
 * match. An empty query trivially matches every text with a small positive
 * score, so callers can treat "empty query => keep all". Matching is
 * case-insensitive and neither argument is mutated.
 *
 * Scoring heuristics (higher is better):
 *   - each matched character contributes a base amount;
 *   - consecutive (contiguous) matches earn a bonus;
 *   - a match at the start of the text or right after a word boundary earns a
 *     bonus;
 *   - matches nearer the start of the text score slightly higher than matches
 *     deep in the text.
 *
 * @param {string} query - the search query
 * @param {string} text - the candidate text to score against
 * @returns {number} `0` for no match, otherwise a positive relevance score
 */
export function fuzzyScore(query, text) {
  const q = lower(query)
  const t = lower(text)

  // Empty query matches everything with a small, uniform positive score.
  if (q.length === 0) return 1

  let score = 0
  let ti = 0
  let prevMatchIndex = -1

  for (let qi = 0; qi < q.length; qi += 1) {
    const qc = q[qi]

    // Advance through the text to the next occurrence of this query char.
    let found = -1
    while (ti < t.length) {
      if (t[ti] === qc) {
        found = ti
        break
      }
      ti += 1
    }

    // Query char not present in the remaining text => not a subsequence.
    if (found === -1) return 0

    // Base points for a matched character.
    score += 1

    // Bonus for contiguous matches (this char immediately follows the last).
    if (prevMatchIndex !== -1 && found === prevMatchIndex + 1) {
      score += 3
    }

    // Bonus for matching at the very start or right after a word boundary.
    if (found === 0 || isBoundary(t[found - 1])) {
      score += 2
    }

    // Small positional bonus favouring matches nearer the start of the text.
    score += Math.max(0, 1 - found / 100)

    prevMatchIndex = found
    ti = found + 1
  }

  return score
}

/**
 * Rank `items` by how well `query` fuzzy-matches the string derived from each
 * item via `keyFn`.
 *
 * Items whose key does not match the query (score `0`) are dropped. Remaining
 * items are returned sorted by descending score; ties preserve the original
 * relative order (stable sort). An empty query returns every item in its
 * original order (all keys score equally, so the stable sort is a no-op).
 *
 * The input array and its items are never mutated; a new array is returned.
 *
 * @template T
 * @param {string} query - the search query
 * @param {T[]} items - the candidate items
 * @param {(item: T) => string} keyFn - extracts the string to match per item
 * @returns {T[]} matching items, best match first
 */
export function rankItems(query, items, keyFn) {
  if (!Array.isArray(items)) return []
  const key = typeof keyFn === 'function' ? keyFn : (x) => x

  const scored = items.map((item, index) => ({
    item,
    index,
    score: fuzzyScore(query, key(item)),
  }))

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item)
}

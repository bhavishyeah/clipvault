// @vitest-environment node
//
// Feature: volt-vault-polish, Task 7.1 — Fuzzy filter helpers
//
// Validates: Requirements 6.2
//
// fuzzy.js provides pure helpers for the command palette:
//   - fuzzyScore: subsequence, case-insensitive match scoring; 0 => no match,
//     empty query => small positive score (match all).
//   - rankItems: drop non-matches, sort by descending score (stable on ties),
//     empty query => all items in original order.

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { fuzzyScore, rankItems } from './fuzzy.js'

describe('fuzzyScore — subsequence matching (Req 6.2)', () => {
  it('matches a contiguous substring', () => {
    expect(fuzzyScore('cat', 'category')).toBeGreaterThan(0)
  })

  it('matches a non-contiguous subsequence', () => {
    // c..l..p..b..d appears in order inside "clipboard"
    expect(fuzzyScore('clpbd', 'clipboard')).toBeGreaterThan(0)
  })

  it('does not match when characters are out of order', () => {
    expect(fuzzyScore('tac', 'cat')).toBe(0)
  })

  it('does not match when a character is absent', () => {
    expect(fuzzyScore('catz', 'category')).toBe(0)
  })

  it('is case-insensitive', () => {
    expect(fuzzyScore('CAT', 'category')).toBeGreaterThan(0)
    expect(fuzzyScore('cat', 'CATEGORY')).toBeGreaterThan(0)
  })

  it('returns a small positive score for an empty query (match all)', () => {
    expect(fuzzyScore('', 'anything')).toBeGreaterThan(0)
    expect(fuzzyScore('', '')).toBeGreaterThan(0)
  })

  it('returns 0 for a non-empty query against empty/non-string text', () => {
    expect(fuzzyScore('x', '')).toBe(0)
    expect(fuzzyScore('x', null)).toBe(0)
    expect(fuzzyScore('x', undefined)).toBe(0)
  })
})

describe('fuzzyScore — ranking heuristics (Req 6.2)', () => {
  it('scores a contiguous match higher than a scattered one', () => {
    const contiguous = fuzzyScore('cat', 'cat food')
    const scattered = fuzzyScore('cat', 'c a t')
    expect(contiguous).toBeGreaterThan(scattered)
  })

  it('scores a start/boundary match higher than a mid-word match', () => {
    const atStart = fuzzyScore('cat', 'cat')
    const midWord = fuzzyScore('cat', 'scatter')
    expect(atStart).toBeGreaterThan(midWord)
  })

  it('rewards word-boundary matches', () => {
    // "sc" starts the second word in "my scanner" vs mid-word in "discs"
    const boundary = fuzzyScore('sc', 'my scanner')
    const midWord = fuzzyScore('sc', 'discs')
    expect(boundary).toBeGreaterThan(midWord)
  })
})

describe('rankItems — ordering and filtering (Req 6.2)', () => {
  // "cart" (c-a-r-t) DOES contain the subsequence c-a-t, so it matches.
  // "dog" does not contain c-a-t in order, so it is dropped.
  const items = ['category', 'concatenate', 'scatter', 'dog', 'cart']

  it('drops items that do not match', () => {
    const ranked = rankItems('cat', items, (x) => x)
    expect(ranked).not.toContain('dog')
  })

  it('keeps every matching item', () => {
    const ranked = rankItems('cat', items, (x) => x)
    expect(ranked).toEqual(
      expect.arrayContaining(['category', 'concatenate', 'scatter', 'cart']),
    )
    expect(ranked).not.toContain('dog')
  })

  it('orders best matches first (start-of-string beats mid-word)', () => {
    const ranked = rankItems('cat', items, (x) => x)
    expect(ranked[0]).toBe('category')
    expect(ranked.indexOf('category')).toBeLessThan(ranked.indexOf('scatter'))
  })

  it('supports a keyFn over objects', () => {
    const objs = [
      { id: 1, label: 'Delete clip' },
      { id: 2, label: 'Copy clip' },
      { id: 3, label: 'Pin note' },
    ]
    const ranked = rankItems('clip', objs, (o) => o.label)
    expect(ranked.map((o) => o.id)).toEqual(expect.arrayContaining([1, 2]))
    expect(ranked.map((o) => o.id)).not.toContain(3)
  })

  it('returns all items in original order for an empty query', () => {
    const ranked = rankItems('', items, (x) => x)
    expect(ranked).toEqual(items)
  })

  it('does not mutate the input array', () => {
    const input = [...items]
    rankItems('cat', input, (x) => x)
    expect(input).toEqual(items)
  })

  it('returns [] for non-array input', () => {
    expect(rankItems('cat', null, (x) => x)).toEqual([])
  })
})

describe('fuzzyScore / rankItems — properties (Req 6.2)', () => {
  it('a text always matches a query that is a prefix of it', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.nat(19),
        (text, cut) => {
          const query = text.slice(0, (cut % text.length) + 1)
          expect(fuzzyScore(query, text)).toBeGreaterThan(0)
        },
      ),
    )
  })

  it('an empty query returns the input list unchanged (order + length)', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (arr) => {
        expect(rankItems('', arr, (x) => x)).toEqual(arr)
      }),
    )
  })

  it('rankItems never returns more items than the input', () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.string()), (query, arr) => {
        expect(rankItems(query, arr, (x) => x).length).toBeLessThanOrEqual(
          arr.length,
        )
      }),
    )
  })

  it('every ranked item has a positive score for the query', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.array(fc.string({ maxLength: 20 })),
        (query, arr) => {
          for (const item of rankItems(query, arr, (x) => x)) {
            expect(fuzzyScore(query, item)).toBeGreaterThan(0)
          }
        },
      ),
    )
  })

  it('ranked scores are non-increasing', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.array(fc.string({ maxLength: 20 })),
        (query, arr) => {
          const scores = rankItems(query, arr, (x) => x).map((t) =>
            fuzzyScore(query, t),
          )
          for (let i = 1; i < scores.length; i += 1) {
            expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i])
          }
        },
      ),
    )
  })
})

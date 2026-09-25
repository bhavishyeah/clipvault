// @vitest-environment node
//
// Feature: volt-vault-polish, Task 8.1 — Usage insights selector
//
// Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
//
// getInsights(store) shapes the LOCAL-ONLY lifetime counters from
// lib/analytics.js into a PII-free view model. Because the store retains no
// per-event history, insights are scoped to lifetime totals and the model
// reports window === 'lifetime' (see the DECISION comment in analytics.js).

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { getInsights, LOW_DATA_THRESHOLD } from './analytics.js'

// A complete, well-formed store like createStore() would produce.
function makeStore(overrides = {}) {
  return {
    sessionStart: Date.now(),
    totalSaves: 0,
    textSaves: 0,
    linkSaves: 0,
    imageSaves: 0,
    totalDeletes: 0,
    totalCopies: 0,
    totalEdits: 0,
    searches: 0,
    sessions: 0,
    lastActive: Date.now(),
    ...overrides,
  }
}

describe('getInsights — shaping (Req 7.1, 7.2, 7.3, 7.4)', () => {
  it('maps counters onto the view model (Req 7.1, 7.2)', () => {
    const store = makeStore({
      totalSaves: 12,
      textSaves: 7,
      linkSaves: 3,
      imageSaves: 2,
      totalCopies: 8,
      totalDeletes: 4,
      totalEdits: 5,
      searches: 6,
      sessions: 9,
    })

    const view = getInsights(store)

    expect(view.totalSaves).toBe(12)
    expect(view.saves).toEqual({ text: 7, link: 3, image: 2 })
    expect(view.copies).toBe(8)
    expect(view.deletes).toBe(4)
    expect(view.edits).toBe(5)
    expect(view.searches).toBe(6)
    expect(view.sessions).toBe(9)
  })

  it('scopes to lifetime totals and documents the window (Req 7.3)', () => {
    const view = getInsights(makeStore({ totalSaves: 100 }))
    expect(view.window).toBe('lifetime')
  })

  it('contains no PII fields — only numeric counters and the window (Req 7.4)', () => {
    const store = makeStore({ totalSaves: 3, totalCopies: 3 })
    const view = getInsights(store)

    // window is the only non-numeric leaf; everything else is a number or the
    // nested saves object of numbers. No timestamps, ids, or content leak.
    const numericKeys = ['totalSaves', 'copies', 'deletes', 'edits', 'searches', 'sessions', 'totalActivity']
    for (const k of numericKeys) {
      expect(typeof view[k]).toBe('number')
    }
    expect(Object.values(view.saves).every((v) => typeof v === 'number')).toBe(true)
    expect(view.window).toBe('lifetime')
    // Guard against accidentally forwarding raw store fields.
    expect(view).not.toHaveProperty('sessionStart')
    expect(view).not.toHaveProperty('lastActive')
  })

  it('totalActivity sums saves + copies + deletes + edits + searches (excludes sessions)', () => {
    const view = getInsights(
      makeStore({
        totalSaves: 2,
        totalCopies: 3,
        totalDeletes: 1,
        totalEdits: 4,
        searches: 5,
        sessions: 99, // must not count toward activity
      }),
    )
    expect(view.totalActivity).toBe(2 + 3 + 1 + 4 + 5)
  })
})

describe('getInsights — low-data state (Req 7.5)', () => {
  it('flags lowData for a brand-new / empty store', () => {
    const view = getInsights(makeStore())
    expect(view.lowData).toBe(true)
    expect(view.totalActivity).toBe(0)
  })

  it('is lowData just below the threshold and not at/above it', () => {
    const below = getInsights(makeStore({ totalSaves: LOW_DATA_THRESHOLD - 1 }))
    expect(below.lowData).toBe(true)

    const atThreshold = getInsights(makeStore({ totalSaves: LOW_DATA_THRESHOLD }))
    expect(atThreshold.lowData).toBe(false)

    const above = getInsights(makeStore({ totalSaves: LOW_DATA_THRESHOLD + 10 }))
    expect(above.lowData).toBe(false)
  })
})

describe('getInsights — robustness on partial/garbage stores', () => {
  it('treats missing, negative, NaN, and non-number counters as 0', () => {
    const view = getInsights({
      totalSaves: -3,
      textSaves: Number.NaN,
      linkSaves: 'nope',
      imageSaves: Infinity,
      // remaining counters omitted entirely
    })
    expect(view.totalSaves).toBe(0)
    expect(view.saves).toEqual({ text: 0, link: 0, image: 0 })
    expect(view.copies).toBe(0)
    expect(view.totalActivity).toBe(0)
    expect(view.lowData).toBe(true)
  })

  it('never throws and always returns a well-formed model for arbitrary input', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const view = getInsights(input)
        expect(view.window).toBe('lifetime')
        expect(typeof view.totalActivity).toBe('number')
        expect(view.totalActivity).toBeGreaterThanOrEqual(0)
        expect(typeof view.lowData).toBe('boolean')
        expect(view.lowData).toBe(view.totalActivity < LOW_DATA_THRESHOLD)
      }),
      { numRuns: 300 },
    )
  })

  it('floors fractional counters to whole numbers', () => {
    const view = getInsights(makeStore({ totalSaves: 7.9, totalCopies: 2.4 }))
    expect(view.totalSaves).toBe(7)
    expect(view.copies).toBe(2)
  })
})

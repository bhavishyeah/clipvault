// @vitest-environment node
//
// Feature: volt-vault-polish, Task 1.1 — Clip tag helpers
//
// Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.8
//
// tags.js provides pure helpers for the per-clip tag list stored under
// `clips.metadata.tags`:
//   - normalizeTag: trim + lowercase + collapse internal whitespace; reject empty.
//   - addTag: normalize, dedupe, enforce MAX_TAGS / MAX_TAG_LEN; immutable.
//   - removeTag: normalize target, remove match; immutable.

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  normalizeTag,
  addTag,
  removeTag,
  MAX_TAGS,
  MAX_TAG_LEN,
} from './tags.js'

describe('normalizeTag (Req 1.2)', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeTag('  work  ')).toBe('work')
  })

  it('lowercases', () => {
    expect(normalizeTag('Work')).toBe('work')
    expect(normalizeTag('URGENT')).toBe('urgent')
  })

  it('collapses runs of internal whitespace to a single space', () => {
    expect(normalizeTag('to   do')).toBe('to do')
    expect(normalizeTag('a\t\tb\nc')).toBe('a b c')
  })

  it('rejects empty and whitespace-only input as null', () => {
    expect(normalizeTag('')).toBeNull()
    expect(normalizeTag('   ')).toBeNull()
    expect(normalizeTag('\t\n')).toBeNull()
  })

  it('rejects non-string input as null', () => {
    expect(normalizeTag(undefined)).toBeNull()
    expect(normalizeTag(null)).toBeNull()
    expect(normalizeTag(42)).toBeNull()
  })

  it('is idempotent — normalizing a normalized tag is a no-op', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (raw) => {
        const once = normalizeTag(raw)
        if (once === null) return
        expect(normalizeTag(once)).toBe(once)
      }),
      { numRuns: 500 },
    )
  })

  it('never produces leading/trailing/double whitespace on success', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (raw) => {
        const out = normalizeTag(raw)
        if (out === null) return
        expect(out).toBe(out.trim())
        expect(out).toBe(out.toLowerCase())
        expect(out).not.toMatch(/\s{2,}/)
      }),
      { numRuns: 500 },
    )
  })
})

describe('addTag — normalization + storage (Req 1.2, 1.8)', () => {
  it('stores the normalized form', () => {
    const r = addTag([], '  Work  ')
    expect(r.ok).toBe(true)
    expect(r.tags).toEqual(['work'])
  })

  it('rejects a tag that normalizes to empty', () => {
    const r = addTag(['a'], '   ')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('empty')
    expect(r.tags).toEqual(['a'])
  })

  it('treats a missing/invalid tag list as empty', () => {
    const r = addTag(undefined, 'first')
    expect(r.ok).toBe(true)
    expect(r.tags).toEqual(['first'])
  })
})

describe('addTag — dedupe no-op (Req 1.3)', () => {
  it('does not add a duplicate (same normalized form)', () => {
    const r = addTag(['work'], 'WORK')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('duplicate')
    expect(r.tags).toEqual(['work'])
  })

  it('adding the same tag twice keeps a single copy', () => {
    const first = addTag([], 'todo')
    const second = addTag(first.tags, ' todo ')
    expect(second.ok).toBe(false)
    expect(second.tags).toEqual(['todo'])
  })
})

describe('addTag — count/length limits with clear rejection (Req 1.5)', () => {
  it('rejects a tag longer than MAX_TAG_LEN with reason too_long', () => {
    const tooLong = 'x'.repeat(MAX_TAG_LEN + 1)
    const r = addTag([], tooLong)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('too_long')
    expect(r.tags).toEqual([])
  })

  it('accepts a tag exactly MAX_TAG_LEN long (boundary)', () => {
    const atLimit = 'x'.repeat(MAX_TAG_LEN)
    const r = addTag([], atLimit)
    expect(r.ok).toBe(true)
    expect(r.tags).toEqual([atLimit])
  })

  it('rejects adding beyond MAX_TAGS with reason too_many', () => {
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `tag${i}`)
    const r = addTag(full, 'overflow')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('too_many')
    expect(r.tags).toEqual(full)
  })

  it('accepts up to exactly MAX_TAGS tags', () => {
    let tags = []
    for (let i = 0; i < MAX_TAGS; i++) {
      const r = addTag(tags, `tag${i}`)
      expect(r.ok).toBe(true)
      tags = r.tags
    }
    expect(tags).toHaveLength(MAX_TAGS)
    expect(addTag(tags, `tag${MAX_TAGS}`).ok).toBe(false)
  })
})

describe('removeTag — removal (Req 1.4)', () => {
  it('removes a present tag', () => {
    expect(removeTag(['work', 'todo'], 'work')).toEqual(['todo'])
  })

  it('normalizes the target before removing', () => {
    expect(removeTag(['work', 'todo'], '  WORK ')).toEqual(['todo'])
  })

  it('is a no-op (equal new array) when the tag is absent', () => {
    expect(removeTag(['work'], 'missing')).toEqual(['work'])
  })

  it('treats a missing/invalid tag list as empty', () => {
    expect(removeTag(undefined, 'x')).toEqual([])
  })
})

describe('immutability (Req 1.3, 1.4)', () => {
  it('addTag does not mutate the input array', () => {
    const input = ['work']
    const snapshot = [...input]
    addTag(input, 'todo')
    expect(input).toEqual(snapshot)
  })

  it('removeTag does not mutate the input array', () => {
    const input = ['work', 'todo']
    const snapshot = [...input]
    removeTag(input, 'work')
    expect(input).toEqual(snapshot)
  })

  it('addTag returns a new array reference on success', () => {
    const input = ['work']
    const r = addTag(input, 'todo')
    expect(r.tags).not.toBe(input)
  })

  it('removeTag returns a new array reference', () => {
    const input = ['work']
    expect(removeTag(input, 'work')).not.toBe(input)
    expect(removeTag(input, 'absent')).not.toBe(input)
  })
})

describe('invariants over arbitrary sequences (Req 1.3, 1.5)', () => {
  it('never exceeds MAX_TAGS, never duplicates, always normalized', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 40 }), { maxLength: 40 }),
        (rawTags) => {
          let tags = []
          for (const raw of rawTags) {
            const r = addTag(tags, raw)
            tags = r.tags
          }
          // Never over the cap.
          expect(tags.length).toBeLessThanOrEqual(MAX_TAGS)
          // No duplicates.
          expect(new Set(tags).size).toBe(tags.length)
          // Every stored tag is a valid normalized form within the length cap.
          for (const t of tags) {
            expect(normalizeTag(t)).toBe(t)
            expect(t.length).toBeLessThanOrEqual(MAX_TAG_LEN)
          }
        },
      ),
      { numRuns: 400 },
    )
  })

  it('add-then-remove of the same tag returns to the original set', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 20 }), { maxLength: MAX_TAGS - 1 }),
        fc.string({ maxLength: 20 }),
        (seedRaws, raw) => {
          // Build a starting set from the seeds.
          let tags = []
          for (const s of seedRaws) tags = addTag(tags, s).tags
          const before = [...tags]

          const added = addTag(tags, raw)
          if (!added.ok) return // rejected: nothing to undo
          const after = removeTag(added.tags, raw)
          expect(after).toEqual(before)
        },
      ),
      { numRuns: 400 },
    )
  })
})

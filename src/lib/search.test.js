// @vitest-environment node
//
// Feature: volt-vault-polish (A5 Search upgrades)
//
// Validates: Requirements 5.1, 5.2, 5.3
//
// matchesClip(clip, { query, type, tag, dateFrom, dateTo }) filters a clip by
// combining its searchable text (content + tags + filename/mime + preview
// text) with the type, tag, and created-date-window filters using AND. These
// tests cover query tokens, tag matching, date-window inclusivity, and the
// empty-query "match all" case.

import { describe, it, expect } from 'vitest'
import {
  matchesClip,
  matchesQuery,
  matchesTag,
  matchesType,
  matchesDateWindow,
  searchableFields,
  queryTokens,
} from './search.js'

// A representative clip touching every searchable field.
const clip = {
  id: 'c1',
  type: 'file',
  content: 'Quarterly budget notes',
  created_at: '2024-06-15T12:00:00.000Z',
  metadata: {
    name: 'report-final.pdf',
    mime: 'application/pdf',
    tags: ['work', 'Finance'],
    preview: {
      title: 'Acme Q2 Results',
      description: 'Revenue and forecast summary',
    },
  },
}

describe('searchableFields', () => {
  it('collects content, filename, mime, tags, and preview text (lowercased)', () => {
    const fields = searchableFields(clip)
    expect(fields).toContain('quarterly budget notes')
    expect(fields).toContain('report-final.pdf')
    expect(fields).toContain('application/pdf')
    expect(fields).toContain('work')
    expect(fields).toContain('finance')
    expect(fields).toContain('acme q2 results')
    expect(fields).toContain('revenue and forecast summary')
  })

  it('tolerates partial clips without throwing', () => {
    expect(searchableFields({})).toEqual([])
    expect(searchableFields(null)).toEqual([])
    expect(searchableFields({ content: null, metadata: {} })).toEqual([])
    expect(searchableFields({ metadata: { tags: 'nope' } })).toEqual([])
  })
})

describe('queryTokens', () => {
  it('splits on whitespace and lowercases', () => {
    expect(queryTokens('  Foo   BAR ')).toEqual(['foo', 'bar'])
  })
  it('returns no tokens for empty / whitespace-only input', () => {
    expect(queryTokens('')).toEqual([])
    expect(queryTokens('   ')).toEqual([])
    expect(queryTokens(undefined)).toEqual([])
  })
})

describe('matchesQuery — query tokens (Req 5.1)', () => {
  it('empty query matches every clip', () => {
    expect(matchesQuery(clip, '')).toBe(true)
    expect(matchesQuery(clip, '   ')).toBe(true)
    expect(matchesQuery(clip, undefined)).toBe(true)
    expect(matchesQuery({}, '')).toBe(true)
  })

  it('matches a token against content', () => {
    expect(matchesQuery(clip, 'budget')).toBe(true)
  })

  it('matches a token against filename and mime', () => {
    expect(matchesQuery(clip, 'report-final')).toBe(true)
    expect(matchesQuery(clip, 'pdf')).toBe(true)
  })

  it('matches a token against tags', () => {
    expect(matchesQuery(clip, 'finance')).toBe(true)
  })

  it('matches a token against preview text', () => {
    expect(matchesQuery(clip, 'forecast')).toBe(true)
    expect(matchesQuery(clip, 'acme')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(matchesQuery(clip, 'BUDGET')).toBe(true)
    expect(matchesQuery(clip, 'AcMe')).toBe(true)
  })

  it('ANDs multiple tokens across different fields', () => {
    // "budget" is in content, "pdf" in mime — both must be present.
    expect(matchesQuery(clip, 'budget pdf')).toBe(true)
    // "budget" present but "spreadsheet" absent -> no match.
    expect(matchesQuery(clip, 'budget spreadsheet')).toBe(false)
  })

  it('returns false when a non-empty query has no searchable fields', () => {
    expect(matchesQuery({}, 'anything')).toBe(false)
  })
})

describe('matchesTag (Req 5.2)', () => {
  it('empty/absent tag filter matches every clip', () => {
    expect(matchesTag(clip, '')).toBe(true)
    expect(matchesTag(clip, undefined)).toBe(true)
    expect(matchesTag({}, '')).toBe(true)
  })

  it('matches an exact tag case-insensitively', () => {
    expect(matchesTag(clip, 'work')).toBe(true)
    expect(matchesTag(clip, 'FINANCE')).toBe(true)
    expect(matchesTag(clip, ' work ')).toBe(true)
  })

  it('does not match a substring or absent tag', () => {
    expect(matchesTag(clip, 'wor')).toBe(false)
    expect(matchesTag(clip, 'personal')).toBe(false)
  })

  it('handles clips with no tags', () => {
    expect(matchesTag({ metadata: {} }, 'work')).toBe(false)
    expect(matchesTag({}, 'work')).toBe(false)
  })
})

describe('matchesType (Req 5.2)', () => {
  it('all / absent type matches every clip', () => {
    expect(matchesType(clip, 'all')).toBe(true)
    expect(matchesType(clip, undefined)).toBe(true)
    expect(matchesType(clip, '')).toBe(true)
  })
  it('matches the exact type only', () => {
    expect(matchesType(clip, 'file')).toBe(true)
    expect(matchesType(clip, 'text')).toBe(false)
  })
})

describe('matchesDateWindow — inclusivity (Req 5.2)', () => {
  const created = clip.created_at // 2024-06-15T12:00:00Z

  it('no bounds matches every clip', () => {
    expect(matchesDateWindow(clip)).toBe(true)
    expect(matchesDateWindow(clip, undefined, undefined)).toBe(true)
  })

  it('includes the exact lower bound (inclusive)', () => {
    expect(matchesDateWindow(clip, created, undefined)).toBe(true)
  })

  it('includes the exact upper bound (inclusive)', () => {
    expect(matchesDateWindow(clip, undefined, created)).toBe(true)
  })

  it('matches inside a closed window', () => {
    expect(
      matchesDateWindow(clip, '2024-06-01T00:00:00Z', '2024-06-30T00:00:00Z'),
    ).toBe(true)
  })

  it('excludes clips before the lower bound', () => {
    expect(matchesDateWindow(clip, '2024-06-16T00:00:00Z', undefined)).toBe(false)
  })

  it('excludes clips after the upper bound', () => {
    expect(matchesDateWindow(clip, undefined, '2024-06-14T00:00:00Z')).toBe(false)
  })

  it('accepts Date and epoch-ms bounds', () => {
    expect(matchesDateWindow(clip, new Date('2024-06-01Z'), new Date('2024-07-01Z'))).toBe(true)
    expect(matchesDateWindow(clip, Date.parse('2024-06-01Z'), Date.parse('2024-07-01Z'))).toBe(true)
  })

  it('fails an active bound when created_at is unparseable/absent', () => {
    expect(matchesDateWindow({}, '2024-01-01Z', undefined)).toBe(false)
    expect(matchesDateWindow({ created_at: 'not-a-date' }, undefined, '2024-12-31Z')).toBe(false)
    // But with no bounds, absent created_at still matches.
    expect(matchesDateWindow({})).toBe(true)
  })
})

describe('matchesClip — combined filters (Req 5.1, 5.2)', () => {
  it('empty filters match every clip', () => {
    expect(matchesClip(clip)).toBe(true)
    expect(matchesClip(clip, {})).toBe(true)
  })

  it('combines type + tag + query + date with AND', () => {
    expect(
      matchesClip(clip, {
        query: 'budget',
        type: 'file',
        tag: 'work',
        dateFrom: '2024-06-01Z',
        dateTo: '2024-06-30Z',
      }),
    ).toBe(true)
  })

  it('fails when any single filter fails', () => {
    // wrong type
    expect(matchesClip(clip, { type: 'text' })).toBe(false)
    // absent tag
    expect(matchesClip(clip, { tag: 'personal' })).toBe(false)
    // query token not present anywhere
    expect(matchesClip(clip, { query: 'nonexistent' })).toBe(false)
    // outside date window
    expect(matchesClip(clip, { dateTo: '2024-06-14Z' })).toBe(false)
  })

  it('matches a link clip by preview text and domain content', () => {
    const link = {
      type: 'link',
      content: 'https://example.com/pricing',
      created_at: '2024-01-01T00:00:00Z',
      metadata: {
        preview: { title: 'Pricing', description: 'Plans and tiers' },
      },
    }
    expect(matchesClip(link, { query: 'pricing' })).toBe(true)
    expect(matchesClip(link, { query: 'tiers', type: 'link' })).toBe(true)
    expect(matchesClip(link, { query: 'example.com' })).toBe(true)
  })
})

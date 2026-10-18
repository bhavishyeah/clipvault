// Feature: volt-vault-polish — Task 5.3: rich link previews
//
// Validates: Requirements 4.4, 4.5
//
// fetchLinkPreview posts the URL + Bearer token to /api/link-preview and
// normalizes the response to { title, description, image }. It degrades to the
// all-null shape (never throws) on network errors, non-OK responses, or a
// malformed body, so the caller can cache and fall back cleanly (Req 4.5).
// hasPreviewData decides whether a preview carries usable fields.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fetchLinkPreview, hasPreviewData } from './fetchLinkPreview.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchLinkPreview', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends a Bearer token and URL, and returns the normalized preview', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'T', description: 'D', image: 'I', extra: 'ignored' }),
    })
    globalThis.fetch = fetchMock

    const result = await fetchLinkPreview('https://example.com', 'tok-123')

    expect(result).toEqual({ title: 'T', description: 'D', image: 'I' })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/link-preview')
    expect(opts.method).toBe('POST')
    expect(opts.headers.Authorization).toBe('Bearer tok-123')
    expect(JSON.parse(opts.body)).toEqual({ url: 'https://example.com' })
  })

  it('fills missing fields with null', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: 'only title' }),
    })

    const result = await fetchLinkPreview('https://example.com', 'tok')
    expect(result).toEqual({ title: 'only title', description: null, image: null })
  })

  it('returns empty preview on a non-OK response (Req 4.5)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) })

    const result = await fetchLinkPreview('https://example.com', 'tok')
    expect(result).toEqual({ title: null, description: null, image: null })
  })

  it('returns empty preview on a network error (Req 4.5)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'))

    const result = await fetchLinkPreview('https://example.com', 'tok')
    expect(result).toEqual({ title: null, description: null, image: null })
  })

  it('returns empty preview without calling fetch when url or token is missing', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock

    expect(await fetchLinkPreview('', 'tok')).toEqual({ title: null, description: null, image: null })
    expect(await fetchLinkPreview('https://example.com', '')).toEqual({ title: null, description: null, image: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('hasPreviewData', () => {
  it('is true when any field is present', () => {
    expect(hasPreviewData({ title: 'x', description: null, image: null })).toBe(true)
    expect(hasPreviewData({ title: null, description: null, image: 'i' })).toBe(true)
  })

  it('is false for null/undefined or all-null previews', () => {
    expect(hasPreviewData(null)).toBe(false)
    expect(hasPreviewData(undefined)).toBe(false)
    expect(hasPreviewData({ title: null, description: null, image: null })).toBe(false)
  })
})

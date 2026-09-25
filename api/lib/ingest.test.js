// @vitest-environment node
//
// Feature: capture-ingest, Batch 2 — /api/ingest payload normalization.
//
// The ingest endpoint delegates ALL payload interpretation to the pure helpers
// in api/lib/ingest.js: how a recipient reference is parsed, and how a raw body
// resolves to a text | link | image transfer (and whether an image upload is
// required). These tests pin that contract; the endpoint itself only layers
// auth, Cloudinary, and persistence on top.

import { describe, it, expect } from 'vitest'
import {
  normalizeRecipient,
  normalizePayload,
  isDataImage,
  isImageUrl,
  unwrapImageUrl,
  MAX_CONTENT_LEN,
} from './ingest.js'

const UUID = '11111111-2222-3333-4444-555555555555'
const DATA_PNG = 'data:image/png;base64,iVBORw0KGgo='
const IMG_URL = 'https://cdn.example.com/cat.jpg'
const GOOGLE =
  'https://www.google.com/imgres?q=cat&imgurl=https%3A%2F%2Fx.com%2Fcat.png&imgrefurl=https%3A%2F%2Fx.com'

describe('normalizeRecipient', () => {
  it('parses @username, bare username, and uuid', () => {
    expect(normalizeRecipient('@Alice')).toEqual({ kind: 'username', value: 'alice' })
    expect(normalizeRecipient('bob_99')).toEqual({ kind: 'username', value: 'bob_99' })
    expect(normalizeRecipient(UUID)).toEqual({ kind: 'id', value: UUID })
  })
  it('rejects invalid references', () => {
    expect(normalizeRecipient('ab')).toBeNull() // too short
    expect(normalizeRecipient('has space')).toBeNull()
    expect(normalizeRecipient('')).toBeNull()
    expect(normalizeRecipient(null)).toBeNull()
  })
})

describe('image detection helpers', () => {
  it('isDataImage / isImageUrl / unwrapImageUrl behave', () => {
    expect(isDataImage(DATA_PNG)).toBe(true)
    expect(isImageUrl(IMG_URL)).toBe(true)
    expect(isImageUrl('https://x.com/page')).toBe(false)
    expect(unwrapImageUrl(GOOGLE)).toBe('https://x.com/cat.png')
  })
})

describe('normalizePayload', () => {
  it('treats an explicit imageUrl as an image upload (wins over content)', () => {
    const out = normalizePayload({ imageUrl: IMG_URL, content: 'ignored text' })
    expect(out.ok).toBe(true)
    expect(out.payload).toMatchObject({ type: 'image', content: null, imageUpload: IMG_URL })
  })

  it('detects a data:image in content and marks it for upload', () => {
    const out = normalizePayload({ content: DATA_PNG })
    expect(out.payload).toMatchObject({ type: 'image', imageUpload: DATA_PNG, content: null })
  })

  it('unwraps a Google imgres link in content to the real image', () => {
    const out = normalizePayload({ content: GOOGLE })
    expect(out.payload).toMatchObject({ type: 'image', imageUpload: 'https://x.com/cat.png' })
  })

  it('classifies a non-image URL as a link', () => {
    const out = normalizePayload({ content: 'https://example.com/article' })
    expect(out.payload).toMatchObject({ type: 'link', content: 'https://example.com/article', imageUpload: null })
  })

  it('classifies plain prose as text', () => {
    const out = normalizePayload({ content: 'hello world' })
    expect(out.payload).toMatchObject({ type: 'text', content: 'hello world', imageUpload: null })
  })

  it('carries a trimmed, length-capped groupName', () => {
    const out = normalizePayload({ content: 'hi', groupName: '  Team  ' })
    expect(out.payload.groupName).toBe('Team')
  })

  it('rejects empty payloads and over-long text', () => {
    expect(normalizePayload({}).ok).toBe(false)
    expect(normalizePayload({ content: '   ' }).ok).toBe(false)
    expect(normalizePayload({ content: 'x'.repeat(MAX_CONTENT_LEN + 1) }).ok).toBe(false)
  })

  it('allows an over-long data:image because it is uploaded, not stored', () => {
    const big = `data:image/png;base64,${'A'.repeat(MAX_CONTENT_LEN + 100)}`
    expect(normalizePayload({ content: big }).ok).toBe(true)
  })
})

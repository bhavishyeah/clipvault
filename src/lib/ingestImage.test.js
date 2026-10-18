// @vitest-environment node
//
// Feature: capture-ingest, Batch 1 — smart image ingest on receive.
//
// The browser extension and Web Share Target deliver images "by reference":
// a link/text transfer whose content is an image URL or a data:image URI.
// planImageIngest decides whether such a transfer should be re-uploaded into
// our own Cloudinary as a durable image clip, and how. These are pure helpers.

import { describe, it, expect } from 'vitest'
import {
  isDataImage,
  isImageUrl,
  unwrapImageUrl,
  planImageIngest,
} from './ingestImage.js'

const DATA_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCA',
  IMG_URL = 'https://cdn.example.com/photos/cat.jpg',
  GOOGLE_IMGRES =
    'https://www.google.com/imgres?q=cat&imgurl=https%3A%2F%2Fwww.example.com%2Fcat.png&imgrefurl=https%3A%2F%2Fwww.example.com',
  PLAIN_URL = 'https://example.com/article/how-to-cat'

describe('isDataImage', () => {
  it('accepts a base64 data:image URI', () => {
    expect(isDataImage(DATA_PNG)).toBe(true)
    expect(isDataImage('data:image/jpeg;base64,/9j/4AAQ')).toBe(true)
  })
  it('rejects non-image data URIs and plain strings', () => {
    expect(isDataImage('data:text/plain;base64,aGk=')).toBe(false)
    expect(isDataImage('https://x.com/a.png')).toBe(false)
    expect(isDataImage(null)).toBe(false)
    expect(isDataImage(42)).toBe(false)
  })
})

describe('isImageUrl', () => {
  it('accepts http(s) URLs ending in an image extension', () => {
    expect(isImageUrl(IMG_URL)).toBe(true)
    expect(isImageUrl('http://x.com/a.PNG')).toBe(true)
    expect(isImageUrl('https://x.com/a.webp?w=500#frag')).toBe(true)
  })
  it('rejects non-image URLs and non-URLs', () => {
    expect(isImageUrl(PLAIN_URL)).toBe(false)
    expect(isImageUrl('ftp://x.com/a.png')).toBe(false)
    expect(isImageUrl('not a url')).toBe(false)
    expect(isImageUrl(DATA_PNG)).toBe(false)
  })
})

describe('unwrapImageUrl', () => {
  it('extracts the real image URL from a Google imgres wrapper', () => {
    expect(unwrapImageUrl(GOOGLE_IMGRES)).toBe('https://www.example.com/cat.png')
  })
  it('returns non-wrapper URLs unchanged', () => {
    expect(unwrapImageUrl(IMG_URL)).toBe(IMG_URL)
    expect(unwrapImageUrl(PLAIN_URL)).toBe(PLAIN_URL)
  })
})

describe('planImageIngest', () => {
  it('plans a data:image ingest with a derived name/mime', () => {
    const plan = planImageIngest({ type: 'text', content: DATA_PNG })
    expect(plan).toMatchObject({ source: 'data', uploadValue: DATA_PNG, mime: 'image/png' })
    expect(plan.name).toMatch(/\.png$/)
  })

  it('plans an image-URL ingest using the URL as the upload value', () => {
    const plan = planImageIngest({ type: 'link', content: IMG_URL })
    expect(plan).toMatchObject({ source: 'url', uploadValue: IMG_URL })
    expect(plan.name).toBe('cat.jpg')
  })

  it('unwraps a Google imgres link and plans ingest of the real image', () => {
    const plan = planImageIngest({ type: 'link', content: GOOGLE_IMGRES })
    expect(plan.source).toBe('url')
    expect(plan.uploadValue).toBe('https://www.example.com/cat.png')
    expect(plan.name).toBe('cat.png')
  })

  it('returns null for a plain (non-image) link', () => {
    expect(planImageIngest({ type: 'link', content: PLAIN_URL })).toBeNull()
  })

  it('returns null when the transfer already owns an uploaded file', () => {
    expect(
      planImageIngest({ type: 'link', content: IMG_URL, file_url: 'https://res.cloudinary.com/x.png' }),
    ).toBeNull()
  })

  it('returns null for file/image/audio transfer types', () => {
    expect(planImageIngest({ type: 'image', content: IMG_URL })).toBeNull()
    expect(planImageIngest({ type: 'file', content: IMG_URL })).toBeNull()
    expect(planImageIngest({ type: 'audio', content: IMG_URL })).toBeNull()
  })

  it('returns null for empty/missing content', () => {
    expect(planImageIngest({ type: 'text', content: '' })).toBeNull()
    expect(planImageIngest({ type: 'text' })).toBeNull()
    expect(planImageIngest(null)).toBeNull()
  })
})

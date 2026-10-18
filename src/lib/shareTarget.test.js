// @vitest-environment node
//
// Feature: capture-ingest, Batch 3 — Web Share Target routing.
//
// Android's share sheet lands on /?share=1 with title/text/url params. parseShare
// turns that query string into a routing intent: an image link/data-URI → image
// clip (Cloudinary ingest), a bare URL → link, anything else → text. Pure.

import { describe, it, expect } from 'vitest'
import { parseShare } from './shareTarget.js'

const DATA_PNG = 'data:image/png;base64,iVBORw0KGgo='
const IMG_URL = 'https://cdn.example.com/cat.jpg'

describe('parseShare', () => {
  it('returns null when nothing is shared', () => {
    expect(parseShare('')).toBeNull()
    expect(parseShare('?share=1')).toBeNull()
    expect(parseShare('?url=')).toBeNull()
  })

  it('routes an image URL (from url param) to an image intent', () => {
    const intent = parseShare(`?share=1&url=${encodeURIComponent(IMG_URL)}`)
    expect(intent).toEqual({ kind: 'image', value: IMG_URL })
  })

  it('routes a data:image (from text param) to an image intent', () => {
    const intent = parseShare(`?text=${encodeURIComponent(DATA_PNG)}`)
    expect(intent).toEqual({ kind: 'image', value: DATA_PNG })
  })

  it('unwraps a Google imgres share to the real image', () => {
    const google =
      'https://www.google.com/imgres?imgurl=' + encodeURIComponent('https://x.com/cat.png')
    const intent = parseShare(`?url=${encodeURIComponent(google)}`)
    expect(intent).toEqual({ kind: 'image', value: 'https://x.com/cat.png' })
  })

  it('routes a non-image URL to a link intent', () => {
    const url = 'https://example.com/article'
    expect(parseShare(`?url=${encodeURIComponent(url)}`)).toEqual({ kind: 'link', value: url })
  })

  it('routes plain text to a text intent', () => {
    expect(parseShare('?text=hello%20world')).toEqual({ kind: 'text', value: 'hello world' })
  })

  it('prefers url over text over title', () => {
    const intent = parseShare('?url=https%3A%2F%2Fa.com&text=b&title=c')
    expect(intent).toEqual({ kind: 'link', value: 'https://a.com' })
  })
})

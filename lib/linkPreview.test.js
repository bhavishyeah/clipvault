// @vitest-environment node
//
// Feature: volt-vault-polish, A4 — pure link-preview helpers.
//
// The link-preview endpoint (api/link-preview.js) delegates its SSRF guard and
// OpenGraph parsing to the dependency-free helpers in lib/linkPreview.js. These
// tests pin that contract: validatePreviewUrl accepts plain public http(s) URLs
// and rejects non-http(s) schemes plus private/loopback/link-local ranges;
// parseOgTags extracts og:title/description/image (with <title> and
// meta[name=description] fallbacks) and returns null for anything absent.
//
// _Requirements: 4.1, 4.4, 4.5, 4.6_

import { describe, it, expect } from 'vitest'
import {
  validatePreviewUrl,
  isPrivateHost,
  parseOgTags,
  PREVIEW_TIMEOUT_MS,
  PREVIEW_MAX_BYTES,
} from './linkPreview.js'

describe('validatePreviewUrl — scheme guard', () => {
  it('accepts a public https URL and returns the parsed URL', () => {
    const res = validatePreviewUrl('https://example.com/page?a=1')
    expect(res.ok).toBe(true)
    expect(res.url).toBeInstanceOf(URL)
    expect(res.url.hostname).toBe('example.com')
  })

  it('accepts a public http URL', () => {
    expect(validatePreviewUrl('http://example.com').ok).toBe(true)
  })

  it('trims surrounding whitespace before parsing', () => {
    expect(validatePreviewUrl('  https://example.com  ').ok).toBe(true)
  })

  it.each(['file:///etc/passwd', 'data:text/html,<h1>x', 'ftp://example.com', 'javascript:alert(1)'])(
    'rejects non-http(s) scheme %s',
    (url) => {
      const res = validatePreviewUrl(url)
      expect(res.ok).toBe(false)
      expect(res.reason).toBe('bad-scheme')
    },
  )

  it.each([null, undefined, '', '   ', 'not a url', 42])('rejects unparseable input %s', (url) => {
    const res = validatePreviewUrl(url)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('invalid-url')
  })
})

describe('validatePreviewUrl — private/loopback/link-local rejection', () => {
  it.each([
    'http://localhost/',
    'http://sub.localhost/',
    'https://server.local/',
    'https://db.internal/',
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://172.16.4.4/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://169.254.169.254/', // cloud metadata link-local
    'http://100.64.0.1/', // CGNAT
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://[::ffff:127.0.0.1]/',
  ])('rejects private/internal host %s', (url) => {
    const res = validatePreviewUrl(url)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('private-host')
  })

  it('allows a public IPv4 literal', () => {
    expect(validatePreviewUrl('http://93.184.216.34/').ok).toBe(true)
  })

  it('does not treat 172.15/172.32 (outside 172.16/12) as private', () => {
    expect(validatePreviewUrl('http://172.15.0.1/').ok).toBe(true)
    expect(validatePreviewUrl('http://172.32.0.1/').ok).toBe(true)
  })
})

describe('isPrivateHost', () => {
  it('flags loopback, private, and link-local ranges', () => {
    expect(isPrivateHost('127.0.0.1')).toBe(true)
    expect(isPrivateHost('192.168.0.1')).toBe(true)
    expect(isPrivateHost('169.254.1.1')).toBe(true)
    expect(isPrivateHost('::1')).toBe(true)
  })

  it('does not flag public hosts', () => {
    expect(isPrivateHost('example.com')).toBe(false)
    expect(isPrivateHost('8.8.8.8')).toBe(false)
  })

  it('fails closed on empty/malformed hosts', () => {
    expect(isPrivateHost('')).toBe(true)
    expect(isPrivateHost('999.999.999.999')).toBe(true)
  })
})

describe('parseOgTags — extraction', () => {
  it('extracts og:title, og:description, and og:image', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Hello World" />
        <meta property="og:description" content="A friendly greeting" />
        <meta property="og:image" content="https://cdn.example.com/img.png" />
      </head></html>`
    expect(parseOgTags(html)).toEqual({
      title: 'Hello World',
      description: 'A friendly greeting',
      image: 'https://cdn.example.com/img.png',
    })
  })

  it('tolerates single quotes and reversed attribute order', () => {
    const html = `<meta content='Reversed Title' property='og:title'>`
    expect(parseOgTags(html).title).toBe('Reversed Title')
  })

  it('decodes common HTML entities in extracted text', () => {
    const html = `<meta property="og:title" content="Tom &amp; Jerry &#39;25" />`
    expect(parseOgTags(html).title).toBe("Tom & Jerry '25")
  })
})

describe('parseOgTags — fallbacks', () => {
  it('falls back to <title> when og:title is absent', () => {
    const html = `<html><head><title>Plain Title</title></head></html>`
    const res = parseOgTags(html)
    expect(res.title).toBe('Plain Title')
    expect(res.description).toBeNull()
    expect(res.image).toBeNull()
  })

  it('falls back to meta[name=description] when og:description is absent', () => {
    const html = `<meta name="description" content="Standard meta description">`
    expect(parseOgTags(html).description).toBe('Standard meta description')
  })
})

describe('parseOgTags — missing tags return null fields', () => {
  it('returns all-null for a document with no metadata', () => {
    expect(parseOgTags('<html><body>nothing here</body></html>')).toEqual({
      title: null,
      description: null,
      image: null,
    })
  })

  it('returns all-null for empty or non-string input', () => {
    expect(parseOgTags('')).toEqual({ title: null, description: null, image: null })
    expect(parseOgTags(null)).toEqual({ title: null, description: null, image: null })
    expect(parseOgTags(undefined)).toEqual({ title: null, description: null, image: null })
  })

  it('treats whitespace-only content as null', () => {
    const html = `<meta property="og:title" content="   " /><title>   </title>`
    expect(parseOgTags(html).title).toBeNull()
  })
})

describe('shared limit constants', () => {
  it('exposes a positive timeout and byte cap for the endpoint', () => {
    expect(PREVIEW_TIMEOUT_MS).toBeGreaterThan(0)
    expect(PREVIEW_MAX_BYTES).toBeGreaterThan(0)
  })
})

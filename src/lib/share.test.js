// @vitest-environment node
//
// Feature: volt-reach — client share view model + path parsing.
// Validates Requirements 5.1, 5.2, 5.3.

import { describe, it, expect } from 'vitest'
import { sharePathToken, shareViewModel } from './share.js'

describe('sharePathToken', () => {
  it('extracts the token from /s/<token>', () => {
    expect(sharePathToken('/s/abc123')).toBe('abc123')
    expect(sharePathToken('/s/abc123/')).toBe('abc123')
    expect(sharePathToken('/s/aA0_-xyz')).toBe('aA0_-xyz')
  })
  it('returns null for non-share paths', () => {
    expect(sharePathToken('/')).toBeNull()
    expect(sharePathToken('/dashboard')).toBeNull()
    expect(sharePathToken('/s/')).toBeNull()
    expect(sharePathToken('/s/a/b')).toBeNull()
    expect(sharePathToken(null)).toBeNull()
  })
})

describe('shareViewModel', () => {
  it('maps a text clip to a copyable text view', () => {
    const v = shareViewModel({ type: 'text', content: 'hello', created_at: 't' })
    expect(v).toMatchObject({ kind: 'text', content: 'hello', canCopy: true, canDownload: false })
  })

  it('maps a link clip to a copyable link view', () => {
    const v = shareViewModel({ type: 'link', content: 'https://x.com' })
    expect(v).toMatchObject({ kind: 'link', content: 'https://x.com', canCopy: true, canDownload: false })
  })

  it('maps an image clip to a downloadable image view', () => {
    const v = shareViewModel({ type: 'image', file_url: 'https://res.cloudinary.com/x/cat.png', file_name: 'cat.png' })
    expect(v).toMatchObject({
      kind: 'image', downloadUrl: 'https://res.cloudinary.com/x/cat.png', fileName: 'cat.png',
      canDownload: true, canCopy: false,
    })
  })

  it('maps file and audio clips to a downloadable file view', () => {
    const file = shareViewModel({ type: 'file', file_url: 'https://res.cloudinary.com/x/doc.pdf', file_name: 'doc.pdf' })
    expect(file).toMatchObject({ kind: 'file', canDownload: true })
    const audio = shareViewModel({ type: 'audio', file_url: 'https://res.cloudinary.com/x/a.mp3' })
    expect(audio.kind).toBe('file')
    expect(audio.canDownload).toBe(true)
  })

  it('cannot download when a file url is missing', () => {
    expect(shareViewModel({ type: 'image', file_url: null }).canDownload).toBe(false)
  })

  it('cannot copy empty text content', () => {
    expect(shareViewModel({ type: 'text', content: '' }).canCopy).toBe(false)
  })

  it('falls back to text for an unknown/absent type', () => {
    expect(shareViewModel({}).kind).toBe('text')
    expect(shareViewModel({ type: 'weird', content: 'x' }).kind).toBe('text')
  })
})

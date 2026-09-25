// @vitest-environment node
//
// Feature: volt-vault-polish (A3) — QR target selection.
// Validates Requirements 3.2, 3.3, 3.4.

import { describe, it, expect } from 'vitest'
import { chooseQrValue, SAFE_QR_LENGTH } from './qrTarget.js'

const ORIGIN = 'https://volt.example'

describe('chooseQrValue', () => {
  // --- Requirement 3.2: an active share wins ---
  describe('share wins when one exists', () => {
    it('encodes the server-provided absolute share url', () => {
      const clip = { type: 'text', content: 'hello' }
      const share = { token: 'tok123', url: 'https://volt.example/s/tok123' }
      expect(chooseQrValue(clip, share, { origin: ORIGIN })).toEqual({
        kind: 'share',
        value: 'https://volt.example/s/tok123',
      })
    })

    it('reconstructs the /s/<token> url from origin when url is absent', () => {
      const clip = { type: 'link', content: 'https://a.com' }
      const share = { token: 'tok123' }
      expect(chooseQrValue(clip, share, { origin: ORIGIN })).toEqual({
        kind: 'share',
        value: 'https://volt.example/s/tok123',
      })
    })

    it('prefers the share even for an image/file clip', () => {
      const clip = { type: 'image', content: null }
      const share = { token: 'imgtok' }
      expect(chooseQrValue(clip, share, { origin: ORIGIN })).toEqual({
        kind: 'share',
        value: 'https://volt.example/s/imgtok',
      })
    })

    it('prefers the share even for oversized text', () => {
      const clip = { type: 'text', content: 'x'.repeat(SAFE_QR_LENGTH + 100) }
      const share = { token: 'bigtok' }
      expect(chooseQrValue(clip, share, { origin: ORIGIN }).kind).toBe('share')
    })

    it('falls through to raw when the share cannot yield a url', () => {
      // A share object with neither url nor token (and no origin) is unusable.
      const clip = { type: 'text', content: 'hi' }
      const share = {}
      expect(chooseQrValue(clip, share, { origin: '' })).toEqual({
        kind: 'raw',
        value: 'hi',
      })
    })
  })

  // --- Requirement 3.3: raw for short text/link with no share ---
  describe('raw for short text/link with no active share', () => {
    it('encodes short text content directly', () => {
      const clip = { type: 'text', content: 'copy this' }
      expect(chooseQrValue(clip, null, { origin: ORIGIN })).toEqual({
        kind: 'raw',
        value: 'copy this',
      })
    })

    it('encodes a short link directly', () => {
      const clip = { type: 'link', content: 'https://a.com/x' }
      expect(chooseQrValue(clip, null, { origin: ORIGIN })).toEqual({
        kind: 'raw',
        value: 'https://a.com/x',
      })
    })

    it('defaults an untyped clip with short content to raw text', () => {
      const clip = { content: 'no type field' }
      expect(chooseQrValue(clip, null, { origin: ORIGIN })).toEqual({
        kind: 'raw',
        value: 'no type field',
      })
    })

    it('encodes content exactly at the safe cap as raw', () => {
      const content = 'a'.repeat(SAFE_QR_LENGTH)
      const clip = { type: 'text', content }
      expect(chooseQrValue(clip, null, { origin: ORIGIN })).toEqual({
        kind: 'raw',
        value: content,
      })
    })
  })

  // --- Requirement 3.4: needs-share for image/file or oversized ---
  describe('needs-share for unsuitable raw content', () => {
    it('signals needs-share for an image clip', () => {
      const clip = { type: 'image', content: null }
      expect(chooseQrValue(clip, null, { origin: ORIGIN })).toEqual({
        kind: 'needs-share',
        value: '',
      })
    })

    it('signals needs-share for a file clip', () => {
      const clip = { type: 'file', content: null }
      expect(chooseQrValue(clip, null, { origin: ORIGIN })).toEqual({
        kind: 'needs-share',
        value: '',
      })
    })

    it('signals needs-share for an audio clip', () => {
      const clip = { type: 'audio', content: null }
      expect(chooseQrValue(clip, null, { origin: ORIGIN })).toEqual({
        kind: 'needs-share',
        value: '',
      })
    })

    it('signals needs-share for text just over the safe cap', () => {
      const clip = { type: 'text', content: 'a'.repeat(SAFE_QR_LENGTH + 1) }
      expect(chooseQrValue(clip, null, { origin: ORIGIN })).toEqual({
        kind: 'needs-share',
        value: '',
      })
    })

    it('signals needs-share for an oversized link', () => {
      const clip = { type: 'link', content: 'https://a.com/' + 'q'.repeat(SAFE_QR_LENGTH) }
      expect(chooseQrValue(clip, null, { origin: ORIGIN }).kind).toBe('needs-share')
    })

    it('signals needs-share for a text clip with empty content', () => {
      const clip = { type: 'text', content: '' }
      expect(chooseQrValue(clip, null, { origin: ORIGIN })).toEqual({
        kind: 'needs-share',
        value: '',
      })
    })
  })
})

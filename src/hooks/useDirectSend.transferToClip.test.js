// @vitest-environment node
//
// Feature: sharing-enhancements, Property 5: Transfer → clip file-field round trip
//
// Validates: Requirements 5.3, 5.6
//
// Saving an incoming file/audio (or image) transfer to the vault must produce a
// clip whose file fields (name, size, mime, url) equal the transfer's file
// fields, and whose type matches. saveToVault is coupled to Supabase, so we test
// the PURE mapping `transferToClip(transfer)` — the exact { type, content,
// metadata } object saveToVault inserts — which is the single source of truth.
//
// For text/link transfers, metadata is {} and the type is carried through
// unchanged.

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { transferToClip } from './useDirectSend.js'

const FILE_TYPES = ['image', 'file', 'audio']
const TEXT_TYPES = ['text', 'link']
const ALL_TYPES = [...FILE_TYPES, ...TEXT_TYPES]

// A generator for an arbitrary transfer row across all types, always carrying
// file fields (they are simply ignored by the mapping for text/link types).
const transferArb = fc.record({
  type: fc.constantFrom(...ALL_TYPES),
  content: fc.oneof(fc.string(), fc.constant(null)),
  // Non-empty strings so `|| null` truthiness checks preserve the value.
  file_url: fc.string({ minLength: 1 }),
  file_name: fc.string({ minLength: 1 }),
  file_size: fc.integer({ min: 1, max: 15_728_640 }),
  mime_type: fc.string({ minLength: 1 }),
})

describe('Property 5: Transfer → clip file-field round trip', () => {
  it('produces a clip whose file fields equal the transfer for image/file/audio', () => {
    fc.assert(
      fc.property(
        transferArb.filter((t) => FILE_TYPES.includes(t.type)),
        (transfer) => {
          const payload = transferToClip(transfer)

          // Type matches the transfer.
          expect(payload.type).toBe(transfer.type)

          // File fields round-trip into the Cloudinary-shaped metadata.
          expect(payload.metadata.secure_url).toBe(transfer.file_url)
          expect(payload.metadata.name).toBe(transfer.file_name)
          expect(payload.metadata.bytes).toBe(transfer.file_size)
          expect(payload.metadata.mime).toBe(transfer.mime_type)
          expect(payload.metadata.provider).toBe('cloudinary')

          // Content is carried through unchanged.
          expect(payload.content).toBe(transfer.content)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('produces empty metadata for text/link transfers, type carried through', () => {
    fc.assert(
      fc.property(
        transferArb.filter((t) => TEXT_TYPES.includes(t.type)),
        (transfer) => {
          const payload = transferToClip(transfer)

          expect(payload.type).toBe(transfer.type)
          expect(payload.metadata).toEqual({})
          expect(payload.content).toBe(transfer.content)
        },
      ),
      { numRuns: 100 },
    )
  })
})

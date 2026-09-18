// @vitest-environment node
//
// Feature: sharing-enhancements, Property 3: Size-limit gate and pre-upload ordering
//
// Validates: Requirements 1.3, 1.4, 1.6, 2.1, 2.2, 2.4, 5.4, 14.5
//
// Property 3 has two halves:
//   (a) Acceptance boundary — for any file, validateFile accepts iff size > 0
//       and size is at most the limit for its classification (15,728,640 for
//       'file', 10,485,760 for 'audio'). Images have no size gate.
//   (b) Pre-upload ordering — whenever validateFile rejects a file, the upload
//       function is never invoked. A small caller shim runs validateFile and
//       only calls the (mocked) upload fn when ok is true.

import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import { validateFile, classifyFile, SIZE_LIMITS } from './fileType.js'

const RUNS = 100

// Small caller shim: mirrors the real pre-upload ordering (validate first,
// only upload when the gate passes). Returns the gate result so callers can
// assert on both the decision and the mock's invocation.
function maybeUpload(file, uploadFn) {
  const result = validateFile(file)
  if (result.ok) uploadFn(file)
  return result
}

// Expected limit for a given MIME classification. `null` means "no size gate".
function limitFor(mime) {
  const kind = classifyFile(mime)
  if (kind === 'audio') return SIZE_LIMITS.audio
  if (kind === 'file') return SIZE_LIMITS.file
  return null // image: unlimited
}

// A generator that produces a representative spread of MIME types across all
// three classifications, so the property exercises image/audio/file paths.
const mimeArb = fc.constantFrom(
  'image/png',
  'image/jpeg',
  'image/gif',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'application/pdf',
  'application/zip',
  'text/plain',
  'video/mp4',
  '',
  'garbage',
)

// A size generator that mixes ordinary sizes with values clustered around the
// two limits and non-positive / non-finite edge cases, so the boundary is hit.
const sizeArb = fc.oneof(
  fc.integer({ min: -5, max: 5 }), // zero and near-zero (rejection region)
  fc.integer({ min: 1, max: 20_000_000 }), // spans both limits
  // Values straddling each limit exactly.
  fc.constantFrom(
    SIZE_LIMITS.audio - 1,
    SIZE_LIMITS.audio,
    SIZE_LIMITS.audio + 1,
    SIZE_LIMITS.file - 1,
    SIZE_LIMITS.file,
    SIZE_LIMITS.file + 1,
  ),
  fc.constantFrom(NaN, Infinity, -Infinity),
)

describe('Property 3: Size-limit gate and pre-upload ordering', () => {
  it('accepts iff size > 0 and within the classification limit', () => {
    fc.assert(
      fc.property(mimeArb, sizeArb, (type, size) => {
        const limit = limitFor(type)
        const bytes = Number(size)

        const withinGate =
          Number.isFinite(bytes) &&
          bytes > 0 &&
          (limit === null || bytes <= limit)

        const result = validateFile({ type, size })
        expect(result.ok).toBe(withinGate)

        // Rejection reasons and the reported limit must be consistent.
        if (!result.ok) {
          if (!Number.isFinite(bytes) || bytes <= 0) {
            expect(result.reason).toBe('empty')
          } else {
            expect(result.reason).toBe('too_large')
            expect(result.limit).toBe(limit)
          }
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('never invokes the upload function when the file is rejected', () => {
    fc.assert(
      fc.property(mimeArb, sizeArb, (type, size) => {
        const upload = vi.fn()
        const file = { type, size }

        const result = maybeUpload(file, upload)

        if (result.ok) {
          expect(upload).toHaveBeenCalledTimes(1)
          expect(upload).toHaveBeenCalledWith(file)
        } else {
          // Core ordering guarantee: no upload on rejection.
          expect(upload).not.toHaveBeenCalled()
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('images bypass the size gate (accepted at any positive size)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('image/png', 'image/jpeg', 'image/webp'),
        fc.integer({ min: 1, max: 500_000_000 }),
        (type, size) => {
          expect(validateFile({ type, size }).ok).toBe(true)
        },
      ),
      { numRuns: RUNS },
    )
  })
})

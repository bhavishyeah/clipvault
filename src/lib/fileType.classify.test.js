// @vitest-environment node
//
// Feature: sharing-enhancements, Property 1: File classification is total and disjoint
//
// Validates: Requirements 1.1, 1.2
//
// classifyFile(mime) must be a TOTAL function over strings, returning exactly
// one of 'image' | 'audio' | 'file'. Every `image/*` maps to 'image', every
// `audio/*` maps to 'audio', and every other input (including empty/unknown)
// maps to 'file'. The classification is disjoint: exactly one kind is returned.

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { classifyFile } from './fileType.js'

const KINDS = ['image', 'audio', 'file']

describe('Property 1: File classification is total and disjoint', () => {
  it('returns exactly one of image/audio/file for any string input', () => {
    fc.assert(
      fc.property(fc.string(), (mime) => {
        const kind = classifyFile(mime)
        // Total + disjoint: result is always exactly one of the three kinds.
        expect(KINDS).toContain(kind)
      }),
      { numRuns: 500 },
    )
  })

  it('classifies every image/* MIME as image (Req 1.1 boundary)', () => {
    fc.assert(
      fc.property(
        // Arbitrary, possibly mixed-case subtype after the `image/` prefix.
        fc.string(),
        (subtype) => {
          expect(classifyFile(`image/${subtype}`)).toBe('image')
          // Case-insensitive: uppercase prefix still classifies as image.
          expect(classifyFile(`IMAGE/${subtype}`)).toBe('image')
        },
      ),
      { numRuns: 200 },
    )
  })

  it('classifies every audio/* MIME as audio (Req 1.2)', () => {
    fc.assert(
      fc.property(fc.string(), (subtype) => {
        expect(classifyFile(`audio/${subtype}`)).toBe('audio')
        // Case-insensitive: uppercase prefix still classifies as audio.
        expect(classifyFile(`AUDIO/${subtype}`)).toBe('audio')
      }),
      { numRuns: 200 },
    )
  })

  it('classifies any non-image, non-audio string as file (Req 1.1 fallthrough)', () => {
    // Generator constrained to the "everything else" input space: strings whose
    // lowercased form does not start with the image/ or audio/ prefix.
    const nonMediaString = fc
      .string()
      .filter((s) => {
        const lower = s.toLowerCase()
        return !lower.startsWith('image/') && !lower.startsWith('audio/')
      })

    fc.assert(
      fc.property(nonMediaString, (mime) => {
        expect(classifyFile(mime)).toBe('file')
      }),
      { numRuns: 300 },
    )
  })

  it('classifies empty and non-string inputs as file (total over unknown)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(''),
          fc.constant(undefined),
          fc.constant(null),
          fc.integer(),
          fc.boolean(),
          fc.object(),
        ),
        (input) => {
          expect(classifyFile(input)).toBe('file')
        },
      ),
      { numRuns: 100 },
    )
  })
})

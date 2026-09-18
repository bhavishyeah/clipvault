// @vitest-environment node
// Feature: sharing-enhancements, Property 2: Resource-type mapping is total
//
// Property 2: Resource-type mapping is total — for any classification kind
// ∈ {image, audio, file}, resourceTypeFor returns exactly one Cloudinary
// resource type, with image→image, audio→video, file→auto.
//
// Validates: Requirements 3.1, 3.2

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { resourceTypeFor } from './fileType.js'

const KINDS = ['image', 'audio', 'file']

// Expected mapping per Requirements 3.1 (audio → video) and 3.2 (file → auto),
// plus the image → image identity used by the existing image upload path.
const EXPECTED = {
  image: 'image',
  audio: 'video',
  file: 'auto',
}

const VALID_RESOURCE_TYPES = ['image', 'video', 'auto']

describe('resourceTypeFor — Property 2: Resource-type mapping is total', () => {
  it('maps every classification kind to exactly one expected Cloudinary resource type', () => {
    fc.assert(
      fc.property(fc.constantFrom(...KINDS), (kind) => {
        const result = resourceTypeFor(kind)

        // Totality: a single, defined string result for every kind.
        expect(typeof result).toBe('string')
        expect(VALID_RESOURCE_TYPES).toContain(result)

        // Exact mapping: image→image, audio→video, file→auto.
        expect(result).toBe(EXPECTED[kind])
      }),
      { numRuns: 200 },
    )
  })

  it('is deterministic — the same kind always yields the same resource type', () => {
    fc.assert(
      fc.property(fc.constantFrom(...KINDS), (kind) => {
        expect(resourceTypeFor(kind)).toBe(resourceTypeFor(kind))
      }),
      { numRuns: 200 },
    )
  })
})

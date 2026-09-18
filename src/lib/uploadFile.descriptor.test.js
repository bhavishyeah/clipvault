// Feature: sharing-enhancements, Property 4: Upload descriptor completeness
//
// Validates: Requirements 1.5, 3.3, 3.4
//
// Property 4: for any valid (within-size) file, the normalized UploadDescriptor
// has every field defined/non-null, and the outgoing request always includes
// the unsigned upload preset and the `volt/{userId}` folder, POSTing to the
// resource segment chosen by resourceTypeFor(classifyFile(mime)).
//
// This exercises the real uploadFile against a mocked XMLHttpRequest that
// synchronously fires a successful `load` with a canned Cloudinary response.
// FormData fields are captured via a spy on FormData.prototype.append because
// jsdom's FormData does not reliably expose appended File entries via .get().

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fc from 'fast-check'
import { classifyFile, resourceTypeFor, SIZE_LIMITS } from './fileType.js'

const RUNS = 100

// Cloudinary env vars the module reads at import time via import.meta.env.
vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', 'test-cloud')
vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', 'test-preset')

// Import AFTER stubbing env so the module picks up the configured values.
const { uploadFile } = await import('./uploadFile.js')

// Holds the request details captured by the most recent fake XHR instance.
let lastRequest

// A minimal fake XMLHttpRequest that records the URL and synchronously fires a
// successful load with a canned Cloudinary JSON body when send() is called.
class FakeXHR {
  constructor() {
    this.upload = { addEventListener: () => {} }
    this._listeners = {}
    this.status = 200
    this.responseText = JSON.stringify({
      secure_url: 'https://res.cloudinary.com/test-cloud/upload/canned.bin',
      bytes: 12345,
      format: 'bin',
    })
  }
  addEventListener(type, cb) {
    this._listeners[type] = cb
  }
  removeEventListener() {}
  open(method, url) {
    lastRequest.method = method
    lastRequest.url = url
  }
  send() {
    // Fire load synchronously so the awaited Promise resolves in-test.
    if (this._listeners.load) this._listeners.load()
  }
  abort() {
    if (this._listeners.abort) this._listeners.abort()
  }
}

let appendSpy

beforeEach(() => {
  lastRequest = { fields: {}, method: null, url: null }

  // Capture appended FormData fields. jsdom's FormData.get() does not expose
  // File values consistently, so we record every append here.
  appendSpy = vi
    .spyOn(FormData.prototype, 'append')
    .mockImplementation(function (key, value) {
      lastRequest.fields[key] = value
    })

  vi.stubGlobal('XMLHttpRequest', FakeXHR)
})

afterEach(() => {
  appendSpy.mockRestore()
  vi.unstubAllGlobals()
})

// MIME types spanning all three classifications, so image/audio/file
// resource-segment routing is exercised.
const mimeArb = fc.constantFrom(
  'image/png',
  'image/jpeg',
  'image/webp',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'application/pdf',
  'application/zip',
  'text/plain',
  'video/mp4',
)

// Sizes constrained to the valid (within-gate) input space. Audio and file
// share a 10 MB floor to stay under both limits; images are effectively
// unlimited but a bounded size keeps generation cheap.
const sizeArb = fc.integer({ min: 1, max: SIZE_LIMITS.audio })

// Non-empty user ids (used for the `volt/{userId}` folder path).
const userIdArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0)

const nameArb = fc.string({ minLength: 1, maxLength: 60 })

describe('Property 4: Upload descriptor completeness', () => {
  it('returns a fully-populated descriptor and sends preset + volt folder', async () => {
    await fc.assert(
      fc.asyncProperty(mimeArb, sizeArb, userIdArb, nameArb, async (mime, size, userId, name) => {
        const file = { type: mime, size, name }

        const descriptor = await uploadFile(file, { userId })

        // (a) Descriptor completeness — every field defined/non-null (Req 1.5, 3.4).
        expect(descriptor.secure_url).toBeTruthy()
        expect(descriptor.resource_type).not.toBeNull()
        expect(descriptor.resource_type).toBeDefined()
        expect(descriptor.bytes).not.toBeNull()
        expect(descriptor.bytes).toBeDefined()
        expect(descriptor.format).not.toBeNull()
        expect(descriptor.format).toBeDefined()
        expect(descriptor.mime).toBe(mime)
        expect(descriptor.name).toBe(name)

        // (b) Request always includes the unsigned preset and per-user folder (Req 3.3).
        expect(lastRequest.fields.upload_preset).toBe('test-preset')
        expect(lastRequest.fields.folder).toBe(`volt/${userId}`)
        expect(lastRequest.fields.file).toBe(file)

        // (c) POST URL targets the resource segment for this MIME (Req 3.3, 3.4).
        const expectedResource = resourceTypeFor(classifyFile(mime))
        expect(lastRequest.method).toBe('POST')
        expect(lastRequest.url).toContain(`/${expectedResource}/upload`)
        expect(descriptor.resource_type).toBe(expectedResource)
      }),
      { numRuns: RUNS },
    )
  })
})

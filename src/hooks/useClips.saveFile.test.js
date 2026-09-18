// @vitest-environment jsdom
//
// Feature: sharing-enhancements
// Unit tests for useClips.saveFile validation and error paths (Task 5.2)
//
// Validates: Requirements 1.6, 1.7
//
// saveFile(file, options) must:
//   - run validateFile FIRST (toast + early return on failure; NO upload and
//     NO clip insert on an oversize/empty file — Req 1.6)
//   - on upload failure, roll back the optimistic entry and store nothing
//     (Req 1.7)
//   - on insert failure, roll back the optimistic entry and store nothing
//   - on success, toast success and keep the clip
//
// The Supabase client, upload service, toast store, analytics, and rate
// limiter are mocked so the tests exercise saveFile's control flow in
// isolation without any network or DOM-storage side effects.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// --- Mocks -----------------------------------------------------------------

// Configurable result for the `clips` table insert. Tests set this before
// invoking saveFile. Default: success (no error).
let insertResult = { error: null }
// Spy so tests can assert whether an insert was attempted at all.
const insertSpy = vi.fn(() => Promise.resolve(insertResult))

// A chainable query builder mimicking the subset of the Supabase JS API that
// useClips touches. The initial mount performs a select().or().order().order()
// that must resolve to { data: [], error: null } so `loading` settles to false.
function makeQueryBuilder() {
  const builder = {
    select: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    insert: vi.fn((...args) => insertSpy(...args)),
    delete: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    not: vi.fn(() => builder),
    // The mount's select chain is awaited directly, so the builder itself must
    // be thenable and resolve to an empty, error-free result set.
    then: (resolve) => resolve({ data: [], error: null }),
  }
  return builder
}

// A realtime channel whose .on() is chainable and .subscribe() returns itself.
function makeChannel() {
  const channel = {
    on: vi.fn(() => channel),
    subscribe: vi.fn(() => channel),
  }
  return channel
}

vi.mock('../lib/supabaseClient', () => {
  const supabase = {
    from: vi.fn(() => makeQueryBuilder()),
    channel: vi.fn(() => makeChannel()),
    removeChannel: vi.fn(),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(() => Promise.resolve({ data: null })),
        remove: vi.fn(() => Promise.resolve({ error: null })),
      })),
    },
  }
  return { supabase }
})

// Upload service mock. Export a configurable vi.fn() plus a stand-in SizeError
// class matching the real module's shape. The class is declared inside the
// factory because vi.mock is hoisted above module-level declarations.
const uploadFile = vi.fn()
vi.mock('../lib/uploadFile', () => {
  class SizeError extends Error {
    constructor(message, { reason, limit } = {}) {
      super(message)
      this.name = 'SizeError'
      this.reason = reason
      this.limit = limit
    }
  }
  return {
    uploadFile: (...args) => uploadFile(...args),
    SizeError,
  }
})

const toast = vi.fn()
vi.mock('../components/ui/toastStore', () => ({
  toast: (...args) => toast(...args),
}))

const trackEvent = vi.fn()
vi.mock('../lib/analytics', () => ({
  trackEvent: (...args) => trackEvent(...args),
}))

const checkRateLimit = vi.fn(() => true)
vi.mock('../lib/rateLimit', () => ({
  checkRateLimit: (...args) => checkRateLimit(...args),
}))

// --- Test harness ----------------------------------------------------------

import { useClips } from './useClips.js'

const user = { id: 'u1' }

// Render the hook and wait for the initial load to settle so `saving`/rollback
// assertions aren't racing the mount effect.
async function mountHook() {
  const view = renderHook(() => useClips(user))
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  insertResult = { error: null }
  insertSpy.mockImplementation(() => Promise.resolve(insertResult))
  checkRateLimit.mockReturnValue(true)
  // Ensure the Cloudinary env vars are present so saveFile does not early-return
  // with 'Upload not configured'.
  vi.stubEnv('VITE_CLOUDINARY_CLOUD_NAME', 'test-cloud')
  vi.stubEnv('VITE_CLOUDINARY_UPLOAD_PRESET', 'test-preset')
})

// --- Tests -----------------------------------------------------------------

describe('useClips.saveFile — validation and error paths', () => {
  it('rejects an oversize file: toasts, never uploads, never inserts (Req 1.6)', async () => {
    const { result } = await mountHook()

    const oversize = { type: 'application/pdf', size: 20 * 1024 * 1024, name: 'big.pdf' }

    await act(async () => {
      await result.current.saveFile(oversize)
    })

    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/limit/i), 'error')
    expect(uploadFile).not.toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
    expect(result.current.clips).toHaveLength(0)
  })

  it('rejects an empty file: toasts, never uploads, never inserts', async () => {
    const { result } = await mountHook()

    const empty = { type: 'application/pdf', size: 0, name: 'empty.pdf' }

    await act(async () => {
      await result.current.saveFile(empty)
    })

    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/empty/i), 'error')
    expect(uploadFile).not.toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
    expect(result.current.clips).toHaveLength(0)
  })

  it('rolls back and stores nothing when the upload fails (Req 1.7)', async () => {
    uploadFile.mockRejectedValueOnce(new Error('Network error'))

    const { result } = await mountHook()

    const valid = { type: 'application/pdf', size: 1024, name: 'doc.pdf' }

    await act(async () => {
      await result.current.saveFile(valid)
    })

    // Upload was attempted, but the insert must NOT be reached.
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(insertSpy).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/failed to upload/i), 'error')
    // Optimistic entry rolled back — nothing retained.
    expect(result.current.clips).toHaveLength(0)
  })

  it('rolls back and stores nothing when the clip insert fails', async () => {
    uploadFile.mockResolvedValueOnce({
      secure_url: 'https://res.cloudinary.com/test/doc.pdf',
      resource_type: 'auto',
      bytes: 1024,
      format: 'pdf',
      mime: 'application/pdf',
      name: 'doc.pdf',
    })
    insertResult = { error: { message: 'insert denied' } }

    const { result } = await mountHook()

    const valid = { type: 'application/pdf', size: 1024, name: 'doc.pdf' }

    await act(async () => {
      await result.current.saveFile(valid)
    })

    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/failed to upload/i), 'error')
    // Rollback: the optimistic clip is removed on insert failure.
    expect(result.current.clips).toHaveLength(0)
  })

  it('stores the clip and toasts success on a valid upload + insert', async () => {
    uploadFile.mockResolvedValueOnce({
      secure_url: 'https://res.cloudinary.com/test/doc.pdf',
      resource_type: 'auto',
      bytes: 1024,
      format: 'pdf',
      mime: 'application/pdf',
      name: 'doc.pdf',
    })
    insertResult = { error: null }

    const { result } = await mountHook()

    const valid = { type: 'application/pdf', size: 1024, name: 'doc.pdf' }

    await act(async () => {
      await result.current.saveFile(valid)
    })

    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('File saved')
    // No error toast on the happy path.
    expect(toast).not.toHaveBeenCalledWith(expect.anything(), 'error')
    // The optimistic entry is retained until Realtime replaces it.
    expect(result.current.clips).toHaveLength(1)
  })
})

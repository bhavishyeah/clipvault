// @vitest-environment jsdom
//
// Feature: volt-vault-polish (Track A — A1 Clip tags)
// Unit tests for useClips.setTags (Task 1.2)
//
// Validates: Requirements 1.1, 1.4, 1.7, 1.8
//
// setTags(clip, tags) must:
//   - persist the tag list under clips.metadata.tags (Req 1.1, 1.8)
//   - MERGE into the clip's existing metadata without clobbering unrelated
//     keys (provider/secure_url/mime/preview/…) (Req 1.8)
//   - update local state optimistically so the card reflects the change (Req 1.1, 1.4)
//   - roll back local state and toast on a persistence error
//
// The Supabase client, toast store, analytics, upload service, and rate
// limiter are mocked so the test exercises setTags' control flow in isolation
// without any network or DOM-storage side effects.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// --- Mocks -----------------------------------------------------------------

// Configurable result for the `clips` table update. Tests set this before
// invoking setTags. Default: success (no error).
let updateResult = { error: null }
// Spy so tests can assert what payload was sent to update().
const updateSpy = vi.fn(() => builderRef)
// Captured update payload for assertions.
let lastUpdatePayload = null

// The initial clip set returned by the mount's select chain. Tests set this
// before mounting so a clip with existing metadata is present in state.
let initialClips = []

let builderRef = null

function makeQueryBuilder() {
  const builder = {
    select: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    update: vi.fn((payload) => {
      lastUpdatePayload = payload
      updateSpy(payload)
      return builder
    }),
    // eq() terminates the update chain and resolves to the configured result.
    eq: vi.fn(() => Promise.resolve(updateResult)),
    lt: vi.fn(() => builder),
    not: vi.fn(() => builder),
    // The mount's select chain is awaited directly.
    then: (resolve) => resolve({ data: initialClips, error: null }),
  }
  builderRef = builder
  return builder
}

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

vi.mock('../lib/uploadFile', () => {
  class SizeError extends Error {}
  return { uploadFile: vi.fn(), SizeError }
})

const toast = vi.fn()
vi.mock('../components/ui/toastStore', () => ({
  toast: (...args) => toast(...args),
}))

vi.mock('../lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('../lib/rateLimit', () => ({ checkRateLimit: vi.fn(() => true) }))

// --- Test harness ----------------------------------------------------------

import { useClips } from './useClips.js'

const user = { id: 'u1' }

async function mountHook() {
  const view = renderHook(() => useClips(user))
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  updateResult = { error: null }
  lastUpdatePayload = null
  initialClips = []
})

// --- Tests -----------------------------------------------------------------

describe('useClips.setTags — metadata merge and persistence', () => {
  it('writes metadata.tags without clobbering other metadata keys (Req 1.8)', async () => {
    // A file clip whose metadata carries provider/secure_url/mime/name — none
    // of these must be lost when tags are written.
    const clip = {
      id: 'c1',
      user_id: 'u1',
      type: 'image',
      content: null,
      metadata: {
        provider: 'cloudinary',
        secure_url: 'https://res.cloudinary.com/test/pic.png',
        mime: 'image/png',
        name: 'pic.png',
      },
      is_pinned: false,
      created_at: new Date().toISOString(),
    }
    initialClips = [clip]

    const { result } = await mountHook()

    await act(async () => {
      await result.current.setTags(clip, ['work', 'urgent'])
    })

    // Persisted payload merges the new tags into existing metadata.
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(lastUpdatePayload).toEqual({
      metadata: {
        provider: 'cloudinary',
        secure_url: 'https://res.cloudinary.com/test/pic.png',
        mime: 'image/png',
        name: 'pic.png',
        tags: ['work', 'urgent'],
      },
    })

    // Local state reflects the merged metadata.
    const updated = result.current.clips.find((c) => c.id === 'c1')
    expect(updated.metadata.tags).toEqual(['work', 'urgent'])
    expect(updated.metadata.provider).toBe('cloudinary')
    expect(updated.metadata.secure_url).toBe('https://res.cloudinary.com/test/pic.png')
    expect(toast).not.toHaveBeenCalled()
  })

  it('sets tags on a clip that has no prior metadata', async () => {
    const clip = {
      id: 'c2',
      user_id: 'u1',
      type: 'text',
      content: 'hello',
      metadata: null,
      is_pinned: false,
      created_at: new Date().toISOString(),
    }
    initialClips = [clip]

    const { result } = await mountHook()

    await act(async () => {
      await result.current.setTags(clip, ['note'])
    })

    expect(lastUpdatePayload).toEqual({ metadata: { tags: ['note'] } })
    const updated = result.current.clips.find((c) => c.id === 'c2')
    expect(updated.metadata.tags).toEqual(['note'])
  })

  it('removing the last tag persists an empty tags array (Req 1.4)', async () => {
    const clip = {
      id: 'c3',
      user_id: 'u1',
      type: 'text',
      content: 'x',
      metadata: { tags: ['old'], preview: { title: 'keep me' } },
      is_pinned: false,
      created_at: new Date().toISOString(),
    }
    initialClips = [clip]

    const { result } = await mountHook()

    await act(async () => {
      await result.current.setTags(clip, [])
    })

    // Tags cleared, but unrelated metadata (preview) preserved.
    expect(lastUpdatePayload).toEqual({
      metadata: { tags: [], preview: { title: 'keep me' } },
    })
    const updated = result.current.clips.find((c) => c.id === 'c3')
    expect(updated.metadata.tags).toEqual([])
    expect(updated.metadata.preview).toEqual({ title: 'keep me' })
  })

  it('rolls back local state and toasts when persistence fails', async () => {
    const clip = {
      id: 'c4',
      user_id: 'u1',
      type: 'text',
      content: 'x',
      metadata: { provider: 'cloudinary', tags: ['a'] },
      is_pinned: false,
      created_at: new Date().toISOString(),
    }
    initialClips = [clip]
    updateResult = { error: { message: 'update denied' } }

    const { result } = await mountHook()

    await act(async () => {
      await result.current.setTags(clip, ['a', 'b'])
    })

    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/tag/i), 'error')
    // Rolled back to the original tag list and metadata.
    const reverted = result.current.clips.find((c) => c.id === 'c4')
    expect(reverted.metadata.tags).toEqual(['a'])
    expect(reverted.metadata.provider).toBe('cloudinary')
  })
})

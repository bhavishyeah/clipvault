// @vitest-environment jsdom
//
// Feature: volt-vault-polish (Track A — A4 Rich link previews)
// Unit tests for useClips.setPreview (Task 5.3)
//
// Validates: Requirements 4.2, 4.3
//
// setPreview(clip, preview) must:
//   - persist the preview under clips.metadata.preview (Req 4.2)
//   - MERGE into the clip's existing metadata without clobbering unrelated
//     keys (tags/provider/secure_url/…)
//   - update local state optimistically so the card re-renders with the
//     preview (Req 4.3)
//   - be best-effort: on a persistence error it keeps the local preview and
//     does NOT roll back or toast (a failed cache write must not disrupt the
//     vault)
//
// The Supabase client, toast store, analytics, upload service, and rate
// limiter are mocked so the test exercises setPreview's control flow in
// isolation without any network or DOM-storage side effects.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

let updateResult = { error: null }
const updateSpy = vi.fn(() => builderRef)
let lastUpdatePayload = null
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
    eq: vi.fn(() => Promise.resolve(updateResult)),
    lt: vi.fn(() => builder),
    not: vi.fn(() => builder),
    then: (resolve) => resolve({ data: initialClips, error: null }),
  }
  builderRef = builder
  return builder
}

function makeChannel() {
  const channel = { on: vi.fn(() => channel), subscribe: vi.fn(() => channel) }
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
vi.mock('../components/ui/toastStore', () => ({ toast: (...args) => toast(...args) }))
vi.mock('../lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('../lib/rateLimit', () => ({ checkRateLimit: vi.fn(() => true) }))

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

describe('useClips.setPreview — metadata merge and caching', () => {
  const preview = { title: 'Hello', description: 'A page', image: 'https://x/i.png' }

  it('writes metadata.preview without clobbering other metadata keys (Req 4.2)', async () => {
    const clip = {
      id: 'l1',
      user_id: 'u1',
      type: 'link',
      content: 'https://example.com',
      metadata: { tags: ['news'] },
      is_pinned: false,
      created_at: new Date().toISOString(),
    }
    initialClips = [clip]

    const { result } = await mountHook()

    await act(async () => {
      await result.current.setPreview(clip, preview)
    })

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(lastUpdatePayload).toEqual({ metadata: { tags: ['news'], preview } })

    const updated = result.current.clips.find((c) => c.id === 'l1')
    expect(updated.metadata.preview).toEqual(preview)
    expect(updated.metadata.tags).toEqual(['news'])
    expect(toast).not.toHaveBeenCalled()
  })

  it('caches an all-null preview so the card falls back cleanly (Req 4.3)', async () => {
    const clip = {
      id: 'l2',
      user_id: 'u1',
      type: 'link',
      content: 'https://blocked.example',
      metadata: null,
      is_pinned: false,
      created_at: new Date().toISOString(),
    }
    initialClips = [clip]
    const empty = { title: null, description: null, image: null }

    const { result } = await mountHook()

    await act(async () => {
      await result.current.setPreview(clip, empty)
    })

    expect(lastUpdatePayload).toEqual({ metadata: { preview: empty } })
    const updated = result.current.clips.find((c) => c.id === 'l2')
    expect(updated.metadata.preview).toEqual(empty)
  })

  it('keeps the local preview and does not toast when persistence fails', async () => {
    const clip = {
      id: 'l3',
      user_id: 'u1',
      type: 'link',
      content: 'https://example.com',
      metadata: { tags: ['a'] },
      is_pinned: false,
      created_at: new Date().toISOString(),
    }
    initialClips = [clip]
    updateResult = { error: { message: 'update denied' } }

    const { result } = await mountHook()

    await act(async () => {
      await result.current.setPreview(clip, preview)
    })

    // Best-effort: no toast, and the optimistic local preview is retained.
    expect(toast).not.toHaveBeenCalled()
    const updated = result.current.clips.find((c) => c.id === 'l3')
    expect(updated.metadata.preview).toEqual(preview)
  })
})

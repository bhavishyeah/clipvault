// Feature: volt-reach — unit tests for the useShares hook
//
// Validates: Requirements 4.1, 4.2, 4.3, 6.1, 6.2
//
// Exercises the useShares hook against a MOCKED Supabase client, the toast
// store, the analytics tracker, and global fetch. No network or real Supabase
// calls are made. Focus is on the hook's observable behavior:
//   - loads the owner's active shares on mount and maps them by clip_id,
//     dropping revoked/expired rows (Req 4.3, 6.1)
//   - createShare posts { action: 'create', clipId } with a Bearer token and
//     records the returned share locally (Req 4.1, 4.2)
//   - revokeShare posts { action: 'revoke', token } and drops the local share
//     (Req 6.2)

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// --- Mock the Supabase client (from().select().is() + auth.getSession) -------
const { fromMock, isMock, getSessionMock, toast, trackEvent } = vi.hoisted(() => {
  const isMock = vi.fn()
  const fromMock = vi.fn(() => ({
    select: vi.fn(() => ({ is: isMock })),
  }))
  return {
    fromMock,
    isMock,
    getSessionMock: vi.fn(),
    toast: vi.fn(),
    trackEvent: vi.fn(),
  }
})

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: fromMock,
    auth: { getSession: getSessionMock },
  },
}))

vi.mock('../components/ui/toastStore', () => ({
  toast: (...args) => toast(...args),
}))

vi.mock('../lib/analytics', () => ({
  trackEvent: (...args) => trackEvent(...args),
}))

// Imported after the mocks so the hook picks up the mocked modules.
import { useShares } from './useShares.js'

const USER = { id: 'user-1' }
const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
const PAST = new Date(Date.now() - 1000).toISOString()

// Render the hook and wait for the initial share load to settle.
async function renderShares(user = USER) {
  const view = renderHook(({ u }) => useShares(u), { initialProps: { u: user } })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  getSessionMock.mockResolvedValue({
    data: { session: { access_token: 'fake-token' } },
  })
  // Default: no shares on the account.
  isMock.mockResolvedValue({ data: [], error: null })
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
})

describe('useShares', () => {
  it('loads active shares on mount and maps them by clip_id', async () => {
    isMock.mockResolvedValue({
      data: [
        { token: 't1', clip_id: 'clip-a', expires_at: FUTURE, revoked_at: null },
        { token: 't2', clip_id: 'clip-b', expires_at: FUTURE, revoked_at: null },
      ],
      error: null,
    })

    const { result } = await renderShares()

    expect(fromMock).toHaveBeenCalledWith('shares')
    expect(result.current.getShare('clip-a')).toMatchObject({ token: 't1' })
    expect(result.current.getShare('clip-b')).toMatchObject({ token: 't2' })
    expect(result.current.getShare('clip-missing')).toBeNull()
  })

  it('drops expired shares from the map on load', async () => {
    isMock.mockResolvedValue({
      data: [
        { token: 't1', clip_id: 'clip-a', expires_at: PAST, revoked_at: null },
        { token: 't2', clip_id: 'clip-b', expires_at: FUTURE, revoked_at: null },
      ],
      error: null,
    })

    const { result } = await renderShares()

    expect(result.current.getShare('clip-a')).toBeNull()
    expect(result.current.getShare('clip-b')).toMatchObject({ token: 't2' })
  })

  it('does not query when no user is present', async () => {
    const { result } = await renderShares(null)

    expect(fromMock).not.toHaveBeenCalled()
    expect(result.current.sharesByClipId).toEqual({})
  })

  it('surfaces a toast when the load fails', async () => {
    isMock.mockResolvedValue({ data: null, error: { message: 'boom' } })

    await renderShares()

    expect(toast).toHaveBeenCalledWith('Failed to load shares', 'error')
  })

  it('createShare posts create with a Bearer token and records the share', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ token: 'new-tok', url: 'https://x/s/new-tok', expires_at: FUTURE }),
    }))

    const { result } = await renderShares()

    let out
    await act(async () => {
      out = await result.current.createShare({ id: 'clip-c' })
    })

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/share',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer fake-token' }),
        body: JSON.stringify({ action: 'create', clipId: 'clip-c' }),
      })
    )
    expect(out).toEqual({ token: 'new-tok', url: 'https://x/s/new-tok', expires_at: FUTURE })
    expect(result.current.getShare('clip-c')).toMatchObject({ token: 'new-tok' })
    expect(trackEvent).toHaveBeenCalledWith('share_create')
  })

  it('createShare returns null and toasts on a failed response', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'You do not own this clip' }),
    }))

    const { result } = await renderShares()

    let out
    await act(async () => {
      out = await result.current.createShare({ id: 'clip-x' })
    })

    expect(out).toBeNull()
    expect(toast).toHaveBeenCalledWith('You do not own this clip', 'error')
    expect(result.current.getShare('clip-x')).toBeNull()
  })

  it('createShare bails out when the session is missing', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })

    const { result } = await renderShares()

    let out
    await act(async () => {
      out = await result.current.createShare({ id: 'clip-c' })
    })

    expect(out).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('Session expired', 'error')
  })

  it('revokeShare posts revoke and drops the matching local share', async () => {
    isMock.mockResolvedValue({
      data: [{ token: 't1', clip_id: 'clip-a', expires_at: FUTURE, revoked_at: null }],
      error: null,
    })
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }))

    const { result } = await renderShares()
    expect(result.current.getShare('clip-a')).toMatchObject({ token: 't1' })

    let ok
    await act(async () => {
      ok = await result.current.revokeShare('t1')
    })

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/share',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'revoke', token: 't1' }),
      })
    )
    expect(ok).toBe(true)
    expect(result.current.getShare('clip-a')).toBeNull()
    expect(trackEvent).toHaveBeenCalledWith('share_revoke')
  })

  it('revokeShare returns false and keeps state on a failed response', async () => {
    isMock.mockResolvedValue({
      data: [{ token: 't1', clip_id: 'clip-a', expires_at: FUTURE, revoked_at: null }],
      error: null,
    })
    global.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'Share not found or already revoked' }),
    }))

    const { result } = await renderShares()

    let ok
    await act(async () => {
      ok = await result.current.revokeShare('t1')
    })

    expect(ok).toBe(false)
    expect(toast).toHaveBeenCalledWith('Share not found or already revoked', 'error')
    expect(result.current.getShare('clip-a')).toMatchObject({ token: 't1' })
  })
})

// Feature: sharing-enhancements — unit tests for the useMfa hook
//
// Validates: Requirements 6.2, 6.4, 9.5
//
// These tests exercise the useMfa hook against a MOCKED Supabase client, the
// toast store, the analytics tracker, and global fetch. No network or real
// Supabase calls are made. The focus is on the hook's side-effecting behavior:
//   - enroll() surfaces the QR + secret from the enroll response (Req 6.2)
//   - malformed TOTP codes never reach supabase.auth.mfa.verify (Req 6.4)
//   - a failed unenroll retains the existing factor state (Req 9.5)
//   - the activate() happy path challenges, verifies, then mints codes

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// --- Mock the Supabase client (auth.mfa + auth.getSession) --------------------
// vi.mock is hoisted above top-level declarations, so the shared mock objects
// are created via vi.hoisted() to be available both inside the factory and in
// the test bodies.
const { mfaMock, getSessionMock, toast, trackEvent } = vi.hoisted(() => ({
  mfaMock: {
    enroll: vi.fn(),
    challenge: vi.fn(),
    verify: vi.fn(),
    unenroll: vi.fn(),
    listFactors: vi.fn(),
  },
  getSessionMock: vi.fn(),
  toast: vi.fn(),
  trackEvent: vi.fn(),
}))

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      mfa: mfaMock,
      getSession: getSessionMock,
    },
  },
}))

// --- Mock the toast store and analytics tracker ------------------------------
vi.mock('../components/ui/toastStore', () => ({
  toast: (...args) => toast(...args),
}))

vi.mock('../lib/analytics', () => ({
  trackEvent: (...args) => trackEvent(...args),
}))

// Imported after the mocks so the hook picks up the mocked modules.
import { useMfa } from './useMfa.js'

const USER = { id: 'user-1' }

// Render the hook and wait for the initial listFactors() load to settle so the
// `loading` flag is false before assertions run.
async function renderMfa(user = USER) {
  const view = renderHook(({ u }) => useMfa(u), { initialProps: { u: user } })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default session with a valid access token for api/ calls.
  getSessionMock.mockResolvedValue({
    data: { session: { access_token: 'fake-token' } },
  })
  // Default: no factors on the account.
  mfaMock.listFactors.mockResolvedValue({ data: { all: [] }, error: null })
  // Global fetch is mocked per-test where needed; default is a safe stub.
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({}),
  }))
})

describe('useMfa', () => {
  it('enroll() returns factorId, qr, and secret from the enroll response', async () => {
    mfaMock.enroll.mockResolvedValue({
      data: {
        id: 'factor-123',
        totp: { qr_code: 'data:image/png;base64,AAAA', secret: 'JBSWY3DPEHPK3PXP' },
      },
      error: null,
    })

    const { result } = await renderMfa()

    let out
    await act(async () => {
      out = await result.current.enroll()
    })

    expect(mfaMock.enroll).toHaveBeenCalledWith({ factorType: 'totp' })
    expect(out).toEqual({
      factorId: 'factor-123',
      qr: 'data:image/png;base64,AAAA',
      secret: 'JBSWY3DPEHPK3PXP',
    })
  })

  it('activate() with an invalid-format code does not call verify and returns an error', async () => {
    const { result } = await renderMfa()

    let out
    await act(async () => {
      out = await result.current.activate('factor-123', '12ab')
    })

    expect(out.error).toBeTruthy()
    expect(mfaMock.challenge).not.toHaveBeenCalled()
    expect(mfaMock.verify).not.toHaveBeenCalled()
  })

  it('challenge() with an invalid-format code does not call verify', async () => {
    const { result } = await renderMfa()

    let out
    await act(async () => {
      out = await result.current.challenge('factor-123', '99')
    })

    expect(out.error).toBeTruthy()
    expect(mfaMock.challenge).not.toHaveBeenCalled()
    expect(mfaMock.verify).not.toHaveBeenCalled()
  })

  it('retains the factor when unenroll fails', async () => {
    const existing = { id: 'factor-abc', status: 'verified' }
    mfaMock.listFactors.mockResolvedValue({
      data: { all: [existing] },
      error: null,
    })
    mfaMock.unenroll.mockResolvedValue({ error: { message: 'unenroll boom' } })

    const { result } = await renderMfa()

    // Precondition: the verified factor is present and active.
    expect(result.current.hasActiveFactor).toBe(true)
    expect(result.current.factors).toEqual([existing])

    let out
    await act(async () => {
      out = await result.current.unenroll('factor-abc')
    })

    expect(out.error).toBe('unenroll boom')
    // Factor state is retained on failure (Req 9.5).
    expect(result.current.factors).toEqual([existing])
    expect(result.current.hasActiveFactor).toBe(true)
  })

  it('activate() happy path challenges, verifies, then returns recovery codes', async () => {
    mfaMock.challenge.mockResolvedValue({ data: { id: 'challenge-1' }, error: null })
    mfaMock.verify.mockResolvedValue({ error: null })
    // After verify, refresh() re-reads factors as verified.
    mfaMock.listFactors
      .mockResolvedValueOnce({ data: { all: [] }, error: null }) // initial mount
      .mockResolvedValue({
        data: { all: [{ id: 'factor-123', status: 'verified' }] },
        error: null,
      })

    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ codes: ['aaaa-1111', 'bbbb-2222'] }),
    }))

    const { result } = await renderMfa()

    let out
    await act(async () => {
      out = await result.current.activate('factor-123', '123456')
    })

    expect(mfaMock.challenge).toHaveBeenCalledWith({ factorId: 'factor-123' })
    expect(mfaMock.verify).toHaveBeenCalledWith({
      factorId: 'factor-123',
      challengeId: 'challenge-1',
      code: '123456',
    })
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/recovery-codes',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(out.recoveryCodes).toEqual(['aaaa-1111', 'bbbb-2222'])
  })
})

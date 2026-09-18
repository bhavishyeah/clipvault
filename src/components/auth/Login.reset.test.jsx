// VOLT — Login reset-parity render test (Feature 2: TOTP 2FA)
//
// Task 13.3 (part 2): the "Forgot password?" reset flow must NOT reveal whether
// an email is registered. Login.jsx calls
// `supabase.auth.resetPasswordForEmail(email, { redirectTo })` and, as long as
// there is no error, shows the SAME confirmation message ("Reset link sent.
// Check your inbox.") — it never branches on account existence. Supabase's
// resetPasswordForEmail intentionally resolves `{ error: null }` for both known
// and unknown emails, so parity is proven by showing the confirmation is
// identical across both resolutions.
//
// Login renders <QRLogin /> internally, which fetches /api/qr-session and may
// call supabase.auth.signInWithPassword during polling. We stub global.fetch
// and mock the whole supabaseClient so the tree renders in jsdom.
//
// Requirements: 7.5, 10.2

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Login from './Login'

// --- Mock the whole Supabase client -----------------------------------------
// resetPasswordForEmail is per-test configurable; everything else is a benign
// stub so Login + the nested QRLogin can mount without throwing.
const resetPasswordForEmail = vi.fn()

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: (...args) => resetPasswordForEmail(...args),
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      mfa: {
        getAuthenticatorAssuranceLevel: vi
          .fn()
          .mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } }),
        listFactors: vi.fn().mockResolvedValue({ data: { all: [] } }),
        challenge: vi.fn(),
        verify: vi.fn(),
      },
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  },
}))

const CONFIRMATION = /reset link sent\. check your inbox\./i

beforeEach(() => {
  resetPasswordForEmail.mockReset()
  // QRLogin fetches /api/qr-session on mount; keep it pending so it never
  // reaches the sign-in polling path during these tests.
  global.fetch = vi.fn(() => new Promise(() => {}))
})

afterEach(() => {
  vi.restoreAllMocks()
})

// Drive the shared reset flow: switch to reset mode, type the email, submit,
// and return the confirmation message text that Login displays.
async function submitResetAndGetMessage(user, email) {
  await user.click(screen.getByRole('button', { name: /forgot password\?/i }))
  await user.type(screen.getByLabelText(/email/i), email)
  await user.click(screen.getByRole('button', { name: /send link/i }))
  const msg = await screen.findByText(CONFIRMATION)
  return msg.textContent
}

describe('Login reset flow — identical confirmation regardless of account existence (Req 7.5, 10.2)', () => {
  it('shows the confirmation for a REGISTERED email (resetPasswordForEmail resolves { error: null })', async () => {
    const user = userEvent.setup()
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })

    render(<Login />)
    const message = await submitResetAndGetMessage(user, 'known@example.com')

    expect(message).toMatch(CONFIRMATION)
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1)
    // The email is normalized (trimmed + lowercased) before the call.
    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      'known@example.com',
      expect.objectContaining({ redirectTo: expect.stringContaining('reset=true') }),
    )
  })

  it('shows the SAME confirmation for an UNREGISTERED email (Supabase also resolves { error: null })', async () => {
    const user = userEvent.setup()
    // Supabase does not disclose non-existence: it resolves success either way.
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })

    render(<Login />)
    const message = await submitResetAndGetMessage(user, 'unknown@example.com')

    expect(message).toMatch(CONFIRMATION)
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1)
    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      'unknown@example.com',
      expect.objectContaining({ redirectTo: expect.stringContaining('reset=true') }),
    )
  })

  it('produces byte-for-byte identical confirmation text across registered vs unregistered', async () => {
    // Registered email render.
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
    const userA = userEvent.setup()
    const { unmount } = render(<Login />)
    const registeredMessage = await submitResetAndGetMessage(userA, 'known@example.com')
    unmount()

    // Unregistered email render — same resolution shape Supabase returns.
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
    const userB = userEvent.setup()
    render(<Login />)
    const unregisteredMessage = await submitResetAndGetMessage(userB, 'unknown@example.com')

    // The UI does not branch on account existence: identical confirmation.
    expect(registeredMessage).toBe(unregisteredMessage)
  })
})

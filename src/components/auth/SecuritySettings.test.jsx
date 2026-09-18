// VOLT — SecuritySettings UI state tests (Feature 2: TOTP 2FA)
//
// Task 12.2: unit tests for the security-settings UI states.
//   - QR + secret shown on enroll (Req 6.2)
//   - recovery codes copy/download after activation (Req 8.1, 8.2)
//   - "2FA enabled" active state (Req 6.6)
//   - confirm-before-disable via ConfirmModal (Req 6.6 / 9.x)
//
// SecuritySettings calls useMfa(user) internally, so we mock the hook and the
// toast store. ConfirmModal is exercised for real (it renders on `open`).
//
// Requirements: 6.2, 6.5, 6.6, 8.2

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import SecuritySettings from './SecuritySettings'

// --- Mock the toast store (no real toasts during tests) ---
vi.mock('../ui/toastStore', () => ({
  toast: vi.fn(),
}))

// --- Mock useMfa with a configurable fake ---
// Each test tweaks `mfaState` before rendering; the mock reads it lazily.
let mfaState

vi.mock('../../hooks/useMfa', () => ({
  useMfa: () => mfaState,
}))

function makeMfa(overrides = {}) {
  return {
    factors: [],
    hasActiveFactor: false,
    loading: false,
    enroll: vi.fn(),
    activate: vi.fn(),
    challenge: vi.fn(),
    unenroll: vi.fn(),
    regenerateRecoveryCodes: vi.fn(),
    verifyRecoveryCode: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  }
}

const USER = { id: 'user-1' }

beforeEach(() => {
  mfaState = makeMfa()
  vi.clearAllMocks()
})

describe('SecuritySettings — enroll shows QR + secret (Req 6.2)', () => {
  it('renders the QR image, the setup secret, and a 6-digit code input after enrolling', async () => {
    const user = userEvent.setup()
    mfaState = makeMfa({
      enroll: vi.fn().mockResolvedValue({
        factorId: 'factor-1',
        qr: 'data:image/png;base64,AAA',
        secret: 'SECRET123',
      }),
    })

    render(<SecuritySettings user={USER} />)

    await user.click(
      screen.getByRole('button', { name: /enable two-factor authentication/i })
    )

    // QR image surfaces (queried by its alt text).
    const qr = await screen.findByAltText(/qr code for setting up two-factor/i)
    expect(qr).toHaveAttribute('src', 'data:image/png;base64,AAA')

    // Text secret is displayed.
    expect(screen.getByText('SECRET123')).toBeInTheDocument()

    // A 6-digit code input appears.
    const codeInput = screen.getByLabelText(/6-digit code/i)
    expect(codeInput).toBeInTheDocument()
    expect(codeInput).toHaveAttribute('maxLength', '6')

    expect(mfaState.enroll).toHaveBeenCalledTimes(1)
  })
})

describe('SecuritySettings — recovery codes copy/download (Req 8.1, 8.2)', () => {
  beforeEach(() => {
    // Stub URL.createObjectURL/revokeObjectURL used by the download handler.
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('reveals codes after activation with working Copy and Download controls', async () => {
    const user = userEvent.setup()

    // Stub clipboard AFTER userEvent.setup() so ours wins (userEvent installs
    // its own clipboard stub during setup). navigator.clipboard is getter-only
    // in jsdom, so define it rather than assign.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    })
    const codes = ['aaaa-1111', 'bbbb-2222']
    mfaState = makeMfa({
      enroll: vi.fn().mockResolvedValue({
        factorId: 'factor-1',
        qr: 'data:image/png;base64,AAA',
        secret: 'SECRET123',
      }),
      activate: vi.fn().mockResolvedValue({ recoveryCodes: codes }),
    })

    render(<SecuritySettings user={USER} />)

    // Drive to enrollment.
    await user.click(
      screen.getByRole('button', { name: /enable two-factor authentication/i })
    )

    // Enter a valid 6-digit code and activate.
    const codeInput = await screen.findByLabelText(/6-digit code/i)
    await user.type(codeInput, '123456')
    await user.click(
      screen.getByRole('button', { name: /verify and activate/i })
    )

    // The recovery codes are displayed.
    expect(await screen.findByText('aaaa-1111')).toBeInTheDocument()
    expect(screen.getByText('bbbb-2222')).toBeInTheDocument()
    expect(mfaState.activate).toHaveBeenCalledWith('factor-1', '123456')

    // Copy + Download controls exist and function.
    const copyBtn = screen.getByRole('button', { name: /copy recovery codes/i })
    const downloadBtn = screen.getByRole('button', { name: /download recovery codes/i })
    expect(copyBtn).toBeInTheDocument()
    expect(downloadBtn).toBeInTheDocument()

    await user.click(copyBtn)
    expect(writeText).toHaveBeenCalledWith(codes.join('\n'))

    await user.click(downloadBtn)
    expect(URL.createObjectURL).toHaveBeenCalled()
  })
})

describe('SecuritySettings — active "2FA enabled" state (Req 6.6)', () => {
  it('shows the on state plus Disable and Regenerate controls', () => {
    mfaState = makeMfa({
      hasActiveFactor: true,
      factors: [{ id: 'f1', status: 'verified' }],
    })

    render(<SecuritySettings user={USER} />)

    // Enabled/on state text.
    expect(screen.getByText('On')).toBeInTheDocument()
    expect(
      screen.getByText(/two-factor authentication is on for your account/i)
    ).toBeInTheDocument()

    // Both management controls are present.
    expect(
      screen.getByRole('button', { name: /disable two-factor authentication/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /regenerate recovery codes/i })
    ).toBeInTheDocument()
  })
})

describe('SecuritySettings — confirm before disable (Req 6.6 / 9.x)', () => {
  it('opens the confirmation modal and calls unenroll on confirm', async () => {
    const user = userEvent.setup()
    mfaState = makeMfa({
      hasActiveFactor: true,
      factors: [{ id: 'f1', status: 'verified' }],
      unenroll: vi.fn().mockResolvedValue({ success: true }),
    })

    render(<SecuritySettings user={USER} />)

    // Click Disable 2FA — the ConfirmModal opens.
    await user.click(
      screen.getByRole('button', { name: /disable two-factor authentication/i })
    )

    // Modal title + message text appear.
    expect(
      await screen.findByText(/disable two-factor authentication\?/i)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/your account will no longer require a code at login/i)
    ).toBeInTheDocument()

    // Confirm (ConfirmModal's confirm button is labeled "Delete").
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mfaState.unenroll).toHaveBeenCalledWith('f1')
    })
  })
})

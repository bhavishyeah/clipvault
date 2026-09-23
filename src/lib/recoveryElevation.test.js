import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearRecoveryElevated,
  isRecoveryElevated,
  markRecoveryElevated,
} from './recoveryElevation.js'

function token(claims) {
  const encode = (value) => btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `${encode({ alg: 'none' })}.${encode(claims)}.`
}

describe('recovery elevation session identity', () => {
  beforeEach(() => clearRecoveryElevated())

  it('survives an access-token refresh for the same Supabase session', () => {
    const oldToken = token({ session_id: 'session-1', aal: 'aal1', exp: 1 })
    const refreshedToken = token({ session_id: 'session-1', aal: 'aal1', exp: 2 })

    markRecoveryElevated(oldToken)

    expect(isRecoveryElevated(refreshedToken)).toBe(true)
  })

  it('does not leak to a different auth session', () => {
    markRecoveryElevated(token({ session_id: 'session-1' }))
    expect(isRecoveryElevated(token({ session_id: 'session-2' }))).toBe(false)
  })
})

// @vitest-environment node
//
// Feature: sharing-enhancements — Supabase-managed integration tests
// Task 18.2
//
// Validates (live-boundary): Requirements 6.1, 6.3, 7.1, 7.3, 8.1, 8.3, 9.3,
//                            11.5, 12.4, 15.3, 15.5, 14.2
//
// These tests exercise the paths that can only be fully validated against a
// live Supabase project: MFA enroll/unenroll, recovery-code generate/verify
// through the serverless endpoint, RLS reads/writes for members vs
// non-members, cascade delete, Realtime member delivery, and the audio
// migration CHECK constraints.
//
// ─────────────────────────────────────────────────────────────────────────
// HOW TO RUN
// ─────────────────────────────────────────────────────────────────────────
// This suite is GATED on environment variables. With no credentials present it
// SKIPS cleanly (does not fail the build). To actually exercise Supabase, set
// the following env vars against a DISPOSABLE test project (never production):
//
//   Required for every block:
//     VITE_SUPABASE_URL           — project URL
//     VITE_SUPABASE_ANON_KEY      — anon (public) key
//     SUPABASE_SERVICE_ROLE_KEY   — service-role key (bypasses RLS; keep secret)
//
//   Required for the RLS / cascade / realtime blocks (two authenticated users):
//     TEST_USER_A_EMAIL / TEST_USER_A_PASSWORD
//     TEST_USER_B_EMAIL / TEST_USER_B_PASSWORD
//     (both must be confirmed users in the test project)
//
//   Optional (unlocks the full MFA challenge/verify happy path):
//     TEST_TOTP_SECRET            — a base32 TOTP secret + `otplib` installed.
//                                   Without it the MFA verify step is skipped
//                                   with a note; enroll/unenroll are still run.
//
// Example:
//   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//   TEST_USER_A_EMAIL=... TEST_USER_A_PASSWORD=... \
//   TEST_USER_B_EMAIL=... TEST_USER_B_PASSWORD=... \
//   npx vitest run src/integration/supabase.integration.test.js
// ─────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// NOTE: api/recovery-codes.js constructs a Supabase client at module load using
// SUPABASE_SERVICE_ROLE_KEY, so it MUST NOT be imported statically — that would
// throw at import time when credentials are absent (i.e. it would fail the
// build instead of skipping). It is imported dynamically inside the guarded
// recovery-codes block below, only when credentials are present.

// Read env from Node's process. Referenced via globalThis so this file lints
// cleanly under the browser-globals eslint config.
const env = (globalThis.process && globalThis.process.env) || {}

const SUPABASE_URL = env.VITE_SUPABASE_URL
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

// Base gate: the minimum needed to talk to Supabase with a service-role client.
const hasBaseEnv = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY)

// Two-user gate: RLS/cascade/realtime blocks need two real authenticated users.
const hasTwoUsers = Boolean(
  hasBaseEnv &&
    env.TEST_USER_A_EMAIL &&
    env.TEST_USER_A_PASSWORD &&
    env.TEST_USER_B_EMAIL &&
    env.TEST_USER_B_PASSWORD
)

// Generous timeouts for network + realtime round trips.
const NET_TIMEOUT = 30_000
const RT_TIMEOUT = 30_000

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Minimal mock req/res to invoke the serverless handler in-process.
function mockReqRes({ method = 'POST', body = {}, token } = {}) {
  const req = {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  }
  const res = {
    statusCode: 200,
    _json: undefined,
    setHeader() {},
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this._json = payload
      return this
    },
    end() {
      return this
    },
  }
  return { req, res }
}

// ── 1. Migration constraint verification (Req: alter_clip_types_add_audio) ──
describe.skipIf(!hasBaseEnv)('migration: audio type CHECK constraints', () => {
  const svc = hasBaseEnv ? serviceClient() : null
  const created = { clipIds: [], transferIds: [] }
  let userId

  beforeAll(async () => {
    // Use any existing auth user as the owner for FK-satisfying inserts.
    const { data } = await svc.auth.admin.listUsers()
    userId = data?.users?.[0]?.id
  }, NET_TIMEOUT)

  afterAll(async () => {
    if (!svc) return
    if (created.clipIds.length) {
      await svc.from('clips').delete().in('id', created.clipIds)
    }
    if (created.transferIds.length) {
      await svc.from('direct_transfers').delete().in('id', created.transferIds)
    }
  }, NET_TIMEOUT)

  it(
    'accepts type="audio" on clips (constraint allows audio)',
    async () => {
      expect(userId, 'test project must have at least one auth user').toBeTruthy()
      const { data, error } = await svc
        .from('clips')
        .insert({ user_id: userId, type: 'audio', content: 'audio-clip' })
        .select('id')
        .single()
      expect(error).toBeNull()
      expect(data?.id).toBeTruthy()
      if (data?.id) created.clipIds.push(data.id)
    },
    NET_TIMEOUT
  )

  it(
    'rejects an invalid clip type (constraint enforced)',
    async () => {
      const { data, error } = await svc
        .from('clips')
        .insert({ user_id: userId, type: 'not-a-real-type', content: 'x' })
        .select('id')
        .single()
      expect(error).toBeTruthy()
      expect(data).toBeNull()
    },
    NET_TIMEOUT
  )

  it(
    'accepts type="audio" on direct_transfers',
    async () => {
      const { data, error } = await svc
        .from('direct_transfers')
        .insert({
          sender_id: userId,
          recipient_id: userId,
          type: 'audio',
          content: 'audio-transfer',
        })
        .select('id')
        .single()
      expect(error).toBeNull()
      expect(data?.id).toBeTruthy()
      if (data?.id) created.transferIds.push(data.id)
    },
    NET_TIMEOUT
  )

  it(
    'rejects an invalid direct_transfer type',
    async () => {
      const { data, error } = await svc
        .from('direct_transfers')
        .insert({
          sender_id: userId,
          recipient_id: userId,
          type: 'bogus',
          content: 'x',
        })
        .select('id')
        .single()
      expect(error).toBeTruthy()
      expect(data).toBeNull()
    },
    NET_TIMEOUT
  )
})

// ── 2. MFA enroll / (verify) / unenroll happy path (Req 6.1, 6.3, 7.1, 7.3, 9.3) ──
describe.skipIf(!hasTwoUsers)('MFA enroll / verify / unenroll', () => {
  let client
  let factorId

  beforeAll(async () => {
    client = anonClient()
    const { error } = await client.auth.signInWithPassword({
      email: env.TEST_USER_A_EMAIL,
      password: env.TEST_USER_A_PASSWORD,
    })
    expect(error, 'test user A must sign in').toBeNull()
  }, NET_TIMEOUT)

  afterAll(async () => {
    // Best-effort cleanup: remove the factor if it is still enrolled.
    if (client && factorId) {
      await client.auth.mfa.unenroll({ factorId }).catch(() => {})
    }
    if (client) await client.auth.signOut().catch(() => {})
  }, NET_TIMEOUT)

  it(
    'enroll returns a factor with a TOTP secret / QR (Req 6.1)',
    async () => {
      const { data, error } = await client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `it-test-${Date.now()}`,
      })
      expect(error).toBeNull()
      expect(data?.id).toBeTruthy()
      factorId = data.id
      // Supabase returns totp.secret and totp.qr_code (or uri).
      const secret = data?.totp?.secret
      const qr = data?.totp?.qr_code || data?.totp?.uri
      expect(secret || qr).toBeTruthy()
    },
    NET_TIMEOUT
  )

  it(
    'challenge + verify elevates to AAL2 when a TOTP secret is provided (Req 6.3, 7.1, 7.3, 9.3)',
    async () => {
      const totpSecret = env.TEST_TOTP_SECRET
      if (!totpSecret) {
        // Documented skip: verifying a TOTP factor requires a live 6-digit code
        // generated from the enrollment secret via an authenticator (otplib).
        // Provide TEST_TOTP_SECRET + install otplib to exercise this path.
        console.info(
          '[integration] Skipping MFA verify: set TEST_TOTP_SECRET and install otplib to run the full challenge/verify happy path.'
        )
        return
      }

      // Lazily import otplib only when a secret is configured.
      const { authenticator } = await import('otplib')
      expect(factorId, 'enroll must have produced a factorId').toBeTruthy()

      const { data: ch, error: chErr } = await client.auth.mfa.challenge({ factorId })
      expect(chErr).toBeNull()
      expect(ch?.id).toBeTruthy()

      const code = authenticator.generate(totpSecret)
      const { data: vr, error: vErr } = await client.auth.mfa.verify({
        factorId,
        challengeId: ch.id,
        code,
      })
      expect(vErr).toBeNull()
      expect(vr?.access_token).toBeTruthy()

      const { data: aal } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
      expect(aal?.currentLevel).toBe('aal2')
    },
    NET_TIMEOUT
  )

  it(
    'unenroll removes the factor (Req 9.3)',
    async () => {
      expect(factorId).toBeTruthy()
      const { error } = await client.auth.mfa.unenroll({ factorId })
      expect(error).toBeNull()
      const { data: factors } = await client.auth.mfa.listFactors()
      const stillThere = (factors?.totp || []).some((f) => f.id === factorId)
      expect(stillThere).toBe(false)
      factorId = null
    },
    NET_TIMEOUT
  )
})

// ── 3. Recovery codes through the serverless endpoint (Req 8.1, 8.3) ──
describe.skipIf(!hasTwoUsers)('recovery codes: generate / verify / regenerate', () => {
  let client
  let token
  let userId
  let handler
  const svc = hasTwoUsers ? serviceClient() : null

  beforeAll(async () => {
    // Dynamic import: the endpoint builds a service-role client at module load,
    // so it is only imported once credentials are known to be present.
    handler = (await import('../../api/recovery-codes.js')).default
    client = anonClient()
    const { data, error } = await client.auth.signInWithPassword({
      email: env.TEST_USER_A_EMAIL,
      password: env.TEST_USER_A_PASSWORD,
    })
    expect(error).toBeNull()
    token = data?.session?.access_token
    userId = data?.user?.id
    expect(token).toBeTruthy()
  }, NET_TIMEOUT)

  afterAll(async () => {
    if (svc && userId) {
      await svc.from('recovery_codes').delete().eq('user_id', userId)
    }
    if (client) await client.auth.signOut().catch(() => {})
  }, NET_TIMEOUT)

  it(
    'generate returns exactly 10 codes and stores hashes (Req 8.1)',
    async () => {
      const { req, res } = mockReqRes({ body: { action: 'generate' }, token })
      await handler(req, res)
      expect(res.statusCode).toBe(200)
      expect(Array.isArray(res._json?.codes)).toBe(true)
      expect(res._json.codes).toHaveLength(10)
      // All distinct.
      expect(new Set(res._json.codes).size).toBe(10)

      // Hashes stored, plaintext never persisted.
      const { data: rows } = await svc
        .from('recovery_codes')
        .select('code_hash')
        .eq('user_id', userId)
      expect(rows).toHaveLength(10)
      rows.forEach((r) => {
        expect(r.code_hash.startsWith('scrypt:')).toBe(true)
        expect(res._json.codes).not.toContain(r.code_hash)
      })
    },
    NET_TIMEOUT
  )

  it(
    'verify consumes a code once (single-use) and rejects reuse (Req 8.3)',
    async () => {
      const gen = mockReqRes({ body: { action: 'generate' }, token })
      await handler(gen.req, gen.res)
      const code = gen.res._json.codes[0]

      const v1 = mockReqRes({ body: { action: 'verify', code }, token })
      await handler(v1.req, v1.res)
      expect(v1.res.statusCode).toBe(200)
      expect(v1.res._json?.success).toBe(true)

      // Second use of the same code must fail (already used).
      const v2 = mockReqRes({ body: { action: 'verify', code }, token })
      await handler(v2.req, v2.res)
      expect(v2.res.statusCode).toBe(400)
    },
    NET_TIMEOUT
  )

  it(
    'regeneration invalidates prior codes (Req 8.6)',
    async () => {
      const gen1 = mockReqRes({ body: { action: 'generate' }, token })
      await handler(gen1.req, gen1.res)
      const oldCode = gen1.res._json.codes[1]

      // Regenerate — old codes should no longer verify.
      const gen2 = mockReqRes({ body: { action: 'generate' }, token })
      await handler(gen2.req, gen2.res)
      expect(gen2.res._json.codes).toHaveLength(10)

      const vOld = mockReqRes({ body: { action: 'verify', code: oldCode }, token })
      await handler(vOld.req, vOld.res)
      expect(vOld.res.statusCode).toBe(400)

      // A new code still works.
      const vNew = mockReqRes({ body: { action: 'verify', code: gen2.res._json.codes[0] }, token })
      await handler(vNew.req, vNew.res)
      expect(vNew.res.statusCode).toBe(200)
    },
    NET_TIMEOUT
  )
})

// ── 4/5/6. RLS, cascade delete, and Realtime with two real users ──
describe.skipIf(!hasTwoUsers)('groups RLS / cascade / realtime', () => {
  const svc = hasTwoUsers ? serviceClient() : null
  let clientA
  let clientB
  let userA
  let userB
  let groupId

  beforeAll(async () => {
    clientA = anonClient()
    clientB = anonClient()

    const a = await clientA.auth.signInWithPassword({
      email: env.TEST_USER_A_EMAIL,
      password: env.TEST_USER_A_PASSWORD,
    })
    const b = await clientB.auth.signInWithPassword({
      email: env.TEST_USER_B_EMAIL,
      password: env.TEST_USER_B_PASSWORD,
    })
    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
    userA = a.data.user.id
    userB = b.data.user.id

    // User A creates a group and is its owner-member.
    const { data: group, error: gErr } = await clientA
      .from('groups')
      .insert({ name: 'integration-group', owner_id: userA })
      .select('id')
      .single()
    expect(gErr).toBeNull()
    groupId = group.id
    const { error: mErr } = await clientA
      .from('group_members')
      .insert({ group_id: groupId, user_id: userA, role: 'owner' })
    expect(mErr).toBeNull()
  }, NET_TIMEOUT)

  afterAll(async () => {
    // Service-role cleanup (cascades remove members + messages).
    if (svc && groupId) {
      await svc.from('groups').delete().eq('id', groupId)
    }
    if (clientA) await clientA.auth.signOut().catch(() => {})
    if (clientB) await clientB.auth.signOut().catch(() => {})
  }, NET_TIMEOUT)

  it(
    'member reads group_messages; non-member reads zero (Req 15.3)',
    async () => {
      // A (member) sends a message.
      const { error: sendErr } = await clientA.from('group_messages').insert({
        group_id: groupId,
        sender_id: userA,
        type: 'text',
        content: 'hello members',
      })
      expect(sendErr).toBeNull()

      // A can read it.
      const { data: aRows } = await clientA
        .from('group_messages')
        .select('id')
        .eq('group_id', groupId)
      expect((aRows || []).length).toBeGreaterThan(0)

      // B (non-member) sees zero rows via RLS.
      const { data: bRows } = await clientB
        .from('group_messages')
        .select('id')
        .eq('group_id', groupId)
      expect(bRows || []).toHaveLength(0)
    },
    NET_TIMEOUT
  )

  it(
    'non-member INSERT into group_messages is denied (Req 15.5)',
    async () => {
      const { error } = await clientB.from('group_messages').insert({
        group_id: groupId,
        sender_id: userB,
        type: 'text',
        content: 'intruder',
      })
      expect(error).toBeTruthy()
    },
    NET_TIMEOUT
  )

  it(
    'non-owner group delete affects zero rows (Req 11.5)',
    async () => {
      await clientB.from('groups').delete().eq('id', groupId)
      // Group must still exist (verified via service role which bypasses RLS).
      const { data: still } = await svc.from('groups').select('id').eq('id', groupId)
      expect(still || []).toHaveLength(1)
    },
    NET_TIMEOUT
  )

  it(
    'cascade delete removes group_members and group_messages (Req 12.4)',
    async () => {
      // Create a throwaway group so we can delete it without affecting the
      // realtime test which relies on the main group.
      const { data: g2 } = await clientA
        .from('groups')
        .insert({ name: 'cascade-group', owner_id: userA })
        .select('id')
        .single()
      await clientA
        .from('group_members')
        .insert({ group_id: g2.id, user_id: userA, role: 'owner' })
      await clientA.from('group_messages').insert({
        group_id: g2.id,
        sender_id: userA,
        type: 'text',
        content: 'to be cascaded',
      })

      // Owner deletes the group.
      const { error: delErr } = await clientA.from('groups').delete().eq('id', g2.id)
      expect(delErr).toBeNull()

      // Members + messages gone (checked with service role).
      const { data: members } = await svc
        .from('group_members')
        .select('user_id')
        .eq('group_id', g2.id)
      const { data: msgs } = await svc
        .from('group_messages')
        .select('id')
        .eq('group_id', g2.id)
      expect(members || []).toHaveLength(0)
      expect(msgs || []).toHaveLength(0)
    },
    NET_TIMEOUT
  )

  it(
    'a subscribed member receives an INSERT from another member over Realtime (Req 14.2)',
    async () => {
      // Add B as a member so B can both read and receive realtime events.
      const { error: addErr } = await clientA
        .from('group_members')
        .insert({ group_id: groupId, user_id: userB, role: 'member' })
      expect(addErr).toBeNull()

      const marker = `rt-${Date.now()}`

      const received = new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Realtime event not received within timeout')),
          RT_TIMEOUT - 2_000
        )
        const channel = clientB
          .channel(`it-group-${groupId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'group_messages',
              filter: `group_id=eq.${groupId}`,
            },
            (payload) => {
              if (payload?.new?.content === marker) {
                clearTimeout(timer)
                clientB.removeChannel(channel)
                resolve(payload.new)
              }
            }
          )
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              // Once B is subscribed, A sends the message.
              clientA
                .from('group_messages')
                .insert({
                  group_id: groupId,
                  sender_id: userA,
                  type: 'text',
                  content: marker,
                })
                .then(({ error }) => {
                  if (error) {
                    clearTimeout(timer)
                    reject(error)
                  }
                })
            }
          })
      })

      const row = await received
      expect(row.content).toBe(marker)
    },
    RT_TIMEOUT
  )
})

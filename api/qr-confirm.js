// POST /api/qr-confirm — Called from phone after scanning QR
// Creates an anonymous user, links it to the QR token
// Returns a one-time magiclink token_hash so the phone can sign in.
// No password is ever derived from the token or returned to the client.

import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { rateLimit, clientIp } from '../lib/rateLimit.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { token } = req.body
    if (!token) return res.status(400).json({ error: 'Token required' })

    // Rate limit anonymous user creation per client IP (blunt unbounded
    // anonymous account creation). Best-effort, per-instance (see
    // lib/rateLimit.js).
    const rl = rateLimit(`qr-confirm:${clientIp(req)}`, { limit: 5, windowMs: 60_000 })
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSec))
      return res.status(429).json({ error: 'Too many requests' })
    }

    // Find the pending session
    const { data: session, error: sessionError } = await supabase
      .from('qr_sessions')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .single()

    if (sessionError || !session) {
      return res.status(404).json({ error: 'QR session not found or already used' })
    }

    // Check expiry
    if (new Date(session.expires_at) < new Date()) {
      await supabase.from('qr_sessions').delete().eq('id', session.id)
      return res.status(410).json({ error: 'QR code expired. Generate a new one.' })
    }

    // Create anonymous user via admin API. The password is random and
    // immediately discarded — it is never derived from the token and never
    // returned. The user only ever authenticates via a magiclink token_hash.
    const anonEmail = `anon-${Date.now()}@volt.temp`
    const anonPassword = crypto.randomBytes(24).toString('hex')

    const { data: userData, error: createError } = await supabase.auth.admin.createUser({
      email: anonEmail,
      password: anonPassword,
      email_confirm: true,
      user_metadata: { is_anonymous: true, qr_session: session.id },
    })

    if (createError) {
      return res.status(500).json({ error: createError.message })
    }

    const userId = userData.user.id

    // Update QR session as confirmed with the new user_id
    await supabase
      .from('qr_sessions')
      .update({
        status: 'confirmed',
        user_id: userId,
        last_active: new Date().toISOString(),
      })
      .eq('id', session.id)

    // Mint a one-time magiclink for the phone to sign in — no password crosses
    // the wire.
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: anonEmail,
    })

    if (linkErr) {
      return res.status(500).json({ error: linkErr.message })
    }

    const tokenHash = linkData?.properties?.hashed_token
    if (!tokenHash) {
      return res.status(500).json({ error: 'Failed to mint session token' })
    }

    // Return ONLY the one-time token_hash. No email or password.
    return res.status(200).json({
      success: true,
      token_hash: tokenHash,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

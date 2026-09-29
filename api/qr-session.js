// POST /api/qr-session — Create a new pending QR session
// GET /api/qr-session?token=xxx — Poll for session status (returns anon session when confirmed)

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { rateLimit, clientIp } from '../lib/rateLimit.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method === 'POST') {
      // Rate limit session creation per client IP. Best-effort, per-instance
      // (see lib/rateLimit.js).
      const rl = rateLimit(`qr-session:${clientIp(req)}`, { limit: 10, windowMs: 60_000 })
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfterSec))
        return res.status(429).json({ error: 'Too many requests' })
      }

      // Generate unique token
      const token = crypto.randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 min to scan

      const { error } = await supabase.from('qr_sessions').insert({
        token,
        status: 'pending',
        expires_at: expiresAt,
      })

      if (error) return res.status(500).json({ error: error.message })

      return res.status(200).json({ token, expires_at: expiresAt })
    }

    if (req.method === 'GET') {
      // Rate limit polling per client IP. The client polls every ~2.5s over a
      // 5-minute token lifetime (~120 polls total), so a generous per-minute
      // limit leaves legitimate polling well under the cap. Best-effort,
      // per-instance (see lib/rateLimit.js).
      const rl = rateLimit(`qr-poll:${clientIp(req)}`, { limit: 120, windowMs: 60_000 })
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfterSec))
        return res.status(429).json({ error: 'Too many requests' })
      }

      const { token } = req.query
      if (!token) return res.status(400).json({ error: 'Token required' })

      const { data, error } = await supabase
        .from('qr_sessions')
        .select('*')
        .eq('token', token)
        .single()

      if (error || !data) return res.status(404).json({ error: 'Session not found' })

      // Check expiry
      if (new Date(data.expires_at) < new Date()) {
        await supabase.from('qr_sessions').delete().eq('id', data.id)
        return res.status(410).json({ error: 'Session expired' })
      }

      // If confirmed, mint a fresh one-time magiclink for the desktop to sign
      // in. The desktop consumes its own token_hash, independent of the phone's.
      if (data.status === 'confirmed' && data.user_id) {
        // Look up the user to get their email (needed to generate the link)
        const { data: userData, error: userError } = await supabase.auth.admin.getUserById(data.user_id)

        if (userError || !userData?.user) {
          return res.status(500).json({ error: 'User not found' })
        }

        const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
          type: 'magiclink',
          email: userData.user.email,
        })

        if (linkErr) {
          return res.status(500).json({ error: linkErr.message })
        }

        const tokenHash = linkData?.properties?.hashed_token
        if (!tokenHash) {
          return res.status(500).json({ error: 'Failed to mint session token' })
        }

        // Delete the QR session (one-time use)
        await supabase.from('qr_sessions').delete().eq('id', data.id)

        // Return ONLY the one-time token_hash. No email, user_id, or password.
        return res.status(200).json({
          status: 'confirmed',
          token_hash: tokenHash,
        })
      }

      return res.status(200).json({ status: data.status })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

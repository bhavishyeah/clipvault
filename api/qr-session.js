// POST /api/qr-session — Create a new pending QR session
// GET /api/qr-session?token=xxx — Poll for session status (returns anon session when confirmed)

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

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

      // If confirmed, return the anonymous session credentials
      if (data.status === 'confirmed' && data.user_id) {
        // Generate a new session for this anonymous user (for desktop)
        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
          type: 'magiclink',
          email: `anon-${data.user_id}@clipvault.temp`,
          options: { data: { is_anonymous: true } },
        })

        if (linkError) {
          // Fallback: return user_id so desktop can use it
          return res.status(200).json({
            status: 'confirmed',
            user_id: data.user_id,
          })
        }

        // Delete the QR session (one-time use)
        await supabase.from('qr_sessions').delete().eq('id', data.id)

        return res.status(200).json({
          status: 'confirmed',
          user_id: data.user_id,
          action_link: linkData.properties?.action_link || null,
          hashed_token: linkData.properties?.hashed_token || null,
        })
      }

      return res.status(200).json({ status: data.status })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

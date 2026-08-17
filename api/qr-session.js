// POST /api/qr-session — Create a new pending QR session token
// GET /api/qr-session?token=xxx — Poll for session status

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method === 'POST') {
      // Generate a unique token
      const token = crypto.randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 min to scan

      // Insert pending session
      const { error } = await supabase.from('qr_sessions').insert({
        token,
        status: 'pending',
        expires_at: expiresAt,
      })

      if (error) {
        return res.status(500).json({ error: error.message })
      }

      return res.status(200).json({ token, expires_at: expiresAt })
    }

    if (req.method === 'GET') {
      const { token } = req.query

      if (!token) {
        return res.status(400).json({ error: 'Token required' })
      }

      // Look up the session
      const { data, error } = await supabase
        .from('qr_sessions')
        .select('*')
        .eq('token', token)
        .single()

      if (error || !data) {
        return res.status(404).json({ error: 'Session not found' })
      }

      // Check if expired
      if (new Date(data.expires_at) < new Date()) {
        await supabase.from('qr_sessions').delete().eq('id', data.id)
        return res.status(410).json({ error: 'Session expired' })
      }

      if (data.status === 'confirmed' && data.user_id) {
        // Get user info
        const { data: userData, error: userError } = await supabase.auth.admin.getUserById(data.user_id)

        if (userError || !userData?.user) {
          return res.status(500).json({ error: 'User not found' })
        }

        // Generate a magic link for this user (one-time use)
        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
          type: 'magiclink',
          email: userData.user.email,
        })

        if (linkError) {
          return res.status(500).json({ error: linkError.message })
        }

        // Clean up the QR session
        await supabase.from('qr_sessions').delete().eq('id', data.id)

        return res.status(200).json({
          status: 'confirmed',
          email: userData.user.email,
          action_link: linkData.properties.action_link,
          token_hash: linkData.properties.hashed_token,
        })
      }

      return res.status(200).json({ status: data.status })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

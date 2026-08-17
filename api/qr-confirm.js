// POST /api/qr-confirm — Called from phone after scanning QR
// Creates an anonymous user, links it to the QR token
// Returns session credentials for the phone too

import { createClient } from '@supabase/supabase-js'

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

    // Create anonymous user via admin API
    const anonEmail = `anon-${Date.now()}@clipvault.temp`
    const anonPassword = `anon-${session.token.slice(0, 32)}`

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

    // Return credentials so the phone can also sign in as this user
    return res.status(200).json({
      success: true,
      email: anonEmail,
      password: anonPassword,
      user_id: userId,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

// POST /api/qr-confirm — Called from mobile to confirm a QR session
// Body: { token, access_token }

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { token, access_token } = req.body

    if (!token || !access_token) {
      return res.status(400).json({ error: 'Token and access_token required' })
    }

    // Verify the mobile user's session
    const { data: userData, error: userError } = await supabase.auth.getUser(access_token)

    if (userError || !userData?.user) {
      return res.status(401).json({ error: 'Invalid access token' })
    }

    // Find the pending QR session
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
      return res.status(410).json({ error: 'QR code expired' })
    }

    // Invalidate any existing QR sessions for this user (single session only)
    await supabase
      .from('qr_sessions')
      .delete()
      .eq('user_id', userData.user.id)
      .neq('id', session.id)

    // Confirm the session
    const { error: updateError } = await supabase
      .from('qr_sessions')
      .update({
        status: 'confirmed',
        user_id: userData.user.id,
        last_active: new Date().toISOString(),
      })
      .eq('id', session.id)

    if (updateError) {
      return res.status(500).json({ error: updateError.message })
    }

    return res.status(200).json({ success: true, message: 'QR session confirmed' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

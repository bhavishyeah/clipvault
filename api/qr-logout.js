// POST /api/qr-logout — Destroys anonymous session, deletes all clips and user

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
    const { user_id } = req.body
    if (!user_id) return res.status(400).json({ error: 'user_id required' })

    // Verify this is an anonymous user
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(user_id)

    if (userError || !userData?.user) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (!userData.user.user_metadata?.is_anonymous) {
      return res.status(403).json({ error: 'Not an anonymous user' })
    }

    // Delete all clips for this user
    await supabase.from('clips').delete().eq('user_id', user_id)

    // Delete any QR sessions
    await supabase.from('qr_sessions').delete().eq('user_id', user_id)

    // Delete the anonymous user
    await supabase.auth.admin.deleteUser(user_id)

    return res.status(200).json({ success: true })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

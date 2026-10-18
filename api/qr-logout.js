// POST /api/qr-logout — Destroys anonymous session, deletes all clips and user

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const APP_ORIGIN = process.env.VITE_APP_ORIGIN || 'https://clipvault-lilac.vercel.app'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', APP_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization || req.headers.Authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) return res.status(401).json({ error: 'Authentication required' })
  const { data: callerData, error: callerErr } = await supabase.auth.getUser(token)
  if (callerErr || !callerData?.user) return res.status(401).json({ error: 'Invalid or expired session' })
  const userId = callerData.user.id

  try {
    // Verify this is an anonymous user
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId)

    if (userError || !userData?.user) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (!userData.user.user_metadata?.is_anonymous) {
      return res.status(403).json({ error: 'Not an anonymous user' })
    }

    // Delete all clips for this user
    await supabase.from('clips').delete().eq('user_id', userId)

    // Delete any QR sessions
    await supabase.from('qr_sessions').delete().eq('user_id', userId)

    // Delete the anonymous user
    await supabase.auth.admin.deleteUser(userId)

    return res.status(200).json({ success: true })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

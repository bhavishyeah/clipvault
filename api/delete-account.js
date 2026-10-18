// POST /api/delete-account — Deletes the caller's own account (auth: Bearer token)

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

  try {
    const authHeader = req.headers.authorization || req.headers.Authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (!token) return res.status(401).json({ error: 'Authentication required' })

    // Verify and derive the user id ONLY from the token
    const { data: userData, error: authError } = await supabase.auth.getUser(token)
    if (authError || !userData?.user) return res.status(401).json({ error: 'Invalid or expired session' })
    const userId = userData.user.id

    // Delete the profile (frees up the username)
    await supabase.from('profiles').delete().eq('id', userId)

    // Delete the auth user (keeps clips/data in DB since we're not deleting clips)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId)

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message })
    }

    return res.status(200).json({ success: true })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

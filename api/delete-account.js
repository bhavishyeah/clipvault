// POST /api/delete-account — Deletes user account but keeps data in DB
// Body: { user_id }

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { user_id, access_token } = req.body

    if (!user_id || !access_token) {
      return res.status(400).json({ error: 'user_id and access_token required' })
    }

    // Verify the requesting user matches the user_id
    const { data: userData, error: authError } = await supabase.auth.getUser(access_token)

    if (authError || !userData?.user || userData.user.id !== user_id) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Delete the profile (frees up the username)
    await supabase.from('profiles').delete().eq('id', user_id)

    // Delete the auth user (keeps clips/data in DB since we're not deleting clips)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(user_id)

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message })
    }

    return res.status(200).json({ success: true })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

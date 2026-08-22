// GET /api/username-check?username=xxx — Check if username is available

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { username } = req.query

  if (!username) return res.status(400).json({ error: 'Username required' })

  const normalized = username.trim().toLowerCase()

  // Validate format
  if (!USERNAME_REGEX.test(normalized)) {
    return res.status(200).json({
      available: false,
      reason: 'Username must be 3-20 characters, letters/numbers/underscore only',
    })
  }

  // Check reserved usernames
  const { data: reserved } = await supabase
    .from('reserved_usernames')
    .select('username')
    .eq('username', normalized)
    .single()

  if (reserved) {
    return res.status(200).json({ available: false, reason: 'This username is reserved' })
  }

  // Check if taken
  const { data: existing } = await supabase
    .from('profiles')
    .select('username')
    .ilike('username', normalized)
    .single()

  if (existing) {
    // Suggest alternatives
    const suggestions = [
      `${normalized}_`,
      `${normalized}${Math.floor(Math.random() * 99)}`,
      `${normalized}_dev`,
    ]
    return res.status(200).json({ available: false, reason: 'Username already taken', suggestions })
  }

  return res.status(200).json({ available: true })
}

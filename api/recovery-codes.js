// POST /api/recovery-codes — App-managed 2FA backup (recovery) codes
//
// Supabase Auth MFA has no native backup codes, so hashing and single-use
// enforcement must happen server-side. This is the ONLY place recovery-code
// hashes are created or compared. The browser can neither safely hold the
// hashing secret nor be trusted to enforce single-use for auth elevation.
//
// Actions (dispatched by `action` in the JSON body):
//   generate → delete any prior codes for the caller (regeneration), create
//              exactly 10 cryptographically-random plaintext codes, store only
//              salted hashes, and return the 10 plaintext codes ONCE. (Req 8.1, 8.6)
//   verify   → hash the submitted code, find an unused matching row, mark it
//              used_at = now() (single-use). Returns ok on success; on invalid
//              or already-used, returns an error and leaves all rows untouched.
//              (Req 8.3, 8.4, 8.5)
//
// The caller is authenticated via the user's access token forwarded in the
// Authorization header and validated with auth.getUser(token). All writes use
// the service-role client, which bypasses RLS.
//
// Hashing choice: node crypto `scryptSync` (memory-hard KDF) over the plaintext
// code, keyed with a per-code random 16-byte salt and mixed with an optional
// server-side pepper (RECOVERY_CODE_PEPPER). The stored `code_hash` text column
// holds `scrypt:<cost>:<saltHex>:<hashHex>`. Because each code carries its own salt,
// verification recomputes the hash per candidate row and compares in constant
// time. No plaintext code is ever stored.
//
// The pure generate/normalize/hash/match logic lives in the shared module
// api/lib/recoveryCodes.js (single source of truth, unit- and property-tested).

import { createClient } from '@supabase/supabase-js'
import { CODE_COUNT, generateCode, normalizeCode, hashCode, matchesHash } from './lib/recoveryCodes.js'

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
    // Authenticate the caller via the Bearer access token.
    const authHeader = req.headers.authorization || req.headers.Authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (!token) return res.status(401).json({ error: 'Authentication required' })

    const { data: userData, error: userError } = await supabase.auth.getUser(token)
    if (userError || !userData?.user) {
      return res.status(401).json({ error: 'Invalid or expired session' })
    }
    const userId = userData.user.id

    const { action } = req.body || {}

    if (action === 'generate') {
      // Regeneration: invalidate all previously issued codes first (Req 8.6).
      const { error: deleteError } = await supabase
        .from('recovery_codes')
        .delete()
        .eq('user_id', userId)
      if (deleteError) return res.status(500).json({ error: deleteError.message })

      // Create exactly 10 fresh, distinct plaintext codes (Req 8.1).
      const codes = new Set()
      while (codes.size < CODE_COUNT) {
        codes.add(generateCode())
      }
      const plaintext = [...codes]

      const rows = plaintext.map((code) => ({
        user_id: userId,
        code_hash: hashCode(code),
      }))

      const { error: insertError } = await supabase.from('recovery_codes').insert(rows)
      if (insertError) return res.status(500).json({ error: insertError.message })

      // Return the plaintext codes exactly once — they are never stored or
      // retrievable again.
      return res.status(200).json({ success: true, codes: plaintext })
    }

    if (action === 'verify') {
      const { code } = req.body || {}
      const normalized = normalizeCode(code)
      if (!normalized) return res.status(400).json({ error: 'Code required' })

      // Load only unused codes for this user. On no match, leave rows untouched.
      const { data: candidates, error: selectError } = await supabase
        .from('recovery_codes')
        .select('id, code_hash')
        .eq('user_id', userId)
        .is('used_at', null)
      if (selectError) return res.status(500).json({ error: selectError.message })

      const match = (candidates || []).find((row) => matchesHash(normalized, row.code_hash))
      if (!match) {
        return res.status(400).json({ error: 'Invalid or already-used recovery code' })
      }

      // Mark exactly this code used (single-use, Req 8.4). Guard against a race
      // by only updating rows still unused.
      const { data: updated, error: updateError } = await supabase
        .from('recovery_codes')
        .update({ used_at: new Date().toISOString() })
        .eq('id', match.id)
        .is('used_at', null)
        .select('id')
      if (updateError) return res.status(500).json({ error: updateError.message })
      if (!updated || updated.length === 0) {
        // Lost the race — the code was consumed concurrently.
        return res.status(400).json({ error: 'Invalid or already-used recovery code' })
      }

      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

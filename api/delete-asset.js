// /api/delete-asset — Signed server-side Cloudinary asset deletion.
//
// POST (owner-scoped, Bearer auth):
//   { public_id, resource_type, secure_url }
//     → issues a SIGNED Cloudinary `destroy` call to permanently remove the
//       underlying asset, so a deleted/revoked clip's image is no longer
//       publicly reachable at its secure_url.
//
// WHY THIS LIVES ON THE SERVER: Cloudinary's destroy API requires a request
// signed with the account's API secret (CLOUDINARY_API_SECRET). That secret
// must NEVER reach the browser and is therefore intentionally NOT VITE_-
// prefixed — it is read only here, server-side. Uploads are unsigned (a public
// upload preset), but deletes are not.
//
// BEST-EFFORT CLEANUP: the client calls this only AFTER it has already deleted
// its own (RLS-scoped) clip row, as fire-and-forget. So this endpoint never
// needs to fail the caller: when secrets are unconfigured it returns a benign
// no-op, and on a Cloudinary error it reports success:false with a 200 rather
// than a 5xx — the row is already gone; the asset is just orphaned until it can
// be reaped. It still REQUIRES a valid session so the endpoint isn't open.
//
// Idempotent: Cloudinary returns { result: 'not found' } for an already-deleted
// asset, which we treat as success alongside { result: 'ok' }.

import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { rateLimit, clientIp } from '../lib/rateLimit.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Cloudinary account config. CLOUD_NAME is the public cloud (same value the
// client uses to upload); API_KEY/API_SECRET are server-only credentials used
// to sign the destroy request.
const CLOUD_NAME = process.env.VITE_CLOUDINARY_CLOUD_NAME
const API_KEY = process.env.CLOUDINARY_API_KEY
const API_SECRET = process.env.CLOUDINARY_API_SECRET

// Per-user delete limit. Best-effort, per-instance (see lib/rateLimit.js).
const DELETE_LIMIT = { limit: 30, windowMs: 60_000 }

async function authenticate(req, res) {
  const authHeader = req.headers.authorization || req.headers.Authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) {
    res.status(401).json({ error: 'Authentication required' })
    return null
  }
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return null
  }
  return data.user.id
}

/**
 * Derive a Cloudinary public_id from a secure_url when the caller didn't store
 * one (older clips saved before public_id was captured).
 *
 * Cloudinary secure_urls look like:
 *   https://res.cloudinary.com/<cloud>/<resource_type>/upload/v<version>/<folder>/<name>.<ext>
 * The public_id is everything AFTER `/upload/v<digits>/` (or after `/upload/`
 * when no version segment is present), with the file extension stripped. The
 * folder is part of the public_id (e.g. `volt/<userid>/<name>`).
 *
 * @param {string} secureUrl
 * @returns {string|null} the public_id, or null when it can't be derived
 */
function derivePublicId(secureUrl) {
  if (typeof secureUrl !== 'string' || !secureUrl) return null
  // Match the path after /upload/, optionally skipping a v<digits>/ segment.
  const m = secureUrl.match(/\/upload\/(?:v\d+\/)?(.+)$/)
  if (!m || !m[1]) return null
  let path = m[1]
  // Strip a trailing query/fragment if present.
  path = path.split(/[?#]/)[0]
  // Strip the file extension from the final path segment only.
  const lastSlash = path.lastIndexOf('/')
  const dir = lastSlash === -1 ? '' : path.slice(0, lastSlash + 1)
  const base = lastSlash === -1 ? path : path.slice(lastSlash + 1)
  const dot = base.lastIndexOf('.')
  const strippedBase = dot > 0 ? base.slice(0, dot) : base
  const publicId = dir + strippedBase
  return publicId || null
}

async function handleDelete(req, res, ownerId) {
  // Per-user rate limit.
  const rl = rateLimit(`delete-asset:${ownerId}:${clientIp(req)}`, DELETE_LIMIT)
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec))
    return res.status(429).json({ error: 'Too many requests' })
  }

  const { public_id, resource_type, secure_url } = req.body || {}

  const publicId = public_id || derivePublicId(secure_url)
  if (!publicId) {
    return res.status(400).json({ error: 'public_id or a derivable secure_url is required' })
  }

  const resourceType = resource_type || 'image'

  // Sign the destroy request. Cloudinary signs the alphabetically-sorted signed
  // params (here: public_id, timestamp) joined as key=value&..., with the API
  // secret appended, then SHA-1 hex. api_key/file/signature are NOT signed.
  const timestamp = Math.floor(Date.now() / 1000)
  const toSign = `public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`
  const signature = crypto.createHash('sha1').update(toSign).digest('hex')

  const form = new URLSearchParams()
  form.set('public_id', publicId)
  form.set('timestamp', String(timestamp))
  form.set('api_key', API_KEY)
  form.set('signature', signature)

  try {
    const resp = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/destroy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      }
    )

    const result = await resp.json().catch(() => ({}))

    if (!resp.ok) {
      // Non-2xx from Cloudinary. Best-effort: report failure without a 5xx so
      // the client's fire-and-forget stays clean.
      return res
        .status(200)
        .json({ success: false, error: result?.error?.message || `HTTP ${resp.status}` })
    }

    // 'ok' = deleted, 'not found' = already gone. Both are success (idempotent).
    if (result?.result === 'ok' || result?.result === 'not found') {
      return res.status(200).json({ success: true, result: result.result })
    }

    return res.status(200).json({ success: false, error: result?.result || 'unknown result' })
  } catch (err) {
    // Network / thrown error — best-effort, never make the client care.
    return res.status(200).json({ success: false, error: err.message })
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    // Require a valid session so the endpoint isn't open (even though the
    // heavy lifting — RLS-scoped row delete — already happened client-side).
    const ownerId = await authenticate(req, res)
    if (!ownerId) return // response already sent

    // If the server-only secrets aren't configured, this is a harmless no-op:
    // the client's best-effort call succeeds without deleting anything, rather
    // than 500-ing. The operator fills CLOUDINARY_API_KEY/SECRET to enable it.
    if (!API_KEY || !API_SECRET) {
      return res.status(200).json({ success: false, skipped: true, reason: 'not-configured' })
    }

    return await handleDelete(req, res, ownerId)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

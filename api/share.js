// /api/share — Public share links (volt-reach)
//
// POST (owner-scoped, Bearer auth):
//   { action: 'create', clipId, expiresInDays? }
//     → create (or reuse an active) share for a clip the caller owns.
//       Returns { token, url, expires_at }.
//   { action: 'revoke', token }
//     → mark the caller's share revoked. Returns { success: true }.
//
// GET (public, NO auth):
//   ?token=<token>
//     → return the single shared clip's presentable fields, or 404
//       { error: 'unavailable' } for a missing/revoked/expired/deleted share.
//       Never reveals owner identity, other clips, or internal columns.
//
// All DB access uses the service-role client. Owner actions validate the
// caller via auth.getUser(token); the public read is unauthenticated but only
// ever exposes the strict presentClip() whitelist. Public responses are sent
// no-store so a revoke takes effect immediately.

import { createClient } from '@supabase/supabase-js'
import { generateToken, computeExpiry, isShareActive, presentClip } from './lib/share.js'
import { rateLimit, clientIp } from './lib/rateLimit.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const APP_ORIGIN = process.env.VITE_APP_ORIGIN || 'https://clipvault-lilac.vercel.app'

// Rate limits (best-effort, per serverless instance — see api/lib/rateLimit.js).
// - POST create: 20 new shares per minute per authenticated owner. Owners rarely
//   need more; this blunts scripted mass-share creation.
// - GET public read: 60 reads per minute per client IP. Enough for normal viewing
//   (including a page's own re-fetches) while slowing token scraping.
// - Revoke is intentionally NOT rate-limited: owners must always be able to pull
//   a link down immediately.
const CREATE_LIMIT = { limit: 20, windowMs: 60_000 }
const READ_LIMIT = { limit: 60, windowMs: 60_000 }

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

async function handleCreate(req, res, ownerId) {
  // Per-owner create limit (Req 7.5, 7.6). Keyed by the authenticated owner id.
  const rl = rateLimit(`share:create:${ownerId}`, CREATE_LIMIT)
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec))
    return res.status(429).json({ error: 'Too many requests' })
  }

  const { clipId, expiresInDays } = req.body || {}
  if (!clipId) return res.status(400).json({ error: 'clipId is required' })

  // Verify the caller owns the clip (Req 4.4).
  const { data: clip, error: clipErr } = await supabase
    .from('clips')
    .select('id, user_id')
    .eq('id', clipId)
    .single()
  if (clipErr || !clip) return res.status(404).json({ error: 'Clip not found' })
  if (clip.user_id !== ownerId) return res.status(403).json({ error: 'You do not own this clip' })

  // Reuse an existing active share for this clip (Req 4.3).
  const { data: existing } = await supabase
    .from('shares')
    .select('token, expires_at, revoked_at')
    .eq('clip_id', clipId)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })

  const active = (existing || []).find((s) => isShareActive(s))
  if (active) {
    return res.status(200).json({
      token: active.token,
      url: `${APP_ORIGIN}/s/${active.token}`,
      expires_at: active.expires_at,
      reused: true,
    })
  }

  // Create a new share (Req 4.1, 4.5).
  const token = generateToken()
  const expires_at = computeExpiry(Number(expiresInDays))
  const { error: insertErr } = await supabase.from('shares').insert({
    token,
    clip_id: clipId,
    owner_id: ownerId,
    expires_at,
  })
  if (insertErr) return res.status(500).json({ error: insertErr.message })

  return res.status(200).json({ token, url: `${APP_ORIGIN}/s/${token}`, expires_at })
}

async function handleRevoke(req, res, ownerId) {
  const { token } = req.body || {}
  if (!token) return res.status(400).json({ error: 'token is required' })

  // Ownership enforced in the predicate (Req 6.2, 6.4).
  const { data: updated, error } = await supabase
    .from('shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token', token)
    .eq('owner_id', ownerId)
    .is('revoked_at', null)
    .select('token')
  if (error) return res.status(500).json({ error: error.message })
  if (!updated || updated.length === 0) {
    return res.status(404).json({ error: 'Share not found or already revoked' })
  }
  return res.status(200).json({ success: true })
}

/**
 * Map a raw `clips` row into the flat shape presentClip() projects.
 *
 * File clips (image/file/audio) store their Cloudinary descriptor inside the
 * `metadata` JSONB (`secure_url` / `name` / `mime`) — the clips table has no
 * top-level file_url/file_name/mime_type columns (see supabase/schema.sql and
 * useClips.js). Lift those into file_url/file_name/mime_type so the public
 * projection returns a usable asset reference. Text/link clips have empty
 * metadata and simply carry `content`.
 *
 * @param {Object} clip - a clips row (type, content, metadata, created_at)
 * @returns {Object} a row shaped for presentClip()
 */
function clipRowToPresentable(clip = {}) {
  const meta = clip.metadata && typeof clip.metadata === 'object' ? clip.metadata : {}
  return {
    type: clip.type,
    content: clip.content,
    file_url: meta.secure_url ?? null,
    file_name: meta.name ?? null,
    mime_type: meta.mime ?? null,
    created_at: clip.created_at,
  }
}

async function handleView(req, res) {
  // Public read — never require auth; never leak beyond presentClip().
  res.setHeader('Cache-Control', 'no-store') // revoke takes effect immediately (Req 6.3)

  // Per-IP read limit to slow token scraping (Req 7.5, 7.6). No auth here, so
  // key by the client IP (first x-forwarded-for hop, then socket address).
  const rl = rateLimit(`share:read:${clientIp(req)}`, READ_LIMIT)
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec))
    return res.status(429).json({ error: 'Too many requests' })
  }

  const token = typeof req.query?.token === 'string' ? req.query.token : ''
  if (!token) return res.status(400).json({ error: 'token is required' })

  const { data: share } = await supabase
    .from('shares')
    .select('clip_id, expires_at, revoked_at, view_count')
    .eq('token', token)
    .single()

  // Missing / revoked / expired → unavailable (Req 5.5). Uniform 404 so a
  // viewer cannot distinguish the reason (no enumeration signal).
  if (!share || !isShareActive(share)) {
    return res.status(404).json({ error: 'unavailable' })
  }

  const { data: clip } = await supabase
    .from('clips')
    .select('type, content, metadata, created_at')
    .eq('id', share.clip_id)
    .single()

  if (!clip) return res.status(404).json({ error: 'unavailable' }) // clip deleted (Req 5.7)

  // Best-effort view count bump (Req 5.4); never block the response on it.
  supabase
    .from('shares')
    .update({ view_count: (share.view_count ?? 0) + 1 })
    .eq('token', token)
    .then(() => {}, () => {})

  // The clips table stores file data inside the `metadata` JSONB (Cloudinary
  // descriptor: secure_url / name / mime), not as top-level columns. Map it to
  // the top-level shape presentClip() projects so image/file/audio shares
  // return a working file_url/file_name/mime_type. Text/link clips carry no
  // metadata and fall through to nulls.
  return res.status(200).json(presentClip(clipRowToPresentable(clip)))
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method === 'GET') {
      return await handleView(req, res)
    }

    if (req.method === 'POST') {
      const ownerId = await authenticate(req, res)
      if (!ownerId) return // response already sent

      const { action } = req.body || {}
      if (action === 'create') return await handleCreate(req, res, ownerId)
      if (action === 'revoke') return await handleRevoke(req, res, ownerId)
      return res.status(400).json({ error: 'Unknown action' })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

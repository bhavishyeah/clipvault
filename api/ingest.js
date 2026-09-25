// POST /api/ingest — Stable "send to VOLT" contract for external clients
//
// Used by the desktop browser extension (right-click "Send to VOLT") and the
// Web Share Target. Gives those clients ONE endpoint with a normalized payload
// instead of coupling them to the direct_transfers schema and RLS.
//
// Auth:   Authorization: Bearer <supabase access token> (the sender). The token
//         is validated with auth.getUser(token); writes use the service-role
//         client (attributed to the resolved sender_id).
//
// Body (JSON):
//   {
//     recipient: "@username" | "<uuid>",   // single target (required unless group)
//     group?:    "<groupId>",               // group target; wins over recipient,
//                                            // fans out to every member (excl. sender)
//     content?:  string,                    // text, link, image URL, or data:image
//     imageUrl?: string,                    // explicit image URL / data URI (wins)
//     groupName?: string                    // optional tag (auto-set for group sends)
//   }
//
// Behavior:
//   - Normalizes the payload (api/lib/ingest.js): decides text | link | image
//     and whether an image must be uploaded.
//   - Images are uploaded into OUR Cloudinary (unsigned preset) so VOLT owns
//     them — the resulting secure_url is stored on the transfer, exactly like
//     an in-app image send. If the upload fails, the image URL is stored as a
//     `link` so the send is never lost.
//   - Resolves the recipient (@username → id) and inserts a direct_transfers
//     row with sender_id = the authenticated caller.

import { createClient } from '@supabase/supabase-js'
import {
  normalizePayload,
  normalizeRecipient,
  buildTransferRow,
  buildFanoutRows,
} from '../lib/ingest.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const CLOUD_NAME = process.env.VITE_CLOUDINARY_CLOUD_NAME
const UPLOAD_PRESET = process.env.VITE_CLOUDINARY_UPLOAD_PRESET

// Upload a remote URL or data: URI to Cloudinary via the unsigned preset.
// Cloudinary fetches remote URLs / decodes data URIs server-side. Returns the
// normalized descriptor, or throws on failure.
async function uploadToCloudinary(fileValue, userId) {
  if (!CLOUD_NAME || !UPLOAD_PRESET) throw new Error('Upload not configured')

  const form = new URLSearchParams()
  form.append('file', fileValue)
  form.append('upload_preset', UPLOAD_PRESET)
  form.append('folder', `volt/${userId}`)

  const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })

  if (!resp.ok) {
    let message = `Cloudinary upload failed (${resp.status})`
    try {
      message = (await resp.json())?.error?.message || message
    } catch {
      // non-JSON error body — keep default
    }
    throw new Error(message)
  }

  const data = await resp.json()
  return {
    secure_url: data.secure_url,
    bytes: data.bytes ?? null,
    format: data.format || null,
    name: data.original_filename
      ? `${data.original_filename}${data.format ? `.${data.format}` : ''}`
      : `shared-image-${Date.now()}.${data.format || 'jpg'}`,
    mime: data.format ? `image/${data.format}` : 'image/*',
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    // 1. Authenticate the caller.
    const authHeader = req.headers.authorization || req.headers.Authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (!token) return res.status(401).json({ error: 'Authentication required' })

    const { data: userData, error: userError } = await supabase.auth.getUser(token)
    if (userError || !userData?.user) {
      return res.status(401).json({ error: 'Invalid or expired session' })
    }
    const senderId = userData.user.id

    // 2. Normalize the payload (shared by single and group sends).
    const normalized = normalizePayload(req.body || {})
    if (!normalized.ok) return res.status(400).json({ error: normalized.error })
    const { payload } = normalized

    // 3. If the payload is an image, upload it into our Cloudinary ONCE. The
    //    resulting descriptor is reused across every fanned-out row so a group
    //    send never re-uploads per recipient. A remote-URL failure falls back
    //    to a link; a data: URI failure is fatal (can't be stored as a link).
    let fileDescriptor = null
    let effectivePayload = payload
    if (payload.type === 'image') {
      try {
        fileDescriptor = await uploadToCloudinary(payload.imageUpload, senderId)
      } catch (err) {
        if (payload.imageUpload.startsWith('data:')) {
          return res.status(502).json({ error: `Image upload failed: ${err.message}` })
        }
        // Degrade to a link so the send is never lost.
        effectivePayload = { ...payload, type: 'link', content: payload.imageUpload, imageUpload: null }
      }
    }

    // 4a. GROUP send — `group` wins over `recipient`. Verify ownership, load
    //     members, exclude the sender, and fan out one row per member.
    const groupId = typeof req.body?.group === 'string' ? req.body.group.trim() : ''
    if (groupId) {
      const { data: group, error: groupErr } = await supabase
        .from('groups')
        .select('id, name, owner_id')
        .eq('id', groupId)
        .single()

      if (groupErr || !group) return res.status(404).json({ error: 'Group not found' })
      if (group.owner_id !== senderId) {
        return res.status(403).json({ error: 'You do not own this group' })
      }

      const { data: memberRows, error: memberErr } = await supabase
        .from('group_members')
        .select('user_id')
        .eq('group_id', group.id)
      if (memberErr) return res.status(500).json({ error: memberErr.message })

      const recipientIds = (memberRows || [])
        .map((m) => m.user_id)
        .filter((id) => id !== senderId)

      if (recipientIds.length === 0) {
        return res.status(200).json({ success: true, recipients: 0 })
      }

      const rows = buildFanoutRows({
        senderId,
        recipientIds,
        payload: effectivePayload,
        groupName: group.name,
        fileDescriptor,
      })

      const { error: insertError } = await supabase.from('direct_transfers').insert(rows)
      if (insertError) return res.status(500).json({ error: insertError.message })

      return res.status(200).json({ success: true, recipients: recipientIds.length })
    }

    // 4b. SINGLE recipient send.
    const recipientRef = normalizeRecipient(req.body?.recipient)
    if (!recipientRef) {
      return res.status(400).json({ error: 'A valid recipient (@username or id) or group is required' })
    }

    let recipientId
    if (recipientRef.kind === 'id') {
      recipientId = recipientRef.value
    } else {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .ilike('username', recipientRef.value)
        .single()
      if (!profile) return res.status(404).json({ error: `No user @${recipientRef.value}` })
      recipientId = profile.id
    }

    const row = buildTransferRow({
      senderId,
      recipientId,
      payload: effectivePayload,
      fileDescriptor,
    })

    // 5. Insert the transfer (service role bypasses RLS; sender is attributed).
    const { data: inserted, error: insertError } = await supabase
      .from('direct_transfers')
      .insert(row)
      .select('id, type')
      .single()

    if (insertError) return res.status(500).json({ error: insertError.message })

    return res.status(200).json({ success: true, id: inserted.id, type: inserted.type })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

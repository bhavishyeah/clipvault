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
//     recipient: "@username" | "<uuid>",   // required
//     content?:  string,                    // text, link, image URL, or data:image
//     imageUrl?: string,                    // explicit image URL / data URI (wins)
//     groupName?: string                    // optional tag for group fan-out
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
import { normalizePayload, normalizeRecipient } from './lib/ingest.js'

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

    // 2. Resolve the recipient.
    const recipientRef = normalizeRecipient(req.body?.recipient)
    if (!recipientRef) {
      return res.status(400).json({ error: 'A valid recipient (@username or id) is required' })
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

    if (recipientId === senderId) {
      // Allowed: users can send to themselves (a common capture flow).
    }

    // 3. Normalize the payload.
    const normalized = normalizePayload(req.body || {})
    if (!normalized.ok) return res.status(400).json({ error: normalized.error })
    const { payload } = normalized

    // 4. Build the transfer row, uploading any image into our Cloudinary.
    const row = {
      sender_id: senderId,
      recipient_id: recipientId,
      type: payload.type,
      content: payload.content,
      file_url: null,
      file_name: null,
      file_size: null,
      mime_type: null,
      group_name: payload.groupName,
      status: 'pending',
    }

    if (payload.type === 'image') {
      try {
        const descriptor = await uploadToCloudinary(payload.imageUpload, senderId)
        row.file_url = descriptor.secure_url
        row.file_name = descriptor.name
        row.file_size = descriptor.bytes
        row.mime_type = descriptor.mime
        row.content = null
      } catch (err) {
        // Fall back to a link so the send is never lost. A data: URI cannot be
        // stored as a link, so surface a clear error instead.
        if (payload.imageUpload.startsWith('data:')) {
          return res.status(502).json({ error: `Image upload failed: ${err.message}` })
        }
        row.type = 'link'
        row.content = payload.imageUpload
      }
    }

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

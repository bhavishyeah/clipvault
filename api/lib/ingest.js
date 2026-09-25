// VOLT — Pure ingest payload helpers (Node-safe, no I/O)
//
// Single source of truth for how an inbound "send to VOLT" payload (from the
// browser extension or the Web Share Target) is normalized before it becomes a
// direct_transfers row. Kept dependency-free so the endpoint (api/ingest.js)
// can layer auth + Cloudinary + persistence on top, and so this logic is unit-
// testable. Mirrors the client-side rules in src/lib/ingestImage.js.

const DATA_IMAGE_RE = /^data:image\/([a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif|ico|tiff?)(?:[?#]|$)/i
const HTTP_RE = /^https?:\/\//i

// Max characters for a link/text content field — a base64 data URI is allowed
// to exceed this because it is uploaded, not stored as text.
export const MAX_CONTENT_LEN = 10000

export const VALID_TYPES = ['text', 'link', 'image']

/**
 * Normalize a recipient reference: a bare id, or an "@username"/"username".
 * Returns { kind: 'username', value } | { kind: 'id', value } | null.
 * @param {unknown} recipient
 */
export function normalizeRecipient(recipient) {
  if (typeof recipient !== 'string') return null
  const trimmed = recipient.trim()
  if (!trimmed) return null

  // A UUID-shaped string is treated as a direct user id.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return { kind: 'id', value: trimmed }
  }

  const username = trimmed.replace(/^@/, '').toLowerCase()
  if (/^[a-z0-9_]{3,20}$/.test(username)) return { kind: 'username', value: username }
  return null
}

export function isDataImage(text) {
  return typeof text === 'string' && DATA_IMAGE_RE.test(text.trim())
}

export function isImageUrl(text) {
  if (typeof text !== 'string' || !HTTP_RE.test(text.trim())) return false
  try {
    return IMAGE_EXT_RE.test(new URL(text.trim()).pathname)
  } catch {
    return false
  }
}

/**
 * Unwrap a Google Images `imgres` redirect to the real image URL when present.
 * @param {string} raw
 * @returns {string}
 */
export function unwrapImageUrl(raw) {
  const text = String(raw ?? '').trim()
  try {
    const u = new URL(text)
    if (/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && u.pathname.includes('/imgres')) {
      const imgurl = u.searchParams.get('imgurl')
      if (imgurl) return imgurl
    }
  } catch {
    // not parseable — return as-is below
  }
  return text
}

export function isUrl(text) {
  return typeof text === 'string' && /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(text.trim())
}

/**
 * @typedef {Object} NormalizedPayload
 * @property {'text'|'link'|'image'} type
 * @property {string|null} content - text/link content, or null for image uploads
 * @property {string|null} imageUpload - a data: URI or remote URL to upload to
 *   Cloudinary (present only when the payload is an image), else null
 * @property {string|null} groupName - optional group tag, else null
 */

/**
 * Normalize a raw ingest body into a persistable shape, resolving the effective
 * type and deciding whether an image upload is required.
 *
 * Resolution order for the sent value (first present wins):
 *   explicit `imageUrl` → image upload
 *   `content` that is a data:image → image upload
 *   `content` that is an image URL (after unwrapping) → image upload
 *   `content` that is any other URL → link
 *   `content` (anything else) → text
 *
 * @param {{ type?: string, content?: string, imageUrl?: string, groupName?: string }} body
 * @returns {{ ok: true, payload: NormalizedPayload } | { ok: false, error: string }}
 */
export function normalizePayload(body = {}) {
  const groupName =
    typeof body.groupName === 'string' && body.groupName.trim()
      ? body.groupName.trim().slice(0, 100)
      : null

  // An explicit image URL always wins.
  if (typeof body.imageUrl === 'string' && body.imageUrl.trim()) {
    const url = unwrapImageUrl(body.imageUrl)
    if (isDataImage(url) || isImageUrl(url) || HTTP_RE.test(url)) {
      return { ok: true, payload: { type: 'image', content: null, imageUpload: url, groupName } }
    }
    return { ok: false, error: 'imageUrl is not a valid image reference' }
  }

  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) return { ok: false, error: 'content or imageUrl is required' }

  if (isDataImage(content)) {
    return { ok: true, payload: { type: 'image', content: null, imageUpload: content, groupName } }
  }

  const unwrapped = unwrapImageUrl(content)
  if (isImageUrl(unwrapped)) {
    return { ok: true, payload: { type: 'image', content: null, imageUpload: unwrapped, groupName } }
  }

  if (content.length > MAX_CONTENT_LEN) {
    return { ok: false, error: `content exceeds ${MAX_CONTENT_LEN} characters` }
  }

  const type = isUrl(content) ? 'link' : 'text'
  return { ok: true, payload: { type, content, imageUpload: null, groupName } }
}

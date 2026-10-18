// VOLT — Image ingest detection for received transfers
//
// The desktop browser extension (and Web Share Target) send images "by
// reference": an image is delivered as a `link`/`text` transfer whose content
// is either
//   1. an http(s) URL that points at an image, or
//   2. a `data:image/...;base64,...` URI that literally IS the image.
//
// When the recipient hits "Save to vault" we want those to become genuine VOLT
// image clips we OWN (re-uploaded to our own Cloudinary), not brittle link
// clips that rot when the source URL disappears or blocks hotlinking.
//
// These are pure helpers: no I/O, no upload. `planImageIngest` decides IF and
// HOW a transfer should be ingested as an image; the hook performs the upload.

const DATA_IMAGE_RE = /^data:image\/([a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i

// Common image file extensions we recognize in a bare URL path.
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif|ico|tiff?)(?:[?#]|$)/i

/**
 * True when the string is a base64-encoded `data:image/...` URI.
 * @param {unknown} text
 * @returns {boolean}
 */
export function isDataImage(text) {
  return typeof text === 'string' && DATA_IMAGE_RE.test(text.trim())
}

/**
 * True when the string looks like an http(s) URL whose path ends in a known
 * image extension (query/hash tolerated). Does NOT fetch — purely syntactic.
 * @param {unknown} text
 * @returns {boolean}
 */
export function isImageUrl(text) {
  if (typeof text !== 'string') return false
  const trimmed = text.trim()
  if (!/^https?:\/\//i.test(trimmed)) return false
  try {
    const u = new URL(trimmed)
    return IMAGE_EXT_RE.test(u.pathname)
  } catch {
    return false
  }
}

/**
 * Google Images result URLs (`.../imgres?...&imgurl=<real>&...`) wrap the real
 * image behind a redirect. Return the decoded real image URL when present,
 * otherwise the input unchanged.
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
    // not a parseable URL — fall through
  }
  return text
}

/**
 * Derive a filename + MIME for a data:image URI.
 * @param {string} dataUri
 * @returns {{ name: string, mime: string }}
 */
function dataImageMeta(dataUri) {
  const m = DATA_IMAGE_RE.exec(dataUri.trim())
  const ext = (m?.[1] || 'png').split('+')[0].toLowerCase()
  return { name: `shared-image-${Date.now()}.${ext}`, mime: `image/${ext}` }
}

/**
 * Derive a filename from an image URL's path.
 * @param {string} url
 * @returns {string}
 */
function urlImageName(url) {
  try {
    const path = new URL(url).pathname
    const base = decodeURIComponent(path.split('/').filter(Boolean).pop() || '')
    if (base && IMAGE_EXT_RE.test(base)) return base
  } catch {
    // ignore
  }
  return `shared-image-${Date.now()}.jpg`
}

/**
 * @typedef {Object} ImageIngestPlan
 * @property {'data' | 'url'} source - whether the image came as a data URI or a remote URL
 * @property {string} uploadValue - the value to hand Cloudinary's `file` field
 *   (the data URI, or the unwrapped remote URL — Cloudinary fetches remote URLs)
 * @property {string} name - suggested filename for the resulting clip
 * @property {string} mime - best-effort MIME type
 */

/**
 * Decide whether a received transfer should be ingested as an image, and how.
 *
 * Only text/link transfers that carry NO real uploaded file are candidates —
 * an image/file/audio transfer already has a `file_url` we own, so it is left
 * alone. Returns `null` when the transfer is not an ingestable image.
 *
 * @param {{ type?: string, content?: string, file_url?: string }} transfer
 * @returns {ImageIngestPlan | null}
 */
export function planImageIngest(transfer) {
  if (!transfer || transfer.file_url) return null
  if (transfer.type !== 'text' && transfer.type !== 'link') return null

  const content = typeof transfer.content === 'string' ? transfer.content.trim() : ''
  if (!content) return null

  if (isDataImage(content)) {
    const { name, mime } = dataImageMeta(content)
    return { source: 'data', uploadValue: content, name, mime }
  }

  const unwrapped = unwrapImageUrl(content)
  if (isImageUrl(unwrapped)) {
    return {
      source: 'url',
      uploadValue: unwrapped,
      name: urlImageName(unwrapped),
      mime: 'image/*',
    }
  }

  return null
}

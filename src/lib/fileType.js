// VOLT — File classification and size-gate helpers
// Pure functions: no side effects, no I/O. Used by the upload path,
// clip storage, direct send, and group sends to classify files,
// pick a Cloudinary resource type, and gate on size before upload.

/**
 * Classify a MIME type into one of the VOLT clip kinds.
 * Total function: any string (including empty/unknown) resolves to a kind.
 * @param {string} mime - a MIME type such as 'image/png' or 'audio/mpeg'
 * @returns {'image' | 'audio' | 'file'}
 */
export function classifyFile(mime) {
  const type = typeof mime === 'string' ? mime.toLowerCase() : ''
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('audio/')) return 'audio'
  return 'file'
}

/**
 * Map a clip kind to the Cloudinary resource type / endpoint segment.
 * @param {'image' | 'audio' | 'file'} kind
 * @returns {'image' | 'video' | 'auto'}
 */
export function resourceTypeFor(kind) {
  switch (kind) {
    case 'image': return 'image'
    case 'audio': return 'video'
    default: return 'auto'
  }
}

// Upload size limits in bytes (Req 1.3, 1.4, 2.1, 2.2)
export const SIZE_LIMITS = {
  file: 15_728_640, // 15 MB
  audio: 10_485_760, // 10 MB
}

/**
 * Pure size gate. Does NOT upload — callers must check `ok` before uploading.
 * @param {{ type?: string, size?: number }} file
 * @returns {{ ok: boolean, reason?: 'empty' | 'too_large', limit?: number }}
 */
export function validateFile({ type, size } = {}) {
  const bytes = Number(size)

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, reason: 'empty' }
  }

  const kind = classifyFile(type)

  if (kind === 'audio' && bytes > SIZE_LIMITS.audio) {
    return { ok: false, reason: 'too_large', limit: SIZE_LIMITS.audio }
  }

  // Images have no size gate here; only 'file' and 'audio' are limited.
  if (kind === 'file' && bytes > SIZE_LIMITS.file) {
    return { ok: false, reason: 'too_large', limit: SIZE_LIMITS.file }
  }

  return { ok: true }
}

/**
 * Format a byte count as a human-readable string, e.g. "2.4 MB".
 * @param {number} bytes
 * @returns {string}
 */
export function humanSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = n
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }

  // Whole bytes never show a decimal; larger units show one decimal place.
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10
  return `${rounded} ${units[unit]}`
}

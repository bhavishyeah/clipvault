// VOLT — Pure share-link helpers (Node-safe, no I/O beyond node crypto)
//
// Single source of truth for the decision + projection logic behind public
// share links. Kept dependency-free (only node `crypto`) so the endpoints
// (api/share.js) can layer auth, persistence, and the service-role read on top,
// and so this logic is unit-testable. Mirrors the conventions in
// api/lib/ingest.js.

import { randomBytes } from 'node:crypto'

// A share token is 24 random bytes rendered as base64url: ~192 bits of entropy
// (well above the 128-bit floor) and 32 URL-safe characters with no padding.
const TOKEN_BYTES = 24

// Default share lifetime, in days, when the caller does not specify one.
export const DEFAULT_EXPIRY_DAYS = 7

/**
 * Generate a URL-safe, high-entropy share token.
 *
 * 24 random bytes → base64url yields 32 characters drawn only from
 * [A-Za-z0-9_-] (no `+`, `/`, or `=` padding), safe to place directly in a
 * `/s/<token>` path.
 *
 * @returns {string} a 32-character base64url token
 */
export function generateToken() {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/**
 * Whether a share is currently usable: not revoked and not expired.
 *
 * A share is active when `revoked_at` is null/absent AND `expires_at` is
 * strictly in the future relative to `now`. Missing or unparseable
 * `expires_at` is treated as inactive (fail closed).
 *
 * @param {{ revoked_at?: string|Date|null, expires_at?: string|Date|null }} share
 * @param {Date|number|string} [now] - the reference time (defaults to Date.now)
 * @returns {boolean}
 */
export function isShareActive(share, now = new Date()) {
  if (!share) return false
  if (share.revoked_at != null) return false

  const expiresMs = toMillis(share.expires_at)
  if (expiresMs == null) return false

  return expiresMs > toMillis(now)
}

/**
 * Whitelist projection for a clip served over the PUBLIC share endpoint.
 *
 * Returns ONLY the fields safe to expose to an unauthenticated viewer. Owner
 * id, share token, and every internal column are intentionally omitted so a
 * public read can never leak them, regardless of what the row contains.
 *
 * @param {Object} clip - a clips row (may contain internal columns)
 * @returns {{
 *   type: string|null,
 *   content: string|null,
 *   file_url: string|null,
 *   file_name: string|null,
 *   mime_type: string|null,
 *   created_at: string|null,
 * }}
 */
export function presentClip(clip = {}) {
  return {
    type: clip.type ?? null,
    content: clip.content ?? null,
    file_url: clip.file_url ?? null,
    file_name: clip.file_name ?? null,
    mime_type: clip.mime_type ?? null,
    created_at: clip.created_at ?? null,
  }
}

/**
 * Compute a share's expiry timestamp: `now` plus `days`.
 *
 * @param {number} [days] - lifetime in days; defaults to DEFAULT_EXPIRY_DAYS
 *   when not a positive finite number
 * @param {Date|number|string} [now] - the reference time (defaults to now)
 * @returns {string} an ISO-8601 timestamptz string
 */
export function computeExpiry(days, now = new Date()) {
  const validDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_EXPIRY_DAYS
  const base = toMillis(now) ?? Date.now()
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  return new Date(base + validDays * MS_PER_DAY).toISOString()
}

/**
 * Coerce a Date | number | ISO string into epoch milliseconds, or null when it
 * cannot be interpreted as a valid time.
 * @param {Date|number|string|null|undefined} value
 * @returns {number|null}
 */
function toMillis(value) {
  if (value == null) return null
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isNaN(ms) ? null : ms
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

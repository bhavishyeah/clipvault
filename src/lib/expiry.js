// VOLT — Clip expiry pure helpers
// Total, side-effect-free functions for turning quick expiry presets into an
// absolute `expires_at`, formatting a human-readable countdown, and deciding
// whether a clip is "expiring soon". No I/O, no clock reads: callers pass the
// current time so behavior is deterministic and testable.

/** Milliseconds in one second/minute/hour/day. */
const MS_PER_MINUTE = 60 * 1000
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

/**
 * Default window (24 hours, in ms) within which an upcoming expiry counts as
 * "expiring soon".
 */
export const SOON_THRESHOLD_MS = 24 * MS_PER_HOUR

/**
 * Duration, in ms, that each expiry preset adds to `now`. The `'none'` preset
 * clears any expiry and maps to `null`.
 * @type {Record<string, number|null>}
 */
export const EXPIRY_PRESETS = {
  '1h': MS_PER_HOUR,
  '1d': MS_PER_DAY,
  '7d': 7 * MS_PER_DAY,
  none: null,
}

/**
 * Coerce a Date, ISO string, or epoch-millis number into epoch milliseconds.
 * @param {Date|string|number} value
 * @returns {number} epoch ms, or NaN when the value cannot be parsed
 */
function toMillis(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') return new Date(value).getTime()
  return NaN
}

/**
 * Convert a quick expiry preset into an absolute expiry timestamp.
 *
 * @param {'1h'|'1d'|'7d'|'none'} preset - the chosen quick preset
 * @param {Date|string|number} [now=new Date()] - the reference "now"
 * @returns {string|null} an ISO-8601 timestamp for `now + preset`, or `null`
 *   for the `'none'` preset (and for any unknown preset).
 */
export function presetToExpiry(preset, now = new Date()) {
  const offset = Object.prototype.hasOwnProperty.call(EXPIRY_PRESETS, preset)
    ? EXPIRY_PRESETS[preset]
    : null
  if (offset === null) return null

  const base = toMillis(now)
  if (!Number.isFinite(base)) return null

  return new Date(base + offset).toISOString()
}

/**
 * Format a human-readable countdown to an expiry.
 *
 * Buckets, from coarsest to finest:
 *   - >= 1 day   -> "in Nd"
 *   - >= 1 hour  -> "in Nh"
 *   - >= 1 min   -> "in Nm"
 *   - > 0        -> "in <1m"
 * Absent (`null`/`undefined`/unparseable) input returns `''`. An expiry at or
 * before `now` returns `'expired'`.
 *
 * @param {Date|string|number|null|undefined} expiresAt - the expiry timestamp
 * @param {Date|string|number} [now=new Date()] - the reference "now"
 * @returns {string} the formatted countdown (e.g. "in 3h", "in 2d")
 */
export function formatCountdown(expiresAt, now = new Date()) {
  if (expiresAt === null || expiresAt === undefined) return ''

  const end = toMillis(expiresAt)
  const base = toMillis(now)
  if (!Number.isFinite(end) || !Number.isFinite(base)) return ''

  const remaining = end - base
  if (remaining <= 0) return 'expired'

  if (remaining >= MS_PER_DAY) return `in ${Math.floor(remaining / MS_PER_DAY)}d`
  if (remaining >= MS_PER_HOUR) return `in ${Math.floor(remaining / MS_PER_HOUR)}h`
  if (remaining >= MS_PER_MINUTE) return `in ${Math.floor(remaining / MS_PER_MINUTE)}m`
  return 'in <1m'
}

/**
 * Decide whether an expiry is "expiring soon": still in the future, but within
 * `thresholdMs` of `now`. A boundary expiry exactly at `now + thresholdMs` is
 * considered soon (inclusive upper bound). Already-expired or absent inputs are
 * never "soon".
 *
 * @param {Date|string|number|null|undefined} expiresAt - the expiry timestamp
 * @param {Date|string|number} [now=new Date()] - the reference "now"
 * @param {number} [thresholdMs=SOON_THRESHOLD_MS] - the soon window in ms
 * @returns {boolean}
 */
export function isExpiringSoon(expiresAt, now = new Date(), thresholdMs = SOON_THRESHOLD_MS) {
  if (expiresAt === null || expiresAt === undefined) return false

  const end = toMillis(expiresAt)
  const base = toMillis(now)
  if (!Number.isFinite(end) || !Number.isFinite(base)) return false

  const remaining = end - base
  return remaining > 0 && remaining <= thresholdMs
}

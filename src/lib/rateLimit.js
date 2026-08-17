// Simple client-side rate limiter to prevent accidental spam saves
// Tracks actions in a sliding window

const windows = new Map()

/**
 * Check if an action is rate-limited
 * @param {string} action - action identifier (e.g., 'save', 'delete')
 * @param {number} maxPerWindow - max allowed actions in the window
 * @param {number} windowMs - window duration in ms (default 10s)
 * @returns {boolean} true if allowed, false if rate-limited
 */
export function checkRateLimit(action, maxPerWindow = 5, windowMs = 10000) {
  const now = Date.now()
  const key = action

  if (!windows.has(key)) {
    windows.set(key, [])
  }

  const timestamps = windows.get(key)

  // Remove timestamps outside the window
  const valid = timestamps.filter((t) => now - t < windowMs)
  windows.set(key, valid)

  if (valid.length >= maxPerWindow) {
    return false // rate limited
  }

  valid.push(now)
  return true // allowed
}

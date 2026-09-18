// VOLT — Group sharing pure helpers
// Total, side-effect-free functions used to gate group creation and sending.

/** Minimum allowed group name length after trimming. */
export const NAME_MIN = 1
/** Maximum allowed group name length after trimming. */
export const NAME_MAX = 100

/**
 * Validate a group name.
 *
 * A name is valid iff, after leading/trailing whitespace is removed, its
 * length is within [NAME_MIN, NAME_MAX].
 *
 * @param {string} name - the raw group name as entered by the user
 * @returns {{ ok: boolean, reason?: 'empty' | 'too_long' }}
 *   `{ ok: true }` when valid; otherwise `{ ok: false, reason }` where
 *   `reason` is `'empty'` for empty/whitespace-only input and `'too_long'`
 *   when the trimmed length exceeds NAME_MAX.
 */
export function validateGroupName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : ''

  if (trimmed.length < NAME_MIN) {
    return { ok: false, reason: 'empty' }
  }

  if (trimmed.length > NAME_MAX) {
    return { ok: false, reason: 'too_long' }
  }

  return { ok: true }
}

/**
 * Determine whether a group with the given member count can receive a send.
 *
 * @param {number} memberCount - the current number of members in the group
 * @returns {boolean} true iff the group has at least one member
 */
export function canSendToGroup(memberCount) {
  return memberCount > 0
}

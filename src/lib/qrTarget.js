// VOLT — QR target selection (pure, no I/O)
//
// Decides WHAT a clip's QR code should encode. A scanning device is usually
// signed out, so the goal is to hand it something it can actually use:
//   - an existing public share URL (/s/<token>) whenever one exists,
//   - otherwise the raw content for short text/link clips,
//   - otherwise a signal that a share must be created first (image/file/audio
//     clips, or content too large to scan reliably).
//
// Kept pure so the QR modal component stays thin and this decision logic is
// unit-testable. Requirements 3.2, 3.3, 3.4.

/**
 * Maximum content length (in characters) we will encode raw into a QR code.
 *
 * QR codes can technically hold more, but density climbs fast and phone
 * cameras struggle to scan dense codes from a screen. 512 is a conservative
 * cap that stays comfortably scannable across typical viewing conditions;
 * anything longer routes through a share link instead.
 */
export const SAFE_QR_LENGTH = 512

/**
 * Build the public share URL for a share, matching the /s/<token> convention.
 * Prefers a server-provided absolute `url`, falling back to `origin` + token.
 * @param {{ token?: string, url?: string }} share
 * @param {string} origin - e.g. window.location.origin
 * @returns {string|null}
 */
function shareUrl(share, origin) {
  if (!share) return null
  if (share.url) return share.url
  if (share.token && origin) return `${origin}/s/${share.token}`
  return null
}

/**
 * @typedef {Object} QrTarget
 * @property {'share'|'raw'|'needs-share'} kind - what the value represents
 * @property {string} value - the share URL, the raw content, or '' for needs-share
 */

/**
 * Choose what a clip's QR code should encode.
 *
 * Decision order (Requirement 3):
 *   1. An active share exists  -> encode the /s/<token> URL      (kind 'share')
 *   2. No share, short text/link -> encode the raw content       (kind 'raw')
 *   3. No share, and raw is unsuitable (image/file/audio clip, or
 *      content over the safe cap) -> ask to create a share first (kind 'needs-share')
 *
 * @param {{ type?: string, content?: string|null }} clip
 * @param {{ token?: string, url?: string }|null|undefined} activeShare
 * @param {{ origin?: string }} [opts]
 * @returns {QrTarget}
 */
export function chooseQrValue(clip = {}, activeShare = null, { origin = '' } = {}) {
  // 1. Prefer an existing share so the scanning device opens a real page.
  const url = shareUrl(activeShare, origin)
  if (url) {
    return { kind: 'share', value: url }
  }

  // 2. Raw encoding only suits short text/link content.
  const type = clip.type || 'text'
  const isRawEncodable = type === 'text' || type === 'link'
  const content = typeof clip.content === 'string' ? clip.content : ''

  if (isRawEncodable && content && content.length <= SAFE_QR_LENGTH) {
    return { kind: 'raw', value: content }
  }

  // 3. Image/file/audio clips or oversized content need a share link first.
  return { kind: 'needs-share', value: '' }
}

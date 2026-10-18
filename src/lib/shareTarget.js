// VOLT — Web Share Target parsing (pure, no I/O)
//
// Android's share sheet sends shared content to the PWA via the manifest
// `share_target` (a GET to /?share=1 with title/text/url query params). This
// helper turns the raw URL search string into a normalized share intent so the
// Dashboard can route it: an image link/data-URI becomes an image clip, any
// other URL a link clip, and everything else a text clip.
//
// Kept pure so the routing decision is unit-testable; image detection is shared
// with the receive/ingest path via lib/ingestImage.

import { isDataImage, isImageUrl, unwrapImageUrl } from './ingestImage'

// Public TLDs accepted for a scheme-less "bare host" so plain text isn't
// mis-classified as a link. Mirrors the rule in lib/ingest.js and
// hooks/useClips.js for consistent link/text typing across capture paths.
const URL_TLD_ALLOWLIST =
  '(?:com|org|net|io|dev|app|co|edu|gov|me|ai|xyz|gg|to|ly|sh|so)'
const URL_RE = new RegExp(
  `^(?:https?:\\/\\/\\S+|www\\.\\S+|[\\w-]+(?:\\.[\\w-]+)*\\.${URL_TLD_ALLOWLIST}(?:[/?#]\\S*)?)$`,
  'i',
)

/**
 * @typedef {Object} ShareIntent
 * @property {'image' | 'link' | 'text'} kind
 * @property {string} value - for image: the upload value (data URI / image URL);
 *   for link/text: the content to save
 */

/**
 * Parse a location.search string (e.g. "?share=1&url=...") into a ShareIntent,
 * or null when there is nothing shared.
 *
 * The shared content is taken from `url`, then `text`, then `title` (first
 * non-empty wins) — matching the manifest's params mapping.
 *
 * @param {string} search - window.location.search
 * @returns {ShareIntent | null}
 */
export function parseShare(search) {
  const params = new URLSearchParams(search || '')

  // Only treat this as a share when the share flag or a payload param exists.
  const raw = params.get('url') || params.get('text') || params.get('title')
  if (!raw) return null

  const content = raw.trim()
  if (!content) return null

  if (isDataImage(content)) {
    return { kind: 'image', value: content }
  }

  const unwrapped = unwrapImageUrl(content)
  if (isImageUrl(unwrapped)) {
    return { kind: 'image', value: unwrapped }
  }

  // A bare URL (no image extension) → link; anything else → text. Treat as a
  // URL only with an explicit http(s) scheme, a `www.` prefix, or a host
  // ending in a recognized public TLD, so plain text (e.g. `node.js`) isn't
  // mis-typed as a link.
  const looksUrl = URL_RE.test(content)
  return { kind: looksUrl ? 'link' : 'text', value: content }
}

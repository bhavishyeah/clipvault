// VOLT — Client-side share helpers (pure, no I/O)
//
// Turns the public share API response into a view model the PublicShare page
// renders, and extracts the token from the /s/<token> path. Kept pure so the
// page component stays thin and the presentation logic is unit-testable.

/**
 * Extract the share token from a pathname like "/s/<token>".
 * @param {string} pathname - window.location.pathname
 * @returns {string|null} the token, or null when the path is not a share path
 */
export function sharePathToken(pathname) {
  if (typeof pathname !== 'string') return null
  const m = pathname.match(/^\/s\/([^/?#]+)\/?$/)
  return m ? decodeURIComponent(m[1]) : null
}

/**
 * @typedef {Object} ShareView
 * @property {'text'|'link'|'image'|'file'} kind - how to render the content
 * @property {string|null} content - text/link content (for text/link kinds)
 * @property {string|null} downloadUrl - Cloudinary URL (for image/file kinds)
 * @property {string|null} fileName
 * @property {boolean} canCopy - offer a copy action (text/link)
 * @property {boolean} canDownload - offer a download/open action (image/file)
 * @property {string} createdAt
 */

/**
 * Build a view model from the /api/share GET response.
 *
 * Maps clip types to a rendering `kind`: text and link keep their content and
 * are copyable; image renders inline and is downloadable; file and audio share
 * one titled download control. Unknown/absent types fall back to text.
 *
 * @param {{ type?: string, content?: string|null, file_url?: string|null,
 *   file_name?: string|null, mime_type?: string|null, created_at?: string }} res
 * @returns {ShareView}
 */
export function shareViewModel(res = {}) {
  const type = res.type || 'text'
  const createdAt = res.created_at || ''

  if (type === 'image') {
    return {
      kind: 'image',
      content: null,
      downloadUrl: res.file_url || null,
      fileName: res.file_name || null,
      canCopy: false,
      canDownload: Boolean(res.file_url),
      createdAt,
    }
  }

  if (type === 'file' || type === 'audio') {
    return {
      kind: 'file',
      content: null,
      downloadUrl: res.file_url || null,
      fileName: res.file_name || null,
      canCopy: false,
      canDownload: Boolean(res.file_url),
      createdAt,
    }
  }

  // text or link — copyable content.
  return {
    kind: type === 'link' ? 'link' : 'text',
    content: res.content ?? '',
    downloadUrl: null,
    fileName: null,
    canCopy: Boolean(res.content),
    canDownload: false,
    createdAt,
  }
}

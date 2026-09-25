// fetchLinkPreview — client-side caller for the /api/link-preview endpoint
// (volt-vault-polish A4, Task 5.3).
//
// Given a link URL and the owner's Supabase access token, POST to the
// serverless preview endpoint (which does the SSRF-guarded scrape server-side
// so the user's token is never exposed to third-party sites — Req 4.4) and
// return the normalized { title, description, image } shape.
//
// The endpoint always responds 200 with an all-null preview on any failure
// (blocked / timed out / no metadata), so callers can cache the result and
// fall back to the favicon+domain card without special-casing errors
// (Req 4.5). This helper mirrors that: on a network error, a non-OK status,
// or a malformed body it resolves to the empty shape rather than throwing.

const PREVIEW_ENDPOINT = '/api/link-preview'

const EMPTY_PREVIEW = { title: null, description: null, image: null }

/**
 * Fetch OpenGraph/meta preview data for a link URL via the server endpoint.
 *
 * @param {string} url - the link clip's URL
 * @param {string} accessToken - the owner's Supabase access token (Bearer)
 * @returns {Promise<{ title: string|null, description: string|null, image: string|null }>}
 */
export async function fetchLinkPreview(url, accessToken) {
  if (!url || !accessToken) return { ...EMPTY_PREVIEW }

  try {
    const res = await fetch(PREVIEW_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ url }),
    })

    if (!res.ok) return { ...EMPTY_PREVIEW }

    const data = await res.json()
    // Normalize to the fixed shape; ignore any extra fields the server sends.
    return {
      title: data?.title ?? null,
      description: data?.description ?? null,
      image: data?.image ?? null,
    }
  } catch {
    // Network error, aborted request, malformed JSON → graceful empty.
    return { ...EMPTY_PREVIEW }
  }
}

/**
 * True when a preview object carries at least one usable field. Used to decide
 * whether to render the rich card (Req 4.3) versus the favicon+domain fallback
 * (Req 4.5), and whether a cached preview already exists (avoids re-fetching —
 * Req 4.2). A cached-but-empty preview (all null) still counts as "cached" so
 * we do not refetch a link that genuinely has no metadata.
 */
export function hasPreviewData(preview) {
  if (!preview) return false
  return Boolean(preview.title || preview.description || preview.image)
}

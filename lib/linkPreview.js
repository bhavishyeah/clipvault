// VOLT — Pure link-preview helpers (Node-safe, no I/O, no dependencies)
//
// Decision + parsing logic behind rich link previews (feature A4). Kept
// dependency-free so the serverless endpoint (api/link-preview.js) can layer
// the actual fetch, auth, and rate-limiting on top, and so this logic stays
// unit-testable. Mirrors the conventions in lib/share.js and lib/rateLimit.js.
//
// Two responsibilities live here:
//   1. validatePreviewUrl(url) — an SSRF guard. Before the endpoint fetches an
//      arbitrary user-supplied URL it must reject anything that is not a plain
//      http(s) request to a public host: no other schemes, no loopback, no
//      RFC 1918 / link-local / other private ranges.
//   2. parseOgTags(html) — extract OpenGraph/meta title, description, and image
//      from a fetched document, falling back to <title> and returning null for
//      any field that is absent. No DOM: a small, forgiving regex pass so it
//      runs in the serverless isolate without a parser dependency.

// --- Limits shared with the endpoint -----------------------------------------

// Maximum wall-clock time to wait on a third-party fetch before giving up and
// degrading to the favicon+domain view. Requirement 4.6 (request timeout).
export const PREVIEW_TIMEOUT_MS = 5_000

// Maximum number of response bytes to read from a target site. A hostile or
// misconfigured server could stream an unbounded body; the endpoint caps reads
// at this size. Requirement 4.6 (response size cap).
export const PREVIEW_MAX_BYTES = 512 * 1024 // 512 KiB

// --- SSRF guard ---------------------------------------------------------------

/**
 * Validate that a user-supplied URL is safe to fetch server-side.
 *
 * Accepts ONLY absolute http/https URLs whose host is a public name or address.
 * Rejects, in order: unparseable input, non-http(s) schemes (file:, data:,
 * ftp:, gopher:, javascript:, ...), empty/malformed hosts, and any host that
 * resolves to a private, loopback, link-local, or otherwise non-routable
 * address range. Hostnames (e.g. "example.com") are permitted here because DNS
 * resolution — and the corresponding post-resolution address check — happens in
 * the endpoint; this guard blocks the literal-address and localhost vectors and
 * the obvious internal names. Requirement 4.6 (SSRF: scheme + private ranges).
 *
 * @param {string} url - the candidate URL to fetch
 * @returns {{ ok: true, url: URL } | { ok: false, reason: string }}
 *   `ok:true` with the parsed URL when safe; otherwise `ok:false` with a short
 *   machine-readable reason ('invalid-url' | 'bad-scheme' | 'no-host' |
 *   'private-host').
 */
export function validatePreviewUrl(url) {
  if (typeof url !== 'string' || !url.trim()) {
    return { ok: false, reason: 'invalid-url' }
  }

  let parsed
  try {
    parsed = new URL(url.trim())
  } catch {
    return { ok: false, reason: 'invalid-url' }
  }

  // http(s) only — reject file:, data:, ftp:, javascript:, etc.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'bad-scheme' }
  }

  const host = parsed.hostname
  if (!host) {
    return { ok: false, reason: 'no-host' }
  }

  if (isPrivateHost(host)) {
    return { ok: false, reason: 'private-host' }
  }

  return { ok: true, url: parsed }
}

/**
 * Whether a hostname/address string points at a non-public range.
 *
 * Covers: localhost and *.localhost, `.local`/`.internal` suffixes, IPv4
 * literals in the loopback (127/8), private (10/8, 172.16/12, 192.168/16),
 * link-local (169.254/16), CGNAT (100.64/10), "this network" (0/8), and
 * broadcast (255.255.255.255) ranges; and IPv6 loopback (::1), unspecified
 * (::), unique-local (fc00::/7), link-local (fe80::/10), and IPv4-mapped
 * addresses whose embedded IPv4 is itself private.
 *
 * @param {string} host - hostname or IP literal (no brackets/port)
 * @returns {boolean}
 */
export function isPrivateHost(host) {
  const h = String(host).trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return true

  // Well-known internal names.
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h.endsWith('.local') || h.endsWith('.internal')) return true

  // IPv4 literal?
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    return isPrivateIpv4(h)
  }

  // IPv6 literal?
  if (h.includes(':')) {
    return isPrivateIpv6(h)
  }

  return false
}

/**
 * Whether a dotted-quad IPv4 literal falls in a non-routable range.
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIpv4(ip) {
  const parts = ip.split('.').map((n) => Number(n))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // Malformed → treat as unsafe (fail closed).
    return true
  }
  const [a, b] = parts

  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // 10.0.0.0/8 private
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a === 255 && b === 255 && parts[2] === 255 && parts[3] === 255) return true // broadcast

  return false
}

/**
 * Whether an IPv6 literal falls in a loopback/unspecified/private range.
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIpv6(ip) {
  const lower = ip.toLowerCase()

  if (lower === '::1') return true // loopback
  if (lower === '::' || lower === '::0') return true // unspecified

  // fc00::/7 unique-local (fc.. or fd..).
  if (/^f[cd][0-9a-f]{0,2}:/.test(lower)) return true
  // fe80::/10 link-local.
  if (/^fe[89ab][0-9a-f]?:/.test(lower)) return true

  // IPv4-mapped in dotted form (e.g. ::ffff:127.0.0.1) — check embedded IPv4.
  const dotted = lower.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (dotted) {
    return isPrivateIpv4(dotted[1])
  }

  // IPv4-mapped in hex form (e.g. ::ffff:7f00:1, as URL normalizes it) —
  // reconstruct the trailing IPv4 from the final two hextets and re-check.
  const mapped = lower.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mapped) {
    const hi = parseInt(mapped[1], 16)
    const lo = parseInt(mapped[2], 16)
    const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
    return isPrivateIpv4(ipv4)
  }

  return false
}

// --- OpenGraph / meta parsing -------------------------------------------------

/**
 * Extract preview metadata from an HTML document.
 *
 * Prefers OpenGraph properties (og:title, og:description, og:image) and falls
 * back to the standard <meta name="description"> and the <title> element.
 * Every field is independent: any that is absent comes back as `null` so the
 * caller (and ultimately the link card) degrades to favicon+domain rather than
 * erroring. Requirement 4.1 (title/description/image) and 4.5 (graceful
 * empties). Purely string work — no network, no DOM.
 *
 * @param {string} html - the fetched document (may be partial/truncated)
 * @returns {{ title: string|null, description: string|null, image: string|null }}
 */
export function parseOgTags(html) {
  if (typeof html !== 'string' || !html) {
    return { title: null, description: null, image: null }
  }

  const ogTitle = findMetaContent(html, 'og:title')
  const ogDesc = findMetaContent(html, 'og:description')
  const ogImage = findMetaContent(html, 'og:image')

  const title = ogTitle ?? findTitleTag(html)
  const description = ogDesc ?? findMetaNameContent(html, 'description')
  const image = ogImage

  return {
    title: emptyToNull(title),
    description: emptyToNull(description),
    image: emptyToNull(image),
  }
}

/**
 * Find the `content` of a `<meta property="...">` tag (OpenGraph style),
 * tolerating attribute order and single/double quotes.
 * @param {string} html
 * @param {string} property - e.g. 'og:title'
 * @returns {string|null}
 */
function findMetaContent(html, property) {
  const esc = escapeRegExp(property)
  // property before content, or content before property — try both orders.
  const patterns = [
    new RegExp(
      `<meta[^>]*\\bproperty\\s*=\\s*["']${esc}["'][^>]*\\bcontent\\s*=\\s*["']([^"']*)["']`,
      'i',
    ),
    new RegExp(
      `<meta[^>]*\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*\\bproperty\\s*=\\s*["']${esc}["']`,
      'i',
    ),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) return decodeEntities(m[1])
  }
  return null
}

/**
 * Find the `content` of a `<meta name="...">` tag, tolerating attribute order.
 * @param {string} html
 * @param {string} name - e.g. 'description'
 * @returns {string|null}
 */
function findMetaNameContent(html, name) {
  const esc = escapeRegExp(name)
  const patterns = [
    new RegExp(
      `<meta[^>]*\\bname\\s*=\\s*["']${esc}["'][^>]*\\bcontent\\s*=\\s*["']([^"']*)["']`,
      'i',
    ),
    new RegExp(
      `<meta[^>]*\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*\\bname\\s*=\\s*["']${esc}["']`,
      'i',
    ),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) return decodeEntities(m[1])
  }
  return null
}

/**
 * Extract the text of the first <title> element.
 * @param {string} html
 * @returns {string|null}
 */
function findTitleTag(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? decodeEntities(m[1].trim()) : null
}

/**
 * Decode the handful of HTML entities likely to appear in title/description
 * text. Not a full entity table — just the common named ones plus numeric.
 * @param {string} str
 * @returns {string}
 */
function decodeEntities(str) {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim()
}

/**
 * Normalize an empty/whitespace-only string to null.
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
function emptyToNull(value) {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed ? trimmed : null
}

/**
 * Escape a string for safe interpolation into a RegExp.
 * @param {string} str
 * @returns {string}
 */
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

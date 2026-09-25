// /api/link-preview — Rich link previews (volt-vault-polish A4)
//
// POST (owner-scoped, Bearer auth):
//   { url: '<http(s) url>' }
//     → fetch the target server-side, parse OpenGraph/meta, and return
//       { title, description, image } (any field may be null). On any failure
//       — blocked, timed out, non-2xx, non-HTML, oversized, or no metadata —
//       this degrades GRACEFULLY to { title: null, description: null,
//       image: null } with a 200, so the client can fall back to the
//       favicon+domain card without treating it as an error (Req 4.5).
//
// The endpoint never forwards the caller's Supabase session token to the
// third-party site (Req 4.4): auth is validated up front, then a fresh fetch
// is made with a minimal, generic header set. It reuses the pure SSRF guard
// and OG parser from lib/linkPreview.js (do NOT reimplement here) and the
// best-effort limiter from lib/rateLimit.js.
//
// This is intentionally the ONLY new serverless function for Track A; its
// helpers live in top-level lib/ to keep api/ under the Vercel Hobby-plan
// function-count limit (per the volt-reach deploy fix).

import { createClient } from '@supabase/supabase-js'
import { lookup as dnsLookup } from 'node:dns/promises'
import {
  validatePreviewUrl,
  isPrivateHost,
  parseOgTags,
  PREVIEW_TIMEOUT_MS,
  PREVIEW_MAX_BYTES,
} from '../lib/linkPreview.js'
import { rateLimit } from '../lib/rateLimit.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Per-owner preview limit (Req 4.7). Previews are fetched on save/first view of
// a link clip, so a modest burst is normal; this blunts scripted scraping
// through the endpoint. Best-effort, per-instance (see lib/rateLimit.js).
const PREVIEW_LIMIT = { limit: 30, windowMs: 60_000 }

// An empty, all-null preview. Returned (with 200) whenever we cannot produce
// metadata so the client uniformly falls back to favicon+domain (Req 4.5).
const EMPTY_PREVIEW = { title: null, description: null, image: null }

async function authenticate(req, res) {
  const authHeader = req.headers.authorization || req.headers.Authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) {
    res.status(401).json({ error: 'Authentication required' })
    return null
  }
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return null
  }
  return data.user.id
}

/**
 * Resolve the URL's hostname and confirm every resolved address is public.
 *
 * validatePreviewUrl already blocks literal private addresses and obvious
 * internal names, but a public-looking hostname can still resolve to a private
 * address (a DNS-rebinding / SSRF vector, e.g. a name pointed at 169.254.169.254).
 * This post-resolution recheck runs the resolved IP(s) back through the same
 * isPrivateHost guard. Fails closed: any resolution error → treat as unsafe.
 *
 * @param {string} hostname
 * @returns {Promise<boolean>} true when safe to fetch, false when it must be blocked
 */
async function resolvesToPublicAddress(hostname) {
  try {
    const results = await dnsLookup(hostname, { all: true })
    if (!results || results.length === 0) return false
    return results.every((r) => !isPrivateHost(r.address))
  } catch {
    return false
  }
}

/**
 * Fetch a validated URL with a hard timeout and a response-size cap, returning
 * the (possibly truncated) HTML body — or null if the target is unusable.
 *
 * Enforces PREVIEW_TIMEOUT_MS via an AbortController and reads at most
 * PREVIEW_MAX_BYTES from the body stream, aborting early once the cap is hit
 * (Req 4.6). Only text/html responses are parsed; anything else (a binary
 * asset, a non-2xx status) yields null so the caller degrades gracefully.
 * A generic User-Agent is sent and NO caller credentials (Req 4.4).
 *
 * @param {URL} url
 * @returns {Promise<string|null>}
 */
async function fetchHtml(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS)
  try {
    const resp = await fetch(url.href, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Generic, credential-free headers — never leak the caller's session.
        'User-Agent': 'VOLT-LinkPreview/1.0 (+https://clipvault-lilac.vercel.app)',
        Accept: 'text/html,application/xhtml+xml',
      },
    })

    if (!resp.ok) return null

    const contentType = resp.headers.get('content-type') || ''
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) return null

    if (!resp.body) {
      const text = await resp.text()
      return text.slice(0, PREVIEW_MAX_BYTES)
    }

    // Read the body incrementally, stopping at the byte cap (Req 4.6).
    const reader = resp.body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: false })
    let html = ''
    let received = 0
    while (received < PREVIEW_MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      html += decoder.decode(value, { stream: true })
    }
    // Cap reached (or stream ended): stop pulling more data.
    try {
      await reader.cancel()
    } catch {
      // ignore — already done
    }
    return html
  } catch {
    // Timeout (abort), network error, DNS failure, etc. → graceful null.
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function handlePreview(req, res, ownerId) {
  // Per-owner rate limit (Req 4.7).
  const rl = rateLimit(`preview:${ownerId}`, PREVIEW_LIMIT)
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec))
    return res.status(429).json({ error: 'Too many requests' })
  }

  const { url } = req.body || {}

  // SSRF guard: scheme + literal private ranges (Req 4.6). A rejected URL is a
  // client error (400), distinct from a fetch that simply yields no metadata.
  const check = validatePreviewUrl(url)
  if (!check.ok) {
    return res.status(400).json({ error: 'Invalid or disallowed URL' })
  }

  // Post-DNS-resolution recheck: block hostnames that resolve to a private
  // address (DNS-rebinding vector). A blocked target degrades to empty rather
  // than erroring, so the client still falls back cleanly (Req 4.5, 4.6).
  const safe = await resolvesToPublicAddress(check.url.hostname)
  if (!safe) {
    return res.status(200).json(EMPTY_PREVIEW)
  }

  const html = await fetchHtml(check.url)
  if (!html) {
    // Blocked / timed out / non-HTML / oversized — graceful empty (Req 4.5).
    return res.status(200).json(EMPTY_PREVIEW)
  }

  // parseOgTags always returns the { title, description, image } shape with
  // null for any absent field (Req 4.1, 4.5).
  return res.status(200).json(parseOgTags(html))
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    if (req.method === 'POST') {
      const ownerId = await authenticate(req, res)
      if (!ownerId) return // response already sent
      return await handlePreview(req, res, ownerId)
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

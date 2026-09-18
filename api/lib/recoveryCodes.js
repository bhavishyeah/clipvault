// VOLT — Pure recovery-code hashing & matching helpers
//
// Single source of truth for how backup (recovery) codes are generated,
// normalized, hashed, and compared. These functions have no Supabase or
// network dependencies so the hash/compare/mark-used state machine can be
// exercised in tests. The serverless endpoint (api/recovery-codes.js) imports
// these and layers the auth + persistence concerns on top.
//
// Hashing: node crypto `scryptSync` (memory-hard KDF) over the normalized
// plaintext code, keyed with a per-code random 16-byte salt and mixed with an
// optional server-side pepper (RECOVERY_CODE_PEPPER). The stored representation
// is the text `scrypt:<saltHex>:<hashHex>`. Because each code carries its own
// salt, verification recomputes the hash per candidate and compares in
// constant time. No plaintext code is ever stored.

import crypto from 'crypto'

export const CODE_COUNT = 10
const SCRYPT_KEYLEN = 32
const PEPPER = process.env.RECOVERY_CODE_PEPPER || ''

// scrypt cost (N) — the memory/CPU work factor. Defaults to node's secure
// default (16384). Read lazily per call so tests can lower it via
// RECOVERY_CODE_SCRYPT_COST (a power of two) to keep property runs fast without
// weakening the production hashing. The cost is embedded in the salt segment of
// the stored string so verification always recomputes with the matching cost.
function scryptCost() {
  const raw = Number(process.env.RECOVERY_CODE_SCRYPT_COST)
  return Number.isInteger(raw) && raw >= 2 && (raw & (raw - 1)) === 0 ? raw : 16384
}

// Human-friendly, unambiguous alphabet (no 0/O/1/I) for readable codes.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

// Generate one cryptographically-random code formatted as XXXXX-XXXXX.
export function generateCode() {
  const chars = []
  // 10 significant characters using rejection-free modulo over random bytes
  // drawn from a 256-value space; ALPHABET length (31) evenly-ish maps and the
  // slight modulo bias is immaterial for a 10-of-31^10 keyspace.
  const bytes = crypto.randomBytes(10)
  for (let i = 0; i < 10; i++) {
    chars.push(ALPHABET[bytes[i] % ALPHABET.length])
  }
  return `${chars.slice(0, 5).join('')}-${chars.slice(5, 10).join('')}`
}

// Generate exactly `count` distinct plaintext codes (default 10).
export function generateCodes(count = CODE_COUNT) {
  const codes = new Set()
  while (codes.size < count) {
    codes.add(generateCode())
  }
  return [...codes]
}

// Normalize user input so display formatting (case, spacing, dashes) does not
// affect matching. Only alphanumerics are significant.
export function normalizeCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

// Derive the stored representation for a plaintext code with a fresh salt. The
// work factor is captured in the string so verification recomputes with the
// exact cost the hash was created under: `scrypt:<cost>:<saltHex>:<hashHex>`.
export function hashCode(code) {
  const salt = crypto.randomBytes(16)
  const cost = scryptCost()
  const derived = crypto.scryptSync(normalizeCode(code) + PEPPER, salt, SCRYPT_KEYLEN, { N: cost })
  return `scrypt:${cost}:${salt.toString('hex')}:${derived.toString('hex')}`
}

// Constant-time check of a plaintext code against a stored
// `scrypt:<cost>:<saltHex>:<hashHex>`.
export function matchesHash(code, stored) {
  if (typeof stored !== 'string') return false
  const parts = stored.split(':')
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false
  const cost = Number(parts[1])
  if (!Number.isInteger(cost) || cost < 2 || (cost & (cost - 1)) !== 0) return false
  const salt = Buffer.from(parts[2], 'hex')
  const expected = Buffer.from(parts[3], 'hex')
  if (salt.length === 0 || expected.length === 0) return false
  let derived
  try {
    derived = crypto.scryptSync(normalizeCode(code) + PEPPER, salt, expected.length, { N: cost })
  } catch {
    return false
  }
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected)
}

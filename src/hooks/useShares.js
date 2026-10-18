import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { toast } from '../components/ui/toastStore'
import { trackEvent } from '../lib/analytics'

const SHARE_ENDPOINT = '/api/share'

// Grab the current session's access token for authenticating api/ calls.
async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token ?? null
}

// A share is usable when it has not been revoked and has not expired.
function isActive(share, now = Date.now()) {
  if (!share) return false
  if (share.revoked_at) return false
  if (share.expires_at && new Date(share.expires_at).getTime() <= now) return false
  return true
}

// Build a clip_id -> share map from a list of share rows, keeping only the
// still-active ones. Later duplicates for the same clip overwrite earlier ones,
// but the server reuses a single active share per clip so this is rarely hit.
function mapByClipId(rows, now = Date.now()) {
  const map = {}
  for (const row of rows ?? []) {
    if (isActive(row, now)) map[row.clip_id] = row
  }
  return map
}

/**
 * useShares — owner-scoped management of public share links (volt-reach).
 *
 * Mirrors the useClips(user) signature: pass the signed-in user and the hook
 * loads that owner's active shares on mount (RLS scopes the query to the
 * caller). Exposes create/revoke actions that call POST /api/share with a
 * Bearer token and keep a local clip_id -> share map so clip cards can show
 * shared state without a round-trip.
 *
 * @param {{ id: string }|null|undefined} user
 * @returns {{
 *   sharesByClipId: Record<string, object>,
 *   loading: boolean,
 *   busy: boolean,
 *   getShare: (clipId: string) => object|null,
 *   createShare: (clip: { id: string }) => Promise<{ token, url, expires_at }|null>,
 *   revokeShare: (token: string) => Promise<boolean>,
 * }}
 */
export function useShares(user) {
  const [sharesByClipId, setSharesByClipId] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // --- Load the owner's active shares on mount ---
  // Owners can SELECT their own shares directly (RLS: "owners read own
  // shares"), so the authenticated anon client returns exactly this owner's
  // rows. Filter out revoked/expired client-side and index by clip_id.
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!user) {
        if (!cancelled) {
          setSharesByClipId({})
          setLoading(false)
        }
        return
      }

      const { data, error } = await supabase
        .from('shares')
        .select('token, clip_id, expires_at, revoked_at, created_at')
        .is('revoked_at', null)

      if (cancelled) return

      if (error) {
        console.error('Could not load shares:', error.message)
        toast('Failed to load shares', 'error')
      } else {
        setSharesByClipId(mapByClipId(data))
      }
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [user])

  // --- Accessor: the active share for a clip, or null ---
  const getShare = useCallback(
    (clipId) => sharesByClipId[clipId] ?? null,
    [sharesByClipId]
  )

  // --- Create (or reuse) a public share for an owned clip ---
  const createShare = useCallback(async (clip) => {
    if (!clip?.id || !user) return null

    const accessToken = await getAccessToken()
    if (!accessToken) {
      toast('Session expired', 'error')
      return null
    }

    setBusy(true)
    try {
      const res = await fetch(SHARE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: 'create', clipId: clip.id }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        toast(data.error || 'Failed to create share link', 'error')
        return null
      }

      const share = {
        token: data.token,
        clip_id: clip.id,
        url: data.url,
        expires_at: data.expires_at,
        revoked_at: null,
      }
      setSharesByClipId((prev) => ({ ...prev, [clip.id]: share }))
      trackEvent('share_create')

      return { token: data.token, url: data.url, expires_at: data.expires_at }
    } catch (err) {
      toast('Failed to create share link', 'error')
      console.error('Could not create share:', err.message)
      return null
    } finally {
      setBusy(false)
    }
  }, [user])

  // --- Revoke an existing share by token ---
  const revokeShare = useCallback(async (token) => {
    if (!token || !user) return false

    const accessToken = await getAccessToken()
    if (!accessToken) {
      toast('Session expired', 'error')
      return false
    }

    setBusy(true)
    try {
      const res = await fetch(SHARE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: 'revoke', token }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        toast(data.error || 'Failed to revoke share link', 'error')
        return false
      }

      // Drop the matching share from local state.
      setSharesByClipId((prev) => {
        const next = {}
        for (const [clipId, share] of Object.entries(prev)) {
          if (share.token !== token) next[clipId] = share
        }
        return next
      })
      trackEvent('share_revoke')

      return true
    } catch (err) {
      toast('Failed to revoke share link', 'error')
      console.error('Could not revoke share:', err.message)
      return false
    } finally {
      setBusy(false)
    }
  }, [user])

  return {
    sharesByClipId,
    loading,
    busy,
    getShare,
    createShare,
    revokeShare,
  }
}

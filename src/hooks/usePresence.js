import { useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'

const HEARTBEAT_INTERVAL = 30000 // 30 seconds
const DEVICE = /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop'

export function usePresence(user) {
  const heartbeatRef = useRef(null)

  const setOnline = useCallback(async () => {
    if (!user) return

    const { error } = await supabase
      .from('presence')
      .upsert({
        user_id: user.id,
        status: 'online',
        device: DEVICE,
        last_seen: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (error) console.error('Presence update failed:', error.message)
  }, [user])

  const setOffline = useCallback(async () => {
    if (!user) return

    await supabase
      .from('presence')
      .update({
        status: 'offline',
        last_seen: new Date().toISOString(),
      })
      .eq('user_id', user.id)
  }, [user])

  useEffect(() => {
    if (!user) return

    // Go online immediately
    setOnline()

    // Heartbeat — keep updating last_seen
    heartbeatRef.current = window.setInterval(setOnline, HEARTBEAT_INTERVAL)

    // Handle visibility change (tab hidden/shown)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setOnline()
      } else {
        setOffline()
      }
    }

    // Handle before unload (tab/window close)
    const handleBeforeUnload = () => {
      // Best effort offline signal using sendBeacon
      navigator.sendBeacon?.(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/presence?user_id=eq.${user.id}`)
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.clearInterval(heartbeatRef.current)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      setOffline()
    }
  }, [user, setOnline, setOffline])
}

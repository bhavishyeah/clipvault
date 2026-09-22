import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { toast } from '../components/ui/toastStore'
import { trackEvent } from '../lib/analytics'

// Pure mapping from an incoming direct-transfer row to the clip insert payload.
// This is the single source of truth for how a saved-to-vault clip is shaped:
// `saveToVault` calls it and inserts the returned object (plus `user_id`).
//
// For image/file/audio transfers, the recorded file fields are copied into a
// Cloudinary-shaped metadata object matching useClips.saveFile
// ({ provider:'cloudinary', secure_url, name, bytes, mime, ... }) so the saved
// clip matches the transfer (Req 5.3, 5.6). Text/link transfers keep the
// existing empty-metadata behavior.
export function transferToClip(transfer) {
  const hasFile =
    transfer.type === 'image' || transfer.type === 'file' || transfer.type === 'audio'

  const metadata = hasFile
    ? {
        provider: 'cloudinary',
        secure_url: transfer.file_url || null,
        name: transfer.file_name || null,
        bytes: transfer.file_size ?? null,
        mime: transfer.mime_type || null,
      }
    : {}

  return {
    type: transfer.type,
    content: transfer.content,
    metadata,
  }
}

export function useDirectSend(user) {
  const [incoming, setIncoming] = useState([])
  const [contacts, setContacts] = useState([])
  const [sending, setSending] = useState(false)

  // Fetch all pending incoming transfers and enrich with sender profiles.
  // Extracted so it can be called on mount, on demand, and from the poll
  // interval — ensuring recipients see new transfers even when the Realtime
  // socket drops (e.g. Android tab backgrounded).
  const loadIncoming = useCallback(async () => {
    if (!user) return

    const { data, error } = await supabase
      .from('direct_transfers')
      .select('*')
      .eq('recipient_id', user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Could not load incoming transfers:', error.message, error.code)
      return
    }
    if (!data) return

    // Enrich with sender display names.
    const senderIds = [...new Set(data.map((t) => t.sender_id))]
    const { data: senderProfiles } = senderIds.length > 0
      ? await supabase.from('profiles').select('id, username, display_name').in('id', senderIds)
      : { data: [] }

    const senderMap = {}
    senderProfiles?.forEach((p) => { senderMap[p.id] = p })

    setIncoming(data.map((t) => ({ ...t, sender: senderMap[t.sender_id] || null })))
  }, [user])

  // Load contacts on mount.
  useEffect(() => {
    if (!user) return
    let cancelled = false

    const loadContacts = async () => {
      const { data: contactData } = await supabase
        .from('contacts')
        .select('contact_id')
        .eq('user_id', user.id)

      if (cancelled || !contactData || contactData.length === 0) return

      const ids = contactData.map((c) => c.contact_id)
      const [{ data: profileData }, { data: presenceData }] = await Promise.all([
        supabase.from('profiles').select('id, username, display_name').in('id', ids),
        supabase.from('presence').select('user_id, status, device').in('user_id', ids),
      ])
      if (cancelled) return

      const presenceMap = {}
      presenceData?.forEach((p) => { presenceMap[p.user_id] = p })

      setContacts((profileData || []).map((p) => ({
        id: p.id,
        username: p.username,
        display_name: p.display_name,
        presence: presenceMap[p.id] || { status: 'offline', device: 'unknown' },
      })).filter((c) => c.username))
    }

    loadContacts()
    return () => { cancelled = true }
  }, [user])

  // Load incoming transfers on mount, subscribe to live inserts via Realtime,
  // AND poll every 5 s as a fallback so transfers appear even when the
  // Realtime socket is disconnected (common on mobile when the tab is
  // backgrounded or the network switches).
  useEffect(() => {
    if (!user) return

    let cancelled = false

    // Defer the initial load off the synchronous effect body to satisfy the
    // react-hooks/set-state-in-effect rule.
    const init = async () => {
      if (!cancelled) await loadIncoming()
    }
    init()

    // Polling fallback — re-fetch the full pending list every 5 s.
    const pollInterval = setInterval(() => {
      if (!cancelled) loadIncoming()
    }, 5000)

    // Realtime fast path — fires immediately when the socket is live.
    const channel = supabase
      .channel('direct-transfers')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_transfers',
          filter: `recipient_id=eq.${user.id}`,
        },
        async (payload) => {
          const { data: sender } = await supabase
            .from('profiles')
            .select('username, display_name')
            .eq('id', payload.new.sender_id)
            .single()

          const enriched = { ...payload.new, sender }
          setIncoming((prev) => {
            // Dedupe: the poll may already have added this row.
            if (prev.some((t) => t.id === enriched.id)) return prev
            return [enriched, ...prev]
          })
          toast(`New from @${sender?.username || 'unknown'}`)
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      clearInterval(pollInterval)
      supabase.removeChannel(channel)
    }
  }, [user, loadIncoming])

  // Search users by username
  const searchUsers = useCallback(async (query) => {
    if (!query || query.length < 2) return []

    const normalized = query.replace(/^@/, '').toLowerCase()

    const { data } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .ilike('username', `%${normalized}%`)
      .neq('id', user?.id)
      .limit(5)

    if (!data) return []

    // Fetch presence
    const userIds = data.map((u) => u.id)
    const { data: presenceData } = await supabase
      .from('presence')
      .select('user_id, status, device')
      .in('user_id', userIds)

    const presenceMap = {}
    presenceData?.forEach((p) => { presenceMap[p.user_id] = p })

    return data.map((u) => ({
      ...u,
      presence: presenceMap[u.id] || { status: 'offline', device: 'unknown' },
      isContact: contacts.some((c) => c.id === u.id),
    }))
  }, [user, contacts])

  // Add contact
  const addContact = useCallback(async (contactUser) => {
    const { error } = await supabase.from('contacts').insert({
      user_id: user.id,
      contact_id: contactUser.id,
    })

    if (error) {
      if (error.message.includes('duplicate')) toast('Already in contacts', 'info')
      else toast('Failed to add contact', 'error')
      return
    }

    setContacts((prev) => [...prev, {
      id: contactUser.id,
      username: contactUser.username,
      display_name: contactUser.display_name,
      presence: contactUser.presence || { status: 'offline', device: 'unknown' },
    }])
    toast(`@${contactUser.username} added to contacts`)
  }, [user])

  // Remove contact
  const removeContact = useCallback(async (contactId) => {
    await supabase.from('contacts').delete().eq('user_id', user.id).eq('contact_id', contactId)
    setContacts((prev) => prev.filter((c) => c.id !== contactId))
    toast('Contact removed')
  }, [user])

  // Send content to a user.
  // `type` is one of text | link | image | file | audio. For image/file/audio
  // transfers, `fileData` is an UploadDescriptor from the shared Upload_Service
  // ({ secure_url, resource_type, bytes, format, mime, name }); its file fields
  // are recorded on the transfer row (Req 5.1, 5.2, 5.3). Text/link transfers
  // pass no fileData and leave the file_* columns null.
  const sendTo = useCallback(async (recipientId, type, content, fileData) => {
    if (!user) return false

    setSending(true)

    const hasFile = type === 'image' || type === 'file' || type === 'audio'

    try {
      const { error } = await supabase.from('direct_transfers').insert({
        sender_id: user.id,
        recipient_id: recipientId,
        type,
        content: content || null,
        file_url: hasFile ? fileData?.secure_url || null : null,
        file_name: hasFile ? fileData?.name || null : null,
        file_size: hasFile ? fileData?.bytes ?? null : null,
        mime_type: hasFile ? fileData?.mime || null : null,
        status: 'pending',
      })

      if (error) throw new Error(error.message)

      toast('Sent!')
      trackEvent(type === 'image' ? 'send_image' : hasFile ? 'send_file' : 'send_text')
      return true
    } catch (err) {
      // Surface the actual error message so DB constraint violations are visible
      const msg = err.message || 'Failed to send'
      toast(msg.includes('violates') || msg.includes('constraint')
        ? `Send failed: ${msg}` : 'Failed to send', 'error')
      console.error('Direct send error:', msg)
      return false
    } finally {
      setSending(false)
    }
  }, [user])

  // Mark transfer as delivered
  const markDelivered = useCallback(async (transferId) => {
    await supabase
      .from('direct_transfers')
      .update({ status: 'delivered', delivered_at: new Date().toISOString() })
      .eq('id', transferId)

    setIncoming((prev) => prev.filter((t) => t.id !== transferId))
  }, [])

  // Save incoming transfer to vault. The clip payload (type/content/metadata)
  // is produced by the pure `transferToClip` helper so the file-field mapping
  // has a single source of truth (Req 5.3, 5.6).
  const saveToVault = useCallback(async (transfer) => {
    const { error } = await supabase.from('clips').insert({
      user_id: user.id,
      ...transferToClip(transfer),
    })

    if (error) {
      toast('Failed to save', 'error')
    } else {
      toast('Saved to vault')
      trackEvent('save_from_transfer')
      await markDelivered(transfer.id)
    }
  }, [user, markDelivered])

  // Dismiss transfer
  const dismissTransfer = useCallback(async (transfer) => {
    await markDelivered(transfer.id)
    toast('Dismissed')
  }, [markDelivered])

  return {
    incoming,
    contacts,
    sending,
    searchUsers,
    sendTo,
    addContact,
    removeContact,
    saveToVault,
    dismissTransfer,
    loadIncoming,
  }
}

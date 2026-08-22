import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { toast } from '../components/ui/toastStore'

export function useDirectSend(user) {
  const [incoming, setIncoming] = useState([])
  const [contacts, setContacts] = useState([])
  const [sending, setSending] = useState(false)

  // Load contacts + incoming transfers on mount
  useEffect(() => {
    if (!user) return

    const loadData = async () => {
      // Load contacts with profile + presence info
      const { data: contactData } = await supabase
        .from('contacts')
        .select('contact_id, profiles:contact_id(id, username, display_name)')
        .eq('user_id', user.id)

      if (contactData) {
        // Fetch presence for contacts
        const ids = contactData.map((c) => c.contact_id)
        const { data: presenceData } = ids.length > 0
          ? await supabase.from('presence').select('user_id, status, device').in('user_id', ids)
          : { data: [] }

        const presenceMap = {}
        presenceData?.forEach((p) => { presenceMap[p.user_id] = p })

        setContacts(contactData.map((c) => ({
          id: c.contact_id,
          username: c.profiles?.username,
          display_name: c.profiles?.display_name,
          presence: presenceMap[c.contact_id] || { status: 'offline', device: 'unknown' },
        })).filter((c) => c.username)) // Filter out any broken entries
      }

      // Load pending incoming transfers
      const { data: transferData } = await supabase
        .from('direct_transfers')
        .select('*')
        .eq('recipient_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (transferData) {
        // Enrich with sender info
        const senderIds = [...new Set(transferData.map((t) => t.sender_id))]
        const { data: senderProfiles } = senderIds.length > 0
          ? await supabase.from('profiles').select('id, username, display_name').in('id', senderIds)
          : { data: [] }

        const senderMap = {}
        senderProfiles?.forEach((p) => { senderMap[p.id] = p })

        setIncoming(transferData.map((t) => ({ ...t, sender: senderMap[t.sender_id] || null })))
      }
    }

    loadData()

    // Subscribe to new incoming transfers (realtime)
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
          setIncoming((prev) => [enriched, ...prev])
          toast(`New from @${sender?.username || 'unknown'}`)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user])

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

  // Send content to a user
  const sendTo = useCallback(async (recipientId, type, content, fileData) => {
    if (!user) return false

    setSending(true)

    try {
      const { error } = await supabase.from('direct_transfers').insert({
        sender_id: user.id,
        recipient_id: recipientId,
        type,
        content: content || null,
        file_url: fileData?.url || null,
        file_name: fileData?.name || null,
        file_size: fileData?.size || null,
        mime_type: fileData?.mime || null,
        status: 'pending',
      })

      if (error) throw new Error(error.message)

      toast('Sent!')
      return true
    } catch (err) {
      toast('Failed to send', 'error')
      console.error('Direct send error:', err.message)
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

  // Save incoming transfer to vault
  const saveToVault = useCallback(async (transfer) => {
    const { error } = await supabase.from('clips').insert({
      user_id: user.id,
      type: transfer.type,
      content: transfer.content,
      metadata: transfer.file_url ? { provider: 'direct_send', secure_url: transfer.file_url } : {},
    })

    if (error) {
      toast('Failed to save', 'error')
    } else {
      toast('Saved to vault')
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
  }
}

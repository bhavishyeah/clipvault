import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { toast } from '../components/ui/toastStore'

export function useDirectSend(user) {
  const [incoming, setIncoming] = useState([])
  const [sending, setSending] = useState(false)

  // Load pending incoming transfers
  useEffect(() => {
    if (!user) return

    const loadIncoming = async () => {
      const { data } = await supabase
        .from('direct_transfers')
        .select('*, sender:profiles!direct_transfers_sender_id_fkey(username, display_name)')
        .eq('recipient_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (data) setIncoming(data)
    }

    loadIncoming()

    // Subscribe to new incoming transfers
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
          // Fetch sender info
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
      .neq('id', user?.id) // Don't show self
      .limit(5)

    if (!data) return []

    // Fetch presence for each result
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
    }))
  }, [user])

  // Send content to a user
  const sendTo = useCallback(async (recipientId, type, content, fileData) => {
    if (!user) return false

    setSending(true)

    try {
      const insertData = {
        sender_id: user.id,
        recipient_id: recipientId,
        type,
        content: content || null,
        file_url: fileData?.url || null,
        file_name: fileData?.name || null,
        file_size: fileData?.size || null,
        mime_type: fileData?.mime || null,
        status: 'pending',
      }

      const { error } = await supabase.from('direct_transfers').insert(insertData)

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

  // Dismiss (mark delivered without saving)
  const dismissTransfer = useCallback(async (transfer) => {
    await markDelivered(transfer.id)
    toast('Dismissed')
  }, [markDelivered])

  return {
    incoming,
    sending,
    searchUsers,
    sendTo,
    saveToVault,
    dismissTransfer,
  }
}

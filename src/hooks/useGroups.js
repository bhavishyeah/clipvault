import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { toast } from '../components/ui/toastStore'
import { trackEvent } from '../lib/analytics'
import { validateGroupName, canSendToGroup } from '../lib/group'
import { validateFile, SIZE_LIMITS } from '../lib/fileType'

// VOLT — Groups hook (Feature 3: group sharing)
//
// Manages the groups the current user belongs to, their membership, and their
// messages. Follows the same conventions as useClips / useDirectSend:
// optimistic insert with rollback, Supabase Realtime postgres_changes channels,
// toast notifications, and trackEvent analytics. Pure gates (name validation,
// send-permission by member count, file size) live in src/lib/group.js and
// src/lib/fileType.js; this hook performs the side-effecting Supabase calls and
// holds the group/message state.
//
// Row Level Security enforces the authoritative rules — non-owners cannot
// delete a group, non-members cannot read or send messages. The hook applies
// the same rules optimistically for UX and rolls back when RLS rejects.

// Is a Supabase error a unique-constraint (duplicate PK) violation? Postgres
// reports code 23505; the message also mentions "duplicate".
function isUniqueViolation(error) {
  if (!error) return false
  return error.code === '23505' || /duplicate/i.test(error.message || '')
}

export function useGroups(user) {
  const [groups, setGroups] = useState([])
  const [messagesByGroup, setMessagesByGroup] = useState({})
  const [loading, setLoading] = useState(true)

  // --- Load the user's groups on mount (Req 11.3) ---
  // The async body defers setState off the synchronous effect body and uses a
  // cancelled guard so a stale load never writes state after unmount / user
  // change (mirrors the useMfa pattern; satisfies react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!user) {
        if (!cancelled) {
          setGroups([])
          setLoading(false)
        }
        return
      }

      // Groups the user is a member of. RLS restricts group_members to the
      // caller's own memberships plus fellow-member reads, so selecting the
      // caller's rows yields exactly their groups.
      const { data: memberships, error } = await supabase
        .from('group_members')
        .select('group_id, role, groups(id, name, owner_id, created_at)')
        .eq('user_id', user.id)

      if (cancelled) return

      if (error) {
        console.error('Could not load groups:', error.message)
        toast('Failed to load groups', 'error')
        setLoading(false)
        return
      }

      const list = (memberships ?? [])
        .filter((m) => m.groups)
        .map((m) => ({
          id: m.groups.id,
          name: m.groups.name,
          owner_id: m.groups.owner_id,
          created_at: m.groups.created_at,
          role: m.role,
          isOwner: m.groups.owner_id === user.id,
        }))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

      setGroups(list)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [user])

  // --- Load a group's existing messages (history) (Req 14.2, 14.3) ---
  // The live subscription (below) only delivers rows inserted AFTER it is
  // established; opening a thread must show what already exists. Callers invoke
  // this when a thread opens. Errors leave the cached messages untouched.
  const loadMessages = useCallback(async (groupId) => {
    if (!groupId) return

    const { data, error } = await supabase
      .from('group_messages')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Could not load group messages:', error.message)
      return
    }

    setMessagesByGroup((prev) => ({ ...prev, [groupId]: data ?? [] }))
  }, [])

  // --- Session-long Realtime subscription for ALL of the user's groups ---
  // Mirrors the useClips `clips-live` / useDirectSend `direct-transfers`
  // pattern: one channel established at hook mount for the whole session, with
  // a cancelled guard and removeChannel cleanup. This is the fan-out mechanism
  // (design: "single Group_Message row + subscription fan-out") — a member
  // receives a group's messages regardless of which thread (if any) is open.
  //
  // A client-side postgres_changes filter can only scope a single group_id, but
  // a user may belong to many groups, so we subscribe WITHOUT a group_id filter.
  // RLS on group_messages already restricts delivered rows to groups the caller
  // is a member of, so no cross-group leakage occurs. The handler routes each
  // row into messagesByGroup[payload.new.group_id], deduping by message id.
  useEffect(() => {
    if (!user) return undefined

    let cancelled = false

    const channel = supabase
      .channel('group-messages-live')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_messages',
        },
        (payload) => {
          if (cancelled) return
          const gid = payload.new.group_id
          setMessagesByGroup((prev) => {
            const existing = prev[gid] ?? []
            // Avoid duplicating a message already present (e.g. optimistic echo).
            if (existing.some((m) => m.id === payload.new.id)) return prev
            return { ...prev, [gid]: [...existing, payload.new] }
          })
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [user])

  // --- Create a group + owner membership, optimistic with rollback (Req 11.1, 11.2) ---
  const createGroup = useCallback(async (name) => {
    if (!user) return null

    const trimmed = (typeof name === 'string' ? name : '').trim()
    const check = validateGroupName(trimmed)
    if (!check.ok) {
      toast(
        check.reason === 'too_long'
          ? 'Group name must be 100 characters or fewer'
          : 'Enter a group name',
        'error'
      )
      return null
    }

    // Optimistic add.
    const tempId = `temp-${Date.now()}`
    const optimistic = {
      id: tempId,
      name: trimmed,
      owner_id: user.id,
      created_at: new Date().toISOString(),
      role: 'owner',
      isOwner: true,
    }
    setGroups((prev) => [optimistic, ...prev])

    // Insert the group first so we have its id for the owner membership.
    const { data: created, error: groupErr } = await supabase
      .from('groups')
      .insert({ name: trimmed, owner_id: user.id })
      .select('id, name, owner_id, created_at')
      .single()

    if (groupErr || !created) {
      setGroups((prev) => prev.filter((g) => g.id !== tempId))
      toast('Failed to create group', 'error')
      console.error('Could not create group:', groupErr?.message)
      return null
    }

    // Insert the creator's owner membership (Req 11.1).
    const { error: memberErr } = await supabase.from('group_members').insert({
      group_id: created.id,
      user_id: user.id,
      role: 'owner',
    })

    if (memberErr) {
      // Roll back: remove the just-created group (cascades membership if any).
      await supabase.from('groups').delete().eq('id', created.id)
      setGroups((prev) => prev.filter((g) => g.id !== tempId))
      toast('Failed to create group', 'error')
      console.error('Could not create owner membership:', memberErr.message)
      return null
    }

    // Replace the optimistic temp entry with the persisted group.
    const real = {
      id: created.id,
      name: created.name,
      owner_id: created.owner_id,
      created_at: created.created_at,
      role: 'owner',
      isOwner: true,
    }
    setGroups((prev) => prev.map((g) => (g.id === tempId ? real : g)))
    toast('Group created')
    trackEvent('group_create')
    return real
  }, [user])

  // --- Delete a group (owner-only; RLS rejects non-owner) optimistic + rollback (Req 11.5, 11.6) ---
  const deleteGroup = useCallback(async (groupId) => {
    const removed = groups.find((g) => g.id === groupId)
    if (!removed) return

    setGroups((prev) => prev.filter((g) => g.id !== groupId))

    // RLS "owner deletes group" allows only the owner; a non-owner delete
    // affects zero rows. Detect that and treat it as a rejection.
    const { error, count } = await supabase
      .from('groups')
      .delete({ count: 'exact' })
      .eq('id', groupId)

    if (error || count === 0) {
      setGroups((prev) => [removed, ...prev])
      toast(
        error ? 'Failed to delete group' : 'Only the group owner can delete this group',
        'error'
      )
      if (error) console.error('Could not delete group:', error.message)
      return
    }

    // Drop cached messages for the removed group.
    setMessagesByGroup((prev) => {
      if (!(groupId in prev)) return prev
      const next = { ...prev }
      delete next[groupId]
      return next
    })
    toast('Group deleted')
    trackEvent('group_delete')
  }, [groups])

  // --- Add a member (owner-only, profile-required, dup-guarded) (Req 12.1, 12.2, 12.3) ---
  const addMember = useCallback(async (groupId, memberUser) => {
    if (!user || !memberUser?.id) return false

    // A user must have a profile to be added (Req 12.2).
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', memberUser.id)
      .maybeSingle()

    if (!profile) {
      toast('That user needs a VOLT account first', 'error')
      return false
    }

    const { error } = await supabase.from('group_members').insert({
      group_id: groupId,
      user_id: memberUser.id,
      role: 'member',
    })

    if (error) {
      // Duplicate membership is guarded by the composite PK (Req 12.3).
      if (isUniqueViolation(error)) {
        toast(`@${memberUser.username || 'user'} is already a member`, 'info')
      } else {
        toast('Failed to add member', 'error')
        console.error('Could not add member:', error.message)
      }
      return false
    }

    toast(`@${memberUser.username || 'member'} added`)
    trackEvent('group_add_member')
    return true
  }, [user])

  // --- Remove a member (owner-only) (Req 12.4) ---
  const removeMember = useCallback(async (groupId, userId) => {
    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', userId)

    if (error) {
      toast('Failed to remove member', 'error')
      console.error('Could not remove member:', error.message)
      return false
    }

    toast('Member removed')
    trackEvent('group_remove_member')
    return true
  }, [])

  // --- Leave a group (member self-leave; owner blocked) (Req 12.5, 12.6) ---
  const leaveGroup = useCallback(async (groupId) => {
    if (!user) return false

    const group = groups.find((g) => g.id === groupId)
    // Owner cannot leave — they must transfer or delete instead (Req 12.6).
    if (group?.owner_id === user.id) {
      toast('Transfer or delete the group instead', 'error')
      return false
    }

    const removed = group
    setGroups((prev) => prev.filter((g) => g.id !== groupId))

    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', user.id)

    if (error) {
      if (removed) setGroups((prev) => [removed, ...prev])
      toast('Failed to leave group', 'error')
      console.error('Could not leave group:', error.message)
      return false
    }

    setMessagesByGroup((prev) => {
      if (!(groupId in prev)) return prev
      const next = { ...prev }
      delete next[groupId]
      return next
    })
    toast('You left the group')
    trackEvent('group_leave')
    return true
  }, [user, groups])

  // --- Fetch current members with profiles (Req 15.3) ---
  const members = useCallback(async (groupId) => {
    const { data, error } = await supabase
      .from('group_members')
      .select('user_id, role, joined_at')
      .eq('group_id', groupId)

    if (error) {
      console.error('Could not load members:', error.message)
      return []
    }

    const rows = data ?? []
    if (rows.length === 0) return []

    // Enrich with profile info (username / display name).
    const ids = rows.map((r) => r.user_id)
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .in('id', ids)

    const profileMap = {}
    profiles?.forEach((p) => { profileMap[p.id] = p })

    return rows.map((r) => ({
      user_id: r.user_id,
      role: r.role,
      joined_at: r.joined_at,
      username: profileMap[r.user_id]?.username ?? null,
      display_name: profileMap[r.user_id]?.display_name ?? null,
    }))
  }, [])

  // --- Send one message to a group (Req 14.1, 14.4, 14.5, 14.6) ---
  // Returns { ok: true } on success, or { ok: false, error } on failure so the
  // caller can retain the composed content (Req 14.6).
  const sendToGroup = useCallback(async (groupId, type, content, fileData) => {
    if (!user) return { ok: false, error: 'Not signed in' }

    // Block sends to a group with no members to receive them (Req 13.5).
    const { count: memberCount } = await supabase
      .from('group_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('group_id', groupId)

    if (!canSendToGroup(memberCount ?? 0)) {
      toast('This group has no members to receive the item', 'error')
      return { ok: false, error: 'no_members' }
    }

    // Size gate for file/audio before any store (Req 14.5). The uploaded
    // fileData is produced by uploadFile; re-check the reported size here so a
    // send never stores a row for an oversize asset.
    if (type === 'file' || type === 'audio') {
      const size = fileData?.size ?? fileData?.bytes
      const mime = fileData?.mime ?? fileData?.mime_type
      const check = validateFile({ type: mime, size })
      if (!check.ok) {
        toast(
          check.reason === 'too_large'
            ? `File exceeds the ${check.limit === SIZE_LIMITS.audio ? '10' : '15'} MB limit`
            : 'File is empty',
          'error'
        )
        return { ok: false, error: 'too_large' }
      }
    }

    // Insert exactly one group_messages row (Req 14.1). RLS "members send
    // messages" rejects non-members (Req 14.4). Select the inserted row back so
    // we can echo it optimistically into the thread — the session-long realtime
    // handler dedupes by id, so this never double-appends.
    const { data: inserted, error } = await supabase
      .from('group_messages')
      .insert({
        group_id: groupId,
        sender_id: user.id,
        type,
        content: content || null,
        file_url: fileData?.url ?? fileData?.secure_url ?? null,
        file_name: fileData?.name ?? null,
        file_size: fileData?.size ?? fileData?.bytes ?? null,
        mime_type: fileData?.mime ?? fileData?.mime_type ?? null,
      })
      .select()
      .single()

    if (error) {
      // Retain composed content (Req 14.6); do not clear the input.
      toast('Send did not complete', 'error')
      console.error('Could not send to group:', error.message)
      return { ok: false, error: error.message }
    }

    // Optimistic echo: the sender sees their own message immediately without
    // waiting for a realtime round-trip. Dedupe by id so the realtime INSERT
    // handler does not append a second copy of the same row.
    if (inserted) {
      setMessagesByGroup((prev) => {
        const existing = prev[groupId] ?? []
        if (existing.some((m) => m.id === inserted.id)) return prev
        return { ...prev, [groupId]: [...existing, inserted] }
      })
    }

    trackEvent('group_send')
    return { ok: true }
  }, [user])

  // --- Open a group's thread: load its message history (Req 14.2) ---
  // Live INSERTs are already delivered by the session-long channel above (which
  // stays subscribed for the whole session regardless of which thread is open),
  // so this no longer opens a per-group channel. It simply fetches the existing
  // messages when a thread mounts and returns a no-op cleanup, preserving the
  // GroupThread contract (it calls onSubscribe(groupId) on mount and invokes the
  // returned cleanup on unmount) without tearing down the session-long channel.
  const subscribeGroup = useCallback((groupId) => {
    loadMessages(groupId)
    return () => {}
  }, [loadMessages])

  return {
    groups,
    messagesByGroup,
    loading,
    createGroup,
    deleteGroup,
    addMember,
    removeMember,
    leaveGroup,
    members,
    sendToGroup,
    subscribeGroup,
    loadMessages,
  }
}

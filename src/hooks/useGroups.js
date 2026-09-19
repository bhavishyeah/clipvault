import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { toast } from '../components/ui/toastStore'
import { trackEvent } from '../lib/analytics'
import { validateGroupName } from '../lib/group'
import { validateFile, SIZE_LIMITS } from '../lib/fileType'

// VOLT — Groups hook (send-only distribution lists)
//
// A group is simply a named set of members. There is NO chat, NO threads, NO
// realtime, and NO message history. Sending to a group fans the item out to
// each OTHER member's Incoming inbox by inserting one direct_transfers row per
// recipient (tagged with the group name), then the caller shows a single
// confirmation toast.
//
// The hook manages the groups the current user belongs to plus their
// membership (create / delete / add / remove / leave / members) and performs
// the fan-out send. Pure gates (name validation, file size) live in
// src/lib/group.js and src/lib/fileType.js. Row Level Security enforces the
// authoritative rules — non-owners cannot delete a group, and the
// direct_transfers insert policy (WITH CHECK auth.uid() = sender_id) allows the
// sender to insert the multi-row fan-out.

// Is a Supabase error a unique-constraint (duplicate PK) violation? Postgres
// reports code 23505; the message also mentions "duplicate".
function isUniqueViolation(error) {
  if (!error) return false
  return error.code === '23505' || /duplicate/i.test(error.message || '')
}

export function useGroups(user) {
  const [groups, setGroups] = useState([])
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

  // --- Send one item to a group by fanning it out to each member's Incoming ---
  // A group is a distribution list: sending inserts ONE direct_transfers row per
  // OTHER member (the sender is excluded), all tagged with `group.name` so the
  // recipient's Incoming card can show which group it came from. The file (if
  // any) was uploaded once by the caller, so every row shares the same file_url
  // — no re-upload. All rows are inserted in a single round-trip; the
  // direct_transfers insert policy (WITH CHECK auth.uid() = sender_id) permits
  // the multi-row insert since the sender owns every row.
  //
  // `group` is the full group object ({ id, name, ... }) so we have group.name
  // for the tag. Returns { ok: true, count } on success or { ok: false, error }
  // on failure so the caller can retain the composed content.
  const sendToGroup = useCallback(async (group, type, content, fileData) => {
    if (!user) return { ok: false, error: 'Not signed in' }
    if (!group?.id) return { ok: false, error: 'no_group' }

    // Load the group's members and exclude the current user — a send only goes
    // to OTHER people. A group with no other members has nobody to receive it.
    const { data: memberRows, error: memberErr } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', group.id)

    if (memberErr) {
      toast('Send did not complete', 'error')
      console.error('Could not load group members for send:', memberErr.message)
      return { ok: false, error: memberErr.message }
    }

    const recipientIds = (memberRows ?? [])
      .map((r) => r.user_id)
      .filter((id) => id !== user.id)

    if (recipientIds.length === 0) {
      toast('This group has no other members to send to', 'error')
      return { ok: false, error: 'no_members' }
    }

    // Size gate for file/audio before any store. The uploaded fileData is
    // produced by uploadFile; re-check the reported size here so a send never
    // stores rows for an oversize asset.
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

    // One row template fanned out across every recipient. All rows share the
    // same file fields (single prior upload) and the group_name tag.
    const rows = recipientIds.map((recipientId) => ({
      sender_id: user.id,
      recipient_id: recipientId,
      type,
      content: content || null,
      file_url: fileData?.secure_url ?? fileData?.url ?? null,
      file_name: fileData?.name ?? null,
      file_size: fileData?.bytes ?? fileData?.size ?? null,
      mime_type: fileData?.mime ?? fileData?.mime_type ?? null,
      status: 'pending',
      group_name: group.name,
    }))

    const { error } = await supabase.from('direct_transfers').insert(rows)

    if (error) {
      toast('Send did not complete', 'error')
      console.error('Could not send to group:', error.message)
      return { ok: false, error: error.message }
    }

    toast(`Sent successfully to all ${rows.length} member${rows.length === 1 ? '' : 's'}`)
    trackEvent('group_send')
    return { ok: true, count: rows.length }
  }, [user])

  return {
    groups,
    loading,
    createGroup,
    deleteGroup,
    addMember,
    removeMember,
    leaveGroup,
    members,
    sendToGroup,
  }
}

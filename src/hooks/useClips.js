import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { toast } from '../components/ui/toastStore'

const SUPABASE_BUCKET = 'clips'
const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

const isUrl = (text) =>
  /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(text)

function sortClips(list) {
  return [...list].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
    return new Date(b.created_at) - new Date(a.created_at)
  })
}

async function resolveUrl(clip) {
  if (clip.metadata?.provider === 'cloudinary') {
    return { ...clip, url: clip.metadata.secure_url }
  }
  if (!clip.file_path) return clip

  const { data } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .createSignedUrl(clip.file_path, 3600)

  return { ...clip, url: data?.signedUrl ?? null }
}

function attachFileUrls(rows) {
  return Promise.all(rows.map(resolveUrl))
}

export function useClips(user) {
  const [clips, setClips] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const channelRef = useRef(null)

  // --- Full refresh (used for manual refresh only) ---
  const refresh = useCallback(async () => {
    if (!user) return

    const { data, error } = await supabase
      .from('clips')
      .select('*')
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Could not load clips:', error.message)
      toast('Failed to load clips', 'error')
    } else {
      setClips(await attachFileUrls(data ?? []))
    }

    setLoading(false)
  }, [user])

  // --- Setup: initial load + Realtime subscription ---
  useEffect(() => {
    if (!user) return

    let cancelled = false

    const loadInitial = async () => {
      const { data, error } = await supabase
        .from('clips')
        .select('*')
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false })

      if (cancelled) return

      if (error) {
        console.error('Could not load clips:', error.message)
        toast('Failed to load clips', 'error')
      } else {
        setClips(await attachFileUrls(data ?? []))
      }
      setLoading(false)
    }

    loadInitial()

    const channel = supabase
      .channel('clips-live')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'clips',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          const enriched = await resolveUrl(payload.new)
          setClips((prev) => {
            if (prev.some((c) => c.id === enriched.id)) return prev
            return sortClips([enriched, ...prev])
          })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'clips',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          const enriched = await resolveUrl(payload.new)
          setClips((prev) =>
            sortClips(prev.map((c) => (c.id === enriched.id ? enriched : c)))
          )
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'clips',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          setClips((prev) => prev.filter((c) => c.id !== payload.old.id))
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [user])

  // --- Save text (optimistic) ---
  const saveText = useCallback(async (rawText) => {
    const content = rawText.trim()
    if (!content || !user) return

    setSaving(true)

    const type = isUrl(content) ? 'link' : 'text'
    const optimistic = {
      id: `temp-${Date.now()}`,
      user_id: user.id,
      type,
      content,
      metadata: {},
      is_pinned: false,
      created_at: new Date().toISOString(),
    }

    setClips((prev) => sortClips([optimistic, ...prev]))

    const { error } = await supabase.from('clips').insert({
      user_id: user.id,
      type,
      content,
    })

    if (error) {
      setClips((prev) => prev.filter((c) => c.id !== optimistic.id))
      toast('Failed to save clip', 'error')
      console.error('Could not save text:', error.message)
    } else {
      toast(`${type === 'link' ? 'Link' : 'Text'} saved`)
    }

    setSaving(false)
  }, [user])

  // --- Save image ---
  const saveImage = useCallback(async (blob) => {
    if (!user) return

    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
      toast('Image upload not configured', 'error')
      return
    }

    setSaving(true)

    try {
      const formData = new FormData()
      formData.append('file', blob)
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET)
      formData.append('folder', `clipvault/${user.id}`)

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
        { method: 'POST', body: formData }
      )

      const uploaded = await response.json()

      if (!response.ok) {
        throw new Error(uploaded.error?.message || 'Cloudinary upload failed')
      }

      const { error } = await supabase.from('clips').insert({
        user_id: user.id,
        type: 'image',
        metadata: {
          provider: 'cloudinary',
          secure_url: uploaded.secure_url,
          public_id: uploaded.public_id,
          resource_type: uploaded.resource_type,
          format: uploaded.format,
          bytes: uploaded.bytes,
          width: uploaded.width,
          height: uploaded.height,
          mime: blob.type,
        },
      })

      if (error) throw new Error(error.message)

      toast('Image saved')
    } catch (err) {
      toast('Failed to upload image', 'error')
      console.error('Could not save image:', err.message)
    } finally {
      setSaving(false)
    }
  }, [user])

  // --- Remove clip (optimistic) ---
  const removeClip = useCallback(async (clip) => {
    setClips((prev) => prev.filter((c) => c.id !== clip.id))

    const { error } = await supabase.from('clips').delete().eq('id', clip.id)

    if (error) {
      setClips((prev) => sortClips([...prev, clip]))
      toast('Failed to delete clip', 'error')
      console.error('Could not delete clip:', error.message)
      return
    }

    if (clip.file_path && clip.metadata?.provider !== 'cloudinary') {
      await supabase.storage.from(SUPABASE_BUCKET).remove([clip.file_path])
    }

    // TODO: Delete Cloudinary asset server-side (requires secure backend endpoint)

    toast('Clip deleted')
  }, [])

  // --- Toggle pin (optimistic) ---
  const togglePin = useCallback(async (clip) => {
    const updated = { ...clip, is_pinned: !clip.is_pinned }
    setClips((prev) => sortClips(prev.map((c) => (c.id === clip.id ? updated : c))))

    const { error } = await supabase
      .from('clips')
      .update({ is_pinned: !clip.is_pinned })
      .eq('id', clip.id)

    if (error) {
      setClips((prev) => sortClips(prev.map((c) => (c.id === clip.id ? clip : c))))
      toast('Failed to update pin', 'error')
      console.error('Could not update pin:', error.message)
    }
  }, [])

  return {
    clips,
    loading,
    saving,
    saveText,
    saveImage,
    removeClip,
    togglePin,
    refresh,
  }
}

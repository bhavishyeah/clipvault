import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const SUPABASE_BUCKET = 'clips'
const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

const isUrl = (text) =>
  /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(text)

export function useClips(user) {
  const [clips, setClips] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const attachFileUrls = async (rows) =>
    Promise.all(
      rows.map(async (clip) => {
        if (clip.metadata?.provider === 'cloudinary') {
          return { ...clip, url: clip.metadata.secure_url }
        }

        if (!clip.file_path) return clip

        const { data } = await supabase.storage
          .from(SUPABASE_BUCKET)
          .createSignedUrl(clip.file_path, 60 * 60)

        return { ...clip, url: data?.signedUrl ?? null }
      })
    )

  const fetchClips = useCallback(async () => {
    if (!user) return

    const { data, error } = await supabase
      .from('clips')
      .select('*')
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })

    if (!error) setClips(await attachFileUrls(data ?? []))
    else console.error('Could not load clips:', error.message)

    setLoading(false)
  }, [user])

  useEffect(() => {
    fetchClips()

    const channel = supabase
      .channel('clips-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'clips' },
        fetchClips
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchClips])

  const saveText = async (rawText) => {
    const content = rawText.trim()
    if (!content || !user) return

    setSaving(true)

    const { error } = await supabase.from('clips').insert({
      user_id: user.id,
      type: isUrl(content) ? 'link' : 'text',
      content,
    })

    if (error) console.error('Could not save text:', error.message)

    await fetchClips()
    setSaving(false)
  }

  const saveImage = async (blob) => {
    if (!user) return

    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
      console.error('Missing Cloudinary environment variables')
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
    } catch (error) {
      console.error('Could not save image:', error.message)
    } finally {
      await fetchClips()
      setSaving(false)
    }
  }

  const removeClip = async (clip) => {
    const { error } = await supabase.from('clips').delete().eq('id', clip.id)

    if (error) {
      console.error('Could not delete clip:', error.message)
      return
    }

    if (clip.file_path && clip.metadata?.provider !== 'cloudinary') {
      await supabase.storage.from(SUPABASE_BUCKET).remove([clip.file_path])
    }

    await fetchClips()
  }

  const togglePin = async (clip) => {
    const { error } = await supabase
      .from('clips')
      .update({ is_pinned: !clip.is_pinned })
      .eq('id', clip.id)

    if (error) console.error('Could not update pin:', error.message)
    await fetchClips()
  }

  return {
    clips,
    loading,
    saving,
    saveText,
    saveImage,
    removeClip,
    togglePin,
    refresh: fetchClips,
  }
}
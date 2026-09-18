import { useRef, useState } from 'react'
import { IconUpload } from '../ui/Icons'
import { toast } from '../ui/toastStore'
import FileCard from '../ui/FileCard'
import { canSendToGroup } from '../../lib/group'
import { uploadFile, SizeError } from '../../lib/uploadFile'
import { classifyFile, validateFile, humanSize } from '../../lib/fileType'

// VOLT — GroupComposer (Feature 3: group sharing)
//
// A lightweight composer for sending one message to a group. It mirrors the
// direct SendComposer's attach/upload flow: text/link are sent as-is, while a
// picked file is size-gated with `validateFile`, uploaded through the shared
// `uploadFile` service (which normalizes the Cloudinary response into an
// UploadDescriptor), and then delivered via `onSend` — the Dashboard wires
// useGroups.sendToGroup here (Req 14.1, 14.5).
//
// On failure the composed content is retained (the composer stays populated);
// on success the inputs are cleared. A zero-member group cannot receive a send,
// so the controls are disabled and a hint is shown (Req 13.5).
//
// Props:
//   group   - the selected group ({ id, name, memberCount, ... })
//   userId  - current user id (for the upload folder path)
//   onSend  - async (groupId, type, content, fileData) => { ok, error }

const isUrl = (text) => /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(text)

const ACCEPT = 'image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip'

export default function GroupComposer({ group, userId, onSend }) {
  const [content, setContent] = useState('')
  const [attachment, setAttachment] = useState(null)
  const [sending, setSending] = useState(false)
  const fileRef = useRef(null)

  const memberCount = Number.isFinite(group?.memberCount) ? group.memberCount : 0
  const sendable = canSendToGroup(memberCount)

  const clearAttachment = () => {
    setAttachment((prev) => {
      if (prev?.preview) URL.revokeObjectURL(prev.preview)
      return null
    })
  }

  // Gate the selection on `validateFile` BEFORE upload, retaining composer state.
  const handleFilePick = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const check = validateFile({ type: file.type, size: file.size })
    if (!check.ok) {
      toast(
        check.reason === 'too_large' ? `Too large — max ${humanSize(check.limit)}` : 'File is empty',
        'error'
      )
      return
    }

    const kind = classifyFile(file.type)
    if (attachment?.preview) URL.revokeObjectURL(attachment.preview)
    setAttachment({
      file,
      kind,
      preview: kind === 'image' ? URL.createObjectURL(file) : null,
    })
  }

  const handleSend = async () => {
    if (!sendable) { toast('This group has no members to receive the item', 'error'); return }
    if (!content.trim() && !attachment) { toast('Add content to send', 'error'); return }

    setSending(true)
    try {
      let type = 'text'
      let finalContent = content.trim()
      let fileData = null

      if (attachment) {
        type = attachment.kind
        try {
          fileData = await uploadFile(attachment.file, { userId })
          finalContent = null
        } catch (err) {
          const message = err instanceof SizeError ? err.message : 'Upload failed — check your connection'
          toast(message, 'error')
          return
        }
      } else if (isUrl(finalContent)) {
        type = 'link'
      }

      const result = await onSend(group.id, type, finalContent, fileData)
      if (result?.ok) {
        // Clear on success; retain content on failure (Req 14.6).
        setContent('')
        clearAttachment()
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="group-composer">
      {attachment ? (
        attachment.kind === 'image' ? (
          <div className="send-image-preview">
            <img src={attachment.preview} alt="To send" />
            <button onClick={clearAttachment} className="send-remove-image">Remove</button>
          </div>
        ) : (
          <div className="send-file-preview">
            <FileCard kind={attachment.kind} name={attachment.file.name} size={attachment.file.size} />
            <button onClick={clearAttachment} className="send-remove-image">Remove</button>
          </div>
        )
      ) : (
        <textarea
          className="group-composer-input"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onPaste={(e) => e.stopPropagation()}
          placeholder={sendable ? 'Message the group…' : 'Add members before sending'}
          rows={2}
          maxLength={10000}
          disabled={!sendable}
        />
      )}

      <div className="group-composer-actions">
        {!attachment && (
          <button className="send-attach" onClick={() => fileRef.current?.click()} disabled={!sendable}>
            <IconUpload width="14" height="14" /> Attach
          </button>
        )}
        <input ref={fileRef} type="file" accept={ACCEPT} onChange={handleFilePick} hidden />
        <button
          className="send-button group-composer-send"
          onClick={handleSend}
          disabled={sending || !sendable || (!content.trim() && !attachment)}
        >
          {sending ? 'Sending…' : `Send to ${memberCount} member${memberCount === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}

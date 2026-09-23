import { useEffect, useRef, useState } from 'react'
import { IconUpload } from '../ui/Icons'
import { toast } from '../ui/toastStore'
import FileCard from '../ui/FileCard'
import { uploadFile, SizeError } from '../../lib/uploadFile'
import { classifyFile } from '../../lib/fileType'

// VOLT — GroupSendPanel (send-only distribution lists)
//
// A modal for sending one item to a group. A group is just a named set of
// members; there is NO chat/thread/history. The panel has two steps:
//   STEP 1 — pick a group (or create one). Existing groups list with their
//            member counts; owners get a lightweight "Manage" trigger.
//   STEP 2 — compose (mirrors SendComposer): textarea for text/link plus an
//            Attach button (size-gated), then a "Send to N members" button.
//            On send, any attachment is uploaded once and then handed to
//            sendToGroup, which fans it out to each member's Incoming. The hook
//            fires the success toast; on success the panel closes, on failure
//            it stays open with the composed content retained.
//
// Props:
//   onClose           () => void
//   groups            array of { id, name, isOwner?, memberCount?, ... }
//   onCreateGroup     () => void — opens the create modal
//   onManageGroup     (group) => void — optional, opens member management
//   sendToGroup       async (group, type, content, fileData) => { ok, count }
//   userId            current user id (for the upload folder path)
//   groupMemberCounts optional map of groupId -> member count

const isUrl = (text) => /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(text)

// Broad picker scope for images, audio, and common document types.
const ACCEPT = 'image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip'
const GROUP_FILE_INPUT_ID = 'group-send-file-input'

export default function GroupSendPanel({
  onClose,
  groups = [],
  onCreateGroup,
  onManageGroup,
  sendToGroup,
  userId,
  groupMemberCounts,
}) {
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [content, setContent] = useState('')
  const [attachment, setAttachment] = useState(null)
  const [sending, setSending] = useState(false)
  const fileInputRef = useRef(null)
  const previewUrlRef = useRef(null)

  // Close on Escape only when no send/upload is using the selected file.
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' && !sending) onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, sending])

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
  }, [])

  // Resolve a group's member count from the injected map (preferred) or the
  // group object's own memberCount; undefined when unknown so we can omit it.
  const countFor = (group) => {
    if (groupMemberCounts && group.id in groupMemberCounts) return groupMemberCounts[group.id]
    if (Number.isFinite(group.memberCount)) return group.memberCount
    return undefined
  }

  const selectedCount = selectedGroup ? countFor(selectedGroup) ?? 0 : 0

  const clearAttachment = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = null
    setAttachment(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const backToList = () => {
    clearAttachment()
    setContent('')
    setSelectedGroup(null)
  }

  const handleFilePick = (event) => {
    const file = event.currentTarget.files?.[0]
    if (!file) return

    const kind = classifyFile(file.type || 'application/octet-stream')
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)

    let preview = null
    if (kind === 'image') {
      try {
        preview = URL.createObjectURL(file)
      } catch {
        // The file remains sendable and falls back to the FileCard preview.
      }
    }

    previewUrlRef.current = preview
    // Preserve the selected File synchronously; do not clear the owning input
    // until Remove/success, because Android content:// access can be lazy.
    setAttachment({ file, kind, preview })
  }

  const handleSend = async () => {
    if (!selectedGroup) return
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

      // The hook fires the success toast and fans out to every member.
      const result = await sendToGroup(selectedGroup, type, finalContent, fileData)
      if (result?.ok) {
        clearAttachment()
        onClose()
      }
      // On failure the panel stays open with content retained.
    } finally {
      setSending(false)
    }
  }

  return (
    // Overlay click-to-close removed — on Android Chrome, the native file
    // picker bottom sheet fires a synthetic click on the document when it
    // closes, which hits the overlay and dismisses the modal before the file
    // is processed. Close is handled by the × button and Escape only.
    <div className="confirm-overlay">
      <div
        className="send-composer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-send-title"
      >
        {!selectedGroup ? (
          // STEP 1 — pick a group
          <>
            <div className="send-header">
              <h3 id="group-send-title">Send to group</h3>
              <button className="send-close" title="Close" onClick={onClose} disabled={sending}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <button className="send-attach group-send-new" onClick={onCreateGroup}>
              + New group
            </button>

            {groups.length === 0 ? (
              <p className="group-send-empty">
                No groups yet. Create one to send to several people at once.
              </p>
            ) : (
              <ul className="group-send-list" aria-label="Your groups">
                {groups.map((group) => {
                  const count = countFor(group)
                  return (
                    <li key={group.id} className="group-send-row">
                      <button
                        type="button"
                        className="group-send-pick"
                        onClick={() => setSelectedGroup(group)}
                      >
                        <span className="group-send-name">{group.name}</span>
                        {count !== undefined && (
                          <span className="group-send-count">
                            {count} member{count === 1 ? '' : 's'}
                          </span>
                        )}
                      </button>
                      {group.isOwner && onManageGroup && (
                        <button
                          type="button"
                          className="group-send-manage"
                          onClick={() => onManageGroup(group)}
                          aria-label={`Manage members of ${group.name}`}
                        >
                          Manage
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        ) : (
          // STEP 2 — compose for the selected group
          <>
            <div className="send-header">
              <button
                type="button"
                className="group-send-back"
                onClick={backToList}
                aria-label="Back to group list"
                disabled={sending}
              >
                ← {selectedGroup.name}
              </button>
              <button className="send-close" title="Close" onClick={onClose} disabled={sending}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="send-content-area">
              {attachment ? (
                attachment.kind === 'image' && attachment.preview ? (
                  <div className="send-image-preview">
                    <img src={attachment.preview} alt="To send" />
                    <button onClick={clearAttachment} className="send-remove-image" disabled={sending}>Remove</button>
                  </div>
                ) : (
                  <div className="send-file-preview">
                    <FileCard kind={attachment.kind} name={attachment.file.name} size={attachment.file.size} />
                    <button onClick={clearAttachment} className="send-remove-image" disabled={sending}>Remove</button>
                  </div>
                )
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onPaste={(e) => e.stopPropagation()}
                  placeholder="Paste text, link, or attach a file..."
                  rows={3}
                  maxLength={10000}
                />
              )}
              {!attachment && (
                <label
                  htmlFor={GROUP_FILE_INPUT_ID}
                  className="send-attach"
                  aria-disabled={sending}
                  style={{
                    cursor: sending ? 'not-allowed' : 'pointer',
                    pointerEvents: sending ? 'none' : 'auto',
                    opacity: sending ? 0.5 : 1,
                  }}
                >
                  <IconUpload width="14" height="14" /> Attach
                </label>
              )}
              <input ref={fileInputRef} id={GROUP_FILE_INPUT_ID} type="file" accept={ACCEPT} onChange={handleFilePick} disabled={sending} hidden aria-hidden="true" />
            </div>

            <button
              className="send-button"
              onClick={handleSend}
              disabled={sending || (!content.trim() && !attachment)}
            >
              {sending ? 'Sending...' : `Send to ${selectedCount} member${selectedCount === 1 ? '' : 's'}`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

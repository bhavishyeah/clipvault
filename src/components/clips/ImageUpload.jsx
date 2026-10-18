import { useState } from 'react'
import { toast } from '../ui/toastStore'
import { IconUpload } from '../ui/Icons'

const MAX_SIZE = 15 * 1024 * 1024 // 15MB
const INPUT_ID = 'vault-file-upload'

export default function ImageUpload({ onImage, saving }) {
  const [dragOver, setDragOver] = useState(false)

  const handleFileChange = async (event) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return

    if (file.size > MAX_SIZE) {
      toast('File must be under 15MB', 'error')
      input.value = ''
      return
    }

    // Keep the native input populated until the Android content-backed File
    // has been consumed. Clearing it first can revoke a lazy content:// grant.
    try {
      await onImage(file)
    } finally {
      input.value = ''
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (file.size > MAX_SIZE) {
      toast('File must be under 15MB', 'error')
      return
    }
    onImage(file)
  }

  return (
    <label
      htmlFor={INPUT_ID}
      className={`image-upload-zone ${dragOver ? 'drag-over' : ''}`}
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      aria-label="Upload a file"
      style={{ cursor: saving ? 'not-allowed' : 'pointer' }}
    >
      {/* Native label/input activation avoids a programmatic click and keeps
          the selected Android content-backed File owned by this input until
          handleFileChange finishes consuming it. */}
      <input
        id={INPUT_ID}
        type="file"
        accept="image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
        onChange={handleFileChange}
        disabled={saving}
        hidden
        aria-hidden="true"
      />

      <div className="image-upload-content">
        <span className="image-upload-icon"><IconUpload /></span>
        <div>
          <p className="image-upload-label">
            {saving ? 'Uploading…' : 'Upload file'}
          </p>
          <p className="image-upload-hint">
            Drop any file here or tap to browse. Max 15MB.
          </p>
        </div>
      </div>
    </label>
  )
}

import { useRef, useState } from 'react'
import { toast } from '../ui/toastStore'
import { IconUpload } from '../ui/Icons'

const MAX_SIZE = 15 * 1024 * 1024 // 15MB

export default function ImageUpload({ onImage, saving }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  const validateAndUpload = (file) => {
    if (!file) return

    if (file.size > MAX_SIZE) {
      toast('File must be under 15MB', 'error')
      return
    }

    onImage(file)
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    validateAndUpload(file)
    // Reset so the same file can be selected again
    e.target.value = ''
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)

    const file = e.dataTransfer.files?.[0]
    validateAndUpload(file)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => setDragOver(false)

  return (
    <div
      className={`image-upload-zone ${dragOver ? 'drag-over' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label="Upload a file"
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
        onChange={handleFileChange}
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
    </div>
  )
}

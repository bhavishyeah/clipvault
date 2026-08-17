import { useRef, useState } from 'react'
import { toast } from '../ui/toastStore'
import { IconUpload } from '../ui/Icons'

const ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png']
const MAX_SIZE = 10 * 1024 * 1024 // 10MB

export default function ImageUpload({ onImage, saving }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  const validateAndUpload = (file) => {
    if (!file) return

    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast('Only JPG and PNG images are supported', 'error')
      return
    }

    if (file.size > MAX_SIZE) {
      toast('Image must be under 10MB', 'error')
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
      aria-label="Upload an image"
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png"
        onChange={handleFileChange}
        hidden
        aria-hidden="true"
      />

      <div className="image-upload-content">
        <span className="image-upload-icon"><IconUpload /></span>
        <div>
          <p className="image-upload-label">
            {saving ? 'Uploading…' : 'Upload image'}
          </p>
          <p className="image-upload-hint">
            Drop an image here or tap to browse. JPG/PNG, max 10MB.
          </p>
        </div>
      </div>
    </div>
  )
}

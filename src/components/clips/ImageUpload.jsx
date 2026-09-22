import { useState } from 'react'
import { toast } from '../ui/toastStore'
import { IconUpload } from '../ui/Icons'

const MAX_SIZE = 15 * 1024 * 1024 // 15MB
const INPUT_ID = 'vault-file-upload'

export default function ImageUpload({ onImage, saving }) {
  const [dragOver, setDragOver] = useState(false)

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    // Reset input so the same file can be re-selected
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_SIZE) {
      toast('File must be under 15MB', 'error')
      return
    }
    onImage(file)
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
      {/* Native file input — linked via label htmlFor so the browser opens the
          picker without a JS .click() call, avoiding the Android PWA reload bug
          where programmatic .click() triggers a popstate/navigation event that
          the Service Worker intercepts and resets the page. */}
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

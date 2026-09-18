import { humanSize } from '../../lib/fileType'
import { IconDownload } from './Icons'

// Presentational card for `file` / `audio` clips and transfers.
// Renders a kind-specific icon, the file name, the human-readable size, and a
// download control. When no URL is available the control is disabled and an
// "Unavailable" label is shown.
function IconAudio(props) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  )
}

function IconDocument(props) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  )
}

export default function FileCard({ kind = 'file', name, size, url }) {
  const isAudio = kind === 'audio'
  const displayName = name || 'Untitled file'
  const readableSize = humanSize(size)

  return (
    <div className="file-card">
      <div className="file-card-icon" aria-hidden="true">
        {isAudio ? <IconAudio /> : <IconDocument />}
      </div>

      <div className="file-card-info">
        <p className="file-card-name" title={displayName}>{displayName}</p>
        <span className="file-card-size">{readableSize}</span>
      </div>

      {url ? (
        <a
          className="file-card-download"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          download
          aria-label={`Download ${displayName} (${readableSize})`}
        >
          <IconDownload />
        </a>
      ) : (
        <button
          type="button"
          className="file-card-download is-disabled"
          disabled
          aria-disabled="true"
          aria-label={`${displayName} is unavailable for download`}
        >
          <span className="file-card-unavailable">Unavailable</span>
        </button>
      )}
    </div>
  )
}

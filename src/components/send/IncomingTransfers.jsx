import { IconDownload, IconExternalLink } from '../ui/Icons'
import FileCard from '../ui/FileCard'
import { isDataImage, isImageUrl, unwrapImageUrl } from '../../lib/ingestImage'

// A shared "send" can arrive as plain text that is really a URL or an image.
// Browsers that "share an image" from a web page often hand over either:
//   1. a link to the image (e.g. a Google `imgres` redirect URL), or
//   2. a `data:image/...;base64,...` URI that IS the image, encoded as text.
// We detect both so the recipient gets a usable action instead of a raw string.
// Detection of the data:image and image-URL cases is shared with the ingest
// path (lib/ingestImage) so "Save to vault" and the preview stay in agreement.

// Broader than isImageUrl: also matches bare domains (no scheme) so the
// "Open link" affordance appears for any URL-shaped content.
const isUrl = (text) =>
  typeof text === 'string' && /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(text.trim())

// Resolve a link for "Open link": unwrap Google imgres wrappers to the real
// image, and ensure a scheme so window.open navigates correctly.
const resolveUrl = (raw) => {
  const unwrapped = unwrapImageUrl(raw)
  return /^https?:\/\//i.test(unwrapped) ? unwrapped : `https://${unwrapped.trim()}`
}

const openInNewTab = (url) => window.open(url, '_blank', 'noopener,noreferrer')

export default function IncomingTransfers({ transfers, onSaveToVault, onDismiss }) {
  if (transfers.length === 0) return null

  return (
    <section className="incoming-section">
      <h3 className="incoming-title">Incoming</h3>
      <div className="incoming-list">
        {transfers.map((t) => {
          const hasFile = (t.type === 'image' && t.file_url) || t.type === 'file' || t.type === 'audio'
          const dataImage = !hasFile && isDataImage(t.content)
          // An image-looking URL (after unwrapping) will be ingested as a real
          // image clip on save — surface that with the "image" badge too.
          const imageUrl = !hasFile && !dataImage && isImageUrl(unwrapImageUrl(t.content))
          const linkish = !hasFile && !dataImage && (t.type === 'link' || isUrl(t.content))

          return (
            <div key={t.id} className="incoming-card">
              <div className="incoming-header">
                <span className="incoming-from">
                  From <strong>@{t.sender?.username || 'unknown'}</strong>
                  {t.group_name && (
                    <span className="incoming-group-badge" title={`Sent to the ${t.group_name} group`}>
                      👥 {t.group_name}
                    </span>
                  )}
                </span>
                <span className="incoming-type">{dataImage || imageUrl ? 'image' : t.type}</span>
              </div>

              {t.type === 'image' && t.file_url ? (
                <div className="incoming-image-wrap">
                  <img src={t.file_url} alt="Received" loading="lazy" />
                </div>
              ) : t.type === 'file' || t.type === 'audio' ? (
                <FileCard kind={t.type} name={t.file_name} size={t.file_size} url={t.file_url} />
              ) : dataImage ? (
                <div className="incoming-image-wrap">
                  <img src={t.content} alt="Received" loading="lazy" />
                </div>
              ) : linkish ? (
                <p className="incoming-content incoming-link" title={t.content}>{t.content}</p>
              ) : (
                <p className="incoming-content">{t.content}</p>
              )}

              <div className="incoming-actions">
                <button onClick={() => onSaveToVault(t)}>Save to vault</button>

                {t.type === 'image' && t.file_url && (
                  <a href={t.file_url} target="_blank" rel="noopener noreferrer" className="incoming-download">
                    <IconDownload /> Open
                  </a>
                )}

                {dataImage && (
                  <button
                    className="incoming-download"
                    onClick={() => {
                      const win = window.open()
                      if (win) win.document.write(`<img src="${t.content}" style="max-width:100%">`)
                    }}
                  >
                    <IconExternalLink /> Open image
                  </button>
                )}

                {linkish && (
                  <button className="incoming-download" onClick={() => openInNewTab(resolveUrl(t.content))}>
                    <IconExternalLink /> Open link
                  </button>
                )}

                <button className="incoming-dismiss" onClick={() => onDismiss(t)}>Dismiss</button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

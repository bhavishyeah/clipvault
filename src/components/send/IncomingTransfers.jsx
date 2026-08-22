import { IconDownload } from '../ui/Icons'

export default function IncomingTransfers({ transfers, onSaveToVault, onDismiss }) {
  if (transfers.length === 0) return null

  return (
    <section className="incoming-section">
      <h3 className="incoming-title">Incoming</h3>
      <div className="incoming-list">
        {transfers.map((t) => (
          <div key={t.id} className="incoming-card">
            <div className="incoming-header">
              <span className="incoming-from">
                From <strong>@{t.sender?.username || 'unknown'}</strong>
              </span>
              <span className="incoming-type">{t.type}</span>
            </div>

            {t.type === 'image' && t.file_url ? (
              <div className="incoming-image-wrap">
                <img src={t.file_url} alt="Received" loading="lazy" />
              </div>
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
              <button className="incoming-dismiss" onClick={() => onDismiss(t)}>Dismiss</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

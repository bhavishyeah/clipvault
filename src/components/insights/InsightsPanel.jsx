import { useMemo } from 'react'
import { getInsights } from '../../lib/analytics'
import {
  IconVault, IconText, IconLink, IconImage, IconCopy, IconTrash,
  IconEdit, IconSearch,
} from '../ui/Icons'

// VOLT — Usage insights view (Feature A7)
//
// A small, honest "your vault so far" panel opened from the user menu. It reads
// the local, PII-free counters shaped by `getInsights` in `lib/analytics.js`
// and renders them as simple counts. It NEVER recomputes analytics itself.
//
// Honesty (Requirement 7.3): the underlying store keeps only LIFETIME counters
// with no per-event history, so `getInsights` returns `window: 'lifetime'`.
// This view is labelled "your vault so far" — NOT "this week" — so we never
// misrepresent lifetime totals as a rolling window.
//
// Low-data (Requirement 7.5): when `lowData` is true there is not enough signal
// to present as insight, so we show a friendly encouragement state rather than
// a wall of misleading zeros.
//
// Privacy (Requirement 7.4): everything shown is a local integer counter. No
// clip content, no identifiers, no PII.
//
// Requirements: 7.1, 7.4, 7.5

export default function InsightsPanel({ onClose }) {
  // Snapshot the counters once when the panel opens. Insights are a summary,
  // not a live feed, so a stable read for the lifetime of the modal is fine.
  const view = useMemo(() => getInsights(), [])

  const saveRows = [
    { key: 'text', label: 'Text', icon: <IconText />, value: view.saves.text },
    { key: 'link', label: 'Links', icon: <IconLink />, value: view.saves.link },
    { key: 'image', label: 'Images', icon: <IconImage />, value: view.saves.image },
  ]

  const actionStats = [
    { key: 'copies', label: 'Copies', icon: <IconCopy />, value: view.copies },
    { key: 'edits', label: 'Edits', icon: <IconEdit />, value: view.edits },
    { key: 'deletes', label: 'Deletes', icon: <IconTrash />, value: view.deletes },
    { key: 'searches', label: 'Searches', icon: <IconSearch />, value: view.searches },
  ]

  return (
    <div className="insights-panel" role="dialog" aria-modal="true" aria-labelledby="insights-title">
      <div className="insights-header">
        <div className="insights-logo" aria-hidden="true">
          <IconVault />
        </div>
        <div>
          <h3 id="insights-title">Usage insights</h3>
          <p className="insights-sub">Your vault so far — counted on this device only, never shared.</p>
        </div>
      </div>

      {view.lowData ? (
        <div className="insights-lowdata">
          <p className="insights-lowdata-title">Not much to show yet</p>
          <p className="insights-lowdata-copy">
            Save a few more clips and use VOLT for a bit — your usage summary will
            appear here once there is enough to show.
          </p>
        </div>
      ) : (
        <div className="insights-body">
          <div className="insights-hero">
            <span className="insights-hero-value">{view.totalSaves}</span>
            <span className="insights-hero-label">
              {view.totalSaves === 1 ? 'clip saved' : 'clips saved'}
            </span>
          </div>

          <div className="insights-section">
            <h4 className="insights-section-title">Saves by type</h4>
            <ul className="insights-list">
              {saveRows.map((row) => (
                <li key={row.key} className="insights-stat">
                  <span className="insights-stat-icon" aria-hidden="true">{row.icon}</span>
                  <span className="insights-stat-label">{row.label}</span>
                  <span className="insights-stat-value">{row.value}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="insights-section">
            <h4 className="insights-section-title">Activity</h4>
            <ul className="insights-list">
              {actionStats.map((row) => (
                <li key={row.key} className="insights-stat">
                  <span className="insights-stat-icon" aria-hidden="true">{row.icon}</span>
                  <span className="insights-stat-label">{row.label}</span>
                  <span className="insights-stat-value">{row.value}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="insights-footnote">
            {view.sessions === 1 ? '1 session' : `${view.sessions} sessions`} on this device.
          </p>
        </div>
      )}

      <div className="insights-actions">
        <button className="confirm-cancel" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

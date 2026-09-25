import { useEffect, useRef } from 'react'
import FileCard from '../ui/FileCard'
import { hasPreviewData } from '../../lib/fetchLinkPreview'

// Presentational body for a single clip, rendered by Clip_Type.
// Extracted from the Dashboard clip render path so the type-branch logic can be
// unit-tested in isolation without mounting the whole Dashboard page.
//
// Branches (behavior identical to the previous inline Dashboard render):
//   - `image`         -> an <img> thumbnail (src = clip.url)
//   - `file` / `audio`-> a <FileCard kind name size url /> download control
//   - `link`          -> rich preview (title/description/thumbnail) when a
//                        cached `metadata.preview` is present, otherwise the
//                        favicon + domain fallback
//   - `text` (default)-> the clip content, styled as code when it looks like code

const getFaviconUrl = (url) => {
  try {
    const domain = url?.replace(/^https?:\/\//, '').split('/')[0]
    if (!domain) return null
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
  } catch {
    return null
  }
}

// Detect if content looks like code
const isCodeSnippet = (text) => {
  if (!text) return false
  const codeSignals = [
    /^(import|export|const|let|var|function|class|if|for|while|return|async|await)\s/m,
    /[{}[\]();].*[{}[\]();]/,
    /=>/,
    /^\s*(\/\/|\/\*|#!)/m,
    /<\/?[a-z][\w-]*[\s>]/i,
    /\.\w+\(.*\)/,
  ]
  let matches = 0
  for (const pattern of codeSignals) {
    if (pattern.test(text)) matches++
  }
  return matches >= 2
}

// The favicon + domain fallback card (Req 4.5). Shown for a link clip that has
// no cached preview yet, or whose fetched preview yielded no usable fields.
function LinkFallback({ url }) {
  return (
    <div className="link-preview">
      <img src={getFaviconUrl(url)} alt="" className="link-favicon" width="16" height="16" loading="lazy" />
      <div className="link-preview-text">
        <p className="clip-content">{url}</p>
        <div className="link-domain">{url?.replace(/^https?:\/\//, '').split('/')[0]}</div>
      </div>
    </div>
  )
}

export default function ClipBody({ clip, onFetchPreview }) {
  // First-view preview fetch for link clips (Req 4.1, 4.2). Fire exactly once
  // per mounted card when the clip is a persisted link that has no cached
  // preview yet. `metadata.preview` being present at all (even all-null) means
  // it was already fetched, so we skip — avoids refetching on every render.
  const fetchedRef = useRef(false)
  const isLink = clip.type === 'link'
  const hasCachedPreview = Boolean(clip.metadata?.preview)
  // Optimistic clips carry a temp- id and aren't persisted yet; skip until real.
  const isPersisted = typeof clip.id === 'string' && !clip.id.startsWith('temp-')

  useEffect(() => {
    if (!isLink || hasCachedPreview || fetchedRef.current) return
    if (!isPersisted || !clip.content || typeof onFetchPreview !== 'function') return
    fetchedRef.current = true
    onFetchPreview(clip)
  }, [isLink, hasCachedPreview, isPersisted, clip, onFetchPreview])

  if (clip.type === 'image') {
    return (
      <div className="image-preview-wrap">
        <img src={clip.url} alt="Clip" className="image-preview" loading="lazy" />
      </div>
    )
  }

  if (clip.type === 'file' || clip.type === 'audio') {
    return (
      <FileCard kind={clip.type} name={clip.metadata?.name} size={clip.metadata?.bytes} url={clip.url} />
    )
  }

  if (clip.type === 'link') {
    const preview = clip.metadata?.preview

    // Graceful fallback: no cached preview, or fetched but no usable fields
    // (Req 4.5).
    if (!hasPreviewData(preview)) {
      return <LinkFallback url={clip.content} />
    }

    // Rich preview: title/description/thumbnail (Req 4.3). Any individual field
    // may be null, so each is rendered conditionally; the favicon+domain line
    // is kept as a stable anchor beneath the rich text.
    const domain = clip.content?.replace(/^https?:\/\//, '').split('/')[0]
    return (
      <div className="link-preview rich">
        {preview.image && (
          <img
            src={preview.image}
            alt=""
            className="link-thumb"
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        )}
        <div className="link-preview-text">
          {preview.title && <p className="link-title">{preview.title}</p>}
          {preview.description && <p className="link-desc">{preview.description}</p>}
          <div className="link-domain">
            <img src={getFaviconUrl(clip.content)} alt="" className="link-favicon" width="16" height="16" loading="lazy" />
            <span>{domain}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <p className={`clip-content ${isCodeSnippet(clip.content) ? 'code-snippet' : ''}`}>{clip.content}</p>
  )
}

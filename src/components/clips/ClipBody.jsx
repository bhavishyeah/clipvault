import FileCard from '../ui/FileCard'

// Presentational body for a single clip, rendered by Clip_Type.
// Extracted from the Dashboard clip render path so the type-branch logic can be
// unit-tested in isolation without mounting the whole Dashboard page.
//
// Branches (behavior identical to the previous inline Dashboard render):
//   - `image`         -> an <img> thumbnail (src = clip.url)
//   - `file` / `audio`-> a <FileCard kind name size url /> download control
//   - `link`          -> favicon + link preview text
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

export default function ClipBody({ clip }) {
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
    return (
      <div className="link-preview">
        <img src={getFaviconUrl(clip.content)} alt="" className="link-favicon" width="16" height="16" loading="lazy" />
        <div className="link-preview-text">
          <p className="clip-content">{clip.content}</p>
          <div className="link-domain">{clip.content?.replace(/^https?:\/\//, '').split('/')[0]}</div>
        </div>
      </div>
    )
  }

  return (
    <p className={`clip-content ${isCodeSnippet(clip.content) ? 'code-snippet' : ''}`}>{clip.content}</p>
  )
}

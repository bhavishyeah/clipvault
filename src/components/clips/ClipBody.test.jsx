// Feature: sharing-enhancements — Task 6.2: image thumbnail branch
//
// Validates: Requirements 4.5
//
// ClipBody is the extracted clip-body render used by the Dashboard clip grid.
// These unit tests pin the type-branch behaviour:
//   - a Clip of type `image` renders an <img> thumbnail (Req 4.5) and NOT a
//     FileCard download control.
//   - a Clip of type `file` renders a FileCard (download control) and NOT a
//     bare image thumbnail, so the two branches are mutually exclusive.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ClipBody from './ClipBody.jsx'

describe('ClipBody image thumbnail branch (Req 4.5)', () => {
  it('renders an <img> thumbnail (not a FileCard) for an image clip', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/y.png'
    const { container } = render(
      <ClipBody clip={{ type: 'image', url, metadata: {} }} />,
    )

    // An image thumbnail is present and points at the clip URL.
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', url)
    expect(container.querySelector('.image-preview-wrap')).not.toBeNull()

    // No FileCard is rendered for an image clip.
    expect(container.querySelector('.file-card')).toBeNull()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders a FileCard (not a bare image thumbnail) for a file clip', () => {
    const url = 'https://res.cloudinary.com/demo/raw/upload/report.pdf'
    const { container } = render(
      <ClipBody
        clip={{ type: 'file', url, metadata: { name: 'report.pdf', bytes: 2048 } }}
      />,
    )

    // The FileCard download control is present.
    expect(container.querySelector('.file-card')).not.toBeNull()
    expect(screen.getByText('report.pdf')).toBeInTheDocument()

    // No image-thumbnail branch for a file clip.
    expect(container.querySelector('.image-preview-wrap')).toBeNull()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

// Feature: volt-vault-polish — Task 5.3: rich link previews
//
// Validates: Requirements 4.2, 4.3, 4.5
//
// A link clip renders a rich preview (title/description/thumbnail) when a
// cached metadata.preview is present (Req 4.3), and falls back to the
// favicon+domain view when no preview is cached or all fields are null
// (Req 4.5). The first-view fetch fires once for a persisted link with no
// cached preview, and NOT when a preview is already cached (Req 4.2).

describe('ClipBody link preview branch (Req 4.2, 4.3, 4.5)', () => {
  it('renders title, description and thumbnail from a cached preview (Req 4.3)', () => {
    const clip = {
      id: 'c1',
      type: 'link',
      content: 'https://example.com/article',
      metadata: {
        preview: {
          title: 'Great Article',
          description: 'A summary of the article.',
          image: 'https://example.com/thumb.png',
        },
      },
    }
    const { container } = render(<ClipBody clip={clip} />)

    expect(screen.getByText('Great Article')).toBeInTheDocument()
    expect(screen.getByText('A summary of the article.')).toBeInTheDocument()
    expect(container.querySelector('.link-thumb')).toHaveAttribute(
      'src',
      'https://example.com/thumb.png',
    )
    expect(container.querySelector('.link-preview.rich')).not.toBeNull()
  })

  it('falls back to favicon+domain when no preview is cached (Req 4.5)', () => {
    const clip = { id: 'c2', type: 'link', content: 'https://example.com', metadata: {} }
    const { container } = render(<ClipBody clip={clip} />)

    expect(container.querySelector('.link-preview.rich')).toBeNull()
    expect(container.querySelector('.link-favicon')).not.toBeNull()
    expect(screen.getByText('example.com')).toBeInTheDocument()
  })

  it('falls back to favicon+domain when the cached preview has all-null fields (Req 4.5)', () => {
    const clip = {
      id: 'c3',
      type: 'link',
      content: 'https://example.com',
      metadata: { preview: { title: null, description: null, image: null } },
    }
    const { container } = render(<ClipBody clip={clip} />)

    expect(container.querySelector('.link-preview.rich')).toBeNull()
    expect(container.querySelector('.link-favicon')).not.toBeNull()
  })

  it('fires the first-view fetch once for a persisted link with no cached preview (Req 4.2)', async () => {
    const onFetchPreview = vi.fn()
    const clip = { id: 'c4', type: 'link', content: 'https://example.com', metadata: {} }
    render(<ClipBody clip={clip} onFetchPreview={onFetchPreview} />)

    await waitFor(() => expect(onFetchPreview).toHaveBeenCalledTimes(1))
    expect(onFetchPreview).toHaveBeenCalledWith(clip)
  })

  it('does NOT fetch when a preview is already cached (Req 4.2)', () => {
    const onFetchPreview = vi.fn()
    const clip = {
      id: 'c5',
      type: 'link',
      content: 'https://example.com',
      metadata: { preview: { title: 'Cached', description: null, image: null } },
    }
    render(<ClipBody clip={clip} onFetchPreview={onFetchPreview} />)

    expect(onFetchPreview).not.toHaveBeenCalled()
  })

  it('does NOT fetch for an optimistic (temp-) clip', () => {
    const onFetchPreview = vi.fn()
    const clip = { id: 'temp-123', type: 'link', content: 'https://example.com', metadata: {} }
    render(<ClipBody clip={clip} onFetchPreview={onFetchPreview} />)

    expect(onFetchPreview).not.toHaveBeenCalled()
  })
})

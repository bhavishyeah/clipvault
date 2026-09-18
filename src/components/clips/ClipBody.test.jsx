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

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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

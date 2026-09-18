// Feature: sharing-enhancements, Property 6: File_Card rendering
//
// Validates: Requirements 4.1, 4.2, 4.3, 4.4, 5.5, 14.3
//
// For any file props, the rendered FileCard shows the file name and the
// human-readable size. When a secure URL is present the download control is a
// real link targeting that URL (href === url) and is enabled; when the URL is
// absent the control is a disabled/aria-disabled button labelled "Unavailable"
// and no enabled link exists.

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { render, screen, cleanup } from '@testing-library/react'
import FileCard from './FileCard.jsx'
import { humanSize } from '../../lib/fileType.js'

// A non-empty display name. FileCard falls back to 'Untitled file' for empty
// names, so we require a truthy name. We also exclude leading/trailing/repeated
// whitespace because Testing Library's getByText normalizes whitespace, which
// would make the query text differ from the raw prop; the rendering behaviour
// under test is independent of that matcher quirk.
const nameArb = fc
  .string({ minLength: 1, maxLength: 60 })
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .filter((s) => s.length > 0)

// Positive integer byte counts so humanSize produces a real size string.
const sizeArb = fc.integer({ min: 1, max: 20 * 1024 * 1024 * 1024 })

const kindArb = fc.constantFrom('file', 'audio')

// A plausible https URL, or a falsy value (missing URL branch).
const urlArb = fc.oneof(
  fc.webUrl({ withQueryParameters: true }).map((u) => u.replace(/^http:/, 'https:')),
  fc.constantFrom(undefined, '', null),
)

describe('Property 6: File_Card rendering', () => {
  it('renders name + human size, and a targeted enabled link only when a URL is present', () => {
    fc.assert(
      fc.property(nameArb, sizeArb, kindArb, urlArb, (name, size, kind, url) => {
        try {
          const { container } = render(
            <FileCard kind={kind} name={name} size={size} url={url} />,
          )

          // Name is always shown (Req 4.1). Scope to the name element so a
          // name that happens to equal the size string can't cause ambiguity.
          const nameEl = container.querySelector('.file-card-name')
          expect(nameEl).not.toBeNull()
          expect(nameEl).toHaveTextContent(name)

          // Human-readable size is always shown (Req 4.2).
          const expectedSize = humanSize(size)
          const sizeEl = container.querySelector('.file-card-size')
          expect(sizeEl).not.toBeNull()
          expect(sizeEl).toHaveTextContent(expectedSize)

          if (url) {
            // Secure URL present: download control is an enabled link that
            // targets the exact URL (Req 4.3, 5.5, 14.3).
            const link = screen.getByRole('link')
            expect(link).toHaveAttribute('href', url)
            // No disabled/unavailable button when the link is available.
            expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
          } else {
            // No URL: control is disabled and labelled "Unavailable" (Req 4.4).
            expect(screen.queryByRole('link')).not.toBeInTheDocument()
            expect(screen.getByText('Unavailable')).toBeInTheDocument()
            const button = screen.getByRole('button')
            expect(button).toBeDisabled()
            expect(button).toHaveAttribute('aria-disabled', 'true')
          }
        } finally {
          // Clean up between iterations to avoid duplicate DOM nodes; the
          // shared afterEach cleanup only runs between tests, not iterations.
          cleanup()
        }
      }),
      { numRuns: 200 },
    )
  })
})

// Feature: volt-reach — PublicShare page renders each share kind and never
// leaks content in the unavailable state. Validates Req 5.1, 5.2, 5.3, 5.5.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import PublicShare from './PublicShare.jsx'

// Helper to stub fetch with a given response.
function mockFetch({ ok = true, body = {} } = {}) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  })
}

beforeEach(() => {
  // jsdom lacks clipboard by default; provide a stub.
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue() } })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PublicShare', () => {
  it('renders text content with a copy action', async () => {
    mockFetch({ body: { type: 'text', content: 'hello world', created_at: 't' } })
    render(<PublicShare token="tok" />)
    await waitFor(() => expect(screen.getByText('hello world')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
  })

  it('renders a link with copy and open actions', async () => {
    mockFetch({ body: { type: 'link', content: 'https://example.com' } })
    render(<PublicShare token="tok" />)
    await waitFor(() => expect(screen.getByText('https://example.com')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open/i })).toBeInTheDocument()
  })

  it('renders an image with a download action', async () => {
    const url = 'https://res.cloudinary.com/x/cat.png'
    mockFetch({ body: { type: 'image', file_url: url, file_name: 'cat.png' } })
    render(<PublicShare token="tok" />)
    const img = await screen.findByAltText('cat.png')
    expect(img).toHaveAttribute('src', url)
    expect(screen.getByRole('link', { name: /download image/i })).toBeInTheDocument()
  })

  it('renders a file with a download control', async () => {
    const url = 'https://res.cloudinary.com/x/doc.pdf'
    mockFetch({ body: { type: 'file', file_url: url, file_name: 'doc.pdf' } })
    render(<PublicShare token="tok" />)
    await waitFor(() => expect(screen.getByText('doc.pdf')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /download doc\.pdf/i })).toBeInTheDocument()
  })

  it('renders an audio clip as a titled download control', async () => {
    const url = 'https://res.cloudinary.com/x/song.mp3'
    mockFetch({ body: { type: 'audio', file_url: url, file_name: 'song.mp3' } })
    render(<PublicShare token="tok" />)
    await waitFor(() => expect(screen.getByText('song.mp3')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /download song\.mp3/i })).toBeInTheDocument()
  })

  it('shows a loading state before the fetch resolves and no content yet', () => {
    // A fetch that never settles keeps the component in its loading state.
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}))
    render(<PublicShare token="tok" />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    // Nothing resolved yet: no affordances and no unavailable panel.
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/this link is unavailable/i)).not.toBeInTheDocument()
  })

  it('shows the unavailable state and NO content when the API returns not-ok', async () => {
    mockFetch({ ok: false, body: { error: 'unavailable' } })
    render(<PublicShare token="tok" />)
    await waitFor(() => expect(screen.getByText(/this link is unavailable/i)).toBeInTheDocument())
    // No copy/download affordances and no leaked content.
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows the unavailable state when fetch rejects', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network'))
    render(<PublicShare token="tok" />)
    await waitFor(() => expect(screen.getByText(/this link is unavailable/i)).toBeInTheDocument())
  })
})

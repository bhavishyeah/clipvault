import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SendComposer from './SendComposer.jsx'

// Regression: Android content-provider Files can depend on the native input
// retaining its selection. The composer must preserve both the File and its UI
// synchronously instead of clearing the input or deferring state to a microtask.
describe('SendComposer mobile file selection', () => {
  it('keeps the selected File owned by the input and renders its preview', () => {
    const { container } = render(
      <SendComposer
        onClose={vi.fn()}
        searchUsers={vi.fn(async () => [])}
        sendTo={vi.fn(async () => true)}
        sending={false}
        userId="user-1"
        contacts={[]}
        addContact={vi.fn()}
        removeContact={vi.fn()}
      />,
    )

    const input = container.querySelector('input[type="file"]')
    const file = new File(['android-backed-file'], 'report.pdf', {
      type: 'application/pdf',
    })

    fireEvent.change(input, { target: { files: [file] } })

    expect(input.files[0]).toBe(file)
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })
})

// Feature: sharing-enhancements — Task 17.6: group empty states
//
// Unit tests for the empty-state messaging of the group sharing UI.
//
// Covers:
//   - RecipientTabs with zero contacts and zero groups: the Contacts panel
//     shows its own empty state, and switching to the Groups tab reveals the
//     Groups panel's own empty state. The two sections are separately labeled
//     and each carries its own message (Req 13.2), and a zero-group list is
//     surfaced as an empty state rather than a blank panel (Req 11.4).
//   - MemberList with zero members: the roster shows its empty state.
//
// Requirements: 11.4, 13.2

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'

import RecipientTabs from '../send/RecipientTabs'
import MemberList from './MemberList'

describe('RecipientTabs empty states (Req 13.2, 11.4)', () => {
  it('shows "No contacts yet" in the Contacts panel when there are no contacts', () => {
    render(<RecipientTabs contacts={[]} groups={[]} />)

    // The panel's accessible name is derived from its labelling tab, which
    // also renders a count badge, so the name reads "Contacts<count>".
    const contactsPanel = screen.getByRole('tabpanel', { name: /Contacts/ })
    expect(within(contactsPanel).getByText('No contacts yet')).toBeInTheDocument()
  })

  it('shows "No groups yet" after switching to the Groups tab when there are no groups', async () => {
    const user = userEvent.setup()
    render(<RecipientTabs contacts={[]} groups={[]} />)

    // The Groups panel is hidden (and excluded from the accessibility tree)
    // until its tab is activated.
    await user.click(screen.getByRole('tab', { name: /Groups/ }))

    const groupsPanel = screen.getByRole('tabpanel', { name: /Groups/ })
    expect(within(groupsPanel).getByText('No groups yet')).toBeInTheDocument()
  })

  it('keeps the two empty-state messages disjoint per section', async () => {
    const user = userEvent.setup()
    render(<RecipientTabs contacts={[]} groups={[]} />)

    // Contacts empty state is present, Groups message is not the Contacts one.
    const contactsPanel = screen.getByRole('tabpanel', { name: /Contacts/ })
    expect(within(contactsPanel).getByText('No contacts yet')).toBeInTheDocument()
    expect(within(contactsPanel).queryByText('No groups yet')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Groups/ }))
    const groupsPanel = screen.getByRole('tabpanel', { name: /Groups/ })
    expect(within(groupsPanel).getByText('No groups yet')).toBeInTheDocument()
    expect(within(groupsPanel).queryByText('No contacts yet')).not.toBeInTheDocument()
  })
})

describe('MemberList empty state (Req 11.4)', () => {
  it('shows "No members yet." when the group has no members', () => {
    render(
      <MemberList
        group={{ id: 'g1', name: 'Empty Group', owner_id: 'u1' }}
        members={[]}
        currentUserId="u1"
      />,
    )

    expect(screen.getByText('No members yet.')).toBeInTheDocument()
  })
})

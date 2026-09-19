// VOLT — group UI empty states
//
// Unit test for the empty-state messaging of the group member roster.
//
// Covers:
//   - MemberList with zero members: the roster shows its empty state.

import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import MemberList from './MemberList'

describe('MemberList empty state', () => {
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

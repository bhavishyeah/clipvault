// Feature: sharing-enhancements, Property 16: Member-management controls gated by role
//
// Validates: Requirements 12.7
//
// MemberList renders member-management controls (the "Add member" trigger and
// per-row "Remove" buttons) ONLY when the viewing user is the group owner. The
// viewer is the owner when group.isOwner === true OR group.owner_id ===
// currentUserId. For a non-owner viewer, NO add-member control and NO
// remove-member controls are rendered. For an owner viewer, the add-member
// control is present and a remove control is present for every non-owner member
// row but absent for the owner's own row (the owner cannot be removed).

import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import { render, within, cleanup } from '@testing-library/react'
import MemberList from './MemberList.jsx'

// Query helpers scoped to a specific render's container so concurrent/orphaned
// DOM from other iterations can never leak into a query. Each helper is bound
// to the container returned by that iteration's render().
const addControls = (container) =>
  within(container).queryAllByRole('button', { name: /add member/i })
// The remove control's aria-label is `Remove ${label} from group`. The
// accessible name computation collapses runs of whitespace, so when a member's
// label is itself whitespace-only the name becomes "Remove from group" with a
// single space. Match without requiring a space between the label slot and
// "from" so every valid label (including whitespace-only) is recognized.
const removeControls = (container) =>
  within(container).queryAllByRole('button', { name: /remove .*from group/i })

// A short arbitrary id (non-empty) usable for users and groups.
const idArb = fc.string({ minLength: 1, maxLength: 12 }).map((s) => `u_${s}`)

// A member record. role is 'owner' or 'member'; username/display_name are
// optionally present so memberLabel exercises each fallback branch.
const memberArb = fc.record({
  user_id: idArb,
  role: fc.constantFrom('owner', 'member'),
  username: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
  display_name: fc.option(fc.string({ minLength: 1, maxLength: 15 }), { nil: undefined }),
})

// A members array with unique user_ids (the component keys rows by user_id and
// group membership has a composite PK on (group_id, user_id)).
const membersArb = fc
  .uniqueArray(memberArb, { minLength: 0, maxLength: 8, selector: (m) => m.user_id })

describe('Property 16: Member-management controls gated by role', () => {
  it('renders no add/remove controls for a non-owner viewer', () => {
    fc.assert(
      fc.property(
        fc.record({
          ownerId: idArb,
          viewerId: idArb,
          // isOwner is intentionally never true here; a non-owner viewer must
          // remain a non-owner regardless of the flag being false/undefined.
          isOwner: fc.constantFrom(false, undefined),
        }),
        membersArb,
        ({ ownerId, viewerId, isOwner }, members) => {
          // Precondition: the viewer is genuinely NOT the owner.
          fc.pre(viewerId !== ownerId)

          const group = { id: 'g1', owner_id: ownerId, isOwner }
          const onAddMember = vi.fn()
          const onRemoveMember = vi.fn()

          const { container } = render(
            <MemberList
              group={group}
              members={members}
              currentUserId={viewerId}
              onAddMember={onAddMember}
              onRemoveMember={onRemoveMember}
            />,
          )

          try {
            // Non-owner viewer: roster is read-only.
            expect(addControls(container)).toHaveLength(0)
            expect(removeControls(container)).toHaveLength(0)
          } finally {
            cleanup()
          }
        },
      ),
      { numRuns: 150 },
    )
  })

  it('renders add + per-row remove controls for an owner viewer, except the owner row', () => {
    fc.assert(
      fc.property(
        fc.record({
          ownerId: idArb,
          // Owner viewer resolved either via owner_id match or the isOwner flag.
          ownerVia: fc.constantFrom('id', 'flag'),
        }),
        membersArb,
        ({ ownerId, ownerVia }, members) => {
          const viewerId = ownerVia === 'id' ? ownerId : 'someone_else'
          const group = {
            id: 'g1',
            owner_id: ownerId,
            isOwner: ownerVia === 'flag' ? true : undefined,
          }
          const onAddMember = vi.fn()
          const onRemoveMember = vi.fn()

          const { container } = render(
            <MemberList
              group={group}
              members={members}
              currentUserId={viewerId}
              onAddMember={onAddMember}
              onRemoveMember={onRemoveMember}
            />,
          )

          try {
            // Owner viewer: the add-member control is always present.
            expect(addControls(container)).toHaveLength(1)

            // Remove controls appear for every non-owner row and never for the
            // owner's own row.
            const nonOwnerCount = members.filter((m) => m.role !== 'owner').length
            expect(removeControls(container)).toHaveLength(nonOwnerCount)
          } finally {
            cleanup()
          }
        },
      ),
      { numRuns: 150 },
    )
  })
})

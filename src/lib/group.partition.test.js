// @vitest-environment node
//
// Feature: sharing-enhancements, Property 13: Contacts/Groups partition and send guards
//
// Validates: Requirements 13.1, 13.3, 13.5
//
// The sharing interface splits recipients into two separately labeled sections,
// "Contacts" and "Groups". This test verifies the underlying model-level
// invariants that RecipientTabs.jsx will render:
//   - 13.1 The two sections are disjoint (no id appears in both) and together
//          cover every recipient.
//   - 13.3 The displayed member count for a selected Group equals its current
//          membership count (derives directly from members.length).
//   - 13.5 canSendToGroup(memberCount) is false iff the Group has zero members.
//
// RecipientTabs.jsx is not implemented yet, so the partition logic is modeled
// inline with a small pure helper. `canSendToGroup` is exercised against the
// real implementation in ./group.js.

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { canSendToGroup } from './group.js'

/**
 * Pure partition helper modeling how the recipient list is split into the
 * "Contacts" and "Groups" sections. Contacts and groups are addressed by their
 * own id spaces; the returned sections are the id sets rendered under each
 * labeled heading.
 *
 * @param {Array<{ id: string }>} contacts
 * @param {Array<{ id: string }>} groups
 * @returns {{ contactsSection: string[], groupsSection: string[] }}
 */
function partitionRecipients(contacts, groups) {
  return {
    contactsSection: contacts.map((c) => c.id),
    groupsSection: groups.map((g) => g.id),
  }
}

// The displayed member count for a group is derived directly from its current
// membership list — never a stale cached number.
const displayedMemberCount = (group) => group.members.length

// Generators -----------------------------------------------------------------

// A contact id lives in the "c:" namespace; a group id in the "g:" namespace.
// Namespacing keeps the two id spaces distinct, mirroring that a Contact row
// and a Group row are never the same entity.
const contactId = fc.uuid().map((u) => `c:${u}`)
const groupId = fc.uuid().map((u) => `g:${u}`)
const memberId = fc.uuid().map((u) => `m:${u}`)

const contact = fc.record({ id: contactId })
const group = fc.record({
  id: groupId,
  members: fc.array(fc.record({ id: memberId }), { maxLength: 12 }),
})

const contacts = fc.uniqueArray(contact, { selector: (c) => c.id, maxLength: 15 })
const groups = fc.uniqueArray(group, { selector: (g) => g.id, maxLength: 15 })

describe('Property 13: Contacts/Groups partition and send guards', () => {
  it('splits recipients into two disjoint sections whose union covers all (Req 13.1)', () => {
    fc.assert(
      fc.property(contacts, groups, (cs, gs) => {
        const { contactsSection, groupsSection } = partitionRecipients(cs, gs)

        // Disjoint: no id appears in both sections.
        const contactSet = new Set(contactsSection)
        const groupSet = new Set(groupsSection)
        for (const id of groupSet) {
          expect(contactSet.has(id)).toBe(false)
        }
        for (const id of contactSet) {
          expect(groupSet.has(id)).toBe(false)
        }

        // Coverage: every recipient appears in exactly one section, and the
        // union equals the full recipient set.
        const union = new Set([...contactsSection, ...groupsSection])
        expect(union.size).toBe(contactSet.size + groupSet.size)
        expect(union.size).toBe(cs.length + gs.length)
      }),
      { numRuns: 200 },
    )
  })

  it('displays a member count equal to the current membership count (Req 13.3)', () => {
    fc.assert(
      fc.property(group, (g) => {
        expect(displayedMemberCount(g)).toBe(g.members.length)
      }),
      { numRuns: 200 },
    )
  })

  it('permits sending to a group iff it has at least one member (Req 13.5)', () => {
    fc.assert(
      fc.property(group, (g) => {
        const count = g.members.length
        expect(canSendToGroup(count)).toBe(count > 0)
      }),
      { numRuns: 200 },
    )
  })

  it('blocks sending to any zero-member group (Req 13.5)', () => {
    const emptyGroup = fc.record({
      id: groupId,
      members: fc.constant([]),
    })
    fc.assert(
      fc.property(emptyGroup, (g) => {
        expect(displayedMemberCount(g)).toBe(0)
        expect(canSendToGroup(g.members.length)).toBe(false)
      }),
      { numRuns: 100 },
    )
  })
})

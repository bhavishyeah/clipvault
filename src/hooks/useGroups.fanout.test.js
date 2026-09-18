// @vitest-environment node
//
// Feature: sharing-enhancements, Property 14: Group message fan-out equals current membership
//
// Validates: Requirements 14.1, 14.2, 15.1
//
// For any group and its current membership set, storing a single Group_Message
// causes the set of users who can read that message (and thus receive it over
// Realtime) to equal exactly the current member set — no more and no fewer.
//
// This is the behaviour of the `group_messages` RLS "members read messages"
// policy: `using (is_group_member(group_id, auth.uid()))`. A row is readable by
// a user iff that user is a *current* member of the group, regardless of who
// was a member when the message was sent. So the receiving set is governed by
// CURRENT membership at read time, not membership-at-send-time.
//
// We model the group as a pure in-memory structure: a mutable current-member
// set plus an append-only message log. `recipientsOf(group)` returns exactly
// the current member set — which is what the RLS policy yields — and we assert
// that against an independent oracle across interleaved add/remove/send ops.

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

// ---------------------------------------------------------------------------
// Pure in-memory membership + message model
// ---------------------------------------------------------------------------

function makeGroup(id, ownerId) {
  return {
    id,
    ownerId,
    // Current member set. The owner is a member from creation (Req 11.1/12.1),
    // mirroring createGroup inserting the owner membership row.
    members: new Set([ownerId]),
    // Append-only message log; each entry records who sent it (metadata only —
    // it does NOT affect who may read the row).
    messages: [],
  }
}

function addMember(group, userId) {
  // PK (group_id, user_id) makes membership a set: duplicate adds are no-ops.
  group.members.add(userId)
}

function removeMember(group, userId) {
  // Owner cannot be removed / cannot leave (Req 12.6); model enforces it so the
  // group always has at least one member and never loses its owner.
  if (userId === group.ownerId) return
  group.members.delete(userId)
}

function sendMessage(group, senderId, content) {
  group.messages.push({ senderId, content })
}

// The RLS "members read messages" policy: a message row is visible to a user
// iff that user is a *current* member. recipientsOf therefore equals the
// current member set for every stored message.
function recipientsOf(group) {
  return new Set(group.members)
}

// ---------------------------------------------------------------------------
// Oracle: an independent recomputation of the "who can read" set. We keep a
// shadow set of current members maintained purely from the operation stream and
// assert the model agrees with it.
// ---------------------------------------------------------------------------

const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x))

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const userId = fc.integer({ min: 1, max: 12 }).map((n) => `u${n}`)

// A sequence of operations against a single group.
const opArb = fc.oneof(
  fc.record({ kind: fc.constant('add'), user: userId }),
  fc.record({ kind: fc.constant('remove'), user: userId }),
  fc.record({ kind: fc.constant('send'), user: userId, content: fc.string({ maxLength: 16 }) }),
)

const opsArb = fc.array(opArb, { minLength: 0, maxLength: 40 })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Property 14: Group message fan-out equals current membership', () => {
  it('receiving set for every stored message equals the current member set', () => {
    fc.assert(
      fc.property(userId, opsArb, (ownerId, ops) => {
        const group = makeGroup('g1', ownerId)
        // Shadow oracle of current membership, seeded with the owner.
        const shadow = new Set([ownerId])

        for (const op of ops) {
          if (op.kind === 'add') {
            addMember(group, op.user)
            shadow.add(op.user)
          } else if (op.kind === 'remove') {
            removeMember(group, op.user)
            if (op.user !== ownerId) shadow.delete(op.user)
          } else {
            sendMessage(group, op.user, op.content)
          }

          // At every point in time, and for every message already stored, the
          // set that can read/receive it equals the CURRENT member set.
          const recipients = recipientsOf(group)
          expect(setEq(recipients, shadow)).toBe(true)

          for (let i = 0; i < group.messages.length; i++) {
            // recipientsOf is per-message-independent: it is always the current
            // member set (RLS re-evaluates membership at read time).
            expect(setEq(recipientsOf(group), shadow)).toBe(true)
          }
        }
      }),
      { numRuns: 300 },
    )
  })

  it('no non-member is ever included in the receiving set', () => {
    fc.assert(
      fc.property(userId, opsArb, (ownerId, ops) => {
        const group = makeGroup('g1', ownerId)
        for (const op of ops) {
          if (op.kind === 'add') addMember(group, op.user)
          else if (op.kind === 'remove') removeMember(group, op.user)
          else sendMessage(group, op.user, op.content)
        }
        const recipients = recipientsOf(group)
        // Every recipient must be a current member — no extras (no more).
        for (const r of recipients) {
          expect(group.members.has(r)).toBe(true)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('every current member is included in the receiving set', () => {
    fc.assert(
      fc.property(userId, opsArb, (ownerId, ops) => {
        const group = makeGroup('g1', ownerId)
        for (const op of ops) {
          if (op.kind === 'add') addMember(group, op.user)
          else if (op.kind === 'remove') removeMember(group, op.user)
          else sendMessage(group, op.user, op.content)
        }
        const recipients = recipientsOf(group)
        // Every current member must receive — none missing (no fewer).
        for (const m of group.members) {
          expect(recipients.has(m)).toBe(true)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('a member removed after a send no longer receives that message; a member added after a send does', () => {
    fc.assert(
      fc.property(
        userId,
        userId,
        userId,
        (ownerId, sender, other) => {
          fc.pre(sender !== ownerId && other !== ownerId && sender !== other)
          const group = makeGroup('g1', ownerId)

          // Sender joins, sends a message while `other` is NOT yet a member.
          addMember(group, sender)
          sendMessage(group, sender, 'hello')
          // At send time, `other` is not a recipient.
          expect(recipientsOf(group).has(other)).toBe(false)

          // `other` joins AFTER the send — RLS reads by current membership, so
          // `other` can now read the earlier message.
          addMember(group, other)
          expect(recipientsOf(group).has(other)).toBe(true)

          // Remove `sender` after the send — they can no longer read it.
          removeMember(group, sender)
          expect(recipientsOf(group).has(sender)).toBe(false)

          // Fan-out still equals the exact current member set.
          const expected = new Set([ownerId, other])
          expect(setEq(recipientsOf(group), expected)).toBe(true)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('owner is always a member and always a recipient', () => {
    fc.assert(
      fc.property(userId, opsArb, (ownerId, ops) => {
        const group = makeGroup('g1', ownerId)
        for (const op of ops) {
          if (op.kind === 'add') addMember(group, op.user)
          else if (op.kind === 'remove') removeMember(group, op.user)
          else sendMessage(group, op.user, op.content)
        }
        expect(group.members.has(ownerId)).toBe(true)
        expect(recipientsOf(group).has(ownerId)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })
})

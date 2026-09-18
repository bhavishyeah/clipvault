// @vitest-environment node
//
// Feature: sharing-enhancements, Property 15: Non-member RLS denial
//
// Validates: Requirements 11.6, 14.4, 15.2, 15.4, 15.6
//
// Model-level property test mirroring the Row-Level-Security decisions defined
// in supabase/add_groups.sql. The live RLS policies are exercised end-to-end by
// integration tests (task 18.2); here we model the *policy logic* with a pure
// in-memory model so the decision rules can be checked exhaustively across many
// generated groups and actors.
//
// Modeled RLS decisions:
//   - "members read messages"  -> SELECT returns rows only for members.
//   - "members send messages"  -> INSERT allowed only for members
//                                 (and sender = self); otherwise no-op.
//   - "owner deletes group"    -> DELETE affects rows only for the owner.

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

// --- Pure in-memory model of a group + its RLS decisions ---------------------

// A group is { id, ownerId, members: Set<userId>, messages: [] }.
// Note: the owner is always a member (owner membership row is created with the
// group), matching add_groups.sql where creating a group inserts the owner as a
// member. Generators below preserve that invariant.

// selectMessages: models the "members read messages" SELECT policy.
// Non-members get zero rows.
function selectMessages(group, actorId) {
  return group.members.has(actorId) ? group.messages : []
}

// insertMessage: models the "members send messages" INSERT policy (member AND
// sender = self). On denial the messages array is left unchanged.
function insertMessage(group, actorId, msg) {
  if (group.members.has(actorId)) {
    group.messages.push({ ...msg, sender_id: actorId })
    return { ok: true }
  }
  return { ok: false }
}

// deleteGroup: models the "owner deletes group" DELETE policy. A non-owner
// affects zero rows.
function deleteGroup(group, actorId) {
  return actorId === group.ownerId ? { deleted: 1 } : { deleted: 0 }
}

// --- Generators --------------------------------------------------------------

const uuid = fc.uuid()

// Distinct user ids, at least `min` of them.
const distinctUsers = (min = 1, max = 8) =>
  fc.uniqueArray(uuid, { minLength: min, maxLength: max })

// A group whose owner is always among its members, with an arbitrary set of
// extra members and a message log authored by members.
const groupArb = distinctUsers(1, 8).chain((users) => {
  const ownerId = users[0]
  const members = new Set(users) // owner + others are all members
  return fc
    .array(
      fc.record({
        id: uuid,
        type: fc.constantFrom('text', 'link', 'image', 'file', 'audio'),
        content: fc.string({ maxLength: 40 }),
        sender_id: fc.constantFrom(...users),
      }),
      { maxLength: 12 },
    )
    .map((messages) => ({
      id: undefined, // filled below
      ownerId,
      members,
      messages,
    }))
    .chain((partial) => uuid.map((id) => ({ ...partial, id })))
})

// An actor id that is guaranteed NOT to be a member of the given group.
const nonMemberFor = (group) =>
  uuid.filter((candidate) => !group.members.has(candidate))

// An actor id that is guaranteed NOT to be the owner of the given group
// (may or may not be a member).
const nonOwnerFor = (group) => uuid.filter((candidate) => candidate !== group.ownerId)

describe('Property 15: Non-member RLS denial (model-level)', () => {
  it('non-member SELECT returns zero rows (Req 15.2)', () => {
    fc.assert(
      fc.property(
        groupArb.chain((group) => fc.tuple(fc.constant(group), nonMemberFor(group))),
        ([group, actorId]) => {
          const rows = selectMessages(group, actorId)
          expect(rows).toEqual([])
          expect(rows).toHaveLength(0)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('non-member INSERT is denied and leaves messages unchanged (Req 14.4, 15.6)', () => {
    fc.assert(
      fc.property(
        groupArb.chain((group) => fc.tuple(fc.constant(group), nonMemberFor(group))),
        ([group, actorId]) => {
          const before = group.messages.length
          const result = insertMessage(group, actorId, {
            id: 'attempt',
            type: 'text',
            content: 'blocked',
          })
          expect(result.ok).toBe(false)
          expect(group.messages).toHaveLength(before)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('non-owner DELETE affects zero rows (Req 11.6, 15.4)', () => {
    fc.assert(
      fc.property(
        groupArb.chain((group) => fc.tuple(fc.constant(group), nonOwnerFor(group))),
        ([group, actorId]) => {
          expect(deleteGroup(group, actorId)).toEqual({ deleted: 0 })
        },
      ),
      { numRuns: 200 },
    )
  })

  // --- Positive controls: the policies must still permit the allowed actors ---

  it('a member sees all messages (positive control)', () => {
    fc.assert(
      fc.property(
        groupArb.chain((group) =>
          fc.tuple(fc.constant(group), fc.constantFrom(...group.members)),
        ),
        ([group, actorId]) => {
          const rows = selectMessages(group, actorId)
          expect(rows).toBe(group.messages)
          expect(rows).toHaveLength(group.messages.length)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('a member INSERT succeeds and appends exactly one message (positive control)', () => {
    fc.assert(
      fc.property(
        groupArb.chain((group) =>
          fc.tuple(fc.constant(group), fc.constantFrom(...group.members)),
        ),
        ([group, actorId]) => {
          const before = group.messages.length
          const result = insertMessage(group, actorId, {
            id: 'ok',
            type: 'text',
            content: 'hello',
          })
          expect(result.ok).toBe(true)
          expect(group.messages).toHaveLength(before + 1)
          // sender is stamped as the acting member (sender = self).
          expect(group.messages[group.messages.length - 1].sender_id).toBe(actorId)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('the owner DELETE affects exactly one row (positive control)', () => {
    fc.assert(
      fc.property(groupArb, (group) => {
        expect(deleteGroup(group, group.ownerId)).toEqual({ deleted: 1 })
      }),
      { numRuns: 200 },
    )
  })
})

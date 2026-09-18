// @vitest-environment node
//
// Feature: sharing-enhancements, Property 12: Membership invariants
//
// Validates: Requirements 11.1, 12.1, 12.3, 12.6
//
// MODEL-LEVEL property test. The RLS/DB layer is NOT exercised here; instead we
// test a pure, in-memory membership model that mirrors the SQL rules in
// supabase/add_groups.sql:
//   - group_members has PRIMARY KEY (group_id, user_id) -> no duplicate rows.
//   - role is one of ('owner','member'); the group creator is inserted as 'owner'.
//   - owner-leave is blocked in the app (Req 12.6); non-owner members self-leave.
//
// The invariants asserted across generated add/leave sequences are:
//   - After creation, the owner (== creator) has role 'owner'.
//   - Any added non-owner user has role 'member'.
//   - Adding the same user twice never creates a second entry (composite PK dedup).
//   - leave(ownerId) is always rejected and leaves the owner membership intact.

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

// --- Inline membership model (mirrors the SQL rules) -----------------------

// A group = { id, ownerId, members: Map<userId, role> }.
// The creator is inserted with role 'owner' at creation (Req 11.1, 12.1 baseline).
function createGroup(id, ownerId) {
  const members = new Map()
  members.set(ownerId, 'owner')
  return { id, ownerId, members }
}

// addMember: composite PK dedup. If userId already present, no-op (keeps the
// existing role). Otherwise insert with role 'member' (Req 12.1, 12.3).
function addMember(group, userId) {
  if (group.members.has(userId)) {
    return { added: false, group }
  }
  group.members.set(userId, 'member')
  return { added: true, group }
}

// leave: owner-leave is rejected (Req 12.6). Non-owner members are removed.
function leave(group, userId) {
  if (userId === group.ownerId) {
    return { rejected: true, group }
  }
  const removed = group.members.delete(userId)
  return { rejected: false, removed, group }
}

// --- Generators ------------------------------------------------------------

// Distinct user ids. Owner is a fixed sentinel; the operation pool draws from a
// small set that may or may not overlap the owner, exercising dedup and the
// owner-leave guard.
const ownerId = 'owner-user'
const otherUserIds = ['u1', 'u2', 'u3', 'u4', 'u5']

// A single operation over the group.
const opArb = fc.oneof(
  fc
    .constantFrom(ownerId, ...otherUserIds)
    .map((userId) => ({ kind: 'add', userId })),
  fc
    .constantFrom(ownerId, ...otherUserIds)
    .map((userId) => ({ kind: 'leave', userId })),
)

const opSequenceArb = fc.array(opArb, { minLength: 0, maxLength: 40 })

// Apply a sequence of operations to a fresh group, tracking rejections.
function applyOps(ops) {
  const group = createGroup('g1', ownerId)
  const rejectedLeaves = []
  for (const op of ops) {
    if (op.kind === 'add') {
      addMember(group, op.userId)
    } else {
      const res = leave(group, op.userId)
      if (res.rejected) rejectedLeaves.push(op.userId)
    }
  }
  return { group, rejectedLeaves }
}

// --- Properties ------------------------------------------------------------

describe('Property 12: Membership invariants', () => {
  it('owner role belongs to the creator right after creation (Req 12.1)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 24 }), (creatorId) => {
        const group = createGroup('g1', creatorId)
        expect(group.ownerId).toBe(creatorId)
        expect(group.members.get(creatorId)).toBe('owner')
        // exactly one member (the owner) at creation.
        expect(group.members.size).toBe(1)
      }),
      { numRuns: 200 },
    )
  })

  it('adding a non-owner user yields role member (Req 12.1)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...otherUserIds), (userId) => {
        const group = createGroup('g1', ownerId)
        const { added } = addMember(group, userId)
        expect(added).toBe(true)
        expect(group.members.get(userId)).toBe('member')
      }),
      { numRuns: 200 },
    )
  })

  it('a duplicate add creates no second entry — composite PK dedup (Req 12.3)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...otherUserIds),
        fc.integer({ min: 2, max: 10 }),
        (userId, times) => {
          const group = createGroup('g1', ownerId)
          for (let i = 0; i < times; i++) addMember(group, userId)
          // Map key uniqueness models the (group_id, user_id) primary key:
          // repeated adds never double the entry; still exactly one role.
          expect(group.members.get(userId)).toBe('member')
          // owner + this one member == size 2, regardless of add count.
          expect(group.members.size).toBe(2)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('re-adding the owner never demotes them or duplicates the row (Req 12.3)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (times) => {
        const group = createGroup('g1', ownerId)
        for (let i = 0; i < times; i++) addMember(group, ownerId)
        expect(group.members.get(ownerId)).toBe('owner')
        expect(group.members.size).toBe(1)
      }),
      { numRuns: 200 },
    )
  })

  it('owner-leave is always rejected and leaves the owner membership intact (Req 12.6)', () => {
    fc.assert(
      fc.property(opSequenceArb, (ops) => {
        const group = createGroup('g1', ownerId)
        // Interleave an owner-leave attempt at every step, plus at the end.
        for (const op of ops) {
          if (op.kind === 'add') addMember(group, op.userId)
          else leave(group, op.userId)

          const res = leave(group, ownerId)
          expect(res.rejected).toBe(true)
          expect(group.members.get(ownerId)).toBe('owner')
        }
        const finalRes = leave(group, ownerId)
        expect(finalRes.rejected).toBe(true)
        expect(group.members.has(ownerId)).toBe(true)
        expect(group.members.get(ownerId)).toBe('owner')
      }),
      { numRuns: 200 },
    )
  })

  it('holds all invariants across arbitrary add/leave sequences (Req 11.1, 12.1, 12.3, 12.6)', () => {
    fc.assert(
      fc.property(opSequenceArb, (ops) => {
        const { group, rejectedLeaves } = applyOps(ops)

        // 1. Owner always remains, always with role 'owner' (owner-leave blocked).
        expect(group.members.has(ownerId)).toBe(true)
        expect(group.members.get(ownerId)).toBe('owner')

        // 2. Every owner-leave op was rejected.
        for (const uid of rejectedLeaves) expect(uid).toBe(ownerId)

        // 3. Every present member is either the owner ('owner') or a
        //    non-owner ('member'); no other role exists (composite role check).
        for (const [uid, role] of group.members) {
          if (uid === ownerId) expect(role).toBe('owner')
          else expect(role).toBe('member')
        }

        // 4. Map keys are unique by construction, so the pair count for any
        //    (group, user) is at most 1 — the composite PK invariant.
        const uniqueUsers = new Set(group.members.keys())
        expect(uniqueUsers.size).toBe(group.members.size)
      }),
      { numRuns: 300 },
    )
  })
})

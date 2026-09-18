// Feature: sharing-enhancements — unit tests for useGroups sendToGroup guards
//
// Validates: Requirements 13.5, 14.6
//
// These tests exercise the useGroups hook's sendToGroup path against a MOCKED
// Supabase client, the toast store, and the analytics tracker. No network or
// real Supabase calls are made. The focus is on the two error/guard paths:
//   - a zero-member group blocks the send and never inserts a message (Req 13.5)
//   - a failed group_messages insert toasts an error and returns a failure so
//     the caller retains the composed content (Req 14.6)
// A positive case confirms a member-bearing group inserts exactly one row.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// --- Shared, per-test-configurable mock state --------------------------------
// vi.mock is hoisted above top-level declarations, so the mock plumbing is
// created via vi.hoisted() to be reachable both inside the factory and in the
// test bodies.
const { state, fromMock, toast, trackEvent } = vi.hoisted(() => {
  // `state` holds the resolved values the fake query builder should return,
  // keyed by table (and by whether the select was a count/head query). Tests
  // mutate this before invoking the hook methods.
  const state = {
    // Resolution for supabase.from('group_members').select(..).eq('user_id',..)
    // used by the initial mount load — settled so `loading` becomes false.
    memberLoad: { data: [], error: null },
    // Resolution for the head/count member-count guard in sendToGroup.
    memberCount: { count: 0 },
    // Resolution for the group_messages insert.
    insert: { error: null },
    // Call tracking.
    insertCalls: [],
  }

  // A chainable, thenable query-builder fake. `.select`, `.eq`, `.is`, `.in`
  // return the same builder so any call shape chains. Awaiting the builder (via
  // `.then`) resolves to the value chosen from `state` based on the table and
  // whether a count/head select was requested.
  function makeBuilder(table) {
    let isCountQuery = false
    let isInsert = false

    const builder = {
      select(_cols, opts) {
        // The member-count guard passes { count: 'exact', head: true }.
        if (opts && (opts.count || opts.head)) isCountQuery = true
        return builder
      },
      insert(payload) {
        isInsert = true
        state.insertCalls.push({ table, payload })
        return builder
      },
      eq() { return builder },
      is() { return builder },
      in() { return builder },
      // Thenable: resolve based on what was requested.
      then(resolve, reject) {
        let value
        if (table === 'group_messages' && isInsert) {
          value = state.insert
        } else if (table === 'group_members' && isCountQuery) {
          value = state.memberCount
        } else if (table === 'group_members') {
          value = state.memberLoad
        } else {
          value = { data: [], error: null }
        }
        return Promise.resolve(value).then(resolve, reject)
      },
    }
    return builder
  }

  const fromMock = vi.fn((table) => makeBuilder(table))

  return { state, fromMock, toast: vi.fn(), trackEvent: vi.fn() }
})

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: (...args) => fromMock(...args),
  },
}))

vi.mock('../components/ui/toastStore', () => ({
  toast: (...args) => toast(...args),
}))

vi.mock('../lib/analytics', () => ({
  trackEvent: (...args) => trackEvent(...args),
}))

// Imported after the mocks so the hook picks up the mocked modules.
import { useGroups } from './useGroups.js'

const USER = { id: 'user-1' }

// Render the hook and wait for the initial membership load to settle so the
// `loading` flag is false before assertions run.
async function renderGroups(user = USER) {
  const view = renderHook(({ u }) => useGroups(u), { initialProps: { u: user } })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  state.memberLoad = { data: [], error: null }
  state.memberCount = { count: 0 }
  state.insert = { error: null }
  state.insertCalls = []
})

describe('useGroups sendToGroup', () => {
  it('blocks a send to a zero-member group and never inserts a message (Req 13.5)', async () => {
    state.memberCount = { count: 0 }

    const { result } = await renderGroups()

    let out
    await act(async () => {
      out = await result.current.sendToGroup('group-1', 'text', 'hi')
    })

    expect(out).toEqual({ ok: false, error: 'no_members' })
    // The insert must never fire for a zero-member group.
    const insertsToMessages = state.insertCalls.filter((c) => c.table === 'group_messages')
    expect(insertsToMessages).toHaveLength(0)
    // The user is told why the send was blocked.
    expect(toast).toHaveBeenCalledWith(expect.any(String), 'error')
  })

  it('signals failure and toasts an error when the message insert fails (Req 14.6)', async () => {
    state.memberCount = { count: 3 }
    state.insert = { error: { message: 'boom' } }

    const { result } = await renderGroups()

    let out
    await act(async () => {
      out = await result.current.sendToGroup('group-1', 'text', 'hi')
    })

    // The failure return lets the caller keep the composed content (Req 14.6).
    expect(out.ok).toBe(false)
    expect(out.error).toBe('boom')
    // An error toast is surfaced.
    expect(toast).toHaveBeenCalledWith(expect.any(String), 'error')
    // The insert was attempted exactly once (it failed, not skipped).
    const insertsToMessages = state.insertCalls.filter((c) => c.table === 'group_messages')
    expect(insertsToMessages).toHaveLength(1)
    // Success analytics never fire on failure.
    expect(trackEvent).not.toHaveBeenCalledWith('group_send')
  })

  it('sends one message when the group has members and the insert succeeds', async () => {
    state.memberCount = { count: 2 }
    state.insert = { error: null }

    const { result } = await renderGroups()

    let out
    await act(async () => {
      out = await result.current.sendToGroup('group-1', 'text', 'hi')
    })

    expect(out).toEqual({ ok: true })
    const insertsToMessages = state.insertCalls.filter((c) => c.table === 'group_messages')
    expect(insertsToMessages).toHaveLength(1)
    expect(trackEvent).toHaveBeenCalledWith('group_send')
  })
})

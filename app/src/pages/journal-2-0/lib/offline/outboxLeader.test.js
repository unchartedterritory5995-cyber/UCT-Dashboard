/**
 * Wave Q1 — exactly one tab drains the outbox (§28/§29 of the directive).
 *
 * ⛔ The failure being prevented is browser-tab ordering becoming silent
 * last-write-wins. The fallback when Web Locks is missing must therefore be
 * "this tab does not drain", never "this tab tries anyway".
 */
import { describe, it, expect, vi } from 'vitest'
import {
  claimSyncLeadership, createChangeChannel, lockNameFor, channelNameFor,
  webLocksAvailable, LEADER, FOLLOWER, READ_ONLY_FOR_SYNC,
} from './outboxLeader'

/** A Web Locks stand-in with one real lock per name. */
function fakeLocks() {
  const held = new Set()
  return {
    held,
    nav: {
      locks: {
        request: async (name, opts, cb) => {
          if (opts?.ifAvailable) {
            if (held.has(name)) return cb(null)
            held.add(name)
            try { return await cb({ name }) } finally { held.delete(name) }
          }
          held.add(name)
          try { return await cb({ name }) } finally { held.delete(name) }
        },
      },
    },
  }
}

describe('leadership', () => {
  it('the first tab leads', async () => {
    const { nav } = fakeLocks()
    const { role } = await claimSyncLeadership('acct1', { nav })
    expect(role).toBe(LEADER)
  })

  it('a second tab is a FOLLOWER — it does not also drain', async () => {
    const { nav } = fakeLocks()
    const first = await claimSyncLeadership('acct1', { nav })
    expect(first.role).toBe(LEADER)
    const second = await claimSyncLeadership('acct1', { nav })
    expect(second.role).toBe(FOLLOWER)
    first.release()
  })

  it('a DIFFERENT account is independent — leadership is per account, not per app', async () => {
    const { nav } = fakeLocks()
    const a = await claimSyncLeadership('acct1', { nav })
    const b = await claimSyncLeadership('acct2', { nav })
    expect(a.role).toBe(LEADER)
    expect(b.role).toBe(LEADER)
    a.release(); b.release()
  })

  it('releasing lets the next tab lead', async () => {
    const { nav } = fakeLocks()
    const first = await claimSyncLeadership('acct1', { nav })
    first.release()
    await Promise.resolve(); await Promise.resolve()
    const second = await claimSyncLeadership('acct1', { nav })
    expect(second.role).toBe(LEADER)
    second.release()
  })
})

describe('⛔ the fallback waits, it does not race', () => {
  it('without Web Locks the tab is READ-ONLY FOR SYNC', async () => {
    const { role } = await claimSyncLeadership('acct1', { nav: {} })
    // ⭐ Not LEADER. A degraded mode that drains anyway would reintroduce
    // exactly the last-write-wins the whole wave forbids.
    expect(role).toBe(READ_ONLY_FOR_SYNC)
    expect(role).not.toBe(LEADER)
  })

  it('a request that throws also degrades to read-only, never to leader', async () => {
    const nav = { locks: { request: () => Promise.reject(new Error('nope')) } }
    const { role } = await claimSyncLeadership('acct1', { nav })
    expect(role).toBe(READ_ONLY_FOR_SYNC)
  })

  it('feature detection is honest about both shapes', () => {
    expect(webLocksAvailable({})).toBe(false)
    expect(webLocksAvailable({ locks: {} })).toBe(false)
    expect(webLocksAvailable({ locks: { request: () => {} } })).toBe(true)
  })
})

describe('names are account-scoped', () => {
  it('the lock and the channel both carry the account', () => {
    expect(lockNameFor('a1')).toBe('uct.nb.sync.a1')
    expect(channelNameFor('a1')).toBe('uct.nb.a1')
    expect(lockNameFor('a1')).not.toBe(lockNameFor('a2'))
  })
})

describe('the change channel is a HINT channel', () => {
  it('posts and receives a small verb, and degrades to a no-op without support', () => {
    const listeners = []
    class FakeChannel {
      constructor(name) { this.name = name }
      addEventListener(_, fn) { listeners.push(fn) }
      removeEventListener() {}
      postMessage(d) { listeners.forEach((fn) => fn({ data: d })) }
      close() {}
    }
    const ch = createChangeChannel('a1', { Channel: FakeChannel })
    const seen = []
    ch.subscribe((m) => seen.push(m))
    ch.post('note-changed', { noteId: 'n1' })
    expect(seen[0].kind).toBe('note-changed')
    expect(seen[0].noteId).toBe('n1')
    // ⛔ It carries an id and a verb — never the note body.
    expect(JSON.stringify(seen[0])).not.toMatch(/bodyJson/)

    // ⛔ `null`, not `undefined` — a default parameter only fills in for
    // `undefined`, so passing that would have silently used the real
    // BroadcastChannel and tested nothing.
    const none = createChangeChannel('a1', { Channel: null })
    expect(none.available).toBe(false)
    expect(() => none.post('x')).not.toThrow()
    expect(none.subscribe(() => {})()).toBeUndefined()
  })
})

describe('⚰️ the grant arrives in a LATER TASK — the defect this replaced', () => {
  it('a callback invoked a task later is still LEADER', async () => {
    // The first version settled FOLLOWER after two microtasks "in case the
    // request never answers". Real `navigator.locks.request` calls back in a
    // later TASK, so that fallback would have beaten every genuine grant: no
    // tab would ever lead, nothing would ever drain, and every rail here would
    // still be green — because the fake in this file grants almost
    // synchronously. A fixture that cannot distinguish is not a rail.
    const nav = {
      locks: {
        request: (name, opts, cb) => new Promise((resolve) => {
          setTimeout(() => resolve(cb({ name })), 5)
        }),
      },
    }
    const { role, release } = await claimSyncLeadership('acct1', { nav })
    expect(role).toBe(LEADER)
    release()
  })

  it('a request that never answers settles FOLLOWER — the safe half', async () => {
    const nav = { locks: { request: () => new Promise(() => {}) } }
    const { role } = await claimSyncLeadership('acct1', { nav, decideAfterMs: 5 })
    expect(role).toBe(FOLLOWER)
    expect(role).not.toBe(LEADER)
  })

  it('⛔ and a lock granted after that timeout is RELEASED, not silently held', async () => {
    // Holding a lock we have already told the caller we do not have is a
    // deadlock for the whole account: no other tab can ever take it, and this
    // one will not drain either.
    let heldForever = null
    const nav = {
      locks: {
        request: (name, opts, cb) => new Promise((resolve) => {
          setTimeout(() => {
            const ret = cb({ name })
            heldForever = ret !== undefined
            resolve()
          }, 15)
        }),
      },
    }
    const { role } = await claimSyncLeadership('acct1', { nav, decideAfterMs: 1 })
    expect(role).toBe(FOLLOWER)
    await new Promise((r) => setTimeout(r, 40))
    expect(heldForever).toBe(false)
  })
})

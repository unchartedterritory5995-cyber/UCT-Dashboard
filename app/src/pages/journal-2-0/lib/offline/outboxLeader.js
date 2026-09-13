/**
 * Wave Q1 — exactly one tab drains an account's outbox.
 *
 * ⛔⛔ THE FAILURE THIS PREVENTS IS BROWSER-TAB ORDERING BECOMING SILENT
 * LAST-WRITE-WINS. Two tabs holding the same note offline, both persisting
 * locally, one reconnecting first: without leadership they both push, and which
 * version the server ends up with is decided by scheduling luck. That is the
 * thing Wave Q exists to make impossible.
 *
 * ⭐ Web Locks is the right primitive and it is AVAILABLE AND GRANTED on the
 * production origin (Chrome 152, measured: `navigator.locks.request(...,
 * {ifAvailable:true})` returned a lock). The lock is held for the life of the
 * session — that is what "leader" means — and released when the tab goes away,
 * which is exactly the lifetime the browser already manages for us.
 *
 * ⛔ AND THE FALLBACK IS NOT "EVERYONE TRIES". Where Web Locks is missing, this
 * tab declares itself READ-ONLY FOR SYNC: it still edits, still persists
 * durably, still queues — it simply does not drain. A degraded mode that races
 * would be worse than one that waits, because the race corrupts and the wait
 * only delays.
 *
 * ⛔ BroadcastChannel is a HINT CHANNEL, never a data channel. "Something
 * changed, re-read it" — never the change itself.
 */

export const LEADER = 'leader'
export const FOLLOWER = 'follower'
export const READ_ONLY_FOR_SYNC = 'read-only-for-sync'

export const lockNameFor = (accountId) => `uct.nb.sync.${accountId}`
export const channelNameFor = (accountId) => `uct.nb.${accountId}`

export function webLocksAvailable(nav = globalThis.navigator) {
  return typeof nav?.locks?.request === 'function'
}

/**
 * Try to become the tab that drains this account's outbox.
 *
 * Resolves as soon as the ROLE is known — it does not wait for a lock another
 * tab is holding, because a follower still has work to do (edit, persist,
 * queue) and must not be blocked behind the leader's lifetime.
 *
 * @returns { role, release() }
 */
export function claimSyncLeadership(accountId, {
  nav = globalThis.navigator,
  decideAfterMs = 2000,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
} = {}) {
  if (!accountId) throw new Error('outboxLeader: an accountId is required')
  if (!webLocksAvailable(nav)) {
    // ⛔ Degrade to waiting, never to racing.
    return Promise.resolve({ role: READ_ONLY_FOR_SYNC, release: () => {} })
  }
  const name = lockNameFor(accountId)
  return new Promise((resolve) => {
    let releaseHeld = null
    const held = new Promise((r) => { releaseHeld = r })
    let settled = false
    let timer = null
    const settle = (role) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimer(timer)
      resolve({ role, release: () => releaseHeld && releaseHeld() })
    }

    // ⛔⛔ A BOUNDED WAIT, NOT A MICROTASK RACE. `navigator.locks.request`
    // invokes its callback in a LATER TASK — an earlier version of this
    // settled FOLLOWER after two microtasks, which in a real browser would
    // have beaten every genuine grant and left the account with no leader at
    // all: nothing drains, and every check stays green. A tab with no answer
    // after this long is a follower, which is the safe half.
    timer = setTimer(() => settle(FOLLOWER), decideAfterMs)

    nav.locks.request(name, { ifAvailable: true }, (lock) => {
      if (!lock) {
        // Somebody else already leads. We are a follower — and we do NOT sit in
        // a retry loop: leadership changes when a tab closes, and the browser
        // hands the lock on by itself when we ask for it without ifAvailable.
        settle(FOLLOWER)
        return undefined
      }
      // ⛔ We already told the caller we are not the leader. Returning here
      // RELEASES the lock immediately rather than holding one nobody believes
      // we have — a held-but-disowned lock is a deadlock for the account.
      if (settled) return undefined
      settle(LEADER)
      return held           // hold the lock until release() is called
    }).catch(() => settle(READ_ONLY_FOR_SYNC))
  })
}

/**
 * Wait for leadership to become available, then take it. Used by a follower
 * once the leader's tab closes. ⛔ No polling — the browser queues the request.
 */
export function awaitSyncLeadership(accountId, { nav = globalThis.navigator, signal } = {}) {
  if (!webLocksAvailable(nav)) {
    return Promise.resolve({ role: READ_ONLY_FOR_SYNC, release: () => {} })
  }
  return new Promise((resolve, reject) => {
    let releaseHeld = null
    const held = new Promise((r) => { releaseHeld = r })
    nav.locks.request(lockNameFor(accountId), { signal }, () => {
      resolve({ role: LEADER, release: () => releaseHeld && releaseHeld() })
      return held
    }).catch(reject)
  })
}

/** A hint channel. ⛔ Messages say WHAT changed, never carry the change. */
export function createChangeChannel(accountId, { Channel = globalThis.BroadcastChannel } = {}) {
  if (typeof Channel !== 'function') {
    return { post: () => {}, subscribe: () => () => {}, close: () => {}, available: false }
  }
  const ch = new Channel(channelNameFor(accountId))
  return {
    available: true,
    post: (kind, payload = {}) => {
      // ⛔ Deliberately small and non-authoritative: an id and a verb.
      try { ch.postMessage({ kind, ...payload, at: Date.now() }) } catch { /* closed */ }
    },
    subscribe: (fn) => {
      const on = (e) => fn(e?.data || {})
      ch.addEventListener('message', on)
      return () => ch.removeEventListener('message', on)
    },
    close: () => { try { ch.close() } catch { /* already closed */ } },
  }
}

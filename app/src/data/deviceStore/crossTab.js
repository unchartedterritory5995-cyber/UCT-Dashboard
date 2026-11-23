// app/src/data/deviceStore/crossTab.js — ONE owner of the device store's files across every tab.
//
// An OPFS FileSystemSyncAccessHandle is exclusive: one per file, origin-wide. So every tab runs its own
// worker, and the workers elect a LEADER with a Web Lock: the lock's holder opens the files and serves
// reads; every other worker is a follower that asks the leader over a BroadcastChannel and gets the
// columns back (structured clone, ~a few hundred microseconds for 1,000 bars). When the leader's tab
// closes, the browser releases its lock (and its file handles with its worker), and the next waiting
// worker becomes the leader and opens the files itself.
//
// A follower's read the leader does not answer within `timeoutMs` (a leader changing hands, a frozen
// tab) resolves null: the chart then waits for the server exactly as it does without this store.
// Without Web Locks (very old engines) every tab serves itself; the exclusive handle then lets only
// the first tab open the files, and the others read null.

export const LEADER_LOCK = 'uct-device-store:leader'
export const CHANNEL_NAME = 'uct-device-store'

/**
 * @param {object} o
 * @param {{request:Function}|null} o.locks        navigator.locks (null → serve itself)
 * @param {(name:string)=>{postMessage:Function, onmessage:any, close:Function}|null} o.makeChannel
 * @param {string} o.tabId
 * @param {() => Promise<void>|void} o.onLeader     called once, when this worker becomes the leader
 * @param {(req:object) => any} o.serve             the leader's handler (reads, ingest kicks)
 * @param {(event:object) => void} [o.onEvent]      another tab's broadcast
 */
export function createCrossTab({
  locks, makeChannel, tabId, onLeader, serve, onEvent = null, timeoutMs = 300,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h),
} = {}) {
  let leader = false
  let closed = false
  let releaseLock = null
  let leaderReady = null
  let seq = 0
  const pending = new Map()
  let ch = null
  try { ch = makeChannel ? makeChannel(CHANNEL_NAME) : null } catch { ch = null }
  // The leader's own serve threw (an engine that cannot read its file, a handler bug): a MISS, never an error. The
  // read answers null and the chart asks the server, as when no copy is held. COUNTED (TERM-033,
  // lib/swallowedFetch.census.test.js) on both paths, this worker's own read and a follower's over the channel, and
  // carried by the worker's `info` answer (workerCore), so a failing store is visible instead of reading as empty.
  let serveFailures = 0
  let lastServeError = null
  const _noteServeFailure = (err) => { serveFailures += 1; lastServeError = String(err?.message || err).slice(0, 120) }
  const _servedNothing = (err) => { _noteServeFailure(err); return null }

  const _become = () => {
    leader = true
    leaderReady = Promise.resolve().then(() => onLeader?.()).catch(() => {})
    return leaderReady
  }

  if (ch) {
    ch.onmessage = (e) => {
      const m = e?.data
      if (!m || closed) return
      if (m.type === 'req') {
        if (!leader) return
        Promise.resolve(leaderReady).then(() => serve(m.req)).then(
          (res) => { try { ch.postMessage({ type: 'res', to: m.from, id: m.id, res: res ?? null }) } catch { /* closed */ } },
          (err) => {
            _noteServeFailure(err)
            try { ch.postMessage({ type: 'res', to: m.from, id: m.id, res: null, error: String(err?.message || err) }) } catch { /* closed */ }
          },
        )
      } else if (m.type === 'res') {
        if (m.to !== tabId) return
        const p = pending.get(m.id)
        if (!p) return
        pending.delete(m.id)
        clearTimer(p.timer)
        p.resolve(m.res ?? null)
      } else if (m.type === 'event') {
        try { onEvent?.(m.event) } catch { /* listener */ }
      }
    }
  }

  // ⭐ THE ROLE IS KNOWN BEFORE THE FIRST REQUEST IS ROUTED. A lock is granted asynchronously, so a
  // request made in the worker's first moments would otherwise be routed as a FOLLOWER's (over the
  // channel, to nobody) and time out: measured in Chromium, a lone tab's first ingest kick was lost
  // that way. So: ask with `ifAvailable` first (answered at once, granted or null); granted → leader;
  // null → a follower, queued for the lock in case the leader goes. Requests wait for that answer.
  const _hold = () => new Promise((resolve) => { releaseLock = resolve })   // until close() / worker exit
  let roleKnown = Promise.resolve()
  if (locks && typeof locks.request === 'function') {
    roleKnown = new Promise((known) => {
      try {
        Promise.resolve(locks.request(LEADER_LOCK, { ifAvailable: true }, (lock) => {
          if (closed) { known(); return undefined }
          if (lock) { _become(); known(); return _hold() }
          known()
          Promise.resolve(locks.request(LEADER_LOCK, () => {
            if (closed) return undefined
            _become()
            return _hold()
          })).catch(() => {})
          return undefined
        })).catch(() => known())
      } catch { _become(); known() }
    })
  } else {
    _become()
  }

  function route(req) {
    if (closed) return Promise.resolve(null)
    if (leader) return Promise.resolve(leaderReady).then(() => serve(req)).catch(_servedNothing)
    if (!ch) return Promise.resolve(null)
    const id = `${tabId}:${++seq}`
    return new Promise((resolve) => {
      const timer = setTimer(() => { pending.delete(id); resolve(null) }, timeoutMs)
      pending.set(id, { resolve, timer })
      try { ch.postMessage({ type: 'req', from: tabId, id, req }) } catch { clearTimer(timer); pending.delete(id); resolve(null) }
    })
  }

  return {
    isLeader: () => leader,
    /** Diagnostics: the leader's serve failures (each answered null), and the last one's cause. */
    stats: () => ({ serveFailures, lastServeError }),
    /** Resolves once this worker knows whether it leads (tests, diagnostics). */
    roleKnown: () => roleKnown,
    /** Ask the leader (this worker itself when it leads). Resolves the answer, or null. Never rejects. */
    request(req) {
      if (closed) return Promise.resolve(null)
      return roleKnown.then(() => route(req))
    },
    /** Tell every other tab's worker (a new generation landed). */
    broadcast(event) {
      if (!ch || closed) return
      try { ch.postMessage({ type: 'event', from: tabId, event }) } catch { /* closed */ }
    },
    close() {
      if (closed) return
      closed = true
      leader = false
      try { releaseLock?.() } catch { /* released */ }
      for (const p of pending.values()) { clearTimer(p.timer); p.resolve(null) }
      pending.clear()
      try { ch?.close() } catch { /* closed */ }
    },
  }
}

// Recovery after the machine wakes or the network comes back (desktop plan 6.4), for every member.
//
// Before this, each piece recovered on its own trigger and nothing ordered them: the live streams
// waited for their 30 s / 45 s silence watchdogs or a backoff already up to 20 s, sign-in was
// re-checked only on a visibility change (which the desktop app may never fire, because the shell
// does not throttle its window), and the desktop stale banner cleared on a blind 20 s timer whether
// or not anything had recovered. Now one sequence runs:
//
//   1. re-check sign-in (a dropped session signs out and AuthGuard sends the member to /login)
//   2. reconnect every live stream at once (the bars stream's reconnect gap-backfills each chart)
//   3. wait until every stream reports connected (capped at CAP_MS)
//   4. only then report 'idle' again, which is what clears the banner
//
// Triggers: the window 'online' event; a wake, seen as a gap between two TICK_MS ticks longer than
// WAKE_GAP_MS (timers do not run while the machine sleeps); and a page coming back after being
// hidden for at least WAKE_GAP_MS. 'offline' parks the state at 'offline' until 'online'.
//
// Steps and timers are injected, so every rule is unit-tested without a browser.

export const TICK_MS = 5000
export const WAKE_GAP_MS = 60000
export const AUTH_TIMEOUT_MS = 8000
export const CAP_MS = 20000
export const POLL_MS = 250

export function createRecovery({
  recheckAuth = async () => {},
  reconnectStreams = () => {},
  streamsConnected = () => true,
  isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let state = isOnline() ? 'idle' : 'offline'
  let run = 0 // a newer run supersedes an older one's late steps
  let lastReason = null
  const listeners = new Set()

  const set = (next) => {
    if (next === state) return
    state = next
    for (const l of listeners) { try { l(state) } catch { /* a bad listener never breaks recovery */ } }
  }
  const sleep = (ms) => new Promise((r) => setTimer(r, ms))
  const withTimeout = (p, ms) => Promise.race([Promise.resolve(p).catch(() => {}), sleep(ms)])

  async function trigger(reason) {
    lastReason = reason
    if (!isOnline()) { set('offline'); return }
    if (state === 'recovering') return // one sequence at a time; it already covers this wake
    const mine = ++run
    set('recovering')
    await withTimeout(recheckAuth(), AUTH_TIMEOUT_MS)
    if (mine !== run) return
    try { reconnectStreams() } catch { /* the managers' own watchdogs remain the fallback */ }
    const deadline = now() + CAP_MS
    while (mine === run && now() < deadline) {
      let ok = false
      try { ok = !!streamsConnected() } catch { ok = false }
      if (ok) break
      await sleep(POLL_MS)
    }
    if (mine === run) set(isOnline() ? 'idle' : 'offline')
  }

  function goOffline() {
    run++ // abandon a sequence in flight
    set('offline')
  }

  /** Watch the window for online/offline, wakes and long-hidden returns. Returns an uninstall. */
  function install(win = typeof window !== 'undefined' ? window : null, doc = typeof document !== 'undefined' ? document : null) {
    if (!win) return () => {}
    const onOnline = () => { trigger('online') }
    const onOffline = () => goOffline()
    let last = now()
    const tick = () => {
      const t = now()
      const gap = t - last
      last = t
      if (gap > WAKE_GAP_MS) trigger('wake')
      timer = setTimer(tick, TICK_MS)
    }
    let timer = setTimer(tick, TICK_MS)
    let hiddenAt = null
    const onVis = () => {
      if (!doc) return
      if (doc.visibilityState === 'hidden') { hiddenAt = now(); return }
      if (hiddenAt !== null && now() - hiddenAt >= WAKE_GAP_MS) trigger('visible-after-hidden')
      hiddenAt = null
    }
    win.addEventListener('online', onOnline)
    win.addEventListener('offline', onOffline)
    doc?.addEventListener('visibilitychange', onVis)
    return () => {
      clearTimer(timer)
      win.removeEventListener('online', onOnline)
      win.removeEventListener('offline', onOffline)
      doc?.removeEventListener('visibilitychange', onVis)
    }
  }

  return {
    trigger,
    goOffline,
    install,
    getState: () => state,
    lastReason: () => lastReason,
    subscribe(l) { listeners.add(l); return () => listeners.delete(l) },
  }
}

// ── The app's one instance ─────────────────────────────────────────────────
// It acts on what lib/recoveryRegistry.js holds: AuthContext's identity re-check, and every live
// stream manager that has loaded (each registers itself), so recovery reconnects exactly the streams
// this page uses. AuthContext installs the triggers.
import { recoveryAuthCheck, recoveryStreams, setRecoveryAuthCheck, registerRecoveryStream, __resetRecoveryRegistryForTests } from './recoveryRegistry'

export { setRecoveryAuthCheck, registerRecoveryStream }

let _app = null
export function appRecovery() {
  if (_app) return _app
  _app = createRecovery({
    recheckAuth: () => { const fn = recoveryAuthCheck(); return fn ? fn() : undefined },
    reconnectStreams: () => { for (const s of recoveryStreams()) { try { s.reconnectNow() } catch { /* its watchdog covers it */ } } },
    streamsConnected: () => recoveryStreams().every((s) => { try { return s.isConnected() } catch { return true } }),
  })
  return _app
}

export function __resetAppRecoveryForTests() { _app = null; __resetRecoveryRegistryForTests() }

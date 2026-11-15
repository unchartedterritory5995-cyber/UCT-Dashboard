// "UCT is updating": the deploy gap, said once, instead of every widget failing on its own (2026-11-12).
//
// Measured 2026-11-12 05:33 UTC: Railway runs ONE web pod on a volume, so every deploy is a gap — the old
// pod stopped, the new one started 12 s later and answered 28 s after that: ~40 s in which every request
// got a 502 from the edge (some hung 15 s first). Each SWR hook then failed and retried on its own, and
// members saw error states scattered over the page.
//
// This module notices the gap (two gateway errors, 502 or 504, within GAP_WINDOW_MS — one stray 502 is not
// a deploy), says so once (ServerUpdatingBanner), checks /api/health every POLL_MS, and the moment the new
// pod answers it asks every SWR key on the page to revalidate, so the screen fills in by itself.
// A 503 is NOT counted: endpoints answer 503 "warming" on purpose, and that is a different message.
export const GAP_STATUSES = new Set([502, 504])
export const GAP_WINDOW_MS = 15_000
export const POLL_MS = 2_000
export const GIVE_UP_MS = 5 * 60_000

export function createServerGap({
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  checkHealth = () => fetch('/api/health', { cache: 'no-store' }).then((r) => r.ok, () => false),
  onBack = () => {},
} = {}) {
  let hits = []
  let state = 'ok' // 'ok' | 'updating'
  let since = 0
  const listeners = new Set()
  const emit = () => { for (const fn of [...listeners]) fn(state) }

  const poll = () => setTimer(async () => {
    if (state !== 'updating') return
    let ok = false
    try { ok = await checkHealth() } catch { ok = false }
    if (ok) {
      state = 'ok'
      hits = []
      emit()
      try { onBack() } catch { /* a refresh that throws must not keep the banner up */ }
      return
    }
    if (now() - since > GIVE_UP_MS) { state = 'ok'; hits = []; emit(); return }
    poll()
  }, POLL_MS)

  return {
    /** Any failed request may report its status; only gateway errors count. */
    report(status) {
      if (!GAP_STATUSES.has(status) || state === 'updating') return
      const t = now()
      hits = hits.filter((h) => t - h < GAP_WINDOW_MS)
      hits.push(t)
      if (hits.length < 2) return
      state = 'updating'
      since = t
      emit()
      poll()
    },
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

let _app = null
/** The page's one detector. `onBack` revalidates every SWR key (wired in App.jsx). */
export function appServerGap(onBack) {
  if (!_app) _app = createServerGap({ onBack: () => _onBack() })
  if (onBack) _onBack = onBack
  return _app
}
let _onBack = () => {}

/** Tests only. */
export function __resetServerGapForTests() { _app = null; _onBack = () => {} }

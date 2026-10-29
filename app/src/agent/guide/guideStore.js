// ── UCT Agent PRODUCT GUIDE: the one walkthrough on screen, as state ──────────────────────────────────────
//
// Tiny and synchronous: the Agent's `guide.show` starts a walkthrough, GuideOverlay renders it and moves it on
// (Next / Back / Exit, or the step's own `waitFor`), and anything may end it. One at a time — starting another ends
// the first. Session-only: nothing persists, nothing reaches the server.
//
// `lastShown` remembers the feature the member was last shown (and on which chart), for "now do it for me".

const subs = new Set()
let state = null            // { feature, steps, index, chartRef, chartLabel, startedAt } | null
let ended = null            // { featureId, reason, at } — why the last walkthrough stopped
let lastShown = null        // { featureId, chartRef, at }
let seq = 0

export const LAST_SHOWN_TTL_MS = 10 * 60 * 1000

/** How long "the guide stopped" stays on screen after a walkthrough lost its control. */
export const NOTICE_MS = 5000
let notice = null           // a sentence the overlay shows after a walkthrough ended on its own
let noticeTimer = null
let snap = { state: null, notice: null }
const emit = () => {
  snap = { state, notice }
  for (const fn of [...subs]) { try { fn(state) } catch { /* a listener's own problem */ } }
}
/** One stable snapshot per change (useSyncExternalStore): the walkthrough and any notice. */
export function guideSnapshot() { return snap }

export function subscribeGuide(fn) { subs.add(fn); return () => subs.delete(fn) }
export function guideState() { return state }
export function guideEnded() { return ended }

/** Start a walkthrough of `feature` on `chartRef` (null: a board-level feature). Ends any other first. */
export function startGuide(feature, { chartRef = null, chartLabel = null, steps = null, now = Date.now() } = {}) {
  if (!feature) return null
  const list = (steps || feature.steps || []).filter(Boolean)
  if (!list.length) return null
  state = { id: ++seq, feature, steps: list, index: 0, chartRef, chartLabel, startedAt: now }
  ended = null
  notice = null
  lastShown = { featureId: feature.id, chartRef, chartLabel, at: now }
  emit()
  return state
}
export function nextStep() {
  if (!state) return
  if (state.index >= state.steps.length - 1) { endGuide('done'); return }
  state = { ...state, index: state.index + 1 }
  emit()
}
export function prevStep() {
  if (!state || state.index === 0) return
  state = { ...state, index: state.index - 1 }
  emit()
}
/** reason: 'done' | 'exit' | 'lost' (its control is gone) | 'replaced' | 'closed' (the Agent went away) */
export function endGuide(reason = 'exit') {
  if (!state) return
  ended = { featureId: state.feature.id, reason, at: Date.now() }
  state = null
  if (reason === 'lost') {
    notice = 'I can’t see that control on screen any more, so the guide stopped. Ask me to show you again when it’s back.'
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => { notice = null; emit() }, NOTICE_MS)
  }
  emit()
}
/** What the member was last shown, while it is recent — or null. */
export function lastShownGuide(now = Date.now()) {
  return lastShown && now - lastShown.at <= LAST_SHOWN_TTL_MS ? lastShown : null
}
export function forgetLastShown() { lastShown = null }

/** Rails only. */
export function _resetGuide() { clearTimeout(noticeTimer); state = null; ended = null; lastShown = null; notice = null; snap = { state: null, notice: null }; subs.clear() }

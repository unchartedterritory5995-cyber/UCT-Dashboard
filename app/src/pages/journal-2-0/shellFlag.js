import { useSyncExternalStore } from 'react'

// Journal 2.0 P4 runtime shell kill-switch. Mirrors the Phase-C bars-push gate
// (`StockChart.jsx` `uct.barsPush.enabled`) EXACTLY: an explicit per-browser
// localStorage override, a stable per-browser rollout bucket, a same-tab Event
// so consumers re-read instantly (no reload — the plan's runtime reversibility
// guarantee), and a `window.__uctJ2Shell(v)` DevTools handle.
//
// The 8→5 nav flip (Task A2+) is gated behind this: the /journal selector
// renders the NEW `JournalLayout` for 'v5' and the LEGACY `JournalTwoRoot`
// unchanged for 'v8'. The deploy freeze (9:15am–4:20pm ET options tape) makes a
// same-day deploy-rollback impossible, so the flip MUST be reversible at
// runtime — flip back to the 8-tab shell with `window.__uctJ2Shell('v8')`.
//
// ROLLOUT DIAL — % of browsers on the NEW shell BY DEFAULT (no explicit
// opt-in/out). 100 = fully rolled out: every browser gets the new shell unless
// it sets `uct.j2.shell`='v8'. Narrow the cohort = lower this + deploy (~10min);
// instant per-browser revert = `window.__uctJ2Shell('v8')`.
export const J2_SHELL_ROLLOUT_PCT = 100

const SHELL_KEY = 'uct.j2.shell'          // explicit override: 'v5' | 'v8'
const BUCKET_KEY = 'uct.j2.shell.bucket'  // stable per-browser rollout bucket
export const J2_SHELL_EVENT = 'uct-j2shell-change'

// Stable per-browser rollout bucket [0,100), assigned once + persisted so a
// browser's in/out status doesn't flip between renders (or as the dial ramps).
function _rolloutBucket() {
  try {
    let b = localStorage.getItem(BUCKET_KEY)
    if (b == null) { b = String(Math.floor(Math.random() * 100)); localStorage.setItem(BUCKET_KEY, b) }
    const n = parseInt(b, 10)
    return Number.isFinite(n) ? n : 100
  } catch { return 100 }  // no storage → out of rollout (safe default = legacy)
}

// Resolve the active shell: explicit 'v8'/'v5' override wins, else the staged
// percentage rollout keyed by the stable bucket. Never throws.
export function resolveJ2Shell() {
  try {
    const ls = typeof localStorage !== 'undefined' ? localStorage.getItem(SHELL_KEY) : null
    if (ls === 'v8') return 'v8'   // explicit legacy (instant per-browser revert)
    if (ls === 'v5') return 'v5'   // explicit new (canary / power user)
    return _rolloutBucket() < J2_SHELL_ROLLOUT_PCT ? 'v5' : 'v8'  // default: staged rollout
  } catch { return 'v8' }  // storage unavailable → safest fallback = legacy shell
}

// Operator/canary helper: set the shell override AND dispatch the same-tab event
// so the /journal selector re-reads immediately (no reload — instant runtime
// revert). From DevTools: window.__uctJ2Shell('v8') to force legacy,
// window.__uctJ2Shell('v5') to force new. Invalid values are a no-op.
export function setJ2Shell(v) {
  if (v !== 'v5' && v !== 'v8') return
  try {
    localStorage.setItem(SHELL_KEY, v)
    window.dispatchEvent(new Event(J2_SHELL_EVENT))
  } catch { /* ignore */ }
}
if (typeof window !== 'undefined') window.__uctJ2Shell = setJ2Shell

// ── React binding ────────────────────────────────────────────────────────────

// Subscribe to BOTH the same-tab change event AND the cross-tab `storage` event
// so a flip in this tab OR another tab re-renders every consumer.
function _subscribe(cb) {
  const onStorage = (e) => {
    if (e.key === SHELL_KEY || e.key === BUCKET_KEY || e.key == null) cb()
  }
  window.addEventListener(J2_SHELL_EVENT, cb)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(J2_SHELL_EVENT, cb)
    window.removeEventListener('storage', onStorage)
  }
}

// Returns the current shell ('v5' | 'v8') and re-renders on change. resolveJ2Shell
// returns a primitive so useSyncExternalStore's Object.is comparison is stable.
export function useJ2Shell() {
  return useSyncExternalStore(_subscribe, resolveJ2Shell, resolveJ2Shell)
}

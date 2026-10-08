// ── Waiting for React to commit — never for a PAINT ───────────────────────────────
//
// After a write that changes React state (a chart setting, a new widget, a list row), the
// Agent reads the result back. That read needs React to have COMMITTED, not the browser to
// have painted. React commits through its scheduler's MessageChannel tasks, which run in a
// background tab; requestAnimationFrame does NOT (Chrome never fires it while the tab is
// hidden). Measured 2026-10-08 in production: with the tab hidden, an Apply that the server
// had already accepted sat at "Working…" — no receipt, no Undo, no navigation — until the
// member came back.
//
// afterRender(): visible → one frame then a macrotask (as before: what the member sees has
// caught up). Hidden — or hidden WHILE waiting — → one MessageChannel macrotask, which Chrome
// does not throttle (timers it does, to 1/min after a while). Every caller already re-checks
// what it reads (`landed`, a bounded `waitForTarget`), so this only decides WHEN to look.

const mc = typeof MessageChannel === 'function' ? new MessageChannel() : null
const waiting = []
if (mc) mc.port1.onmessage = () => { const r = waiting.shift(); if (r) r() }

/** One macrotask, posted behind whatever React has already scheduled. */
export function macrotask() {
  return new Promise(resolve => {
    if (mc) { waiting.push(resolve); mc.port2.postMessage(0) } else setTimeout(resolve, 0)
  })
}

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

export function afterRender() {
  if (typeof requestAnimationFrame !== 'function' || hidden()) return macrotask()
  return new Promise(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      document.removeEventListener('visibilitychange', onVisibility)
      resolve()
    }
    // Hidden while waiting: the frame may never come — continue on a macrotask instead.
    const onVisibility = () => { if (hidden()) macrotask().then(finish) }
    document.addEventListener('visibilitychange', onVisibility)
    requestAnimationFrame(() => setTimeout(finish, 0))
  })
}

/** Run fn once the page is visible (now, if it already is). Returns a cancel function. */
export function whenVisible(fn) {
  if (!hidden()) { fn(); return () => {} }
  const on = () => { if (!hidden()) { document.removeEventListener('visibilitychange', on); fn() } }
  document.addEventListener('visibilitychange', on)
  return () => document.removeEventListener('visibilitychange', on)
}

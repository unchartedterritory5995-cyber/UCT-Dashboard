// Run `fn` once the browser is idle (N4, polish round): `requestIdleCallback` where the browser has
// it (Safari does not), else a short timeout. Returns a cancel function, so a component that
// schedules on mount can call it off on unmount.
//
// `timeout` bounds how long an idle callback may be put off on a busy page; `fallbackMs` is the
// delay used where there is no idle callback at all. Both are small: this is for work that should
// happen soon after first paint, never for work that can wait indefinitely.
export const IDLE_TIMEOUT_MS = 2000
export const FALLBACK_MS = 200

export default function whenIdle(fn, { timeout = IDLE_TIMEOUT_MS, fallbackMs = FALLBACK_MS, win = globalThis.window } = {}) {
  if (win && typeof win.requestIdleCallback === 'function') {
    const handle = win.requestIdleCallback(() => fn(), { timeout })
    return () => { if (typeof win.cancelIdleCallback === 'function') win.cancelIdleCallback(handle) }
  }
  const timer = setTimeout(fn, fallbackMs)
  return () => clearTimeout(timer)
}

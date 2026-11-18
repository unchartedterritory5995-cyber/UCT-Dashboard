// Is the member looking at the app at all? The answer SWR uses to decide whether to poll.
//
// In a browser this is just the page's own visibility. In the desktop app the page cannot know:
// the shell turns off background throttling, so a minimized window still reports
// `document.visibilityState === 'visible'` and every SWR poll kept running at full rate (measured,
// desktop Task 12 P4). The shell reports the WHOLE desk instead (`desk-visibility`: hidden only when
// every app window is hidden or minimized), and this module folds that in.
//
// What stops while hidden: SWR's interval polling (its `isVisible` config reads `isAppVisible`).
// What does NOT stop: the live price and bar streams and alert delivery, which are not SWR polls.
// When the desk comes back, each poll resumes on its next interval.

let deskHidden = false
const listeners = new Set()

export function setDeskHidden(hidden) {
  const next = !!hidden
  if (next === deskHidden) return
  deskHidden = next
  for (const l of [...listeners]) { try { l(deskHidden) } catch { /* one bad listener never breaks the rest */ } }
}

export function isDeskHidden() { return deskHidden }

/** SWR's `isVisible`: false while the desktop desk is hidden, or while a browser tab is hidden. */
export function isAppVisible() {
  if (deskHidden) return false
  try {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden'
  } catch {
    return true
  }
}

export function onDeskHiddenChange(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Test seam. */
export function __resetDeskVisibility() { deskHidden = false; listeners.clear() }

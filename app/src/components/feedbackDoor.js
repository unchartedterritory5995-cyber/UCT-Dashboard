// The Help & Feedback menu's door for a surface that does not draw its "?" (the phone Notebook, S12: its "+" sheet's
// "Help & feedback" row). It opens the SAME FeedbackWidget menu -- the one Help menu (S14: Search help, Quick answers,
// Keyboard shortcuts, Tours, Send feedback; a ticket is one step on, from Send feedback) -- never a second form.
// Tier 1b fix round 1, review Minor 8.
export const OPEN_FEEDBACK_EVENT = 'uct:open-feedback'

// Fix round 2 (re-review N2): `returnTo` is the control that opened it (the "+"): Escape hands focus back THERE, not to
// a "?" that is not drawn. The menu opens on the NEXT frame, after the opener's own sheet has restored its focus, so
// the menu's first item keeps the focus it takes.
// S14: whether a FeedbackWidget is mounted to answer the door. With the touch hub up, Layout does not mount it (the
// hub carries its own feedback control), so a page's Help button asks here first and falls back to the Support page.
let menusMounted = 0
export function markFeedbackMenuMounted() {
  menusMounted += 1
  return () => { menusMounted -= 1 }
}
export const feedbackMenuMounted = () => menusMounted > 0

export function openFeedback(mode = 'menu', returnTo = null, { toggle = false } = {}) {
  if (typeof window === 'undefined') return
  const fire = () => window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK_EVENT, { detail: { mode, returnTo, toggle } }))
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(fire)
  else fire()
}

// S14 (audit 2026-11-05, details #3-#5): ONE Help menu. The corner "?" (FeedbackWidget) and the Journal header's
// "?" (keyboard shortcuts) were two buttons with two jobs. The menu is FeedbackWidget's; a page that draws its own
// Help button registers here as a HELP HOST (the corner "?" steps aside while one is mounted, so exactly one "?" is on
// screen), and a page that has a keyboard-shortcut sheet registers as the SHORTCUTS HOST (the menu's "Keyboard
// shortcuts" row opens it; with no host, the row is not offered). Module state, read with useSyncExternalStore.
let helpHosts = 0
let shortcutsHost = null
const hostListeners = new Set()
const emitHosts = () => { for (const fn of Array.from(hostListeners)) fn() }

export function subscribeHelpHosts(fn) {
  hostListeners.add(fn)
  return () => hostListeners.delete(fn)
}

/** A page's own Help button is on screen: returns the release. */
export function registerHelpHost() {
  helpHosts += 1
  emitHosts()
  let released = false
  return () => {
    if (released) return
    released = true
    helpHosts -= 1
    emitHosts()
  }
}
export const helpHostMounted = () => helpHosts > 0

/** `open()` shows the page's keyboard-shortcut sheet: returns the release. */
export function registerShortcutsHost(open) {
  shortcutsHost = open
  emitHosts()
  return () => {
    if (shortcutsHost === open) shortcutsHost = null
    emitHosts()
  }
}
export const shortcutsHostOpen = () => shortcutsHost

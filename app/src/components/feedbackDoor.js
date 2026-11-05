// The Help & Feedback menu's door for a surface that does not draw its "?" (the phone Notebook, S12: its "+" sheet's
// "Help & feedback" row). It opens the SAME FeedbackWidget menu -- Send Feedback and Submit a ticket -- never a second
// form. Tier 1b fix round 1, review Minor 8.
export const OPEN_FEEDBACK_EVENT = 'uct:open-feedback'

// Fix round 2 (re-review N2): `returnTo` is the control that opened it (the "+"): Escape hands focus back THERE, not to
// a "?" that is not drawn. The menu opens on the NEXT frame, after the opener's own sheet has restored its focus, so
// the menu's first item keeps the focus it takes.
export function openFeedback(mode = 'menu', returnTo = null) {
  if (typeof window === 'undefined') return
  const fire = () => window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK_EVENT, { detail: { mode, returnTo } }))
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(fire)
  else fire()
}

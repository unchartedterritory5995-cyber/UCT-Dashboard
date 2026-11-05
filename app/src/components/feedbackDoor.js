// The Help & Feedback menu's door for a surface that does not draw its "?" (the phone Notebook, S12: its "+" sheet's
// "Help & feedback" row). It opens the SAME FeedbackWidget menu -- Send Feedback and Submit a ticket -- never a second
// form. Tier 1b fix round 1, review Minor 8.
export const OPEN_FEEDBACK_EVENT = 'uct:open-feedback'

export function openFeedback(mode = 'menu') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK_EVENT, { detail: { mode } }))
}

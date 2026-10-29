// ── UCT Agent PRODUCT GUIDE: where the step card sits, and the walkthrough's timing ─────────────────────────

/** How often a step's control is re-found (scrolling, resizing, a panel opening or closing). */
export const POLL_MS = 120
/** How long a step's control may be gone before the walkthrough ends (or an optional step is skipped). */
export const LOST_MS = 2000
const CARD_W = 300
const GAP = 10

export const sameRect = (a, b) => !!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5

/** Where the card goes: below the control if it fits, else above, else level with it — always inside the window. */
export function placeCard(rect, { vw, vh, cardH = 140, cardW = CARD_W, margin = 12 } = {}) {
  const w = Math.min(cardW, vw - margin * 2)
  if (!rect) return { top: margin, left: margin, width: w }
  let top = rect.top + rect.height + GAP
  if (top + cardH > vh - margin) top = rect.top - GAP - cardH
  if (top < margin) top = Math.min(Math.max(margin, rect.top), vh - cardH - margin)
  let left = rect.left
  if (left + w > vw - margin) left = vw - margin - w
  if (left < margin) left = margin
  return { top: Math.round(top), left: Math.round(left), width: w }
}

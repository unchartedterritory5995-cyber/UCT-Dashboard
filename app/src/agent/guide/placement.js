// ── UCT Agent PRODUCT GUIDE: where the step card sits, and the walkthrough's timing ─────────────────────────

/** How often a step's control is re-found (scrolling, resizing, a panel opening or closing). */
export const POLL_MS = 120
/** How long a step's control may be gone before the walkthrough ends (or an optional step is skipped). */
export const LOST_MS = 2000
/** How soon after the member's press a control's going away counts as that press's doing. */
export const CLICK_MS = 1500
/** How long a `late` step (one that may simply not apply) is looked for. */
export const LATE_MS = 700
/** How long a walkthrough waits, paused, for a control that went away with no earlier step to return to (a layout switch,
 *  a panel closed). It carries on by itself the moment the control is back; after this it stops and says so. */
export const PAUSE_MS = 30000
const CARD_W = 300
const GAP = 10

export const sameRect = (a, b) => !!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5

const hits = (a, b) => !!a && !!b && a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top

/** Where the card goes: below the control if it fits, else above, else beside it, always inside the window and ⛔ NEVER on
 *  top of the control. `avoid`: boxes to stay off when there is room (the menu or window the control sits in, so the
 *  member can see what they are working in). `cardH` is measured by the overlay once the card has rendered. */
// `pointer`: a box around where the member's pointer is. The card never lands under it: a hover menu (Layouts ▾) closes the
// moment the pointer is over something outside it, and a card that moved under the pointer would close it (pl-teach round 4)
export function placeCard(rect, { vw, vh, cardH = 140, cardW = CARD_W, margin = 12, avoid = [], pointer = null } = {}) {
  const w = Math.min(cardW, vw - margin * 2)
  // no control found yet ("Looking for it…"): a corner, never the one under the pointer
  if (!rect) {
    const box0 = (t, l) => ({ top: t, left: l, width: w, height: cardH })
    const corners = [[margin, margin], [margin, vw - margin - w], [vh - cardH - margin, vw - margin - w], [vh - cardH - margin, margin]]
    const [t, l] = corners.find(([t, l]) => !pointer || !hits(box0(t, l), pointer)) || corners[0]
    return { top: Math.round(t), left: Math.round(l), width: w }
  }
  const clampL = (l) => Math.max(margin, Math.min(l, vw - margin - w))
  const clampT = (t) => Math.max(margin, Math.min(t, vh - cardH - margin))
  const spots = [
    { top: rect.top + rect.height + GAP, left: clampL(rect.left), fits: rect.top + rect.height + GAP + cardH <= vh - margin },
    { top: rect.top - GAP - cardH, left: clampL(rect.left), fits: rect.top - GAP - cardH >= margin },
    { top: clampT(rect.top), left: rect.left + rect.width + GAP, fits: rect.left + rect.width + GAP + w <= vw - margin },
    { top: clampT(rect.top), left: rect.left - GAP - w, fits: rect.left - GAP - w >= margin },
  ]
  // the outside edges of what to stay off: beside the menu or window, not merely beside the control inside it
  for (const b of avoid) {
    spots.push({ top: clampT(rect.top), left: b.left + b.width + GAP, fits: b.left + b.width + GAP + w <= vw - margin })
    spots.push({ top: clampT(rect.top), left: b.left - GAP - w, fits: b.left - GAP - w >= margin })
    spots.push({ top: b.top + b.height + GAP, left: clampL(rect.left), fits: b.top + b.height + GAP + cardH <= vh - margin })
  }
  const box = (s) => ({ top: s.top, left: s.left, width: w, height: cardH })
  const fitting = spots.filter(s => s.fits && (!pointer || !hits(box(s), pointer)))
  const best = fitting.find(s => !avoid.some(b => hits(box(s), b)) && !hits(box(s), rect))
    || fitting.find(s => !hits(box(s), rect))
    // nothing fits beside it (a very small window): the corner furthest from the control, still off it where that is possible
    || [{ top: margin, left: margin }, { top: margin, left: vw - margin - w }, { top: vh - cardH - margin, left: margin }, { top: vh - cardH - margin, left: vw - margin - w }]
      .find(s => !hits(box(s), rect) && (!pointer || !hits(box(s), pointer)))
    || { top: margin, left: margin }
  return { top: Math.round(best.top), left: Math.round(best.left), width: w }
}

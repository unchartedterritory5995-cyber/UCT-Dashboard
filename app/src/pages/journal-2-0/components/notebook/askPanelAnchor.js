// Which edge of its toggle the desktop Ask panel hangs from. Pure, so the rail can feed it;
// its own module so AskPanel.jsx keeps exporting only components (fast refresh).
//
// The panel is `position:absolute; right:0; width:400px` on a toggle that may sit anywhere.
// On Research Home the toggle is at the far right, so hanging from the right edge fits. On a
// note page the toggle sits near the LEFT edge of the note pane, which scrolls
// (`overflow-y:auto` clips both axes), so a right-hung panel reached ~150 px past the pane's
// left edge and its first ~60 px rendered under the folder sidebar ("s note", "ode is QX-7731":
// fin-walk record, both 2026-10-08 production runs). Measured, not styled: a 400 px panel that
// would cross the clipping ancestor's left edge hangs from the toggle's left edge instead; one
// that would then cross the right edge stays where it was (no anchoring fits, the wider one
// loses less). `null` bounds (jsdom, no ancestor) keep the default.

export function choosePanelAnchor({ panel, bound, toggleLeft }) {
  if (!panel || !bound) return 'end'
  const width = panel.right - panel.left
  if (panel.left >= bound.left) return 'end'
  const startRight = (toggleLeft ?? panel.left) + width
  return startRight <= bound.right ? 'start' : 'end'
}

/** The nearest ancestor that clips horizontally, as a rect; the viewport when none does. */
export function clipBoundaryOf(el) {
  if (typeof window === 'undefined') return null
  let node = el?.parentElement
  while (node && node !== document.body) {
    const ox = window.getComputedStyle(node).overflowX
    if (ox && ox !== 'visible') return node.getBoundingClientRect()
    node = node.parentElement
  }
  return { left: 0, right: window.innerWidth || document.documentElement.clientWidth || 0 }
}

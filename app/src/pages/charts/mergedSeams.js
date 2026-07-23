// Pure geometry for merged-mode "split pane" seam resizing.
//
// In merged mode the widgets tile the 24-col × 20-row grid gaplessly (margin 0).
// A SEAM is a shared column (vertical) or row (horizontal) boundary between
// adjacent widgets. Dragging a vertical seam at column `c` GROWS every widget
// whose right edge is at c and SHRINKS every widget whose left edge is at c (and
// the reverse when dragging the other way), so the board stays tiled — exactly
// the TC2000 divider-drag behavior. Widgets that merely SPAN across c are
// untouched. All functions here are pure (no React, no DOM).

// Enumerate the draggable seams for a set of widgets on a cols×rows grid.
// A boundary is a seam only when there are widgets on BOTH sides of it.
export function computeSeams(widgets, cols, rows) {
  const vertical = []
  for (let c = 1; c < cols; c++) {
    const left = widgets.filter(w => (w.x + w.w) === c)
    const right = widgets.filter(w => w.x === c)
    if (!left.length || !right.length) continue
    const parts = [...left, ...right]
    vertical.push({
      key: `v${c}`,
      c,
      y0: Math.min(...parts.map(w => w.y)),
      y1: Math.max(...parts.map(w => w.y + w.h)),
      leftIds: left.map(w => w.id),
      rightIds: right.map(w => w.id),
    })
  }
  const horizontal = []
  for (let r = 1; r < rows; r++) {
    const top = widgets.filter(w => (w.y + w.h) === r)
    const bottom = widgets.filter(w => w.y === r)
    if (!top.length || !bottom.length) continue
    const parts = [...top, ...bottom]
    horizontal.push({
      key: `h${r}`,
      r,
      x0: Math.min(...parts.map(w => w.x)),
      x1: Math.max(...parts.map(w => w.x + w.w)),
      topIds: top.map(w => w.id),
      bottomIds: bottom.map(w => w.id),
    })
  }
  return { vertical, horizontal }
}

// Clamp a requested vertical drag (in whole columns) so no affected widget goes
// below its min width or off the grid. `minWFor(widget)` → that widget's min cols.
export function clampVerticalDelta(widgets, c, d, minWFor) {
  if (!d) return 0
  const left = widgets.filter(w => (w.x + w.w) === c)
  const right = widgets.filter(w => w.x === c)
  if (!left.length || !right.length) return 0
  if (d > 0) {
    // Boundary moves right → right-starters shrink; each must keep min width.
    let maxD = Infinity
    for (const w of right) maxD = Math.min(maxD, w.w - minWFor(w))
    return Math.max(0, Math.min(d, maxD))
  }
  // Boundary moves left → left-enders shrink; each must keep min width.
  let minD = -Infinity
  for (const w of left) minD = Math.max(minD, minWFor(w) - w.w)
  return Math.min(0, Math.max(d, minD))
}

// Apply a vertical seam drag. Returns { widgets, applied } where applied is the
// clamped whole-column delta actually used (0 = no-op).
export function applyVerticalDrag(widgets, c, d, minWFor) {
  const applied = clampVerticalDelta(widgets, c, d, minWFor)
  if (!applied) return { widgets, applied: 0 }
  const next = widgets.map(w => {
    if ((w.x + w.w) === c) return { ...w, w: w.w + applied }
    if (w.x === c) return { ...w, x: w.x + applied, w: w.w - applied }
    return w
  })
  return { widgets: next, applied }
}

// Clamp a requested horizontal drag (in whole rows) — mirror of the vertical case.
export function clampHorizontalDelta(widgets, r, d, minHFor) {
  if (!d) return 0
  const top = widgets.filter(w => (w.y + w.h) === r)
  const bottom = widgets.filter(w => w.y === r)
  if (!top.length || !bottom.length) return 0
  if (d > 0) {
    let maxD = Infinity
    for (const w of bottom) maxD = Math.min(maxD, w.h - minHFor(w))
    return Math.max(0, Math.min(d, maxD))
  }
  let minD = -Infinity
  for (const w of top) minD = Math.max(minD, minHFor(w) - w.h)
  return Math.min(0, Math.max(d, minD))
}

export function applyHorizontalDrag(widgets, r, d, minHFor) {
  const applied = clampHorizontalDelta(widgets, r, d, minHFor)
  if (!applied) return { widgets, applied: 0 }
  const next = widgets.map(w => {
    if ((w.y + w.h) === r) return { ...w, h: w.h + applied }
    if (w.y === r) return { ...w, y: w.y + applied, h: w.h - applied }
    return w
  })
  return { widgets: next, applied }
}

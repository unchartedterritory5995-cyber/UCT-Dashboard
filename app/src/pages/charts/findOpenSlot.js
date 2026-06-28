// findOpenSlot — first-fit placement for a new widget in the react-grid-layout
// workspace. Scans the cols×maxRows grid row-major (top→bottom, left→right) for
// the first free w×h rectangle. Returns {x, y} or null when nothing fits.
//
// Why this exists: RGL's compactType="vertical" preserves a widget's given x
// and only compacts vertically, so a hardcoded x:0 forces every new widget into
// column 0 — stacking below the left column and overflowing maxRows instead of
// using open space elsewhere in the grid.
export function findOpenSlot(widgets, w, h, cols = 12, maxRows = 20) {
  const fitW = Math.min(Math.max(1, w | 0), cols)
  const need = Math.max(1, h | 0)

  // Occupancy grid; only count widgets that are actually placed (finite x/y).
  const occupied = Array.from({ length: maxRows }, () => new Array(cols).fill(false))
  for (const wd of widgets || []) {
    if (!wd || !Number.isFinite(wd.x) || !Number.isFinite(wd.y)) continue
    const x0 = Math.max(0, wd.x | 0)
    const y0 = Math.max(0, wd.y | 0)
    const x1 = Math.min(cols, x0 + Math.max(0, wd.w | 0))
    const y1 = Math.min(maxRows, y0 + Math.max(0, wd.h | 0))
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) occupied[y][x] = true
    }
  }

  for (let y = 0; y + need <= maxRows; y++) {
    for (let x = 0; x + fitW <= cols; x++) {
      let free = true
      for (let yy = y; yy < y + need && free; yy++) {
        for (let xx = x; xx < x + fitW; xx++) {
          if (occupied[yy][xx]) { free = false; break }
        }
      }
      if (free) return { x, y }
    }
  }
  return null  // no w×h slot fits within maxRows
}

// findPlacement — pick where AND at what size to drop a new widget. Tries the
// widget's default size first, then shrinks toward its min dimensions so it can
// squeeze into a smaller open gap (width-first, then height) instead of falling
// off-screen when the default size doesn't fit any remaining space. Returns
// {x, y, w, h}; falls back to bottom-pack at default size only when the grid is
// genuinely full.
export function findPlacement(widgets, defaults, cols = 12, maxRows = 20) {
  const w = defaults.w
  const h = defaults.h
  const mw = defaults.minW || w
  const mh = defaults.minH || h
  // Candidate sizes, largest → smallest; first that fits an open slot wins.
  const candidates = [
    [w, h],
    [mw, h],
    [w, mh],
    [mw, mh],
  ]
  for (const [cw, ch] of candidates) {
    const slot = findOpenSlot(widgets, cw, ch, cols, maxRows)
    if (slot) return { x: slot.x, y: slot.y, w: cw, h: ch }
  }
  return { x: 0, y: Infinity, w, h }  // nothing fits → RGL bottom-packs
}

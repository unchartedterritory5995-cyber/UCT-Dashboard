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

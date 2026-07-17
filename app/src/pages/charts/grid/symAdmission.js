//
// Fetch-herd guard for group switches. The mount queue (useStaggeredMount) is
// keyed by cell id, so a same-id symbol swap slips past it -> N simultaneous
// cold /api/bars fetches (the 2026-05-24 incident). Keying the queue on
// `${id}::${sym}` makes a sym swap re-enter the throttle. This module decides
// which sym a still-mounted cell should LOAD this render so the chart instance
// is never torn down: the target sym once admitted, else the last admitted sym
// (old chart stays), else null (first mount -> skeleton).

export function chartKeys(cells) {
  const out = []
  for (const c of cells || []) {
    if (c && c.sym) out.push(`${c.id}::${c.sym}`)
  }
  return out
}

export function admittedSym(cell, mountedKeys, prevSyms) {
  if (!cell || !cell.sym) return { sym: null, admitted: false }
  if (mountedKeys.has(`${cell.id}::${cell.sym}`)) return { sym: cell.sym, admitted: true }
  const prev = prevSyms && prevSyms[cell.id]
  return { sym: prev || null, admitted: false }
}

// CAPABILITY REGRESSION — layout assertions for `expect.charts` that hold for ANY number of charts (#1275, AUDIT):
//   tiled: true   the charts tile ONE rectangle: no two overlap and together they fill their bounding box (no gap)
//   sizes: [...]  the charts' cell sizes ("WxH"), as a multiset (order-free) — pins the layout exactly
// `sameSize` stays for an even grid; 3 charts on a 2-wide grid (12x10, 12x10, 24x10) are pinned with these instead.

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** [] when the rects tile one rectangle; else what is wrong (overlapping pairs, a gap) */
export function tilingProblems(rects) {
  const rs = (rects || []).map(r => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h }))
  if (!rs.length) return ['no charts']
  const out = []
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) if (overlaps(rs[i], rs[j])) out.push(`${rs[i].id ?? i} overlaps ${rs[j].id ?? j}`)
  }
  const x0 = Math.min(...rs.map(r => r.x)), y0 = Math.min(...rs.map(r => r.y))
  const x1 = Math.max(...rs.map(r => r.x + r.w)), y1 = Math.max(...rs.map(r => r.y + r.h))
  const area = rs.reduce((s, r) => s + r.w * r.h, 0)
  // with no overlap, the areas fill the bounding box exactly iff there is no gap
  if (!out.length && area !== (x1 - x0) * (y1 - y0)) out.push(`a gap: the charts cover ${area} of their ${(x1 - x0) * (y1 - y0)}-cell bounding box`)
  return out
}

/** the cells' sizes, sorted — compare with a sorted expectation */
export const sizesOf = (rects) => (rects || []).map(r => `${r.w}x${r.h}`).sort()

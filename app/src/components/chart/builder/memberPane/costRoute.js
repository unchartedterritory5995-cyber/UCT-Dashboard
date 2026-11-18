// app/src/components/chart/builder/memberPane/costRoute.js
//
// ─── ⭐⭐ ROUTE BY COST (Engine 73 (#1711)): MOVE A HOST DOCUMENT ONLY WHEN THE RUN DRAWS THE SAME PICTURE ──
//
// docs/pine/evidence/2026-11-17-host-lane-cost/EVIDENCE.md. The member door asks the HOST lane first.
// A host document whose recurrences cost more than a long task (`engine/hostLaneCost.js`) is offered
// to the runtime lane, which computes in a worker, and is MOVED there only when that lane builds it,
// admits it (kill list, allowlist, capability verdict: `runtimeLaneDefinition`'s own checks) and its
// document draws EXACTLY what the host document draws. This module is that last check.
//
// ⛔ WHY IT EXISTS: measured on the committed corpus, the runtime document of 7 of the 14 expensive
// scripts it builds draws a DIFFERENT picture: no fills (keltner's ten bands, sessions' four; the
// runtime lane does not draw a fill yet, `RUNTIME_UNDRAWN_KINDS`), seven markers fewer
// (opening-range), two arrows fewer and sixteen rows the host hides (cpr). A move that draws less is
// not a speed fix, so those stay on the host lane.
//
// ⭐ The picture is compared as the documents declare it, never by computing: every visible plot by
// the translation output it draws (the vendor harness's own row mapping, `ourSide.js`) and its style,
// and the counts of fills, horizontal lines and paints, and whether it draws objects.

/** The code a cost route that stays on the host lane is told by when the pictures differ. */
export const COST_ROUTE_SURFACE = 'cost-route:surface'

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x)

/** What one door answer draws. `built` is `memberPaneDefinition`'s `{definition, rows, translation}`. */
export function drawnSurfaceOf(built) {
  const def = built && built.definition
  const plots = isObj(def) && Array.isArray(def.plots) ? def.plots : []
  const outIndexByAst = new Map()
  for (const [index, o] of ((built && built.translation && built.translation.outputs) || []).entries()) {
    if (o && o.ast) outIndexByAst.set(o.ast, index)
  }
  const rowByKey = new Map(((built && built.rows) || []).filter(isObj).map((r) => [r.key, r]))
  const visible = []
  for (const p of plots) {
    if (!isObj(p) || p.hidden || p.fill || p.style === 'hlines') continue
    const row = rowByKey.get(p.key)
    const output = row && Number.isInteger(row.output) ? row.output
      : (row && row.ast && outIndexByAst.has(row.ast) ? outIndexByAst.get(row.ast) : null)
    // a visible plot with no output is named by its own key, which no other document shares
    visible.push(`${output === null ? `key:${p.key}` : `out:${output}`}:${p.style || 'line'}`)
  }
  const ops = isObj(def) && isObj(def.objects) && Array.isArray(def.objects.ops) ? def.objects.ops : []
  return {
    visible: visible.sort(),
    fills: plots.filter((p) => isObj(p) && p.fill).length,
    hlines: plots.filter((p) => isObj(p) && p.style === 'hlines').length,
    paints: isObj(def) && Array.isArray(def.paints) ? def.paints.length : 0,
    objects: ops.length > 0,
  }
}

/** Does the runtime answer draw exactly what the host answer draws? `{ok}` or `{ok: false, code, why}`. */
export function sameDrawnSurface(host, run) {
  const h = drawnSurfaceOf(host)
  const r = drawnSurfaceOf(run)
  const differ = []
  if (h.visible.join('|') !== r.visible.join('|')) {
    const missing = h.visible.filter((v) => !r.visible.includes(v)).length
    const extra = r.visible.filter((v) => !h.visible.includes(v)).length
    differ.push(`its plots (${missing} the run does not draw, ${extra} it draws that the formula lane does not)`)
  }
  if (h.fills !== r.fills) differ.push(`its fills (${h.fills} against ${r.fills})`)
  if (h.hlines !== r.hlines) differ.push(`its horizontal lines (${h.hlines} against ${r.hlines})`)
  if (h.paints !== r.paints) differ.push(`its background and bar colours (${h.paints} against ${r.paints})`)
  if (h.objects !== r.objects) differ.push('its drawings')
  if (!differ.length) return { ok: true }
  return { ok: false, code: COST_ROUTE_SURFACE, why: `the per-bar lane would draw a different picture: ${differ.join('; ')}` }
}

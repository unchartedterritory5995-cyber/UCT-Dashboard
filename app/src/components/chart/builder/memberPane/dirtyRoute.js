// app/src/components/chart/builder/memberPane/dirtyRoute.js
//
// ─── ⭐⭐ PARITY UNIT 1 (`objects`, NUMBER PENDING): A HOST DOCUMENT THAT LOST DRAWINGS, OFFERED TO THE RUN ──
//
// docs/pine/evidence/2026-11-18-objects-unit/EVIDENCE.md. The member door asks the HOST lane first. When the
// host lane ATTACHES a script but its object program cannot carry some of the script's drawings (`objectLoss`
// verdict other than `clean`: a setter whose value it cannot read, a create under a guard it cannot follow, a
// cell whose text is a reassigned variable), or withholds one of its background / bar colours by name, the
// member gets a SMALLER picture than TradingView's with a disclosure ("N of M drawing elements in this script
// aren't supported yet"). TradingView draws every one: the reference, `line.new`: "Creates new line object."
// The per-bar run executes every drawing call in source order, which is TradingView's own model, so the
// document is offered to the runtime lane exactly as a host refusal is (`routed: false`), and MOVED there only
// when that lane builds it, admits it (its kill list, allowlist and capability verdict, `runtimeLaneDefinition`'s
// own checks) and draws everything the host document draws plus what the host lost:
//
//   · the same plots, fills and horizontal lines (`costRoute.js::drawnSurfaceOf`, the route-by-cost check);
//   · a host that lost drawings: the run draws its OWN drawings (`compute.objects`, RT5 / WS-E), never the
//     host program's partial picture again;
//   · a host that withheld paints: the run draws at least the host's paints and one more.
//
// Anything else keeps the host answer a member has today (with its run half, `hostPartialRunHalf`, as before),
// carrying `dirtyRoute` (why it stayed) for the census. ⛔ Only while the runtime pane is on for THIS viewer:
// with it off nothing is asked and the answer is byte-identical to before.
import { drawnSurfaceOf } from './costRoute'

/** The code a dirty route that stays on the host lane is told by when the pictures differ. */
export const DIRTY_ROUTE_SURFACE = 'dirty-route:surface'
/** …when the host lost drawings and the run does not draw its own. */
export const DIRTY_ROUTE_OBJECTS = 'dirty-route:objects'
/** …when the host withheld paints and the run draws none more. */
export const DIRTY_ROUTE_PAINTS = 'dirty-route:paints'

/** What the host document lost that the run could draw: `{objects, paints}` or null (nothing lost).
 *  `loss` is `paneObjectsGate(t).loss` (`objectLoss.assessObjectLoss`) and `drawn` that gate's `draw`;
 *  `paintsWithheld` counts the host translation's paints withheld by name that the host document does not draw.
 *
 *  ⛔ CARVE-OUT (measured, docs/pine/evidence/2026-11-18-objects-unit/EVIDENCE.md section 4): a host whose object
 *  gate WITHHOLDS THE WHOLE DRAWING by name (a lost removal, verdict `removes`: owner ruling 2026-09-27, option b)
 *  is not offered. The member reads that withholding by name; of the two such documents this route would move,
 *  the admitted one's capture grades the run's picture DIVERGE (TradingView 52 objects, the run none) and no
 *  capture shows one MATCHing. It is lifted the day a capture does. A host that draws a PARTIAL picture (the
 *  "N of M drawing elements" disclosure) is the case this route exists for. */
export function hostLossOf({ loss, drawn = true, paintsWithheld = 0 } = {}) {
  // any verdict but `clean`: a dropped op, or a drawing name the object reader does not carry (`polyline.*`);
  // and the host still DRAWS its partial picture (the carve-out above)
  const objects = !!(loss && typeof loss.verdict === 'string' && loss.verdict !== 'clean' && drawn !== false)
  const paints = Number.isInteger(paintsWithheld) && paintsWithheld > 0 ? paintsWithheld : 0
  return objects || paints ? { objects, paints } : null
}

/** The translation output indices of the rows the host document carries HIDDEN because their author hid them
 *  (`display = display.none`, `hiddenReason: 'author'`): never drawn, but computed, and graded by the vendor
 *  harness as any plot. A moved document carries them too (`runtimeLaneDefinition`'s `carryHidden`). */
export function hostAuthorHiddenOutputsOf(host) {
  const outs = (host && host.translation && host.translation.outputs) || []
  const byAst = new Map()
  for (const [i, o] of outs.entries()) if (o && o.ast) byAst.set(o.ast, i)
  const set = new Set()
  for (const r of (host && host.rows) || []) {
    if (!r || r.hidden !== true) continue
    const i = Number.isInteger(r.output) ? r.output : (r.ast && byAst.has(r.ast) ? byAst.get(r.ast) : null)
    if (Number.isInteger(i) && outs[i] && outs[i].hiddenReason === 'author') set.add(i)
  }
  return set
}

/** Does the runtime answer draw everything the host answer draws, and what the host lost?
 *  `{ok}` or `{ok: false, code, why}`. `hidden` (optional): the host's author-hidden outputs, every one of
 *  which the run must carry. */
export function drawsWhatTheHostLost(host, run, lost, hidden = null) {
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
  if (hidden && hidden.size) {
    const carried = new Set(((run && run.rows) || []).filter((x) => x && x.hidden === true && Number.isInteger(x.output))
      .map((x) => x.output))
    const missing = [...hidden].filter((i) => !carried.has(i)).length
    if (missing) differ.push(`its hidden plots (${missing} of the ${hidden.size} its author hid the run does not compute)`)
  }
  if (differ.length) {
    return { ok: false, code: DIRTY_ROUTE_SURFACE, why: `the per-bar lane would draw a different picture: ${differ.join('; ')}` }
  }
  const runDef = run && run.definition
  const ownObjects = !!(runDef && runDef.compute && runDef.compute.objects === true)
  if (lost && lost.objects && !ownObjects) {
    return { ok: false, code: DIRTY_ROUTE_OBJECTS, why: 'the per-bar lane does not make its drawings itself, so it would draw the same incomplete picture' }
  }
  if (lost && lost.paints && !(r.paints > h.paints)) {
    return { ok: false, code: DIRTY_ROUTE_PAINTS, why: `the per-bar lane draws ${r.paints} of its background and bar colours, the formula lane ${h.paints}: none of the withheld ones` }
  }
  if (h.paints > r.paints) {
    return { ok: false, code: DIRTY_ROUTE_SURFACE, why: `the per-bar lane would draw fewer background and bar colours (${r.paints} against ${h.paints})` }
  }
  return { ok: true }
}

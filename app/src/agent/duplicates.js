// ── UCT Agent: an instant "add" of an indicator the chart ALREADY shows (Phase 2, 2026-10-29) ─────────────
//
// Every new chart already draws EMA 9 / EMA 20 / SMA 50 / SMA 200. A typed "throw the 9 and 20 on my chart" used to add
// a SECOND, identical EMA 9 and EMA 20 — two lines on top of each other, and then "make the 9 green" could not tell them
// apart. Inside a MULTI-STEP request (agent/compound.js: "create four charts …, put the 9 and 20 on all of them, make the
// 9 green") — where the next step names them — an add is screened. (A single typed "add a 20 EMA" keeps its Gate C
// behaviour, railed in agentGateCIndicators: a second EMA 20 beside the default one.)
//
//   the same indicator, same settings, visible on that chart   → not added again; the receipt says it is already there
//   …the same, but HIDDEN                                      → shown instead (indicator.show — what the member wants
//                                                                to see; reversible, its own receipt and Undo)
//   anything else                                              → added exactly as before
//
// "The same" is Indicators' own structured lookup on EFFECTIVE input values (indicatorEdits.alreadyOnChart). The
// capability itself is unchanged — Add to Chart adds every time it is asked, and a deliberate second copy is
// indicatorCopy.duplicate ("add another RSI" through the model).

import { getTargetKind } from './capabilities'
import { alreadyOnChart, inputsOfArgs } from './capabilities/indicatorEdits'

const listOf = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** → { ops, note } — `ops` without the adds that are already there (hidden ones shown instead); `note` says so, or null. */
export function screenDuplicateAdds(ops, host) {
  const kind = getTargetKind('indicatorEdits')
  if (!kind || !Array.isArray(ops) || !ops.some(o => o?.action === 'indicator.add')) return { ops, note: null }
  const out = []
  const there = new Map()                               // chart label → [names already on it]
  for (const o of ops) {
    if (o?.action !== 'indicator.add' || typeof o.target !== 'string') { out.push(o); continue }
    let st = null
    try { const snap = kind.read(host, o.target); st = snap ? kind.stateOf(snap) : null } catch { st = null }
    const ins = inputsOfArgs(o.args?.inputs)
    const hit = st && ins.ok ? alreadyOnChart(st, o.args?.defId, ins.inputs) : null
    if (!hit?.instanceId) { out.push(o); continue }
    if (hit.hidden) { out.push({ action: 'indicator.show', target: o.target, args: { instance: hit.instanceId } }); continue }
    there.set(st.chart, [...(there.get(st.chart) || []), hit.name])
  }
  if (!there.size) return { ops: out, note: null }
  // "EMA 9 and EMA 20 are already on Chart (QQQ), Chart (NVDA) and Chart (TSLA)."
  const byNames = new Map()
  for (const [chart, names] of there) {
    const k = listOf(names)
    const e = byNames.get(k) || { charts: [], plural: names.length > 1 }
    e.charts.push(chart)
    byNames.set(k, e)
  }
  const parts = [...byNames].map(([names, e]) => `${names} ${e.plural ? 'are' : 'is'} already on ${listOf(e.charts)}`)
  return { ops: out, note: `${parts.join('; ')} — not added again.` }
}

// ── UCT Agent: an "add" of an indicator the chart ALREADY shows (Phase 2, 2026-10-29) ─────────────────────
//
// Every new chart already draws EMA 9 / EMA 20 / SMA 50 / SMA 200. A typed "throw the 9 and 20 on my chart" used to add
// a SECOND, identical EMA 9 and EMA 20 — two lines on top of each other, and then "make the 9 green" could not tell them
// apart. ⭐ Owner decision (2026-10-29): every add is screened — typed, model-planned or a step of a multi-step request —
// and the existing instance is REUSED (session memory points at it, so "make it a 9" edits that one). Not screened: an
// approved card (the member approved exactly that plan) and words asking for another copy (`wantsCopy`: "add another
// 20 EMA", "a second RSI", "add RSI again"), which add through the same canonical Add to Chart as always.
//
//   the same indicator, same settings, visible on that chart   → not added again; the receipt says it is already there
//   …the same, but HIDDEN                                      → shown instead (indicator.show — what the member wants
//                                                                to see; reversible, its own receipt and Undo)
//   anything else                                              → added exactly as before
//
// "The same" is Indicators' own structured lookup on EFFECTIVE input values (indicatorEdits.alreadyOnChart). The
// capability itself is unchanged — Add to Chart adds every time it is asked; the screen sits before it (useAgent's
// execute), and a deliberate second copy goes straight through it (or indicatorCopy.duplicate, through the model).

import { getTargetKind } from './capabilities'
import { alreadyOnChart, inputsOfArgs } from './capabilities/indicatorEdits'

const WANTS_COPY = /\b(another|one more|an extra|a second|a third|duplicate|again)\b/i
/** The member asked for another copy ("add another 20 EMA") — the add is never screened. */
export const wantsCopy = (words) => WANTS_COPY.test(String(words || ''))

const listOf = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** → { ops, note, reused } — `ops` without the adds that are already there (hidden ones shown instead); `note` says so,
 *  or null; `reused` the existing instances that stand in for them ({ op, chartRef, instanceId, defId, name }). */
export function screenDuplicateAdds(ops, host) {
  const kind = getTargetKind('indicatorEdits')
  if (!kind || !Array.isArray(ops) || !ops.some(o => o?.action === 'indicator.add')) return { ops, note: null, reused: [] }
  const out = []
  const reused = []
  const there = new Map()                               // chart label → [names already on it]
  for (const o of ops) {
    if (o?.action !== 'indicator.add' || typeof o.target !== 'string') { out.push(o); continue }
    let st = null
    try { const snap = kind.read(host, o.target); st = snap ? kind.stateOf(snap) : null } catch { st = null }
    const ins = inputsOfArgs(o.args?.inputs)
    const hit = st && ins.ok ? alreadyOnChart(st, o.args?.defId, ins.inputs) : null
    if (!hit?.instanceId) { out.push(o); continue }
    if (hit.hidden) { out.push({ action: 'indicator.show', target: o.target, args: { instance: hit.instanceId } }); continue }
    reused.push({ op: o, chartRef: kind.groupOf ? (kind.groupOf(o.target) ?? o.target) : o.target, instanceId: hit.instanceId, defId: hit.defId || o.args?.defId || null, name: hit.name || null })
    there.set(st.chart, [...(there.get(st.chart) || []), hit.name])
  }
  if (!there.size) return { ops: out, note: null, reused }
  // "EMA 9 and EMA 20 are already on Chart (QQQ), Chart (NVDA) and Chart (TSLA)."
  const byNames = new Map()
  for (const [chart, names] of there) {
    const k = listOf(names)
    const e = byNames.get(k) || { charts: [], plural: names.length > 1 }
    e.charts.push(chart)
    byNames.set(k, e)
  }
  const parts = [...byNames].map(([names, e]) => `${names} ${e.plural ? 'are' : 'is'} already on ${listOf(e.charts)}`)
  return { ops: out, note: `${parts.join('; ')} — not added again.`, reused }
}

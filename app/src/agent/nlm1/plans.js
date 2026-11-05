// ── NLM-1 D2 · PLANS THAT REFERENCE WHAT THE SAME PLAN CREATES (DARK: the NLM-1 two-key flag) ─────────────────────
//
// Track A's createdBinding (CG-37) binds "it / the new one" after a create step to the chart that step creates — the
// create op's alias, which the runtime resolves to the committed widget's authoritative id. Production reaches it only
// once every op's target kind has exactly ONE candidate; on a board with two charts "add a chart for QQQ and put RSI
// on it" has two indicator targets, so the instant path gave up and the model was asked.
//
// planCreatedReference(text, host) reads the request with the fast path, fills ONLY the targets that are certain (a
// kind with one candidate: the workspace), and hands the plan to bindCreated — the same binding, not a second one. It
// adds one reading: "… and put X on BOTH / ALL of them / each" right after creating a chart means the new chart AND the
// board's existing charts ("both" only with exactly one existing chart) — the same op once per chart, the new one by
// its alias. Everything returned is ordinary registry ops for the ordinary execute (planner, policy, runtime, receipts,
// grouped Undo). Anything uncertain → null (the request goes on exactly as before) or { ask }.

import { fastParse } from '../fastPath'
import { bindCreated } from '../createdBinding'
import { getCapability, getTargetKind } from '../capabilities'
import { indicatorEditsRef } from '../capabilities/indicatorEdits'

const BOTH = /\b(?:on|to|onto|for)\s+(?:both(?: of them| charts)?|all(?: of)? them|all (?:the |my )?charts|each(?: of them| chart)?|every chart)\b/i

const chartRefs = (host) => { try { return (host?.charts?.list?.() || []).map(c => String(c.ref ?? c.id)) } catch { return [] } }

/** The same op aimed at an EXISTING chart (a chart op: the chart; an indicator op: that chart's indicator entry). */
function aimAt(op, chartRef) {
  const cap = getCapability(op.action)
  if (!cap) return null
  if (cap.target === 'chart') return { ...op, target: chartRef }
  if (cap.target === 'indicatorEdits') return { ...op, target: indicatorEditsRef(chartRef) }
  return null
}

/** → { ops } | { ask } | null */
// `bind`: the created-object binder (Track A's bindCreated today; created-binding-v2 when it lands — same contract:
// (ops, text, host) → { ops } | { ask } | null). This module hands it UNTARGETED ops only (a target is filled only where it
// is certain: the workspace), so it never depends on a binder re-aiming an op the plan aimed at an existing chart.
// `said`: the member's OWN words when `text` is NLM-1's rewrite of them ("same but weekly" → "add a chart for TSLA and
// make it weekly"). The binder reads the words only for whether the MEMBER named an existing chart; a ticker the rewrite
// carried over from the earlier request is not the member naming the chart that already shows it.
export function planCreatedReference(text, host, { bind = bindCreated, said = null } = {}) {
  try {
    const t = String(text || '')
    const both = BOTH.test(t)
    // "on both" binds like "on it" for the created chart; the existing charts are added below
    const words = both ? t.replace(BOTH, (m) => `${m.split(/\s+/)[0]} it`) : t
    const fast = fastParse(words, { host })
    if (fast?.kind !== 'ops' || !fast.ops?.length) return null
    // only CERTAIN targets are filled: a kind with exactly one candidate (the workspace a chart is created on)
    const filled = fast.ops.map(o => {
      if (o.target) return o
      const kind = getTargetKind(getCapability(o.action)?.target)
      const list = (() => { try { return kind?.list?.(host) || [] } catch { return [] } })()
      return list.length === 1 && getCapability(o.action)?.target === 'workspace' ? { ...o, target: list[0].ref } : o
    })
    const bound = bind(filled, said != null ? String(said) : words, host)
    if (!bound) return null
    if (bound.ask) return { ask: bound.ask }
    let ops = bound.ops
    if (both) {
      const existing = chartRefs(host)
      if (!existing.length || (/\bboth\b/i.test(t) && existing.length !== 1)) return null
      const aliases = new Set(ops.filter(o => o.action === 'widget.add' && o.args?.as).map(o => String(o.args.as)))
      const onNew = ops.filter(o => aliases.has(String(o.target)) && o.action !== 'chart.setSymbol' && o.action !== 'chart.setTimeframe')
      const copies = existing.flatMap(ref => onNew.map(o => aimAt(o, ref)))
      if (copies.some(c => !c)) return null
      ops = [...ops, ...copies]
    }
    return ops.every(o => o.target) ? { ops } : null
  } catch { return null }
}

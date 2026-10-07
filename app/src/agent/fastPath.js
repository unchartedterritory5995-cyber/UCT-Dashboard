// ── UCT Agent FAST PATH: obvious commands, no model call ─────────────────────
//
// Two layers:
//   1. universal control words — undo / do it / just the first N / never mind
//   2. capability phrases — each registered capability MAY declare
//      `fast({ raw, lower, core }) -> args | null` for its own obvious wording
//      ("bars", "weekly", "hide volume"). The fast path knows no feature.
//
// Its output is the SAME registry ops the model path produces and goes through
// the same planner / policy / runtime — there is no second, less-checked path.
//
// ⛔ ALL-OR-NOTHING. Every clause must match some capability. One unrecognised
// clause sends the whole message to the model.
//
// Returns null (→ model), or:
//   { kind: 'ops', ops: [{ action, args }] }   targets resolved by the caller
//   { kind: 'undo' } | { kind: 'confirm' } | { kind: 'dismiss' } | { kind: 'subset', count }

import { allCapabilityNames, getCapability } from './capabilities'

const LEAD = /^(please\s+)?(switch|change|go|set|make|turn|flip|put)\s+(it|this|the chart|this chart|chart)?\s*(to|into|in|on)?\s*/
const TAIL = /\s+(chart|timeframe|time frame|view|please)$/
const clean = (s) => s.toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim()
const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }

function matchClause(raw) {
  const lower = clean(raw)
  if (!lower) return null
  const core = lower.replace(LEAD, '').replace(TAIL, '').trim()
  const hits = []
  for (const name of allCapabilityNames()) {
    const cap = getCapability(name)
    if (typeof cap.fast !== 'function') continue
    const args = cap.fast({ raw: raw.trim(), lower, core })
    if (args) hits.push({ action: name, args })
  }
  return hits.length === 1 ? hits[0] : null      // ambiguous phrase -> let the model decide
}

export function fastParse(text) {
  const t = clean(String(text || ''))
  if (!t || t.length > 160) return null
  if (/^(undo|undo (that|it|this|the last (one|change))|revert( that| it)?|go back|put it back)$/.test(t)) return { kind: 'undo' }
  if (/^(do it|yes|yes please|yep|go ahead|apply( it| that| them)?|ok(ay)?(,)? do it|confirm|sounds good,? do it)$/.test(t)) return { kind: 'confirm' }
  if (/^(no|nope|cancel|never ?mind|don'?t|skip it|forget it)$/.test(t)) return { kind: 'dismiss' }
  const sub = /^(just |only )?(apply|do) (just |only )?the first (\d|one|two|three|four|five|six)( ones?| changes?| items?)?$/.exec(t)
  if (sub) {
    const n = Number(sub[4]) || WORDNUM[sub[4]]
    if (n > 0) return { kind: 'subset', count: n }
  }
  const clauses = String(text).split(/,|;|\band\b|\bthen\b|&/i).map(s => s.trim()).filter(Boolean)
  if (!clauses.length || clauses.length > 6) return null
  const ops = []
  for (const c of clauses) {
    const op = matchClause(c)
    if (!op) return null
    ops.push(op)
  }
  return { kind: 'ops', ops }
}

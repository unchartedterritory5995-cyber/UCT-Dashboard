// ── HELD-OUT, round 7: teaching the Options Flow widget's filters (guide/controls.js) ────────────────────────────
// ⛔ WRITTEN 2026-11-07 BEFORE the entries and anchors existed. Each row names a substring of the last step's target.
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { guideFeature } from './guide/registry'
import { stepsFor } from './guide/slots'

beforeAll(() => { registerBuiltins() })
const route = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })
const last = (q) => { const g = route(q); const s = g ? stepsFor(guideFeature(g.feature), g.detail || q) : []; return JSON.stringify(s[s.length - 1]?.target ?? null) }

export const FLOW_HELD_OUT = [
  ['how do I only see call options in the options flow', 'flow.filter.cp'],
  ['how can I show just puts in options flow', 'flow.filter.cp'],
  ['how do I filter options flow to sweeps', 'flow.filter.type'],
  ['how do I show only block trades in the flow widget', 'flow.filter.type'],
  ['how do I see only bullish flow', 'flow.filter.dir'],
  ['how do I hide the bearish options flow', 'flow.filter.dir'],
  ['how do I set a minimum premium on options flow', 'flow.filter.min'],
  ['how do I only see big premium trades in the options flow', 'flow.filter.min'],
]
describe('held-out round 7: Options Flow filters', () => {
  it.each(FLOW_HELD_OUT)('%s → %s', (q, want) => { expect(last(q)).toContain(want) })
})

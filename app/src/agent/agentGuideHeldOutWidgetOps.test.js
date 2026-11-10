// ── HELD-OUT, the widget ops pl-widget executes (#1027 agent/pl/exec-widget-actions, 2026-11-10) that #1014 does not
// already teach: the Scanner's and Period Sort's Refresh, a watchlist column's width, the Flagged list's name; and the
// Options Flow filters one by one (Calls, Puts, Sweep, Block, Bull, Bear; owner-approved). ⛔ WRITTEN BEFORE any change, in
// words of this file's own. Each "how do I" ask walks to the control that does it (a substring of the title or of the last
// step's target). A miss is recorded as a KNOWN MISS (both ways), never edited to pass.
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { guideFeature } from './guide/registry'
import { guideSteps } from './capabilities/guide'

beforeAll(() => { registerBuiltins() })
const route = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })
export const seen = (q) => {
  const g = route(q)
  if (!g) return 'null'
  const { steps, title } = guideSteps(guideFeature(g.feature), g.detail || q)
  return `${title} | ${JSON.stringify(steps[steps.length - 1]?.target ?? null)}`
}

export const WIDGET_OPS_HELD_OUT = [
  // refresh
  ['how do I rerun the scan in my scanner widget', 'Refresh scan'],
  ['show me how to refresh the scanner results', 'Refresh scan'],
  ['how do I refresh the period sort widget', 'Refresh'],
  ['how do I get fresh results in period sort', 'Refresh'],
  // a column's width
  ['how do I make a watchlist column wider', 'Drag to resize column'],
  ['show me how to resize the columns in my watchlist', 'Drag to resize column'],
  // the Flagged list's name
  ['how do I rename my flagged list', 'Rename'],
  ['show me how to give the flagged list a different name', 'Rename'],
  // Options Flow filters, one by one
  ['how do I show only calls in options flow', 'Calls'],
  ['how do I filter the options flow to puts', 'Puts'],
  ['show me how to see just sweeps in the flow widget', 'Sweep'],
  ['how do I show only block trades in options flow', 'Block'],
  ['how do I see only bullish flow', 'Bull'],
  ['how do I filter options flow to bearish prints', 'Bear'],
]

describe('a widget op ask walks to its control', () => {
  it.each(WIDGET_OPS_HELD_OUT)('"%s" → %s', (q, needle) => {
    expect(seen(q)).toContain(needle)
  })
})

// CONTROLS (added with the fix): a two-sided ask keeps the group's own control, and the premium filter keeps its own
describe('nothing else moves', () => {
  it.each([
    ['how do I choose calls or puts in options flow', 'flow.filter.cp'],
    ['how do I pick sweeps or blocks in the flow', 'flow.filter.type'],
    ['how do I set the minimum premium in options flow', 'flow.filter.min'],
    ['how do I open the custom period sort', 'Custom-period sort'],
  ])('"%s" → %s', (q, needle) => { expect(seen(q)).toContain(needle) })
})

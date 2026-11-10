// ── HELD-OUT, cov-2: two-part asks ("X, then Y"), drawing tools by name, one drawing's edits, indicator alerts by name,
// Multi Chart's layout controls and a layout's history ─────────────────────────────────────────────────────────────────
// ⛔ WRITTEN 2026-11-09 BEFORE any cov-2 entry or reading existed, in words of this file's own (not the inventory's). Each
// row names a substring of the walkthrough's title or of its last step's target (for a two-part ask: the SECOND part's).
// The count before the entries is in the cov-2 PR doc; the rows are not edited to pass.
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { guideFeature } from './guide/registry'
import { guideSteps } from './capabilities/guide'
import { titleFor } from './guide/slots'

beforeAll(() => { registerBuiltins() })
const route = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })
// the walkthrough the member would be walked: its title(s) and its last step's target
const seen = (q) => {
  const g = route(q)
  if (!g) return 'null'
  const f = guideFeature(g.feature)
  const { steps, title } = guideSteps(f, g.detail || q)
  return `${title || titleFor(f, g.detail || q)} | ${JSON.stringify(steps[steps.length - 1]?.target ?? null)}`
}

export const COV2_HELD_OUT = [
  // two parts, one walkthrough: the second part's last control ends it
  ['how do I add an RSI and then change its length', '"attr":"data-field"'],
  ['how do I add a MACD then change its colour', 'chartSettings.colorPanel'],
  ['how do I draw a trendline and then set an alert on it', 'Set alert'],
  ['how do I switch this chart to weekly and then add the RSI', '"named":"RSI"'],
  ['how do I put NVDA on my watchlist and then flag it', 'Add to Flagged'],
  ['how do I open my watchlist then sort it by change', 'Sort by Symbol'],
  // a drawing tool by its own name
  ['how do I use the pitchfork', 'Pitchfork'],
  ['how can I put a vertical line on a date', 'Vertical Line'],
  ['how do I add a parallel channel', 'Parallel Channel'],
  ['how do I anchor a VWAP to a bar', 'Anchored VWAP'],
  ['how do I place a text note on the chart', 'Text Note'],
  ['how do I use the position calculator', 'Position Calculator'],
  ['how do I count the bars between two dates', 'Bars & Time'],
  ['how do I put an arrow on the chart', 'Arrow'],
  ['how do I use an extended line', 'Extended Line'],
  // one drawing's own edits
  ['how do I make that trendline pink', 'Recolouring a drawing'],
  ['how do I hide just that fib', 'Hiding one drawing'],
  ['how do I move one point of a trendline', 'Moving a drawing'],
  // an indicator alert, by its indicator
  ['how do I delete my RSI alert', 'Deleting an indicator alert'],
  ['how do I pause the MACD alert', 'Pausing an indicator alert'],
  // Multi Chart's layout controls, and a layout's history
  ['how do I sync the crosshair across my charts', 'Syncing the crosshair'],
  ['how do I keep all my charts on the same time range', 'Syncing the time range'],
  ['how do I go to the next group', 'Stepping through groups'],
  ['how do I get out of groups mode', 'Leaving Groups mode'],
  ['how do I refresh the group', 'Refreshing a group'],
  ['how do I see older versions of my layout', 'A layout’s version history'],
]
describe('held-out cov-2: two-part asks, drawing tools and edits, indicator alerts, Multi Chart and layout controls', () => {
  it.each(COV2_HELD_OUT)('%s → %s', (q, want) => { expect(seen(q)).toContain(want) })
})

// ── HELD-OUT, cov-5 item 3: Chart Settings and drawing-menu rows by what a member calls them ──
// ⛔ WRITTEN 2026-11-09 BEFORE any cov-5 routing change, in words of this file's own (not the inventory's). Each row names a
// substring of the walkthrough's title or of its last step's target. A miss is recorded as a KNOWN MISS (both ways), never
// edited to pass.
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { guideFeature } from './guide/registry'
import { guideSteps } from './capabilities/guide'

beforeAll(() => { registerBuiltins() })
const route = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })
const seen = (q) => {
  const g = route(q)
  if (!g) return 'null'
  const { steps, title } = guideSteps(guideFeature(g.feature), g.detail || q)
  return `${title} | ${JSON.stringify(steps[steps.length - 1]?.target ?? null)}`
}

export const COV5_HELD_OUT = [
  // Chart Settings: the background's own control, not just its tab
  ['how do I give my chart a plain black background', 'The chart’s background'],
  ['how do I change the background colour of the chart', 'The chart’s background'],
  ['how do I set a solid colour behind the candles', 'The chart’s background'],
  // the magnet crosshair: a toggle on the chart's right-click menu
  ['how do I make the crosshair snap to the candles', 'The magnet crosshair'],
  ['how do I turn on the magnet crosshair', 'The magnet crosshair'],
  // the light/dark palette: Shift+T on the chart
  ['how do I switch the chart to light mode', 'Light or dark chart'],
  ['how do I make the chart dark', 'Light or dark chart'],
  ['how do I flip between the light and dark palette', 'Light or dark chart'],
  // a drawing's own menu
  ['how do I make a copy of my trendline', 'Duplicate'],
  ['how do I clone this horizontal line', 'Duplicate'],
  ['how do I copy that line', 'Duplicate'],
  ['how do I show the price on my horizontal line', 'Show price label'],
  ['how do I put a price tag on a horizontal ray', 'Show price label'],
  ['how do I make my text note bold', 'Bold'],
  ['how do I make the note italic', 'Italic'],
  ['how do I change the font of a text note', 'Font'],
  ['how do I make the text on my note bigger', 'Text size'],
  ['how do I save this line style as the default for new lines', 'Save as default'],
]
// ⛔ THE ROWS ABOVE ARE NOT EDITED. A KNOWN MISS is asserted both ways (not what was named; what it reaches today) and listed
// in testing/agent/guide/knownMisses.json.
export const COV5_MISSES = {
  // no word of the background's own: "behind the candles" names nothing the catalog or the settings table holds, and the generic Chart Settings walkthrough takes it
  'how do I set a solid colour behind the candles': 'Finding chart settings',
  // the magnet crosshair's only toggle is on StockChart's own region menu (pr-magnet) and ChartToolbar's panel, neither of which
  // a desktop /charts right-click opens (the workspace's chart menu has no such row): no walkthrough can ring it there yet
  'how do I make the crosshair snap to the candles': 'Changing Crosshair',
  'how do I turn on the magnet crosshair': 'Changing Crosshair',
}
describe('held-out cov-5 item 3: Chart Settings and drawing-menu rows', () => {
  it.each(COV5_HELD_OUT.filter(([q]) => !COV5_MISSES[q]))('%s → %s', (q, want) => { expect(seen(q)).toContain(want) })
  it.each(COV5_HELD_OUT.filter(([q]) => COV5_MISSES[q]))('a KNOWN MISS: %s (named %s)', (q, want) => {
    expect(seen(q)).not.toContain(want)
    expect(seen(q)).toContain(COV5_MISSES[q])
  })
})

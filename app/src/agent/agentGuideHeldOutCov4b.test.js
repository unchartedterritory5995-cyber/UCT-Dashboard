// ── HELD-OUT, cov-4 (5)–(7): alerts by gesture and by what they watch, and controls the guide must first bring into view ──
// ⛔ WRITTEN 2026-11-09 BEFORE any of these entries existed, in words of this file's own (not the inventory's). Each row names
// a substring of the walkthrough's title or of its last step's target. A miss is recorded as a KNOWN MISS (both ways), never
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

export const COV4B_HELD_OUT = [
  // alerts by gesture and by what they watch
  ['how do I set an alert right where my mouse is', 'A price alert at the cursor'],
  ['how do I get alerted when price reaches my trendline', 'An alert on a line'],
  ['how do I get alerted at a fib level', 'An alert on a line'],
  ['how do I load a ticker by clicking one of my alerts', 'Seeing your alerts'],
  ['how do I get an alert when the 9 ema crosses the 21', 'An alert on a moving average cross'],
  ['how do I watch the MACD signal line with an alert', 'Which line an alert watches'],
  // controls the guide must first bring into view
  ['how do I turn on thin bars', 'Thin bars'],
  ['how do I close the second tab of my watchlist', 'Closing a widget tab'],
  ['how do I change the link colour of a chart tab', 'A chart tab’s link colour'],
]
// ⛔ THE ROWS ABOVE ARE NOT EDITED. A KNOWN MISS is asserted both ways (not what was named; what it reaches today) and listed
// in testing/agent/guide/knownMisses.json. Recorded 2026-11-09.
export const COV4B_MISSES = {
  // a fib has no Set alert of its own (drawingSettingsSchema.js): the truthful walkthrough is a price alert at the level
  'how do I get alerted at a fib level': 'Setting a price alert',
}
describe('held-out cov-4 (5)–(7): alerts and controls brought into view', () => {
  it.each(COV4B_HELD_OUT.filter(([q]) => !COV4B_MISSES[q]))('%s → %s', (q, want) => { expect(seen(q)).toContain(want) })
  it.each(COV4B_HELD_OUT.filter(([q]) => COV4B_MISSES[q]))('a KNOWN MISS: %s (named %s)', (q, want) => {
    expect(seen(q)).not.toContain(want)
    expect(seen(q)).toContain(COV4B_MISSES[q])
  })
})

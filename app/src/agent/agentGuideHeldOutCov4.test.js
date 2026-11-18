// ── HELD-OUT, cov-4: Chart Settings rows by their own names, and a drawing's own menu rows ─────────────────────────────
// ⛔ WRITTEN 2026-11-09 BEFORE any cov-4 entry or reading existed, in words of this file's own (not the inventory's). Each
// row names a substring of the walkthrough's title or of its last step's target. The count before the entries is in the
// cov-4 PR doc; the rows are not edited to pass (a miss is recorded as a KNOWN MISS, both ways).
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

export const COV4_HELD_OUT = [
  // Chart Settings rows, by their own names (British spelling too)
  ['how do I change the colour of earnings beats on the chart', 'Earnings beat color'],
  ['how do I change the IPO marker colour', 'IPO marker color'],
  ['how do I show the market cap in the info row', 'Market cap in the info row'],
  ['how do I change the header colours', 'Header colors'],
  ['how do I change the swing label background colour', 'Swing label background color'],
  ['how do I set the gradient background top colour', 'Gradient background top color'],
  ['how do I put the day change beside the title', 'Day change beside the title'],
  ['how do I change what the title shows', 'Title shows'],
  // a drawing's own menu rows
  ['how do I make a copy of a trendline', 'Duplicate'],
  ['how do I keep this drawing style for my next drawings', 'Save as default'],
  ['how do I make my trendline flat', 'Make horizontal'],
  ['how do I set a drawing to an exact price', 'Set level'],
]
// ⛔ THE ROWS ABOVE ARE NOT EDITED. A row that misses what this file named is a KNOWN MISS (asserted both ways: not what was
// named; what it reaches today), listed in testing/agent/guide/knownMisses.json and the PR doc. Recorded 2026-11-09.
export const COV4_MISSES = {
  // the info row's own panel walkthrough (panelAction "Info row fields", the matrix's assignment for C1-066) takes it first
  'how do I show the market cap in the info row': 'The header’s info row',
}
describe('held-out cov-4: Chart Settings rows and a drawing’s menu rows', () => {
  it.each(COV4_HELD_OUT.filter(([q]) => !COV4_MISSES[q]))('%s → %s', (q, want) => { expect(seen(q)).toContain(want) })
  it.each(COV4_HELD_OUT.filter(([q]) => COV4_MISSES[q]))('a KNOWN MISS: %s (named %s)', (q, want) => {
    expect(seen(q)).not.toContain(want)
    expect(seen(q)).toContain(COV4_MISSES[q])
  })
})

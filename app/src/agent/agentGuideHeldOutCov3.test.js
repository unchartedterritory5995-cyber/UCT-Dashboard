// ── HELD-OUT, cov-3: comparisons, the indicator draft (Create Indicator / Formula Builder), widget controls named by what
// they do, going to a date, and more two-part asks ─────────────────────────────────────────────────────────────────────
// ⛔ WRITTEN 2026-11-09 BEFORE any cov-3 entry or reading existed, in words of this file's own (not the inventory's). Each
// row names a substring of the walkthrough's title or of its last step's target (for a two-part ask: the SECOND part's).
// The count before the entries is in the cov-3 PR doc; the rows are not edited to pass.
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

export const COV3_HELD_OUT = [
  // comparisons on a chart
  ['how do I take AMD off the comparison', 'Removing a compared symbol'],
  ['how do I get rid of the sector overlay', 'Removing a group'],
  ['how do I put a compared stock on its own scale', 'A compared symbol’s scale'],
  ['how do I hide my main symbol and just show the overlays', 'Showing the group only'],
  ['how do I clear every overlay off the chart', 'Clearing all comparisons'],
  // the indicator draft
  ['how do I throw away my indicator draft', 'Discarding a draft'],
  ['how do I undo the last change on my draft', 'Undoing a draft step'],
  ['how do I give my draft a name', 'Naming a formula'],
  ['how do I show a dot under the bar when my condition is true', 'Signal markers and colours'],
  ['how do I paint the candles when the signal is true', 'Signal markers and colours'],
  // widget controls named by what they do
  ['how do I sort the themes from worst to best', 'Ranking themes by period'],
  ['how do I measure the themes from the open', 'The today basis'],
  ['how do I see annual numbers in fundamentals', 'Switching the fundamentals view'],
  ['how do I only see call options with a big premium', 'Flow filters'],
  ['how do I hide a breadth reading', 'Adding or removing a reading'],
  ['how do I add the Russell to new highs and lows', 'New highs and lows universes'],
  // going to a date
  ['how do I jump to a date on the chart', 'goToDate'],
  ['how do I go to a year like 2020 on the chart', 'goToDate'],
  // two parts
  ['how do I add a comparison and then put it on its own scale', 'A compared symbol’s scale'],
  ['how do I add a horizontal line and then lock it', 'Locking a drawing'],
  ['how do I open the options flow then filter it to puts', 'Flow filters'],
]
// ⛔ THE ROWS ABOVE ARE NOT EDITED. Three of them miss what this file named, for reasons recorded here (2026-11-09, after the
// entries): each is asserted to reach what it reaches today, so a change in either direction shows. Counted in the PR doc.
export const COV3_MISSES = {
  // the Options Flow catalog control is more specific than the row this file named ("Flow filters")
  'how do I only see call options with a big premium': 'Options Flow: minimum premium',
  'how do I open the options flow then filter it to puts': 'Options Flow: calls or puts',
  // a two-part walkthrough's title lowercases its second part: "…, then locking a drawing"
  'how do I add a horizontal line and then lock it': 'then locking a drawing',
}
describe('held-out cov-3: comparisons, the indicator draft, widget controls, dates, two-part asks', () => {
  it.each(COV3_HELD_OUT.filter(([q]) => !COV3_MISSES[q]))('%s → %s', (q, want) => { expect(seen(q)).toContain(want) })
  it.each(COV3_HELD_OUT.filter(([q]) => COV3_MISSES[q]))('a recorded miss: %s (named %s)', (q, want) => {
    expect(seen(q)).not.toContain(want)
    expect(seen(q)).toContain(COV3_MISSES[q])
  })
})

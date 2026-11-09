// ── HELD-OUT: a list's columns and a ticker's note, said without the word "list" ──
// On Charts, columns belong only to a list widget (a Watchlist or a scan), and a note on a TICKER only to a list's row. ⛔ WRITTEN
// 2026-11-09 BEFORE that rule existed, in words of this file's own. A miss is a KNOWN MISS (both ways), never edited to pass.
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

export const LIST_COLUMNS_HELD_OUT = [
  ['how do I turn on the relative volume column', 'Choosing a list’s columns'],
  ['how do I get rid of a column I don’t use', 'Choosing a list’s columns'],
  ['how do I put the change column before price', 'Reordering a list’s columns'],
  ['how do I make the ticker column narrower', 'Resizing a list’s column'],
  ['how do I put the columns back how they were', 'Resetting a list’s columns'],
  ['how do I leave a note on a ticker', 'A note on a ticker'],
  ['how do I edit my note for a stock', 'A note on a ticker'],
]
export const LIST_COLUMNS_MISSES = {}
describe('held-out: a list\'s columns and a ticker\'s note, without the word list', () => {
  it.each(LIST_COLUMNS_HELD_OUT.filter(([q]) => !LIST_COLUMNS_MISSES[q]))('%s → %s', (q, want) => { expect(seen(q)).toContain(want) })
  it.each(LIST_COLUMNS_HELD_OUT.filter(([q]) => LIST_COLUMNS_MISSES[q]))('a KNOWN MISS: %s (named %s)', (q, want) => {
    expect(seen(q)).not.toContain(want)
    expect(seen(q)).toContain(LIST_COLUMNS_MISSES[q])
  })
})
describe('the rule stays inside lists', () => {
  it('a scan\'s columns stay the scan\'s, and a chart\'s text note stays a drawing', () => {
    expect(seen('how do I choose the columns of a scan')).not.toContain('a list’s columns')
    expect(seen('how do I add a text note on the chart')).not.toContain('A note on a ticker')
  })
})

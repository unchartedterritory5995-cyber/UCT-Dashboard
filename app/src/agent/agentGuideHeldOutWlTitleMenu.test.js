// ── HELD-OUT: the 11 list actions on the Charts watchlist widget's title menu (#1005, live: watchlist.title, watchlist.listMenu) ──
// ⛔ WRITTEN 2026-11-09 BEFORE any of these walkthroughs existed, in words of this file's own. Each row names a substring of the
// walkthrough's title. A miss is recorded as a KNOWN MISS (both ways), never edited to pass.
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

export const WL_TITLE_MENU_HELD_OUT = [
  ['how do I change the name of my watchlist', 'Renaming a list'],
  ['how do I rename my flagged list', 'Renaming a list'],
  ['how do I clear out all the starred tickers in my watchlist', 'Removing the starred tickers'],
  ['how do I copy my watchlist tickers to the clipboard', 'Copying a list'],
  ['how do I download my watchlist as a spreadsheet', 'Exporting a list'],
  ['how do I export my list to csv', 'Exporting a list'],
  ['how do I paste a bunch of tickers into my list', 'Importing tickers'],
  ['how do I get back an older version of my watchlist', 'A list’s version history'],
  ['how do I share my watchlist with everyone', 'Sharing a list'],
  ['how do I make my watchlist private again', 'Sharing a list'],
  ['how do I publish my list as a UCT prebuilt list', 'Publishing a list to Prebuilt'],
  ['how do I save someone else’s watchlist to my lists', 'Saving a community list'],
  ['how do I share my flagged list', 'Sharing a list'],
]
// ⛔ THE ROWS ABOVE ARE NOT EDITED. A KNOWN MISS is asserted both ways and listed in testing/agent/guide/knownMisses.json.
export const WL_TITLE_MENU_MISSES = {
  // NOT IN PRODUCT (C3-080): nothing in the product stars a ticker in a list, so Remove starred never shows and is not taught
  'how do I clear out all the starred tickers in my watchlist': 'Using watchlists',
}
describe('held-out: the list actions on the widget\'s title menu', () => {
  it.each(WL_TITLE_MENU_HELD_OUT.filter(([q]) => !WL_TITLE_MENU_MISSES[q]))('%s → %s', (q, want) => { expect(seen(q)).toContain(want) })
  it.each(WL_TITLE_MENU_HELD_OUT.filter(([q]) => WL_TITLE_MENU_MISSES[q]))('a KNOWN MISS: %s (named %s)', (q, want) => {
    expect(seen(q)).not.toContain(want)
    expect(seen(q)).toContain(WL_TITLE_MENU_MISSES[q])
  })
})

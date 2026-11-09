// ── HELD-OUT: the watchlist rows taught inside the Charts Watchlist widget (group A of TEACH-WATCHLISTS-WIDGET-DESIGN.md) ──
// ⛔ WRITTEN 2026-11-09 BEFORE any routing change for them, in words of this file's own (not the inventory's). Each row names
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

export const WL_WIDGET_HELD_OUT = [
  // C3-071: a new list from a saved look, in the picker's create form
  ['how do I start a new watchlist from one of my templates', 'Creating a list from a template'],
  ['how do I make a list using a saved template', 'Creating a list from a template'],
  // C3-076 / C3-079: a list's own tickers
  ['how do I put a new ticker on my watchlist', 'Adding a ticker to a watchlist'],
  ['how do I add AAPL to my list', 'Adding a ticker to a watchlist'],
  ['how do I take TSLA off my watchlist', 'Removing a ticker from a list'],
  ['how do I drop a stock from my list', 'Removing a ticker from a list'],
  // C3-083 / C3-085 / C3-086 / C3-087: a list's columns
  ['how do I hide the volume column in my watchlist', 'Choosing a list’s columns'],
  ['how do I add a column to my list', 'Choosing a list’s columns'],
  ['how do I move the price column to the left in my watchlist', 'Reordering a list’s columns'],
  ['how do I drag columns around in my list', 'Reordering a list’s columns'],
  ['how do I make a column wider in my watchlist', 'Resizing a list’s column'],
  ['how do I put my watchlist columns back to default', 'Resetting a list’s columns'],
  // C3-088: a ticker's note
  ['how do I write a note on a ticker in my list', 'A note on a ticker'],
  // C3-102: a row's attention facts
  ['how do I see why a stock in my list needs attention', 'A ticker’s attention facts'],
  ['how do I see the attention facts for a ticker in my watchlist', 'A ticker’s attention facts'],
  // C3-103: the widget's look
  ['how do I change the colours of my watchlist', 'Changing a watchlist’s look'],
  ['how do I change the background of my watchlist widget', 'Changing a watchlist’s look'],
  // C3-104: a saved watchlist look
  ['how do I save my watchlist look as a template', 'A saved watchlist look'],
  ['how do I load a saved look on my watchlist', 'A saved watchlist look'],
]
// ⛔ THE ROWS ABOVE ARE NOT EDITED. A KNOWN MISS is asserted both ways and listed in testing/agent/guide/knownMisses.json.
export const WL_WIDGET_MISSES = {}
describe('held-out: watchlist rows in the Charts widget', () => {
  it.each(WL_WIDGET_HELD_OUT.filter(([q]) => !WL_WIDGET_MISSES[q]))('%s → %s', (q, want) => { expect(seen(q)).toContain(want) })
  it.each(WL_WIDGET_HELD_OUT.filter(([q]) => WL_WIDGET_MISSES[q]))('a KNOWN MISS: %s (named %s)', (q, want) => {
    expect(seen(q)).not.toContain(want)
    expect(seen(q)).toContain(WL_WIDGET_MISSES[q])
  })
})

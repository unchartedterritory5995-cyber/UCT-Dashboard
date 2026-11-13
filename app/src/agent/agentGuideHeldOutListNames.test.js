// ── HELD-OUT: a member's own list, named ("Momentum", "my swing ideas list"), as a general list reference ──
// ⛔ WRITTEN 2026-11-09 BEFORE the list-name reader existed, in words of this file's own. The names are this fixture's, read at
// run time from the host's watchlist store (host.watchlists.snapshot): nothing in the guide knows any list's name. Each row
// names a substring of the walkthrough's title. A miss is recorded as a KNOWN MISS (both ways), never edited to pass.
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { guideFeature } from './guide/registry'
import { guideSteps } from './capabilities/guide'

beforeAll(() => { registerBuiltins() })
const LISTS = [{ id: '1', name: 'Momentum', items: [] }, { id: '2', name: 'Swing Ideas', items: [] }, { id: '3', name: 'Q4 Leaders', items: [] }]
const hostWith = (lists) => ({ surface: 'charts', watchlists: { snapshot: () => lists } })
const route = (q, lists = LISTS) => getCapability('guide.show').fast({ raw: q, host: hostWith(lists) })
const seen = (q, lists) => {
  const g = route(q, lists)
  if (!g) return 'null'
  const { steps, title } = guideSteps(guideFeature(g.feature), g.detail || q)
  return `${title} | ${JSON.stringify(steps[steps.length - 1]?.target ?? null)}`
}

export const LIST_NAME_HELD_OUT = [
  ['how do I add NVDA to Momentum', 'Adding a ticker to a watchlist'],
  ['how do I put AMD on my swing ideas list', 'Adding a ticker to a watchlist'],
  ['how do I take TSLA out of Momentum', 'Removing a ticker from a list'],
  ['how do I remove META from Swing Ideas', 'Removing a ticker from a list'],
  ['how do I write a note on NVDA in Momentum', 'A note on a ticker'],
  ['how do I hide a column in Momentum', 'Choosing a list’s columns'],
  ['how do I move the price column left in Swing Ideas', 'Reordering a list’s columns'],
  ['how do I widen a column in Q4 Leaders', 'Resizing a list’s column'],
  ['how do I reset the columns of Momentum', 'Resetting a list’s columns'],
]
// ⛔ THE ROWS ABOVE ARE NOT EDITED. A KNOWN MISS is asserted both ways and listed in testing/agent/guide/knownMisses.json.
export const LIST_NAME_MISSES = {}
describe('held-out: a member\'s own list, by its name', () => {
  it.each(LIST_NAME_HELD_OUT.filter(([q]) => !LIST_NAME_MISSES[q]))('%s → %s', (q, want) => { expect(seen(q)).toContain(want) })
  it.each(LIST_NAME_HELD_OUT.filter(([q]) => LIST_NAME_MISSES[q]))('a KNOWN MISS: %s (named %s)', (q, want) => {
    expect(seen(q)).not.toContain(want)
    expect(seen(q)).toContain(LIST_NAME_MISSES[q])
  })
})

describe('a name is a list only where the words use it as one', () => {
  it('a member with no such list: the name is just a word', () => {
    expect(seen('how do I add NVDA to Momentum', [])).not.toContain('Adding a ticker to a watchlist')
  })
  it('a list\'s name used as an ordinary word is not a list ("momentum indicators")', () => {
    expect(seen('how do I add momentum indicators')).not.toContain('watchlist')
    expect(seen('how do I add momentum indicators')).not.toContain('a list')
  })
})

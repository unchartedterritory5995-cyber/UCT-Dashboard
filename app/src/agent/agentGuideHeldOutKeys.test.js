// ── HELD-OUT: a chart's keyboard shortcuts, taught from their own declaration (components/chart/keyboardShortcuts.js) ──
// ⛔ WRITTEN 2026-11-10 BEFORE the key family existed, in words of this file's own (not the inventory's). Each row names a
// substring of the walkthrough's title. A miss is recorded as a KNOWN MISS (both ways), never edited to pass.
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
  return `${title} | ${steps.map(s => s.text).join(' / ')}`
}

export const KEYS_HELD_OUT = [
  ['what is the keyboard shortcut for log scale', 'Toggle log scale'],
  ['how do I use Shift+L', 'Toggle log scale'],
  ['is there a hotkey to jump to a date', 'Go to date'],
  ['what does Alt+G do on a chart', 'Go to date'],
  ['which key adds the ticker I am looking at to a watchlist', 'Add ticker to watchlist'],
  ['is there a shortcut for a price alert where my mouse is', 'Price alert at cursor'],
  ['how do I press Alt+Shift+A', 'Add indicator'],
  ['how do I see all the keyboard shortcuts', 'Show this help overlay'],
  ['what key cancels the drawing tool I picked', 'Cursor / cancel'],
]
// ⛔ THE ROWS ABOVE ARE NOT EDITED. A KNOWN MISS is asserted both ways and listed in testing/agent/guide/knownMisses.json.
export const KEYS_MISSES = {}
describe('held-out: a chart\'s keyboard shortcuts, from their declaration', () => {
  it.each(KEYS_HELD_OUT.filter(([q]) => !KEYS_MISSES[q]))('%s → %s', (q, want) => { expect(seen(q)).toContain(want) })
  it.each(KEYS_HELD_OUT.filter(([q]) => KEYS_MISSES[q]))('a KNOWN MISS: %s (named %s)', (q, want) => {
    expect(seen(q)).not.toContain(want)
    expect(seen(q)).toContain(KEYS_MISSES[q])
  })
})

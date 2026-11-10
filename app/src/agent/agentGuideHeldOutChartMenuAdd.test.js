// ── HELD-OUT, C1-123: "Add indicator…" on the chart's right-click menu (owner-approved row, 2026-11-10) ──
// ⛔ WRITTEN BEFORE the walkthrough change, in words of this file's own. A right-click / menu ask about adding an indicator
// walks to the menu's own row (data-menu-id ind-add) and names Alt+Shift+A as the other way in; an add with no menu words
// keeps its own walkthrough, and the other right-click rows keep theirs. A miss is recorded, never edited to pass.
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { guideFeature } from './guide/registry'
import { guideSteps } from './capabilities/guide'

beforeAll(() => { registerBuiltins() })
const route = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })
const walk = (q) => {
  const g = route(q)
  if (!g) return null
  const { steps, title } = guideSteps(guideFeature(g.feature), g.detail || q)
  return { feature: g.feature, title, steps, last: JSON.stringify(steps[steps.length - 1]?.target ?? null) }
}
const ROW = '{"within":"chart.contextMenu","attr":"data-menu-id","value":"ind-add"}'

describe('a menu ask about adding an indicator walks to the menu row', () => {
  it.each([
    'add indicator from menu',
    'how do I add an indicator from the right-click menu',
    'show me how to right-click the chart to add an indicator',
    'can I add a study by right clicking the chart',
    'where is add indicator in the chart menu',
  ])('"%s"', (q) => {
    const w = walk(q)
    expect(w, 'no walkthrough').toBeTruthy()
    expect(w.last).toBe(ROW)
    expect(w.steps).toHaveLength(2)
    expect(w.steps[0].target).toBe('chart.plot')
    expect(w.steps[0].text).toMatch(/right-click/i)
    // the other way in is named, never dropped
    expect(w.steps[1].text).toMatch(/Alt\+Shift\+A/)
  })
})

describe('nothing else moves', () => {
  it.each([
    ['how do I add an indicator', ROW, false],
    // (first written as 'what is the keyboard shortcut to add an indicator': at master 96230b5598 that question reaches no
    // walkthrough at all, so it could not show the key row stays put; recorded here and replaced by a how-phrasing)
    ['how do I add an indicator with a keyboard shortcut', '"chart.plot"', true],
    ['how do I add a widget by right-click', '"add-widget"', true],
    ['how do I send the chart to my journal', '"journal"', true],
    ['how do I set an alert by right-clicking the chart', '"set-alert"', true],
  ])('"%s"', (q, needle, has) => {
    const w = walk(q)
    expect(w, 'no walkthrough').toBeTruthy()
    if (has) expect(w.last).toContain(needle)
    else expect(w.last).not.toBe(needle)
  })
})

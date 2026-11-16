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
    'how do I add an indicator from the right-click menu',
    'show me how to right-click the chart to add an indicator',
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

// KNOWN MISSES (recorded after the AFTER run, both ways): not this row's: the ask gate. A bare phrase and a "can I …"
// question reach no walkthrough for ANY feature at master 96230b5598 (the existing add-widget row: 'can I add a widget by
// right clicking the chart' → null too). Their how-do-I forms reach the row.
describe('known misses: the ask gate, not the row', () => {
  it.each([
    ['add indicator from menu', 'how do I add indicator from menu'],
    ['can I add a study by right clicking the chart', 'how do I add a study by right clicking the chart'],
  ])('"%s" reaches nothing; "%s" reaches the row', (miss, how) => {
    expect(route(miss)).toBeNull()
    expect(walk(how).last).toBe(ROW)
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

// The row's OWN words, without the families before it: indicatorManage takes a plain add first, which hid a greedy
// /add.*indicator/ here (a surviving mutant, 2026-11-10). This rail reads the row alone, so that mutant fails.
describe('the row alone: a menu word is required', () => {
  it('matches only with a right-click or menu word', async () => {
    const { CHART_MENU } = await import('./guide/actions')
    const row = CHART_MENU.find(r => r.id === 'addIndicator')
    expect(row, 'no addIndicator row').toBeTruthy()
    for (const q of ['how do i add an indicator', 'how do i add rsi to my chart', 'how do i add a study', 'how do i add an indicator with a keyboard shortcut'])
      expect(row.re.test(q), q).toBe(false)
    for (const q of ['how do i add indicator from menu', 'how do i add a study by right clicking the chart', 'right-click to add an indicator'])
      expect(row.re.test(q), q).toBe(true)
  })
})

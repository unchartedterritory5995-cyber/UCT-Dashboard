// ── HELD-OUT, the chart right-click menu's remaining rows (inventory v2: C1-177, C1-178 confirmed additions; the
// location-aware settings row, a discovery candidate). ⛔ WRITTEN 2026-11-10 BEFORE any change, in words of this file's
// own. Each ask walks to the menu's own row (data-menu-id). A miss is recorded as a KNOWN MISS (both ways), never edited.
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
const row = (id) => `{"within":"chart.contextMenu","attr":"data-menu-id","value":"${id}"}`

describe('each ask walks to its menu row', () => {
  it.each([
    // C1-177: Send to Journal, choose where
    ['how do I send the chart to the journal and choose where it goes', 'journal-choose'],
    ['show me how to pick which journal entry a chart capture lands in', 'journal-choose'],
    ['how do I save this chart into a particular journal page', 'journal-choose'],
    // C1-178: Ask AI about the symbol (offered on a right-click over a bar)
    ['how do I ask the AI about this stock from the chart', 'ask-ai'],
    ['show me how to ask AI about a bar on the chart', 'ask-ai'],
    ['how do I get an AI take on this ticker by right-clicking the chart', 'ask-ai'],
    // the location-aware settings row
    ['how do I open candle settings by right-clicking a candle', 'settings-candles'],
    ['show me how to reach the canvas settings from the chart menu', 'settings-canvas'],
    ['how do I right-click the watermark to open its settings', 'settings-watermark'],
  ])('"%s" → %s', (q, id) => {
    const w = walk(q)
    expect(w, 'no walkthrough').toBeTruthy()
    expect(w.last).toBe(row(id))
    expect(w.steps[0].target).toBe('chart.plot')
    expect(w.steps[0].text).toMatch(/right-click/i)
  })
})

describe('nothing else moves', () => {
  it.each([
    ['how do I send the chart to my journal', row('journal'), true],
    ['how do I add an indicator from the right-click menu', row('ind-add'), true],
    ['how do I set an alert by right-clicking the chart', row('set-alert'), true],
    ['how do I add a widget by right-click', row('add-widget'), true],
    ['how do I change the candle colours', 'chart.contextMenu', false],
    ['how do I move the watermark', 'chart.contextMenu', false],
    // added after mutation M3 survived (the ask-ai row without its chart-word lookahead): an AI ask that names no chart,
    // bar or menu is not the chart menu's row
    ['how do I ask the AI about a stock', 'ask-ai', false],
    ['show me how to ask AI a question', 'ask-ai', false],
  ])('"%s"', (q, needle, has) => {
    const w = walk(q)
    if (has) { expect(w, 'no walkthrough').toBeTruthy(); expect(w.last).toBe(needle) } else expect(w?.last ?? '').not.toContain(needle)
  })
})

// Found while running the above (2026-11-10): "right-click" was read as the word "right", so the watermark's
// Alignment control (any: right) took a right-click ask. Written before the words.js change.
describe('"right-click" is not the word "right"', () => {
  it('a right-click ask carries no "right" concept; the word alone still does', async () => {
    const { conceptsOf } = await import('./guide/words')
    for (const q of ['how do i right-click the watermark', 'right click the chart', 'by right-clicking it', 'i right-clicked the candle',
      'right clicking the axis', 'a rightclick menu', 'the right-click menu', 'two right clicks']) expect(conceptsOf(q).has('~right'), q).toBe(false)
    // "right" as a direction stays: the word, not a click
    for (const q of ['how do i align the watermark to the right', 'put it on the right', 'the right side of the chart', 'move the label right',
      'right of the candles', 'the right edge', 'right-align the text']) expect(conceptsOf(q).has('~right'), q).toBe(true)
    // the click survives the rewrite (a "click" control still reads its word)
    expect([...conceptsOf('right-click the chart')].some(c => /click/.test(c))).toBe(true)
  })
  it('aligning the watermark to the right still walks to Alignment', () => {
    expect(walk('how do I align the watermark to the right').last).toContain('Alignment')
  })
})

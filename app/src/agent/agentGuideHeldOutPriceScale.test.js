// ── HELD-OUT: resetting the price scale (owner decision 2026-11-09; pl-exec offers it when auto-scale is refused on a dragged
// log scale). ⛔ WRITTEN BEFORE the entry existed, in words of this file's own. The entry pl-exec offers is
// guide.show { feature: 'chartView', detail: <the member's words> } → the row id 'priceScaleReset' (title below).
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
  return `${g.feature} | ${title} | ${steps.map(s => s.text).join(' / ')}`
}

export const PRICE_SCALE_HELD_OUT = [
  ['how do I reset the price scale', 'Resetting the price scale'],
  ['how do I put the price axis back to auto', 'Resetting the price scale'],
  ['how do I undo dragging the price axis', 'Resetting the price scale'],
  ['how can I get the price scale back to normal after I squished it', 'Resetting the price scale'],
  ['show me how to reset the y axis', 'Resetting the price scale'],
]
describe('held-out: resetting the price scale', () => {
  it.each(PRICE_SCALE_HELD_OUT)('%s → %s', (q, want) => {
    const s = seen(q)
    expect(s).toContain(want)
    expect(s).toMatch(/^chartView \|/)
    expect(s).toContain('Double-click the price axis to reset it to auto')
  })
})

// ── HELD-OUT, the rest of the Multi Chart grid ops pl-grid executes (agent/pl/exec-multichart-grid, multiChart.set /
// multiChart.cell, 2026-11-10): Groups mode on and off, picking a group, Prev and Next, the also-in switch, refreshing the
// group, saving, opening and deleting a saved grid, the shared settings and un-maximizing. ⛔ WRITTEN BEFORE any change,
// in words of this file's own. Each "how do I" ask walks to the control that does it (a substring of the title or of the
// last step's target). A miss is recorded as a KNOWN MISS (both ways), never edited to pass.
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { guideFeature } from './guide/registry'
import { guideSteps } from './capabilities/guide'

beforeAll(() => { registerBuiltins() })
const route = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })
export const seen = (q) => {
  const g = route(q)
  if (!g) return 'null'
  const { steps, title } = guideSteps(guideFeature(g.feature), g.detail || q)
  return `${title} | ${JSON.stringify(steps[steps.length - 1]?.target ?? null)}`
}

export const GRID_OPS_HELD_OUT = [
  // Groups mode
  ['how do I fill my grid with a stock’s group automatically', 'Groups Mode'],
  ['how do I stop using groups in multi chart', 'Exit Groups'],
  // picking a group
  ['show me how to load the semiconductor group into the grid', 'Search groups'],
  // Prev / Next
  ['how do I go to the previous group in my grid', 'Previous group'],
  ['how do I move on to the next group in multi chart', 'Next group'],
  // the also-in switch (the group header's chips)
  ['how do I switch the grid to another group this stock is also in', 'Switch to '],
  // refreshing the group
  ['how do I re-rank the group in my grid right now', '↻ Refresh group'],
  // saved grids
  ['how do I save this grid so I can use it later', 'Grid name'],
  ['show me how to open one of my saved grids', 'My grids'],
  ['how do I get rid of a grid I saved', 'Delete'],
  // the shared settings, un-maximizing
  ['where are the settings every chart in my grid shares', 'chart.cellSettings'],
  ['how do I get all the grid charts back on screen after maximizing one', 'chart.cellMaximize'],
]

describe('a grid op ask walks to its control', () => {
  it.each(GRID_OPS_HELD_OUT)('"%s" → %s', (q, needle) => {
    expect(seen(q)).toContain(needle)
  })
})

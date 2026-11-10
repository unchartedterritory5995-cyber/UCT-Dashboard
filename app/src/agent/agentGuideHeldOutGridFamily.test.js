// ── HELD-OUT, the Multi Chart grid families pl-grid executes (2026-11-10): maximize a cell, reset a cell to my chart,
// the grid's size, crosshair / time-range sync. ⛔ WRITTEN BEFORE any change, in words of this file's own. Each "how do I"
// ask walks to the control that does it (a substring of the title or of the last step's target). A miss is recorded as a
// KNOWN MISS (both ways), never edited to pass.
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

export const GRID_FAMILY_HELD_OUT = [
  // maximize one cell
  ['how do I make one chart in the grid fill the whole grid', 'chart.cellMaximize'],
  ['show me how to blow up a single grid chart to full size', 'chart.cellMaximize'],
  ['how do I put a grid chart back to its normal size after maximizing it', 'chart.cellMaximize'],
  // reset a cell to my chart
  ['how do I reset a grid chart to my own chart settings', 'chart.cellReset'],
  ['show me how to drop the custom look on one chart in the grid', 'chart.cellReset'],
  // the grid's size
  // (first written with 'multiChart.preset': the grid walkthrough's LAST step is the Workspace button by design, so the
  // needle could never match; a test-design error recorded at the first AFTER run, the title is the walkthrough's)
  ['how do I change the grid to four by four', 'Setting up a 4×4 chart grid'],
  ['show me how to set up a 2x3 grid of charts', 'Setting up a 2×3 chart grid'],
  ['how do I go back from the grid to my normal board', 'Leaving Multi Chart'],
  // sync across the grid
  ['how do I sync crosshairs across the grid', 'Sync crosshair across charts'],
  ['how do I turn off crosshair sync on my grid', 'Sync crosshair across charts'],
  ['show me how to keep every grid chart on the same time range', 'Sync time range across charts'],
]

describe('a grid family ask walks to its control', () => {
  it.each(GRID_FAMILY_HELD_OUT)('"%s" → %s', (q, needle) => {
    expect(seen(q)).toContain(needle)
  })
})

// CONTROLS (added with the fix): the chart's own grid LINES keep their walkthrough; a plain reset of a single chart's view
// and an ordinary settings ask in the grid keep theirs
describe('nothing else moves', () => {
  it.each([
    ['how do I turn off the grid lines', 'Grid lines'],
    ['how do I hide the grid on my chart', 'Grid lines'],
    ['how do I change the grid lines colour', 'Grid lines'],
    ['how do I open the shared settings of my grid', 'chart.cellSettings'],
    ['how do I reset a chart in the grid', 'chart.cellReset'],
  ])('"%s" → %s', (q, needle) => { expect(seen(q)).toContain(needle) })
})

// ── HELD-OUT, round 3: the next catalog families (guide/controls.js) ─────────────────────────────────────────────
//
// ⛔ WRITTEN 2026-11-07 BEFORE the entries existed: watchlist columns (resize, reset), the Scanner's picker (search, back),
// nudging a drawing from the keyboard, Volume Surge logos, placing a news headline on the chart. Words chosen not to be the
// inventory's own. Each row names a substring of the LAST step (its target and its sentence). A miss stays a miss.
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { guideFeature } from './guide/registry'
import { stepsFor } from './guide/slots'

beforeAll(() => { registerBuiltins() })

const route = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })
const last = (q) => {
  const got = route(q)
  const steps = got ? stepsFor(guideFeature(got.feature), got.detail || q) : []
  const s = steps[steps.length - 1]
  return s ? JSON.stringify({ target: s.target, text: s.text }) : 'null'
}

export const HELD_OUT_2 = [
  ['how can I make a column in my watchlist wider', 'Drag to resize column'],
  ['how do I stretch the symbol column of a list', 'Drag to resize column'],
  ['how do I put my watchlist columns back to the default', 'Reset columns'],
  ['where do I look up a scan by name in the scanner', '"aria":"Search"'],
  ['how do I go back to the list of scans', 'watchlist.lists'],
  ['how do I get back to choosing a scan in the scanner', 'watchlist.lists'],
  ['how do I nudge a drawing a little with the keyboard', 'arrow keys'],
  ['teach me to move a selected drawing using arrow keys', 'arrow keys'],
  ['how do I turn on company logos in the volume surge widget', 'volumescan'],
  ['how do I pin a news headline onto my chart', 'Place headline on chart'],
]
// an existing walkthrough owns these words
export const NONE_2 = [
  ['how do I reset the view', 'chartMenu'],
  ['how do I sort my watchlist', 'watchlistAction'],
  ['how do I move a drawing', 'drawingEdit'],
  ['how do I search themes', 'widgetAction'],
  ['how do I choose the columns of my watchlist', 'watchlistAction'],
]

describe('held-out round 3: the catalog rings the control the words describe', () => {
  it.each(HELD_OUT_2)('%s → %s', (q, want) => { expect(last(q)).toContain(want) })
})
describe('held-out round 3: other walkthroughs keep their words', () => {
  it.each(NONE_2)('%s stays %s', (q, feature) => { expect(route(q)?.feature).toBe(feature) })
})

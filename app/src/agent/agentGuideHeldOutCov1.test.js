// ── HELD-OUT, cov-1: indicator settings and appearance, watchlist rows and columns, the Scanner's own controls ──────────
// ⛔ WRITTEN 2026-11-08 BEFORE any cov-1 entry or reading existed, in words of this file's own (not the inventory's). Each
// row names a substring of the last step's target. The count before the entries is in the cov-1 PR doc; the rows are not
// edited to pass.
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { guideFeature } from './guide/registry'
import { stepsFor } from './guide/slots'

beforeAll(() => { registerBuiltins() })
const route = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })
const last = (q) => { const g = route(q); const s = g ? stepsFor(guideFeature(g.feature), g.detail || q) : []; return JSON.stringify(s[s.length - 1]?.target ?? null) }

const FIELD = '"attr":"data-field"'
const COLOUR = 'chartSettings.colorPanel'
export const COV1_HELD_OUT = [
  // indicator settings: a named indicator and a value, a timeframe, a source, a toggle
  ['how do I set my RSI to 21', FIELD],
  ['how can I change the RSI so it uses 9 bars', FIELD],
  ['how do I run the RSI on the weekly timeframe instead of the chart one', FIELD],
  ['how do I calculate the MACD on a higher timeframe', FIELD],
  ['how do I hide the signal line on the MACD', FIELD],
  ['how do I switch the moving average source to the high', FIELD],
  // indicator appearance: colour, width, line style, plot style
  ['how do I make my moving average red', COLOUR],
  ['how do I change the colour of the MACD histogram bars', COLOUR],
  ['how do I make the RSI line purple', COLOUR],
  ['how can I make the 50 day moving average line thicker', FIELD],
  ['how do I make the MACD line dotted', FIELD],
  ['how do I draw the RSI as a histogram instead of a line', FIELD],
  // watchlist rows
  ['how do I put NVDA on my watchlist', 'watchlist.addSymbol'],
  ['how do I take TSLA off my list', 'remove'],
  ['how do I add a ticker to my flagged list', 'Add to Flagged'],
  ['how do I add a note to a ticker in my watchlist', 'notes'],
  ['how do I open one of my lists in the watchlist widget', 'watchlist.picker'],
  // watchlist columns
  ['how do I hide a column in my watchlist', 'watchlist.colMenu'],
  ['how do I add another column to my watchlist', 'watchlist.colMenu'],
  ['how do I make a watchlist column wider', 'Drag to resize column'],
  ['how do I put my watchlist columns back to default', 'Reset columns'],
  // the Scanner widget
  ['how do I add a column to the scanner results', 'watchlist.colMenu'],
  ['how do I find a scan by name', 'Search'],
  ['how do I re-run this scan', 'Refresh scan'],
  ['how do I order the scan results by relative volume', 'Sort by Symbol'],
  ['how do I see what a scan is screening for', 'watchlist.scanCriteria'],
  ['how do I get out of this scan and pick another one', 'watchlist.lists'],
]
describe('held-out cov-1: indicator settings and appearance, watchlist rows and columns, Scanner', () => {
  it.each(COV1_HELD_OUT)('%s → %s', (q, want) => { expect(last(q)).toContain(want) })
})

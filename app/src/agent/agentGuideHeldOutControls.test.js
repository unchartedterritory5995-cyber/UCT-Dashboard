// ── HELD-OUT teaching phrasings for the named-control catalog (guide/controls.js) ─────────────────────────────
//
// ⛔ WRITTEN BEFORE guide/controls.js EXISTED (2026-11-06, agent/pl/teach-gen-1), in words chosen NOT to be the inventory's
// own (docs/agent/CHARTS_COVERAGE_MATRIX.md "Human action" / "Example phrase" — that is the tuning set, probed by
// agentGuideInventory.test.js). Each row names the control the walkthrough's LAST step must ring, by the product's own
// accessible name or label: a substring of that step's target. Never edit a row to turn it green: a miss is reported as a
// miss (the first run's score is the number in the report).
//
// ASK: words that fit several controls equally — the guide must ask which, never pick one.
// NONE: words the catalog must not claim (another walkthrough, or the model).
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { guideFeature } from './guide/registry'
import { stepsFor } from './guide/slots'

beforeAll(() => { registerBuiltins() })

const route = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })
const lastTarget = (q) => {
  const got = route(q)
  if (!got) return null
  const f = guideFeature(got.feature)
  const steps = f ? stepsFor(f, got.detail || q) : []
  return JSON.stringify(steps[steps.length - 1]?.target ?? null)
}

export const HELD_OUT = [
  // Send to Journal, per widget
  ['how can I push my price alerts over to the journal', 'alerts'],
  ['walk me through getting today’s earnings calendar into my journal', 'calendar'],
  ['teach me to save the breadth snapshot in my journal', 'breadth'],
  ['how would I log the index levels to the journal', 'indexes'],
  ['where do I send this AI search chat to the journal', 'aisearch'],
  ['how do I put the theme ranking in my journal', 'themes'],
  // a drawing's own menu
  ['how do I change the fill colour of a rectangle', 'Fill'],
  ['show me how to make my text note italic', 'Italic'],
  ['walk me through putting the fib back to its default levels', 'Reset levels'],
  ['how do I flatten a trendline so it is level', 'Make horizontal'],
  ['how do I make a copy of a drawing', 'Duplicate'],
  ['how can I keep these drawing settings for next time', 'Save as default'],
  ['how do I hide the dollar change on the measure tool', 'Show dollar change'],
  // the chart toolbar and its panels
  ['how do I make drawings snap to the candles', 'Magnet'],
  ['how do I keep the same drawing tool after I place one', 'Repeat drawing'],
  ['where do I choose which drawing tools show on my toolbar', 'chart.customizeTools'],
  ['how do I start a fresh drawing board', 'New board'],
  ['how can I rename a drawing board', 'Rename'],
  ['how do I save the chart as a png file', 'Download PNG'],
  ['how would I copy a picture of the chart to paste somewhere', 'Copy to Clipboard'],
  ['how do I get a link to this chart', 'Copy Share URL'],
  // a watchlist's own list controls
  ['how do I get rid of one of my watchlists', 'Delete watchlist'],
  ['how do I share my watchlist with the community', 'Share with community'],
  ['how do I download my watchlist as a csv', 'Export CSV'],
  ['how can I paste a bunch of tickers into a list at once', 'Import tickers'],
  ['how do I see older versions of my watchlist', 'Version history'],
  ['how do I copy all the tickers in a list', 'Copy list to clipboard'],
  ['how do I clear the starred names out of a list', 'Remove starred'],
  // the layout library and bar
  ['how do I permanently delete a saved layout', 'permanently'],
  ['how do I put a layout from my library onto the bar', 'to the bar'],
  ['how do I shift a layout one spot to the left on the bar', 'Move left'],
  // tabs
  ['how do I rename one of my chart tabs', 'chart.tabs'],
  ['how do I change which colour group a chart tab follows', 'linked color group'],
  // widgets' own controls
  ['how do I flip the earnings list to sort by implied move', 'Sort by implied move'],
  ['how do I bookmark a news headline', 'More actions for this headline'],
  ['where do I manage my news collections', 'Manage collections'],
  ['how can I go back to the live news feed', 'live feed'],
  ['how do I stop an AI search that is running', 'Stop search'],
  ['how do I keep an AI search answer for later', 'Save this answer'],
  ['how do I copy the text of an AI answer', 'Copy answer text'],
  ['how do I hide one index from the indexes widget', 'Hide'],
  ['how do I rerun the scan to get fresh results', 'Refresh scan'],
  ['how do I zoom into the market map', 'Zoom in'],
  ['how do I turn the ticker labels off on the market map', 'Cycle ticker labels'],
  ['how do I make the market map follow my watchlist', 'Follow the linked list'],
  ['how do I delete a volume surge list', 'Delete list'],
  // chart settings rows the settings table does not carry
  ['how do I line the watermark up on the left', 'Alignment'],
  ['how do I put the watermark back in the middle', 'Reset to center'],
  ['how do I choose which bar values show in the legend', 'Bar info'],
]

// several controls fit these words equally: the answer is a question naming them
export const ASK = [
  'how do I send this to the journal',
  'how do I delete a list',
  'how do I rename it',
]

// not the catalog's: an existing walkthrough owns these words, and the catalog must not take them
export const NONE = [
  ['how do I delete an alert', 'widgetAction'],
  ['how do I remove a ticker from my watchlist', 'watchlistAction'],
  ['how do I rename a layout', 'layoutAction'],
  ['how do I lock a drawing', 'drawingEdit'],
  ['how do I hide the grid lines', 'chartSetting'],
  ['how do I add an RSI', 'indicators'],
  ['how do I draw a trendline', 'drawing'],
]

// ⛔ RECORDED MISSES, kept as they were written (2026-11-06 report). "bookmark" is an authoring error: the guide rings the
// headline's own bookmark (Save headline), the row expected the ⋯ menu. "line the watermark up" reads "line" as a drawing.
const MISSES = new Set(['how do I bookmark a news headline', 'how do I line the watermark up on the left'])
const ASK_MISSES = new Set(['how do I delete a list'])   // one owner (a watchlist) is shown, not asked about
// ⛔ WITHDRAWN 2026-11-07 (browser: the Charts Watchlist widget shows a list in pick mode, which hides the list's header —
// Watchlists.module.css .pickMode .wlHeader { display: none } — so these controls are not reachable on /charts). The rows stay
// as written; what is asserted now is that the guide never rings a control the member cannot see. Deleting a list is taught
// through the widget's picker instead (its bin on each list).
const WITHDRAWN = new Set(['Delete watchlist', 'Share with community', 'Export CSV', 'Import tickers', 'Version history', 'Copy list to clipboard', 'Remove starred'])
describe('held-out: the catalog rings the control the words describe', () => {
  it.each(HELD_OUT.filter(([q, n]) => WITHDRAWN.has(n)))('WITHDRAWN: %s never rings the hidden %s', (q, name) => {
    expect(String(lastTarget(q))).not.toContain(name)
  })
  it.each(HELD_OUT.filter(([q, n]) => !MISSES.has(q) && !WITHDRAWN.has(n)))('%s → %s', (q, name) => {
    expect(lastTarget(q)).toContain(name)
  })
  it.fails.each(HELD_OUT.filter(([q]) => MISSES.has(q)))('KNOWN MISS: %s → %s', (q, name) => {
    expect(lastTarget(q)).toContain(name)
  })
})
describe('held-out: words several controls fit are asked about, never guessed', () => {
  it.fails.each(ASK.filter(q => ASK_MISSES.has(q)))('KNOWN MISS: %s', (q) => { expect(route(q)?.feature).toBe('control'); expect(getCapability('guide.show').answer(null, { feature: 'control', detail: q }, { surface: 'charts', charts: { list: () => [] } })).toMatch(/which/i) })
  it.each(ASK.filter(q => !ASK_MISSES.has(q)))('%s', (q) => {
    const got = route(q)
    expect(got?.feature).toBe('control')
    const said = getCapability('guide.show').answer(null, { feature: got.feature, detail: got.detail }, { surface: 'charts', charts: { list: () => [] } })
    expect(said).toMatch(/\?/)
    expect(said).toMatch(/which/i)
  })
})
describe('held-out: the catalog leaves another walkthrough’s words alone', () => {
  it.each(NONE)('%s stays %s', (q, feature) => { expect(route(q)?.feature).toBe(feature) })
})

// app/src/components/chart/engine/__tests__/listingStatement.test.js
//
// ─── ⭐⭐ THE LISTING STATEMENT ON A WEEKLY OR MONTHLY CHART (coordinator ruling 2026-11-20) ──────────
//
// ⚰️ Production e86, Fred RS on NASDAQ:BGIN 1W (listed 2025-10-21): the chart's first weekly bar IS the
// listing week (`/api/bars/BGIN?tf=W` first bar `2025-10-24`), and the member read "this chart's bars
// don't start at the symbol's first trading day", which is FALSE. The ruling:
//   (a) the door states the FACT on W / M (`listingSeed.listingStartOf`);
//   (b) whatever is still refused there says a TRUE sentence (`runtime:listing-unverified`, and the
//       host lane's notes through `interpret.js::chartClockSentence`);
//   (c) SERVING a run from the listing on W / M stays gated on capture evidence: `historyFromListing`
//       (the switch) stays daily-only (`LISTING_SERVED_TFS`).
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import * as registry from '../nativeRegistry'
import { listingStartOf, historyFromListingOf, servedFromListingOf, LISTING_SERVED_TFS } from '../listingSeed'
import { listingOptsFor, chartClockReport } from '../astColumns'
import {
  computeRuntimeColumns, RUNTIME_LISTING_UNVERIFIED_GUARD, RUNTIME_WARMUP_GUARD,
} from '../runtime/runtimeColumns'
import {
  CHART_CLOCK_WITHHELD, LISTING_LATER_NOTES, LISTING_UNVERIFIED_NOTE, chartClockSentence,
} from '../ast/interpret'
import { runHalfRefusedSentence } from '../ast/objectLoss'

const LISTED = '2025-10-21'                     // NASDAQ:BGIN's first trade (/api/ticker-ipo/BGIN, final)
const W_FIRST = '2025-10-24'                    // its first weekly bar as /api/bars?tf=W keys it (the week's last session)
const M_FIRST = '2025-10-01'                    // its first monthly bar (the month's first day)

describe('(a) the FACT: does the chart\'s first bar hold the symbol\'s first trade?', () => {
  const bars = (t) => [{ t }, { t: '2099-01-01' }]
  it('a weekly chart whose first bar is the listing week, and a monthly one whose first bar is the listing month, start at the listing', () => {
    expect(listingStartOf({ bars: bars(W_FIRST), tf: 'W', listDate: LISTED })).toBe(true)
    expect(listingStartOf({ bars: bars(M_FIRST), tf: 'M', listDate: LISTED })).toBe(true)
    // the store's key may be any day of the period: the week's Monday, or a timestamped ISO string
    expect(listingStartOf({ bars: bars('2025-10-20'), tf: 'W', listDate: LISTED })).toBe(true)
    expect(listingStartOf({ bars: bars('2025-10-24T00:00:00Z'), tf: 'W', listDate: LISTED })).toBe(true)
  })
  it('⛔ one starting AFTER the listing period does not', () => {
    expect(listingStartOf({ bars: bars('2025-10-31'), tf: 'W', listDate: LISTED })).toBe(false)
    expect(listingStartOf({ bars: bars('2025-10-17'), tf: 'W', listDate: LISTED })).toBe(false)   // a week BEFORE: not it either
    expect(listingStartOf({ bars: bars('2025-11-01'), tf: 'M', listDate: LISTED })).toBe(false)
    expect(listingStartOf({ bars: bars('2024-10-01'), tf: 'M', listDate: LISTED })).toBe(false)   // same month, another year
  })
  it('the ISO week crosses a year: a Tuesday 2024-12-31 listing is the week its Friday 2025-01-03 bar keys', () => {
    expect(listingStartOf({ bars: bars('2025-01-03'), tf: 'W', listDate: '2024-12-31' })).toBe(true)
    expect(listingStartOf({ bars: bars('2025-01-10'), tf: 'W', listDate: '2024-12-31' })).toBe(false)
  })
  it('daily is exactly `historyFromListingOf` (equality, never "within the week")', () => {
    for (const t of [LISTED, '2025-10-22', '2025-10-20']) {
      expect(listingStartOf({ bars: bars(t), tf: 'D', listDate: LISTED })).toBe(historyFromListingOf({ bars: bars(t), tf: 'D', listDate: LISTED }))
    }
    expect(listingStartOf({ bars: bars('2025-10-22'), tf: 'D', listDate: LISTED })).toBe(false)
  })
  it('⛔ intraday, malformed, missing: no fact', () => {
    expect(listingStartOf({ bars: [{ t: 1761053400 }], tf: '60', listDate: LISTED })).toBe(false)
    expect(listingStartOf({ bars: bars(W_FIRST), tf: 'W', listDate: null })).toBe(false)
    expect(listingStartOf({ bars: bars(W_FIRST), tf: 'W', listDate: '10/21/2025' })).toBe(false)
    expect(listingStartOf({ bars: [], tf: 'W', listDate: LISTED })).toBe(false)
    expect(listingStartOf({ bars: [{ t: 1761053400 }], tf: 'W', listDate: LISTED })).toBe(false)
    expect(listingStartOf()).toBe(false)
  })
})

describe('(c) THE FACT IS NOT THE PERMISSION: serving from the listing stays daily-only', () => {
  it('weekly is SERVED on its capture evidence (BGIN 1W MATCH); monthly is not yet', () => {
    expect(LISTING_SERVED_TFS).toEqual(['D', 'W'])
    expect(servedFromListingOf({ bars: [{ t: W_FIRST }], tf: 'W', listDate: LISTED })).toBe(true)
    expect(servedFromListingOf({ bars: [{ t: '2025-10-31' }], tf: 'W', listDate: LISTED })).toBe(false)   // a week after
    expect(servedFromListingOf({ bars: [{ t: M_FIRST }], tf: 'M', listDate: LISTED })).toBe(false)        // ⛔ M: not yet
    expect(servedFromListingOf({ bars: [{ t: LISTED }], tf: 'D', listDate: LISTED })).toBe(true)
    expect(servedFromListingOf({ bars: [{ t: '2025-10-22' }], tf: 'D', listDate: LISTED })).toBe(false)   // daily stays exact
    // the daily switch itself is unchanged
    expect(historyFromListingOf({ bars: [{ t: W_FIRST }], tf: 'W', listDate: LISTED })).toBe(false)
  })
})

// ── (b) the runtime lane: a listing document on a W chart that starts at the listing ──────────────────
const N = 400
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 50 + 20 * Math.sin(i / 17) + i * 0.05
  return { t: 1700000000 + i * 7 * 86400, o: c - 0.4, h: c + 1, l: c - 1, c, v: 1000 + (i % 13) }
})
// a count never forgets where the run began: run from two first bars, it never agrees
const COUNTER = {
  id: 'rt-listing-w', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:rt-listing-w', outputs: { a: 0 },
    source: '//@version=6\nindicator("n", overlay = false)\nvar float n = 0.0\nn += 1\nplot(n)\n' },
}
const run = (ctx, opts) => { try { computeRuntimeColumns(COUNTER, BARS, ctx, opts); return null } catch (e) { return e } }
const W_CLOSED = { tf: 'W', newestBarIsForming: false }

describe('(b) the runtime lane says the TRUE sentence where the chart starts at the listing', () => {
  it('a weekly chart starting at the listing is refused as `runtime:listing-unverified`, saying it DOES start there', () => {
    const err = run({ ...W_CLOSED, listingStart: true })
    expect(err && err.guard).toBe(RUNTIME_LISTING_UNVERIFIED_GUARD)
    expect(err.message).toMatch(/DOES start at the symbol's first trading period/)
    expect(err.message).toMatch(/only been checked against TradingView on daily charts/)
    expect(err.message).not.toMatch(/does not start|not known to start|start later/)
  })
  it('CONTROL: one starting after the listing keeps the off-listing refusal and its sentence, unchanged', () => {
    const err = run(W_CLOSED)
    expect(err && err.guard).toBe(RUNTIME_WARMUP_GUARD)
    expect(err.message).toMatch(/does not start at the symbol's first bar/)
  })
  it('the curtain-off path says the same true sentence', () => {
    const err = run({ ...W_CLOSED, listingStart: true }, { warmupCurtain: false })
    expect(err && err.guard).toBe(RUNTIME_LISTING_UNVERIFIED_GUARD)
  })
  it('⛔ the fact never SERVES: where `historyFromListing` holds (daily), the run draws and the fact is not consulted', () => {
    expect(run({ tf: 'D', newestBarIsForming: false, historyFromListing: true, listingStart: true })).toBeNull()
  })
  it('the member\'s strip has a sentence for the new guard, and it is not the history-start one', () => {
    const s = runHalfRefusedSentence('runtime:listing-unverified')
    expect(s).toMatch(/this chart starts at the symbol's first trading period/)
    expect(s).toMatch(/only been checked against TradingView on daily charts/)
    expect(s).not.toMatch(/don't start/)
    expect(runHalfRefusedSentence('runtime:history-start')).toMatch(/don't start at the symbol's first trading day/)   // CONTROL
  })
})

// ── (b) the host lane's notes ──────────────────────────────────────────────────────────────────────────
describe('(b) the host lane: a note claiming the bars start later is replaced where the chart starts at the listing', () => {
  it('`chartClockSentence` gives the true note only where the fact holds and the run is not served', () => {
    for (const code of LISTING_LATER_NOTES) {
      expect(chartClockSentence(code, 'W', { listingStart: true }), code).toBe(LISTING_UNVERIFIED_NOTE('W'))
      expect(chartClockSentence(code, 'W', {}), code).toBe(CHART_CLOCK_WITHHELD[code]('W'))
      expect(chartClockSentence(code, 'D', { listingStart: true, historyFromListing: true }), code)
        .toBe(CHART_CLOCK_WITHHELD[code]('D'))
    }
    expect(LISTING_UNVERIFIED_NOTE('W')).toMatch(/first trading week/)
    expect(LISTING_UNVERIFIED_NOTE('M')).toMatch(/first trading month/)
    // a note about something else is never touched
    expect(chartClockSentence('request:other-timeframe', 'W', { listingStart: true }))
      .toBe(CHART_CLOCK_WITHHELD['request:other-timeframe']('W'))
  })
  it('⛔ DRIFT: every note whose own sentence says the loaded bars start after the listing is in the list, and the list names only real notes', () => {
    // the table's own sentences decide; a new note of this kind that is not listed fails here
    const later = /start(s)? later|start after the symbol's listing|does not begin at the symbol's listing|count is lower than TradingView's/
    const claimed = Object.keys(CHART_CLOCK_WITHHELD).filter((k) => later.test(CHART_CLOCK_WITHHELD[k]('W')))
    expect(claimed.length).toBeGreaterThan(5)                     // CONTROL: the matcher sees the sentences
    expect([...claimed].sort()).toEqual([...claimed].filter((k) => LISTING_LATER_NOTES.includes(k)).sort())
    for (const k of LISTING_LATER_NOTES) expect(typeof CHART_CLOCK_WITHHELD[k], k).toBe('function')
  })
  it('`listingOptsFor` carries the fact to a Pine document only, and never with the serving switch', () => {
    const pine = { meta: { recurrenceOrigin: 'pine' } }
    expect(listingOptsFor(pine, { listingStart: true })).toEqual({ listingStart: true })
    expect(listingOptsFor({ meta: {} }, { listingStart: true })).toEqual({})
    expect(listingOptsFor(pine, { historyFromListing: true, listingStart: true }).listingStart).toBeUndefined()
  })
})

const ID = 'u_listing-stmt'
afterEach(() => { registry.uninstallUserDefinition(ID); vi.unstubAllEnvs() })
function host(source, ctx) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const d = memberPaneDefinition({ source, id: ID, name: 'ls' })
  expect(d.ok, d.reason).toBe(true)
  const { installed, errors } = registry.installUserDefinitions([d.definition])
  expect(errors).toEqual([])
  return chartClockReport(registry.computeFor(installed[0], BARS, undefined, ctx))
}

describe('(b) end to end through the door: a `var` that keeps its first value, on a weekly chart', () => {
  const SRC = '//@version=6\nindicator("vo", overlay = false)\nvar float anchor = close\nplot(anchor, "anchor")\n'
  it('starting at the listing, its note says the chart DOES start there', () => {
    const rep = host(SRC, { ...W_CLOSED, listingStart: true })
    const row = rep && rep.withheld.find((r) => r.code === 'var-origin:window')
    expect(row, JSON.stringify(rep)).toBeTruthy()
    expect(row.reason).toBe(LISTING_UNVERIFIED_NOTE('W'))
  })
  it('CONTROL: starting after it, the note is the table\'s own', () => {
    const rep = host(SRC, W_CLOSED)
    const row = rep && rep.withheld.find((r) => r.code === 'var-origin:window')
    expect(row, JSON.stringify(rep)).toBeTruthy()
    expect(row.reason).toBe(CHART_CLOCK_WITHHELD['var-origin:window']('W'))
  })
})

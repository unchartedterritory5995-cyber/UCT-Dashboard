// ─── ⭐⭐ TRAIN e95 — A SERIES PLACED FROM A RECORD IS NAMED BY ITS RECORD'S CODE, AND BY NOTHING ELSE ─────────────────
//
// Three units of train e95 place another series from a RECORD (`SERIES_EVENT_RECORD`): T4 E2 (an event family), T4 F1b
// (a financial read) and T4 B2 (a breadth spelling). Each such series is also marked `SERIES_UNKNOWN_BEFORE_FIRST`, the
// mark the before-held unit (#2429, train e94) names as "UCT's intraday history of <ticker> starts there"
// (`other-symbol:before-held`). Merged, those bars would have been named TWICE, once with a sentence that is not theirs.
// The train's rule: a record-placed series' bars before its first row stay in the alignment mask and are named by its
// record's code alone (`interpret.js::symAlignmentMasks`; the strip's `astColumns.js::beforeHeldOf` lists only series
// whose rows are keyed by time, which a record-placed series, dated by session, never is), and the record's code is ONE
// reading (`interpret.js::beforeRecordCodeOf`: a record's own `code`, else a `financial` family's, else an event's).

import { describe, it, expect } from 'vitest'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { computeFor, withheldBarsReport, otherSymbolReport, externalReadNotices, columnErrors } from '../nativeRegistry'
import { EVENTS_KEY } from '../pineEvents'
import { FINANCIAL_KEY } from '../pineFinancial'
import {
  beforeRecordCodeOf, EVENT_BEFORE_RECORD_CODE, FINANCIAL_UNKNOWN_CODE, BREADTH_BEFORE_RECORD_CODE, OTHER_SYMBOL_BEFORE_HELD_CODE,
} from '../ast/interpret'

const pine = (lines) => ['//@version=5', 'indicator("records")', ...lines].join('\n')
const DAYS = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
  '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16']
const CHART = DAYS.map((t, i) => ({ t, o: 10, h: 11, l: 9, c: 10 + i, v: 1000 }))
// our dividend record starts 2026-01-08: the bars before it are withheld, by the record's own code
const DOC = { schema: 'uct.pine-events/v1', symbol: 'AAPL', state: 'ready', families: {
  earnings: { state: 'empty', knownFrom: null, rows: [] },
  dividends: { state: 'ok', knownFrom: '2026-01-08', rows: [{ exDate: '2026-01-08', gross: 0.77, currency: 'USD' }] },
  splits: { state: 'empty', knownFrom: null, rows: [] } } }
const CTX = { tf: 'D', symbol: { ticker: 'AAPL', exchange: 'NASDAQ' }, newestBarIsForming: false, historyFromListing: false,
  secondary: new Map([[EVENTS_KEY, { status: 'available', events: DOC, symbol: 'AAPL', rev: 1 }]]), exchangeOf: () => null }

function run() {
  const src = pine(['plot(nz(request.dividends(syminfo.tickerid, dividends.gross, barmerge.gaps_off, barmerge.lookahead_on), -1), "d")'])
  const d = memberPaneDefinition({ source: src, id: 'u_e95_records', name: 'd' })
  expect(d.ok).toBe(true)
  const cols = computeFor(d.definition, CHART, undefined, CTX)
  return { def: d.definition, cols }
}

describe('train e95 — a record-placed series is named by its record code alone', () => {
  it('its bars before the record are withheld under the record code, never also as before-held', () => {
    const { cols } = run()
    const held = withheldBarsReport(cols) || {}
    const codes = new Set(Object.values(held).flatMap((c) => Object.keys(c || {})))
    expect(codes.has(EVENT_BEFORE_RECORD_CODE)).toBe(true)
    expect(codes.has(OTHER_SYMBOL_BEFORE_HELD_CODE)).toBe(false)
  })

  it('the strip carries no before-held entry for it, and says the record sentence once', () => {
    const { def, cols } = run()
    const report = otherSymbolReport(cols) || {}
    expect(report.beforeHeld || []).toEqual([])
    const notes = externalReadNotices(def, cols)
    expect(notes.filter((n) => n.code === OTHER_SYMBOL_BEFORE_HELD_CODE)).toEqual([])
    expect(notes.filter((n) => n.code === EVENT_BEFORE_RECORD_CODE)).toHaveLength(1)
  })

  it('⛔ NO member-facing sentence names an internal record ticker (EV-..., the financial and breadth twins, USI~...)', () => {
    // the engine's internal names for a record-placed read: `EV-<family+field>-<pairing>` (events), `EV-F...` (financial),
    // and the breadth door's key `USI~<SPELLING>`. A member reads `request.earnings` / `USI:ADVN.NY`, never these.
    const INTERNAL = /\bEV-[A-Z0-9]+-[A-Z0-9]+\b|USI~/
    const FIN = { schema: 'uct.pine-financial/v1', symbol: 'AAPL', family: 'financial', familyState: 'ok', state: 'ready', refreshedAt: 1,
      fields: { 'TOTAL_REVENUE:FQ': { state: 'ok', knownFrom: '2026-01-08', points: [{ publicAt: 0, knownFrom: '2026-01-08', v: 100,
        periodEnd: '2025-12-27', method: 'direct', staleFrom: '2099-12-31' }] } } }
    const BREADTH = { status: 'available', spelling: 'ADVN.NY', bars: DAYS.slice(3).map((t, i) => ({ t, o: NaN, h: NaN, l: NaN,
      c: 1000 + i, v: NaN })), knownFrom: '2026-01-08', newestBarIsForming: false, at: 0, rev: 'x' }
    const ctx = { ...CTX, secondary: new Map([...CTX.secondary,
      [FINANCIAL_KEY, { status: 'available', financial: FIN, symbol: 'AAPL', rev: '1' }], ['USI~ADVN.NY', BREADTH]]) }
    const reads = [
      'request.dividends(syminfo.tickerid, dividends.gross, barmerge.gaps_off, barmerge.lookahead_on)',
      'request.earnings(syminfo.tickerid, earnings.actual, barmerge.gaps_on, barmerge.lookahead_on)',
      'request.splits(syminfo.tickerid, splits.denominator)',
      'request.financial(syminfo.tickerid, "TOTAL_REVENUE", "FQ")',
      'request.security("USI:ADVN.NY", "D", close)',
      // refused by name: their sentences too
      'request.earnings()', 'request.financial(syminfo.tickerid, "NOT_AN_ID", "FQ")', 'request.dividends("NASDAQ:MSFT", dividends.gross)',
      'request.security("USI:UNCH.NQ", "D", close)',
    ]
    let said = 0
    for (const [k, read] of reads.entries()) {
      const d = memberPaneDefinition({ source: pine([`plot(nz(${read}, -1), "x")`]), id: `u_e95_words_${k}`, name: 'x' })
      const disclosed = ((d.definition && d.definition.meta && d.definition.meta.disclosures) || [])
        .map((x) => x && (x.text || x.note || x.reason || x.message))
      const sentences = [d.reason, ...disclosed]
      if (d.ok && d.definition) {
        const cols = computeFor(d.definition, CHART, undefined, ctx)
        for (const n of externalReadNotices(d.definition, cols)) sentences.push(n.reason)
        for (const e of Object.values(columnErrors(cols) || {})) sentences.push(e && e.message)
        for (const r of (otherSymbolReport(cols) || {}).refused || []) sentences.push(r.reason)
      }
      for (const s of sentences.filter((x) => typeof x === 'string' && x)) {
        said += 1
        expect(s, `${read}: ${s}`).not.toMatch(INTERNAL)
      }
    }
    expect(said).toBeGreaterThan(8)   // non-vacuity: the reads said something
  })

  it('one reading of a record code: its own code, else financial, else an event family', () => {
    expect(beforeRecordCodeOf({ code: BREADTH_BEFORE_RECORD_CODE, family: 'breadth' })).toBe(BREADTH_BEFORE_RECORD_CODE)
    expect(beforeRecordCodeOf({ family: 'financial' })).toBe(FINANCIAL_UNKNOWN_CODE)
    expect(beforeRecordCodeOf({ family: 'dividends' })).toBe(EVENT_BEFORE_RECORD_CODE)
    expect(beforeRecordCodeOf(null)).toBe(EVENT_BEFORE_RECORD_CODE)
  })
})

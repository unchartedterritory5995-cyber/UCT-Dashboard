// ─── ⭐⭐ T4 E2 — `request.earnings` / `request.dividends` / `request.splits` ON THE CHART'S OWN SYMBOL ─────────────
//
// Each call is rewritten at parse into an other-symbol read of the chart's own events (`pine.js::eventAsSecurity`), so
// both lanes read it as one series per field and gaps x lookahead pairing, placed on the chart's bars by
// `pineEvents.js::placeEvents` from E1's answer (`/api/pine/events/<symbol>`, the chart's `EVENTS_KEY` entry) as E0
// witnessed TradingView placing them (docs/pine/evidence/2026-11-22-t4-e0-event-placement/EVIDENCE.md):
//   R1  lookahead_on on the bar of the event's date, lookahead_off on the NEXT bar (next session on D, next week on W);
//       an event dated on a non-session day lands BOTH reads on the next session;
//   R2  gaps_on: the value on that bar, `na` on every other; gaps_off: carried from it, `na` before the first.
// Coordinator ruling 2026-11-22 (1): a bar before OUR RECORD (`knownFrom`) is withheld by name; a bar from `knownFrom` on
// with no event (yet) reads `na` exactly as TradingView prints it (a symbol whose knownFrom precedes its first event).

import { describe, it, expect, afterEach } from 'vitest'
import { translatePine } from './ast/pine'
import {
  resolveOtherSymbols, fetchableOtherSymbols, staticallyUnservable, spellingUnservable, eventsNeeded,
  setRequestWitnessRows, otherSymbolsSignature, OTHER_SYMBOL_REFUSAL as R,
} from './otherSymbols'
import { EVENTS_KEY, EVENT_VENUE, placeEvents, eventReadOf, SERIES_EVENT_RECORD } from './pineEvents'
import { SERIES_UNKNOWN_BEFORE_FIRST } from './ast/interpret'
import WITNESSES from './requestWitnesses.json'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { computeFor, columnErrors } from './nativeRegistry'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from './runtime/runtimeColumns'

const pine = (lines) => ['//@version=5', 'indicator("events")', ...lines].join('\n')
function docOf(src) {
  const t = translatePine(src, { strict: true })
  const trees = {}
  ;(t.outputs || []).forEach((o, i) => { if (o && o.ast) trees[`p${i}`] = o.ast })
  return { t, def: { id: 'u_evt', compute: { kind: 'ast', trees },
    meta: { recurrenceOrigin: 'pine', ...(t.otherSymbols ? { otherSymbols: t.otherSymbols } : {}) } } }
}

// the chart: Mon 2026-01-05 .. Fri 2026-01-16 (10 sessions)
const DAYS = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
  '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16']
const CHART = DAYS.map((t, i) => ({ t, o: 10, h: 11, l: 9, c: 10 + i, v: 1000 }))
// E1's answer: our record starts 2026-01-06 (knownFrom), a day BEFORE the first report (ruling (1)); a report dated on
// SATURDAY 2026-01-10 lands both reads on Monday 01-12
const DOC = {
  schema: 'uct.pine-events/v1', symbol: 'AAPL', state: 'ready',
  families: {
    earnings: { state: 'ok', knownFrom: '2026-01-06', rows: [
      { date: '2026-01-07', actual: 1.5, estimate: 1.4 },
      { date: '2026-01-10', actual: 2.0, estimate: 1.9 },
      { date: '2026-01-14', actual: 2.5, estimate: null },
    ] },
    dividends: { state: 'ok', knownFrom: '2026-01-08', rows: [
      { exDate: '2026-01-08', gross: 0.77, currency: 'USD' },
      { exDate: '2026-01-15', gross: 0.26, currency: 'USD' },
    ] },
    splits: { state: 'empty', knownFrom: null, rows: [] },
  },
}
const ENTRY = { status: 'available', events: DOC, symbol: 'AAPL', rev: 1 }
const CTX = { tf: 'D', symbol: { ticker: 'AAPL', exchange: 'NASDAQ' }, newestBarIsForming: false, historyFromListing: false,
  secondary: new Map([[EVENTS_KEY, ENTRY]]), exchangeOf: () => null }

const W = null   // withheld: before our record
const NA = -1    // `na`, read through nz(x, -1)
// TradingView's placement, by E0's rules (nz(·, -1); W = withheld before knownFrom 2026-01-06)
const WANT = {
  'barmerge.gaps_on, barmerge.lookahead_on': [W, NA, 1.5, NA, NA, 2.0, NA, 2.5, NA, NA],
  'barmerge.gaps_on, barmerge.lookahead_off': [W, NA, NA, 1.5, NA, 2.0, NA, NA, 2.5, NA],
  'barmerge.gaps_off, barmerge.lookahead_on': [W, NA, 1.5, 1.5, 1.5, 2.0, 2.0, 2.5, 2.5, 2.5],
  'barmerge.gaps_off, barmerge.lookahead_off': [W, NA, NA, 1.5, 1.5, 2.0, 2.0, 2.0, 2.5, 2.5],
}
const asWant = (col) => Array.from(col).map((v) => (Number.isNaN(v) ? W : v))

afterEach(() => { setRequestWitnessRows(null); resetRuntimeSessions(); resetRuntimeLedgers() })

describe('E2 — the parse rewrite: one event read per field and pairing, under the event venue', () => {
  it('request.earnings(syminfo.tickerid, earnings.actual, gaps_on, lookahead_on) reads EV-EA-11', () => {
    const { t, def } = docOf(pine(['plot(request.earnings(syminfo.tickerid, earnings.actual, barmerge.gaps_on, barmerge.lookahead_on))']))
    expect(t.otherSymbols).toEqual([{ ticker: 'EV-EA-11', spellings: [EVENT_VENUE] }])
    expect(eventsNeeded(def)).toBe(true)
  })

  it('defaults: earnings.actual / dividends.gross / splits.denominator, gaps_off, lookahead_off', () => {
    expect(eventReadOf('EV-EA-00')).toMatchObject({ family: 'earnings', field: 'earnings.actual', gaps: false, lookahead: false })
    expect(docOf(pine(['plot(request.dividends(syminfo.tickerid))'])).t.otherSymbols).toEqual([{ ticker: 'EV-DG-00', spellings: [EVENT_VENUE] }])
    expect(docOf(pine(['plot(request.splits(syminfo.tickerid, splits.numerator))'])).t.otherSymbols).toEqual([{ ticker: 'EV-SN-00', spellings: [EVENT_VENUE] }])
    expect(docOf(pine(['plot(request.earnings("", lookahead = barmerge.lookahead_on, gaps = barmerge.gaps_on, field = earnings.estimate))'])).t.otherSymbols)
      .toEqual([{ ticker: 'EV-EE-11', spellings: [EVENT_VENUE] }])
  })

  it('a symbol bound to the chart\'s own (`t = syminfo.tickerid`) is the chart\'s own; another symbol is refused by name', () => {
    expect(docOf(pine(['t = syminfo.tickerid', 'plot(request.earnings(t))'])).t.otherSymbols)
      .toEqual([{ ticker: 'EV-EA-00', spellings: [EVENT_VENUE] }])
    const other = docOf(pine(['plot(request.dividends("NASDAQ:BELFA", dividends.gross))']))
    expect(other.t.otherSymbols).toEqual([{ ticker: 'EV-DG-XS', spellings: [EVENT_VENUE] }])
    expect(staticallyUnservable('EV-DG-XS', EVENT_VENUE)).toMatchObject({ code: R.EVENT_SYMBOL })
    expect(eventsNeeded(other.def)).toBe(false)
  })

  it('⛔ refused by name: standardized, net, a non-USD currency, an argument not written as a constant', () => {
    const tick = (src) => docOf(pine([src])).t.otherSymbols[0].ticker
    expect(staticallyUnservable(tick('plot(request.earnings(syminfo.tickerid, earnings.standardized))'), EVENT_VENUE))
      .toMatchObject({ code: R.EVENT_FIELD })
    expect(staticallyUnservable(tick('plot(request.dividends(syminfo.tickerid, dividends.net))'), EVENT_VENUE))
      .toMatchObject({ code: R.EVENT_FIELD })
    expect(staticallyUnservable(tick('plot(request.dividends(syminfo.tickerid, dividends.gross, currency = currency.EUR))'), EVENT_VENUE))
      .toMatchObject({ code: R.EVENT_CURRENCY })
    expect(staticallyUnservable(tick('g = barmerge.gaps_on\nplot(request.splits(syminfo.tickerid, splits.numerator, g))'), EVENT_VENUE))
      .toMatchObject({ code: R.EVENT_ARGUMENT })
    // the identity currencies are served
    expect(tick('plot(request.dividends(syminfo.tickerid, dividends.gross, ignore_invalid_symbol = true, currency = currency.USD))')).toBe('EV-DG-00')
  })
})

describe('E2 — the synthetic spelling is never a symbol (ruling (2))', () => {
  it('a script that WRITES the internal name is refused by name and never fetched', () => {
    expect(spellingUnservable('EV-EA-11')).toMatchObject({ code: R.EVENT_SPELLING })
    expect(spellingUnservable('NASDAQ:EV-EA-11')).toMatchObject({ code: R.EVENT_SPELLING })
    // the rewrite's own venue, typed: still only a string, never the marked read
    expect(spellingUnservable('@event:EV-EA-11')).toMatchObject({ code: R.EVENT_SPELLING })
    expect(staticallyUnservable('EV-EA-11', '')).toMatchObject({ code: R.EVENT_SPELLING })
    const { t, def } = docOf(pine(['plot(request.security("EV-EA-11", "D", close))']))
    expect(fetchableOtherSymbols(def)).toEqual([])
    expect(eventsNeeded(def)).toBe(false)
    const r = resolveOtherSymbols(def, CTX)
    expect(r.served).toEqual([])
    expect(r.refused[0]).toMatchObject({ code: R.EVENT_SPELLING })
    expect(JSON.stringify(t)).not.toMatch(/@event/)
  })

  it('a FORMULA that names the internal name (`sym(\'EV-EA-11\', close)`) is never fetched, and is refused by name', async () => {
    const { resolveFormulaSymbols } = await import('./otherSymbols')
    const def = { id: 'u_evtformula', compute: { kind: 'ast', ast: { type: 'sym', value: 'EV-EA-11', args: [{ type: 'series', name: 'close' }] } }, meta: {} }
    expect(fetchableOtherSymbols(def)).toEqual([])
    expect(resolveFormulaSymbols(def, { secondary: new Map() }).refused[0]).toMatchObject({ code: R.EVENT_SPELLING })
  })

  it('the rewrite\'s own reads are never a bars fetch either (the events door supplies them)', () => {
    const { def } = docOf(pine(['plot(request.earnings(syminfo.tickerid, earnings.actual, barmerge.gaps_on, barmerge.lookahead_on))']))
    expect(fetchableOtherSymbols(def)).toEqual([])
  })
})

describe('E2 — the placement (R1, R2) and our record (ruling (1)), on both lanes', () => {
  for (const [pairing, want] of Object.entries(WANT)) {
    it(`host lane: earnings.actual, ${pairing}`, () => {
      const src = pine([`plot(nz(request.earnings(syminfo.tickerid, earnings.actual, ${pairing}), -1), "e")`])
      const d = memberPaneDefinition({ source: src, id: 'u_evthost', name: 'e' })
      expect(d.ok, d.reason).toBe(true)
      const cols = computeFor(d.definition, CHART, undefined, CTX)
      expect(Object.values(columnErrors(cols))).toEqual([])
      expect(asWant(cols[Object.keys(cols)[0]])).toEqual(want)
    })

    it(`runtime lane, our record from before the chart: earnings.actual, ${pairing}`, () => {
      // knownFrom before the chart's first bar: nothing is withheld, and the run from the listing draws every bar
      const early = { ...ENTRY, events: { ...DOC, families: { ...DOC.families, earnings: { ...DOC.families.earnings, knownFrom: '2025-12-01' } } } }
      const ctx = { ...CTX, historyFromListing: true, secondary: new Map([[EVENTS_KEY, early]]) }
      const id = `u_evtrt${pairing.includes('gaps_on') ? 'g' : 'c'}${pairing.includes('lookahead_on') ? 'l' : 'o'}`
      const doc = { id, meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: `runtime:${id}`, outputs: { a: 0 },
        source: pine([`plot(nz(request.earnings(syminfo.tickerid, earnings.actual, ${pairing}), -1))`]) } }
      const out = computeRuntimeColumns(doc, CHART, ctx)
      expect(asWant(out.a)).toEqual([NA, ...want.slice(1)])
    })

    it(`runtime lane, our record from 2026-01-06: the run starts there (depth), never reads before it: ${pairing}`, () => {
      const id = `u_evtrd${pairing.includes('gaps_on') ? 'g' : 'c'}${pairing.includes('lookahead_on') ? 'l' : 'o'}`
      const doc = { id, meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: `runtime:${id}`, outputs: { a: 0 },
        source: pine([`plot(nz(request.earnings(syminfo.tickerid, earnings.actual, ${pairing}), -1))`]) } }
      const out = computeRuntimeColumns(doc, CHART, { ...CTX, historyFromListing: true })
      const got = asWant(out.a)
      expect(got[0]).toBe(W)                                      // before our record: withheld
      for (let i = 1; i < got.length; i += 1) if (got[i] !== W) expect(got[i], `bar ${i}`).toBe(want[i])
      expect(got.filter((v) => v !== W).length).toBeGreaterThan(4) // drawn from the run's start on
    })
  }

  it('the placed series: dense from knownFrom, marked unknown before it, carrying its record', () => {
    const r = resolveOtherSymbols(docOf(pine(['plot(request.earnings(syminfo.tickerid, earnings.actual, barmerge.gaps_on, barmerge.lookahead_on))'])).def,
      { ...CTX, chartBars: CHART })
    expect(r.served).toEqual(['EV-EA-11'])
    const s = r.symbols['EV-EA-11']
    expect(s.map((b) => b.t)).toEqual(DAYS.slice(1))
    expect(s[SERIES_UNKNOWN_BEFORE_FIRST]).toBe(true)
    expect(s[SERIES_EVENT_RECORD]).toMatchObject({ family: 'earnings', symbol: 'AAPL', knownFrom: '2026-01-06' })
  })

  it('dividends.gross is read at float32 (TradingView stores 0.77 as 0.769999981)', () => {
    const placed = placeEvents(eventReadOf('EV-DG-11'), true, true, DOC.families.dividends.rows, '2026-01-08', CHART, 'D')
    expect(placed.series.find((b) => b.t === '2026-01-08').c).toBe(Math.fround(0.77))
    expect(placed.series.find((b) => b.t === '2026-01-08').c).not.toBe(0.77)
  })

  it('weekly: lookahead_on in the event\'s week, lookahead_off the next week; a Saturday event lands next week', () => {
    const weeks = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'].map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 }))
    const rows = [{ date: '2026-01-07', actual: 1 }, { date: '2026-01-17', actual: 2 }]
    const cover = { coverageStart: true }
    const on = placeEvents(eventReadOf('EV-EA-11'), true, true, rows, '2026-01-05', weeks, 'W', cover).series.map((b) => b.c)
    const off = placeEvents(eventReadOf('EV-EA-10'), true, false, rows, '2026-01-05', weeks, 'W', cover).series.map((b) => b.c)
    expect(on).toEqual([1, NaN, 2, NaN])
    expect(off).toEqual([NaN, 1, 2, NaN])
  })
})

describe('E2 — refused by name at the bind (both lanes ask `eventDecision`)', () => {
  const read = 'plot(request.earnings(syminfo.tickerid, earnings.actual, barmerge.gaps_on, barmerge.lookahead_on))'
  const decide = (ctx) => resolveOtherSymbols(docOf(pine([read])).def, ctx).refused[0]

  it('a monthly chart and an intraday chart', () => {
    expect(decide({ ...CTX, tf: 'M' })).toMatchObject({ code: R.EVENT_TIMEFRAME })
    expect(decide({ ...CTX, tf: 'M' }).reason).toMatch(/W-E2/)
    expect(decide({ ...CTX, tf: '5' })).toMatchObject({ code: R.EVENT_TIMEFRAME })
    expect(decide({ ...CTX, tf: '5' }).reason).toMatch(/time of day/)
  })

  it('the door dark for this member (404): a plain named refusal, never an error', () => {
    const r = decide({ ...CTX, secondary: new Map([[EVENTS_KEY, { status: 'dark', symbol: 'AAPL' }]]) })
    expect(r).toMatchObject({ code: R.EVENT_NOT_AVAILABLE })
    expect(r.reason).toMatch(/^earnings data is not available on this chart yet/)
    expect(r.pending).toBeUndefined()
  })

  it('still gathering (202), or not asked yet: pending, never a settled refusal', () => {
    expect(decide({ ...CTX, secondary: new Map([[EVENTS_KEY, { status: 'pending', symbol: 'AAPL' }]]) })).toMatchObject({ pending: true })
    expect(decide({ ...CTX, secondary: new Map() })).toMatchObject({ pending: true })
    // an answer for the previous symbol is no answer for this chart
    expect(decide({ ...CTX, symbol: { ticker: 'MSFT', exchange: 'NASDAQ' } })).toMatchObject({ pending: true })
  })

  it('a family UCT holds nothing of (splits, empty) is refused by name', () => {
    const r = resolveOtherSymbols(docOf(pine(['plot(request.splits(syminfo.tickerid, splits.numerator, barmerge.gaps_on, barmerge.lookahead_on))'])).def, CTX).refused[0]
    expect(r).toMatchObject({ code: R.EVENT_NONE })
    expect(r.reason).toMatch(/UCT holds no split for AAPL/)
  })

  it('the witness row pending: the placement is not served', () => {
    const rows = { ...WITNESSES.rows, 'EVENTS:EARNINGS': { ...WITNESSES.rows['EVENTS:EARNINGS'], witness: '' } }
    setRequestWitnessRows(rows)
    expect(decide(CTX)).toMatchObject({ code: R.EVENT_TIMEFRAME })
  })

  it('the memo moves when the events entry lands', () => {
    const { def } = docOf(pine([read]))
    const a = otherSymbolsSignature(def, new Map([[EVENTS_KEY, { status: 'loading', symbol: 'AAPL' }]]), 'D')
    const b = otherSymbolsSignature(def, CTX.secondary, 'D')
    expect(a).not.toBe(b)
  })
})

describe('E2 — the per-bar words: a bar before our record is withheld BY NAME, never `na`', () => {
  it('host lane: bar 0 (before knownFrom) carries the event code, and the strip says why in plain words', async () => {
    const { withheldBarsReport } = await import('./astColumns')
    const { externalReadNotices } = await import('./nativeRegistry')
    const src = pine(['plot(nz(request.earnings(syminfo.tickerid, earnings.actual, barmerge.gaps_off, barmerge.lookahead_on), -1), "e")'])
    const d = memberPaneDefinition({ source: src, id: 'u_evtwords', name: 'e' })
    const cols = computeFor(d.definition, CHART, undefined, CTX)
    const key = Object.keys(cols)[0]
    const per = withheldBarsReport(cols)[key][R.EVENT_BEFORE_RECORD]
    expect(Array.from(per)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const notes = externalReadNotices(d.definition, cols).filter((n) => n.code === R.EVENT_BEFORE_RECORD)
    expect(notes).toEqual([{ code: R.EVENT_BEFORE_RECORD, reason: 'Not drawn before 2026-01-06: UCT\'s record of AAPL\'s '
      + 'earnings reports starts there, so whether an earlier one landed on those bars is not known here.' }])
  })

  it('⛔ CONTROL: knownFrom before the chart: nothing is named, nothing withheld', async () => {
    const { withheldBarsReport } = await import('./astColumns')
    const early = { ...ENTRY, events: { ...DOC, families: { ...DOC.families, earnings: { ...DOC.families.earnings, knownFrom: '2025-12-01' } } } }
    const src = pine(['plot(nz(request.earnings(syminfo.tickerid, earnings.actual, barmerge.gaps_off, barmerge.lookahead_on), -1), "e")'])
    const d = memberPaneDefinition({ source: src, id: 'u_evtwords2', name: 'e' })
    const cols = computeFor(d.definition, CHART, undefined, { ...CTX, secondary: new Map([[EVENTS_KEY, early]]) })
    expect(withheldBarsReport(cols)).toBeNull()
    expect(asWant(cols[Object.keys(cols)[0]])).toEqual([NA, NA, 1.5, 1.5, 1.5, 2.0, 2.0, 2.5, 2.5, 2.5])
  })

  it('a refusal names the read in the member\'s words, never the engine\'s internal name', async () => {
    const { externalReadNotices } = await import('./nativeRegistry')
    const src = pine(['plot(request.splits(syminfo.tickerid, splits.numerator, barmerge.gaps_on, barmerge.lookahead_on), "s")'])
    const d = memberPaneDefinition({ source: src, id: 'u_evtwords3', name: 's' })
    const cols = computeFor(d.definition, CHART, undefined, CTX)
    const err = Object.values(columnErrors(cols))[0]
    expect(err.guard).toBe(R.EVENT_NONE)
    expect(err.message).toMatch(/^This indicator reads `request\.splits` \(`splits\.numerator`, `barmerge\.gaps_on`, `barmerge\.lookahead_on`\): UCT holds no split for AAPL/)
    expect(JSON.stringify(externalReadNotices(d.definition, cols))).not.toMatch(/EV-/)
  })
})

describe('E2 rulings 1 and 3 — the earnings window, and a fund', () => {
  // daily bars across the cut: 2001-08-29 .. 2001-09-10 (Labor Day 09-03 closed)
  const D = ['2001-08-29', '2001-08-30', '2001-08-31', '2001-09-04', '2001-09-05', '2001-09-06', '2001-09-07', '2001-09-10']
  const BARS = D.map((t, i) => ({ t, o: 1, h: 1, l: 1, c: 1 + i, v: 1 }))
  // our record reaches back to 1999 (before the cut): a report before TradingView's window, one inside it
  const OLD = { ...DOC, families: { ...DOC.families, earnings: { state: 'ok', knownFrom: '1999-01-20', rows: [
    { date: '1999-01-20', actual: 0.5 }, { date: '2001-08-30', actual: 0.7 }, { date: '2001-09-05', actual: 0.9 }] } } }
  const ctxOf = (doc, extra = {}) => ({ ...CTX, ...extra, secondary: new Map([[EVENTS_KEY, { ...ENTRY, events: doc }]]) })
  const host = (pairing, ctx) => {
    const src = pine([`plot(nz(request.earnings(syminfo.tickerid, earnings.actual, ${pairing}), -1), "e")`])
    const d = memberPaneDefinition({ source: src, id: `u_evtwin${pairing.length}`, name: 'e' })
    const cols = computeFor(d.definition, BARS, undefined, ctx)
    return { d, cols, got: asWant(cols[Object.keys(cols)[0]]) }
  }

  it('the cut is a named constant: 2001-09-01, after every TradingView first report witnessed', async () => {
    const { EARNINGS_WINDOW_FROM } = await import('./pineEvents')
    expect(EARNINGS_WINDOW_FROM).toBe('2001-09-01')
    for (const first of ['2001-07-17', '2001-07-18', '2001-08-14', '2000-01-14']) expect(first < EARNINGS_WINDOW_FROM).toBe(true)
  })

  it('gaps_on: bars before the cut are withheld; from it, a report draws on its bar and every other bar is na', () => {
    expect(host('barmerge.gaps_on, barmerge.lookahead_on', ctxOf(OLD)).got).toEqual([W, W, W, NA, 0.9, NA, NA, NA])
  })

  it('gaps_off: a cut is not a coverage start: withheld until the first report after it lands, then carried', async () => {
    const { withheldBarsReport } = await import('./astColumns')
    const { externalReadNotices } = await import('./nativeRegistry')
    const { d, cols, got } = host('barmerge.gaps_off, barmerge.lookahead_on', ctxOf(OLD))
    expect(got).toEqual([W, W, W, W, 0.9, 0.9, 0.9, 0.9])
    expect(Array.from(withheldBarsReport(cols)[Object.keys(cols)[0]][R.EVENT_BEFORE_RECORD])).toEqual([1, 1, 1, 1, 0, 0, 0, 0])
    expect(externalReadNotices(d.definition, cols).filter((n) => n.code === R.EVENT_BEFORE_RECORD).map((n) => n.reason))
      .toEqual(['Not drawn before 2001-09-05: UCT draws AAPL\'s earnings from 2001-09-01 on, where TradingView\'s earnings '
        + 'history begins, so whether an earlier report landed on those bars, or carries into them, is not known here.'])
  })

  it('⛔ CONTROL: a record that starts after the cut is a coverage start (ruling (1)): na from it, nothing carried', () => {
    const LATE = { ...OLD, families: { ...OLD.families, earnings: { state: 'ok', knownFrom: '2001-09-04', rows: [
      { date: '2001-09-05', actual: 0.9 }] } } }
    expect(host('barmerge.gaps_off, barmerge.lookahead_on', ctxOf(LATE)).got).toEqual([W, W, W, NA, 0.9, 0.9, 0.9, 0.9])
  })

  it('a fund (store class ETF, SPY): earnings read na on every bar, and the vendor\'s stray row never draws', () => {
    const SPY = { ...DOC, symbol: 'SPY', families: { ...DOC.families, earnings: { state: 'ok', knownFrom: '2026-01-07', rows: [
      { date: '2026-01-07', actual: 1.0 }] } } }
    const spy = { ...ctxOf(SPY), symbol: { ticker: 'SPY', exchange: 'AMEX', securityType: 'ETF' } }
    for (const pairing of Object.keys(WANT)) {
      const src = pine([`plot(nz(request.earnings(syminfo.tickerid, earnings.actual, ${pairing}), -1), "e")`])
      const d = memberPaneDefinition({ source: src, id: 'u_evtspy', name: 'e' })
      const cols = computeFor(d.definition, CHART, undefined, spy)
      expect(asWant(cols[Object.keys(cols)[0]]), pairing).toEqual(CHART.map(() => NA))
    }
    // ⛔ CONTROL: the same row on a stock's chart draws
    const stock = { ...spy, symbol: { ticker: 'SPY', exchange: 'AMEX', securityType: 'Stock' } }
    const src = pine(['plot(nz(request.earnings(syminfo.tickerid, earnings.actual, barmerge.gaps_on, barmerge.lookahead_on), -1), "e")'])
    const cols = computeFor(memberPaneDefinition({ source: src, id: 'u_evtspy2', name: 'e' }).definition, CHART, undefined, stock)
    expect(asWant(cols[Object.keys(cols)[0]])[2]).toBe(1.0)
  })
})

describe('E2 — the member\'s words: the door discloses UCT event data; the run names its depth', () => {
  it('the saved document discloses "UCT earnings data", never the engine\'s internal name', async () => {
    const { EVENT_SOURCE_NOTE } = await import('./ast/symbolSubstitution')
    const d = memberPaneDefinition({ source: pine(['plot(request.earnings(syminfo.tickerid))', 'plot(request.dividends(syminfo.tickerid))']),
      id: 'u_evtnote', name: 'e' })
    const notes = JSON.stringify(d.definition.meta.disclosures || d.notes || [])
    expect(notes).toContain('UCT earnings data')
    expect(notes).toContain('UCT dividend data')
    expect(notes).not.toMatch(/EV-|@event/)
    expect(EVENT_SOURCE_NOTE('earnings')).toMatch(/^This script reads `request\.earnings`\. It uses UCT earnings data, not TradingView's feed/)
  })

  it('runtime lane: the bars before our record are named by the event code, with the plain sentence', async () => {
    const { runtimeWarmupOf } = await import('./runtime/runtimeObjects')
    const doc = { id: 'u_evtrtw', meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: 'runtime:u_evtrtw', outputs: { a: 0 },
      source: pine(['plot(nz(request.earnings(syminfo.tickerid, earnings.actual, barmerge.gaps_on, barmerge.lookahead_on), -1))']) } }
    const out = computeRuntimeColumns(doc, CHART, { ...CTX, historyFromListing: true })
    const warm = runtimeWarmupOf(out)
    expect(warm).toMatchObject({ knownFrom: 1, knownFromCode: R.EVENT_BEFORE_RECORD })
    expect(warm.knownFromReason).toMatch(/^Not drawn before 2026-01-06: UCT's record of AAPL's earnings reports starts there/)
  })
})

describe('E2 — the corpus anchor idiom on the runtime lane: a NAME bound to an event read, read inside a call', () => {
  it('`e = request.earnings(…)` then `not na(e)` reads the events (never the columnar lane\'s supply-less na)', () => {
    const R = 'request.earnings(syminfo.tickerid, earnings.actual, barmerge.gaps_on, barmerge.lookahead_on, ignore_invalid_symbol = true)'
    const doc = { id: 'u_evtnamed', meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: 'runtime:u_evtnamed', outputs: { a: 0 },
      source: pine([`new_e = ${R}`, 'anchor = input.string("Earnings", "A", options = ["Earnings", "Session"])',
        'isNew = switch anchor', '    "Earnings" => not na(new_e)', '    "Session" => close > open', '    => false', 'plot(isNew ? 1 : 0)']) } }
    const early = { ...ENTRY, events: { ...DOC, families: { ...DOC.families, earnings: { ...DOC.families.earnings, knownFrom: '2025-12-01' } } } }
    const out = computeRuntimeColumns(doc, CHART, { ...CTX, historyFromListing: true, secondary: new Map([[EVENTS_KEY, early]]) })
    expect(Array.from(out.a)).toEqual([0, 0, 1, 0, 0, 1, 0, 1, 0, 0])
  })
})

describe('E2 — E1 own record: `knownFrom` IS our first event, so an older one may exist (measured on the probes)', () => {
  // E1's shape: knownFrom equals the first held event's date (2026-01-07, a Wednesday)
  const E1 = { ...DOC, families: { ...DOC.families, earnings: { state: 'ok', knownFrom: '2026-01-07', rows: [
    { date: '2026-01-07', actual: 1.5 }, { date: '2026-01-14', actual: 2.5 }] } } }
  const ctx = { ...CTX, secondary: new Map([[EVENTS_KEY, { ...ENTRY, events: E1 }]]) }
  const host = (pairing) => {
    const src = pine([`plot(nz(request.earnings(syminfo.tickerid, earnings.actual, ${pairing}), -1), "e")`])
    const cols = computeFor(memberPaneDefinition({ source: src, id: `u_evte1${pairing.length}`, name: 'e' }).definition, CHART, undefined, ctx)
    return asWant(cols[Object.keys(cols)[0]])
  }
  it('gaps_off / lookahead_off: the bar of our first event date carries an OLDER event on TradingView: withheld, never na', () => {
    // MEASURED: AAPL dividends D04 bar 7981 (TradingView 0.12, the dividend before our record), JPM D04 (0.34), NVDA S05/S06
    expect(host('barmerge.gaps_off, barmerge.lookahead_off')).toEqual([W, W, W, 1.5, 1.5, 1.5, 1.5, 1.5, 2.5, 2.5])
  })
  it('gaps_on / lookahead_off: that bar may hold an older event landing there: withheld; every later bar is known', () => {
    expect(host('barmerge.gaps_on, barmerge.lookahead_off')).toEqual([W, W, W, 1.5, NA, NA, NA, NA, 2.5, NA])
  })
  it('lookahead_on: our first event lands on its own bar, the newest there: drawn from it on', () => {
    expect(host('barmerge.gaps_on, barmerge.lookahead_on')).toEqual([W, W, 1.5, NA, NA, NA, NA, 2.5, NA, NA])
    expect(host('barmerge.gaps_off, barmerge.lookahead_on')).toEqual([W, W, 1.5, 1.5, 1.5, 1.5, 1.5, 2.5, 2.5, 2.5])
  })
})

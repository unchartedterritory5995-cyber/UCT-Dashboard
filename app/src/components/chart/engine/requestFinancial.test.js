// ─── ⭐⭐ T4 F1b — `request.financial` ON THE CHART'S OWN SYMBOL, AS UCT DATA (company filings) ────────────────────
//
// Each call is rewritten at parse into a data read of the chart's own figures (`pine.js::eventAsSecurity` via
// `pineEvents.js::eventCallParts` -> `pineFinancial.js::financialCallParts`), so both lanes read one series per id,
// period and `gaps`, placed on the chart's bars by `pineFinancial.js::placeFinancial` from F1a's answer
// (`/api/pine/financial/<symbol>`, the chart's `FINANCIAL_KEY` entry):
//   P1  a figure steps on the first chart bar whose session close is at or after its `knownFrom` (F1a: the first
//       session whose close follows its filing's public instant), never its fiscal period end;
//   P2  gaps_off carries it; gaps_on reads it on that bar and `na` elsewhere;
//   P3  a bar where UCT knows no current figure (none public yet, a filing that left it unknown, a figure past its
//       `staleFrom`) is WITHHELD by name (`other-symbol:financial-unknown`), never `na`, never the older value carried.
// ⛔ The values are UCT data, never TradingView's figures: the plot's note says so, and no grade of one counts MATCH.

import { describe, it, expect, afterEach } from 'vitest'
import { translatePine } from './ast/pine'
import {
  resolveOtherSymbols, fetchableOtherSymbols, staticallyUnservable, spellingUnservable, eventsNeeded, financialNeeded,
  otherSymbolsSignature, OTHER_SYMBOL_REFUSAL as R,
} from './otherSymbols'
import { EVENT_VENUE, SERIES_EVENT_RECORD, eventReadOf } from './pineEvents'
import { FINANCIAL_KEY, placeFinancial, financialReadOf, FINANCIAL_SOURCE_NOTE } from './pineFinancial'
import { SERIES_UNKNOWN_BEFORE_FIRST } from './ast/interpret'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { computeFor, columnErrors } from './nativeRegistry'
import { computeRuntimeColumns, runtimeColumnsFor, resetRuntimeSessions, resetRuntimeLedgers } from './runtime/runtimeColumns'

const pine = (lines) => ['//@version=5', 'indicator("financial")', ...lines].join('\n')
function docOf(src) {
  const t = translatePine(src, { strict: true })
  const trees = {}
  ;(t.outputs || []).forEach((o, i) => { if (o && o.ast) trees[`p${i}`] = o.ast })
  return { t, def: { id: 'u_fin', compute: { kind: 'ast', trees },
    meta: { recurrenceOrigin: 'pine', ...(t.otherSymbols ? { otherSymbols: t.otherSymbols } : {}) } } }
}

// the chart: Mon 2026-01-05 .. Fri 2026-01-16 (10 sessions)
const DAYS = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
  '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16']
const CHART = DAYS.map((t, i) => ({ t, o: 10, h: 11, l: 9, c: 10 + i, v: 1000 }))
const pt = (knownFrom, v, staleFrom = '2026-12-31') => ({ publicAt: 0, knownFrom, v, periodEnd: '2025-09-27',
  method: v === null ? 'gap' : 'direct', staleFrom: v === null ? null : staleFrom })
// F1a's answer (synthetic values in its shapes)
const DOC = {
  schema: 'uct.pine-financial/v1', symbol: 'AAPL', family: 'financial', familyState: 'ok', state: 'ready', refreshedAt: 1,
  fields: {
    // public before the chart (carried into it), then 01-07, a SATURDAY-dated one (lands Monday 01-12), 01-14
    'TOTAL_REVENUE:FQ': { state: 'ok', knownFrom: '2025-11-03', points: [
      pt('2025-11-03', 100), pt('2026-01-07', 120), pt('2026-01-10', 130), pt('2026-01-14', 140)] },
    'TOTAL_REVENUE:TTM': { state: 'ok', knownFrom: '2025-11-03', points: [pt('2025-11-03', 400)] },
    // a filing on 01-08 left the figure UNKNOWN (a gap) until 01-13
    'EARNINGS_PER_SHARE_DILUTED:FQ': { state: 'ok', knownFrom: '2025-11-03', points: [
      pt('2025-11-03', 1.0), pt('2026-01-08', null), pt('2026-01-13', 1.2)] },
    'EARNINGS_PER_SHARE_DILUTED:TTM': { state: 'withheld', knownFrom: null, points: [] },
    // past its staleFrom (01-09) until the next filing (01-13)
    'TOTAL_EQUITY:FQ': { state: 'ok', knownFrom: '2025-06-02', points: [pt('2025-06-02', 5, '2026-01-09'), pt('2026-01-13', 6)] },
    // the first filing that yields it is public 01-08
    'TOTAL_SHARES_OUTSTANDING:FQ': { state: 'ok', knownFrom: '2026-01-08', points: [pt('2026-01-08', 15)] },
    'FREE_CASH_FLOW:TTM': { state: 'missing', knownFrom: null, points: [] },
  },
}
const ENTRY = { status: 'available', financial: DOC, symbol: 'AAPL', rev: '1' }
const CTX = { tf: 'D', symbol: { ticker: 'AAPL', exchange: 'NASDAQ' }, newestBarIsForming: false, historyFromListing: false,
  secondary: new Map([[FINANCIAL_KEY, ENTRY]]), exchangeOf: () => null }
const W = null   // withheld
const NA = -1    // `na`, read through nz(x, -1)
const asWant = (col) => Array.from(col).map((v) => (Number.isNaN(v) ? W : v))
const revenue = (gaps = '') => `request.financial(syminfo.tickerid, "TOTAL_REVENUE", "FQ"${gaps})`

afterEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

describe('F1b — the parse rewrite: one data read per id, period and gaps, under the data venue', () => {
  it('request.financial(syminfo.tickerid, "TOTAL_REVENUE", "FQ") reads EV-FRV-Q0, and asks the financial door only', () => {
    const { t, def } = docOf(pine([`plot(${revenue()})`]))
    expect(t.otherSymbols).toEqual([{ ticker: 'EV-FRV-Q0', spellings: [EVENT_VENUE] }])
    expect(financialNeeded(def)).toBe(true)
    expect(eventsNeeded(def)).toBe(false)
    expect(fetchableOtherSymbols(def)).toEqual([])
  })

  it('every mapped pair, named arguments, gaps_on, and the identity arguments', () => {
    const tick = (src) => docOf(pine([src])).t.otherSymbols[0].ticker
    expect(tick(`plot(${revenue(', barmerge.gaps_on')})`)).toBe('EV-FRV-Q1')
    expect(tick('plot(request.financial(syminfo.tickerid, "TOTAL_REVENUE", "TTM"))')).toBe('EV-FRV-T0')
    expect(tick('plot(request.financial(syminfo.tickerid, "EARNINGS_PER_SHARE_DILUTED", "TTM", ignore_invalid_symbol = true))')).toBe('EV-FED-T0')
    expect(tick('plot(request.financial(symbol = syminfo.tickerid, financial_id = "FREE_CASH_FLOW", period = "TTM"))')).toBe('EV-FFC-T0')
    expect(tick('plot(request.financial(syminfo.tickerid, "TOTAL_EQUITY", "FQ", currency = currency.USD))')).toBe('EV-FEQ-Q0')
    expect(tick('t = syminfo.tickerid\nplot(request.financial(t, "TOTAL_SHARES_OUTSTANDING", "FQ"))')).toBe('EV-FSO-Q0')
    expect(financialReadOf('EV-FSO-Q0')).toMatchObject({ family: 'financial', field: 'TOTAL_SHARES_OUTSTANDING', period: 'FQ',
      series: 'shares_outstanding', gaps: false, lookahead: null, refused: null })
    expect(eventReadOf('EV-FRV-T1')).toMatchObject({ family: 'financial', field: 'TOTAL_REVENUE', period: 'TTM', gaps: true })
  })

  it('⛔ refused by name: an id UCT does not serve, a period, another symbol, a currency, an argument not a constant', () => {
    const why = (src) => staticallyUnservable(docOf(pine([src])).t.otherSymbols[0].ticker, EVENT_VENUE)
    const debt = why('plot(request.financial(syminfo.tickerid, "TOTAL_DEBT", "FY"))')
    expect(debt).toMatchObject({ code: R.FINANCIAL_FIELD })
    expect(debt.reason).toMatch(/^`TOTAL_DEBT` is not served: UCT does not hold total debt/)
    expect(why('plot(request.financial(syminfo.tickerid, "EARNINGS_ESTIMATE", "FQ"))').reason).toMatch(/analyst estimate/)
    const fy = why('plot(request.financial(syminfo.tickerid, "TOTAL_REVENUE", "FY"))')
    expect(fy).toMatchObject({ code: R.FINANCIAL_PERIOD })
    expect(fy.reason).toMatch(/^`TOTAL_REVENUE` is served for `FQ` and `TTM` only \(`FY`: UCT's filings store holds no fiscal-year series yet\)/)
    const unknown = why('plot(request.financial(syminfo.tickerid, "NET_DEBT_TO_EBITDA", "FQ"))')
    expect(unknown).toMatchObject({ code: R.FINANCIAL_FIELD })
    expect(unknown.reason).toMatch(/UCT serves `TOTAL_REVENUE` \(`FQ`, `TTM`\)/)
    expect(why('plot(request.financial("NASDAQ:MSFT", "TOTAL_REVENUE", "FQ"))')).toMatchObject({ code: R.FINANCIAL_SYMBOL })
    expect(why('plot(request.financial(syminfo.tickerid, "TOTAL_REVENUE", "FQ", currency = currency.EUR))')).toMatchObject({ code: R.FINANCIAL_CURRENCY })
    expect(why('id = "TOTAL_REVENUE"\nplot(request.financial(syminfo.tickerid, id, "FQ"))')).toMatchObject({ code: R.FINANCIAL_ARGUMENT })
    expect(why('p = "FQ"\nplot(request.financial(syminfo.tickerid, "TOTAL_REVENUE", p))')).toMatchObject({ code: R.FINANCIAL_PERIOD })
    expect(why('g = barmerge.gaps_on\nplot(request.financial(syminfo.tickerid, "TOTAL_REVENUE", "FQ", g))')).toMatchObject({ code: R.FINANCIAL_ARGUMENT })
    // the reference example: another symbol AND an id not served: the id is named first
    expect(why('plot(request.financial("NASDAQ:MSFT", "ACCOUNTS_PAYABLE", "FY"))')).toMatchObject({ code: R.FINANCIAL_FIELD })
  })
})

describe('F1b — the synthetic spelling is never a symbol, and a financial read is never a bars fetch', () => {
  it('a script that WRITES the internal name is refused by name, in the financial words, and never fetched', () => {
    expect(spellingUnservable('EV-FRV-Q0')).toMatchObject({ code: R.EVENT_SPELLING })
    expect(spellingUnservable('NASDAQ:EV-FRV-Q0').reason).toMatch(/financial read inside its engine, not a symbol/)
    expect(staticallyUnservable('EV-FRV-Q0', '')).toMatchObject({ code: R.EVENT_SPELLING })
    const { t, def } = docOf(pine(['plot(request.security("EV-FRV-Q0", "D", close))']))
    expect(fetchableOtherSymbols(def)).toEqual([])
    expect(financialNeeded(def)).toBe(false)
    const r = resolveOtherSymbols(def, CTX)
    expect(r.served).toEqual([])
    expect(r.refused[0]).toMatchObject({ code: R.EVENT_SPELLING })
    expect(JSON.stringify(t)).not.toMatch(/@event/)
  })

  it('a FORMULA that names the internal name is never fetched, and is refused by name', async () => {
    const { resolveFormulaSymbols } = await import('./otherSymbols')
    const def = { id: 'u_finformula', compute: { kind: 'ast', ast: { type: 'sym', value: 'EV-FRV-Q0', args: [{ type: 'series', name: 'close' }] } }, meta: {} }
    expect(fetchableOtherSymbols(def)).toEqual([])
    expect(resolveFormulaSymbols(def, { secondary: new Map() }).refused[0]).toMatchObject({ code: R.EVENT_SPELLING })
  })
})

describe('F1b — the placement (P1, P2) on both lanes', () => {
  const WANT = {
    '': [100, 100, 120, 120, 120, 130, 130, 140, 140, 140],
    ', barmerge.gaps_off': [100, 100, 120, 120, 120, 130, 130, 140, 140, 140],
    // bar 0 carries a figure public before the chart: it did not step there, so gaps_on reads na
    ', barmerge.gaps_on': [NA, NA, 120, NA, NA, 130, NA, 140, NA, NA],
  }
  for (const [gaps, want] of Object.entries(WANT)) {
    it(`host lane: TOTAL_REVENUE FQ${gaps}`, () => {
      const d = memberPaneDefinition({ source: pine([`plot(nz(${revenue(gaps)}, -1), "r")`]), id: 'u_finhost', name: 'r' })
      expect(d.ok, d.reason).toBe(true)
      const cols = computeFor(d.definition, CHART, undefined, CTX)
      expect(Object.values(columnErrors(cols))).toEqual([])
      expect(asWant(cols[Object.keys(cols)[0]])).toEqual(want)
    })

    it(`runtime lane: TOTAL_REVENUE FQ${gaps}`, () => {
      const id = `u_finrt${gaps.includes('gaps_on') ? 'g' : 'c'}${gaps ? 'x' : 'd'}`
      const doc = { id, meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: `runtime:${id}`, outputs: { a: 0 },
        source: pine([`plot(nz(${revenue(gaps)}, -1))`]) } }
      const out = computeRuntimeColumns(doc, CHART, { ...CTX, historyFromListing: true })
      expect(asWant(out.a)).toEqual(want)
    })
  }

  it('the placed series carries its record and is marked unknown before its first row', () => {
    const r = resolveOtherSymbols(docOf(pine([`plot(${revenue()})`])).def, { ...CTX, chartBars: CHART })
    expect(r.served).toEqual(['EV-FRV-Q0'])
    const s = r.symbols['EV-FRV-Q0']
    expect(s.map((b) => b.t)).toEqual(DAYS)
    expect(s[SERIES_UNKNOWN_BEFORE_FIRST]).toBe(true)
    expect(s[SERIES_EVENT_RECORD]).toMatchObject({ family: 'financial', symbol: 'AAPL', field: 'TOTAL_REVENUE', period: 'FQ' })
  })

  it('weekly: a figure steps in the week whose last session closes at or after its knownFrom', () => {
    const weeks = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'].map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 }))
    const field = { points: [pt('2026-01-07', 1), pt('2026-01-17', 2), pt('2026-01-19', 3)] }
    expect(placeFinancial(false, field, weeks, 'W').series.map((b) => b.c)).toEqual([1, 1, 3, 3])
    expect(placeFinancial(true, field, weeks, 'W').series.map((b) => b.c)).toEqual([1, NaN, 3, NaN])
  })

  it('monthly: a figure steps in the month whose last session closes at or after its knownFrom', () => {
    const months = ['2025-11-03', '2025-12-01', '2026-01-02', '2026-02-02'].map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 }))
    const field = { points: [pt('2025-11-20', 7), pt('2026-01-30', 8)] }
    expect(placeFinancial(false, field, months, 'M').series.map((b) => b.c)).toEqual([7, 7, 8, 8])
  })
})

describe('F1b — P3: a bar UCT knows no current figure on is WITHHELD by name, never na, never carried', () => {
  const host = (id, gaps = '') => {
    const d = memberPaneDefinition({ source: pine([`plot(nz(request.financial(syminfo.tickerid, "${id}", "FQ"${gaps}), -1), "f")`]),
      id: `u_fin${id.slice(0, 6)}${gaps ? 'g' : ''}`, name: 'f' })
    expect(d.ok, d.reason).toBe(true)
    return { d, cols: computeFor(d.definition, CHART, undefined, CTX) }
  }

  it('before the first filing that yields it: withheld, and the strip says why', async () => {
    const { withheldBarsReport } = await import('./astColumns')
    const { externalReadNotices } = await import('./nativeRegistry')
    const { d, cols } = host('TOTAL_SHARES_OUTSTANDING')
    const key = Object.keys(cols)[0]
    expect(asWant(cols[key])).toEqual([W, W, W, 15, 15, 15, 15, 15, 15, 15])
    expect(Array.from(withheldBarsReport(cols)[key][R.FINANCIAL_UNKNOWN])).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 0, 0])
    const notes = externalReadNotices(d.definition, cols).filter((n) => n.code === R.FINANCIAL_UNKNOWN)
    expect(notes).toEqual([{ code: R.FINANCIAL_UNKNOWN, reason: 'Not drawn before 2026-01-08: UCT\'s figures for AAPL\'s '
      + '`TOTAL_SHARES_OUTSTANDING` (`FQ`) come from company filings, and none that yields it had become public before then, '
      + 'so what it read on earlier bars is not known here.' }])
  })

  it('a filing that left the figure unknown (a gap): every bar up to the next figure is withheld, never the older value', async () => {
    const { externalReadNotices } = await import('./nativeRegistry')
    const { d, cols } = host('EARNINGS_PER_SHARE_DILUTED')
    expect(asWant(cols[Object.keys(cols)[0]])).toEqual([W, W, W, W, W, W, 1.2, 1.2, 1.2, 1.2])
    const notes = externalReadNotices(d.definition, cols).filter((n) => n.code === R.FINANCIAL_UNKNOWN)
    expect(notes[0].reason).toMatch(/^Not drawn before 2026-01-13: on 2026-01-12 UCT did not know a current figure for AAPL's `EARNINGS_PER_SHARE_DILUTED` \(`FQ`\)/)
  })

  it('a figure past its staleFrom is not carried: withheld until the next filing', () => {
    const { cols } = host('TOTAL_EQUITY')
    expect(asWant(cols[Object.keys(cols)[0]])).toEqual([W, W, W, W, W, W, 6, 6, 6, 6])
  })

  it('gaps_on: only a gap\'s own step bar is unknown, and staleness withholds nothing (every other bar reads na)', () => {
    const eps = host('EARNINGS_PER_SHARE_DILUTED', ', barmerge.gaps_on').cols
    expect(asWant(eps[Object.keys(eps)[0]])).toEqual([W, W, W, W, NA, NA, 1.2, NA, NA, NA])
    const eq = host('TOTAL_EQUITY', ', barmerge.gaps_on').cols
    expect(asWant(eq[Object.keys(eq)[0]])).toEqual([NA, NA, NA, NA, NA, NA, 6, NA, NA, NA])
  })

  it('⛔ CONTROL: a figure known before the chart and never unknown: nothing is withheld, nothing named', async () => {
    const { withheldBarsReport } = await import('./astColumns')
    const d = memberPaneDefinition({ source: pine(['plot(request.financial(syminfo.tickerid, "TOTAL_REVENUE", "TTM"), "f")']), id: 'u_finctl', name: 'f' })
    const cols = computeFor(d.definition, CHART, undefined, CTX)
    const key = Object.keys(cols)[0]
    expect(asWant(cols[key])).toEqual(new Array(10).fill(400))
    expect((withheldBarsReport(cols) || {})[key]?.[R.FINANCIAL_UNKNOWN]).toBeUndefined()
  })

  it('runtime lane: the run starts after the last unknown bar, its bars before named by the financial code', async () => {
    const { runtimeWarmupOf } = await import('./runtime/runtimeObjects')
    const doc = { id: 'u_finrtw', meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: 'runtime:u_finrtw', outputs: { a: 0 },
      source: pine(['plot(nz(request.financial(syminfo.tickerid, "EARNINGS_PER_SHARE_DILUTED", "FQ"), -1))']) } }
    // the gap early on the chart (01-05), the next figure 01-07: the run starts there, as an event family's depth does
    const early = { ...ENTRY, financial: { ...DOC, fields: { ...DOC.fields, 'EARNINGS_PER_SHARE_DILUTED:FQ': { state: 'ok',
      knownFrom: '2025-11-03', points: [pt('2025-11-03', 1.0), pt('2026-01-05', null), pt('2026-01-07', 1.2)] } } } }
    const out = computeRuntimeColumns(doc, CHART, { ...CTX, historyFromListing: true, secondary: new Map([[FINANCIAL_KEY, early]]) })
    // bars 0-1 are unknown (named below); from the run's start each bar is the figure or withheld by the run's own
    // start rule (as an event family's depth, E2), never the older 1.0 and never na
    const got = asWant(out.a)
    expect(got.slice(0, 2)).toEqual([W, W])
    for (let i = 2; i < got.length; i += 1) if (got[i] !== W) expect(got[i], `bar ${i}`).toBe(1.2)
    expect(got.filter((v) => v !== W).length).toBeGreaterThan(4)
    const warm = runtimeWarmupOf(out)
    expect(warm).toMatchObject({ knownFrom: 2, knownFromCode: R.FINANCIAL_UNKNOWN })
    expect(warm.knownFromReason).toMatch(/^Not drawn before 2026-01-07: on 2026-01-06 UCT did not know a current figure/)
  })
})

describe('F1b — refused by name at the bind (both lanes ask `financialDecision`)', () => {
  const decide = (ctx, src = `plot(${revenue()})`) => resolveOtherSymbols(docOf(pine([src])).def, ctx).refused[0]

  it('an intraday chart: a figure is dated by session', () => {
    expect(decide({ ...CTX, tf: '5' })).toMatchObject({ code: R.FINANCIAL_TIMEFRAME })
    expect(decide({ ...CTX, tf: '60' }).reason).toMatch(/served on daily, weekly and monthly charts/)
  })

  it('the door dark for this member (404): a plain named refusal, never an error', () => {
    const r = decide({ ...CTX, secondary: new Map([[FINANCIAL_KEY, { status: 'dark', symbol: 'AAPL' }]]) })
    expect(r).toMatchObject({ code: R.FINANCIAL_NOT_AVAILABLE })
    expect(r.reason).toMatch(/^financial figures are not available on this chart yet/)
    expect(r.pending).toBeUndefined()
  })

  it('still gathering, not asked yet, or an answer for another symbol: pending, never a settled refusal', () => {
    expect(decide({ ...CTX, secondary: new Map([[FINANCIAL_KEY, { status: 'pending', symbol: 'AAPL' }]]) })).toMatchObject({ pending: true })
    expect(decide({ ...CTX, secondary: new Map() })).toMatchObject({ pending: true })
    expect(decide({ ...CTX, symbol: { ticker: 'MSFT', exchange: 'NASDAQ' } })).toMatchObject({ pending: true })
  })

  it('a figure the filings do not yield, a per-share figure withheld, a symbol with no filings', () => {
    expect(decide(CTX, 'plot(request.financial(syminfo.tickerid, "FREE_CASH_FLOW", "TTM"))')).toMatchObject({ code: R.FINANCIAL_NONE })
    const w = decide(CTX, 'plot(request.financial(syminfo.tickerid, "EARNINGS_PER_SHARE_DILUTED", "TTM"))')
    expect(w).toMatchObject({ code: R.FINANCIAL_WITHHELD })
    expect(w.reason).toMatch(/split history could not be verified/)
    const none = { ...ENTRY, financial: { ...DOC, familyState: 'none', fields: {} } }
    expect(decide({ ...CTX, secondary: new Map([[FINANCIAL_KEY, none]]) })).toMatchObject({ code: R.FINANCIAL_NONE })
  })

  it('runtime lane: a refreshed financial answer recomputes the run (its memo names the entry)', () => {
    const doc = { id: 'u_finmemo', meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: 'runtime:u_finmemo',
      outputs: { a: 0 }, source: pine(['plot(request.financial(syminfo.tickerid, "TOTAL_REVENUE", "TTM"))']) } }
    const at = (v, rev) => ({ ...CTX, historyFromListing: true, secondary: new Map([[FINANCIAL_KEY, { ...ENTRY, rev,
      financial: { ...DOC, refreshedAt: rev, fields: { ...DOC.fields, 'TOTAL_REVENUE:TTM': { state: 'ok', knownFrom: '2025-11-03',
        points: [pt('2025-11-03', v)] } } } }]]) })
    // the chart's path, memoised per bars and run key (`runtimeColumnsFor`): the SAME bars, a refreshed answer
    const bars = CHART.map((b) => ({ ...b }))
    expect(Array.from(runtimeColumnsFor(doc, bars, {}, at(400, '1')).a)).toEqual(new Array(10).fill(400))
    expect(Array.from(runtimeColumnsFor(doc, bars, {}, at(410, '2')).a)).toEqual(new Array(10).fill(410))
  })

  it('the memo moves when the financial entry lands', () => {
    const { def } = docOf(pine([`plot(${revenue()})`]))
    const a = otherSymbolsSignature(def, new Map([[FINANCIAL_KEY, { status: 'loading', symbol: 'AAPL' }]]), 'D')
    const b = otherSymbolsSignature(def, new Map([[FINANCIAL_KEY, ENTRY]]), 'D')
    expect(a).not.toBe(b)
  })
})

describe('F1b — the member\'s words: UCT data (company filings), never TradingView\'s figures', () => {
  it('the saved document discloses the UCT data note, never the engine\'s internal name', () => {
    const d = memberPaneDefinition({ source: pine([`plot(${revenue()})`]), id: 'u_finnote', name: 'f' })
    const notes = JSON.stringify(d.definition.meta.disclosures || d.notes || [])
    expect(notes).toContain('UCT data (company filings)')
    expect(notes).toContain("not TradingView's figures")
    expect(notes).not.toMatch(/EV-F|@event/)
    expect(FINANCIAL_SOURCE_NOTE).toMatch(/dated when its filing became public/)
  })

  it('a refusal names the read in the member\'s words, never the engine\'s internal name', () => {
    const d = memberPaneDefinition({ source: pine(['plot(request.financial(syminfo.tickerid, "TOTAL_DEBT", "FY"), "d")']), id: 'u_finwords', name: 'd' })
    const cols = computeFor(d.definition, CHART, undefined, CTX)
    const err = JSON.stringify(Object.values(columnErrors(cols)))
    expect(err).toMatch(/request\.financial/)
    expect(err).not.toMatch(/EV-F/)
  })
})

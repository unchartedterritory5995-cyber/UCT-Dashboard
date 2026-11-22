// ─── ⭐⭐ T4 B2 — TRADINGVIEW'S `USI:` BREADTH SPELLINGS, SERVED FROM UCT'S OWN BREADTH (NUMBER PENDING, e95) ──────────
//
// `request.security("USI:ADVN.NY", "D", close)` reads UCT's own NYSE / Nasdaq breadth counts (B1, `GET /api/pine/breadth/
// <spelling>`), labelled UCT breadth data, never TradingView's series (`pineBreadth.js`). Each served spelling is a
// witness row of kind `breadth` (`requestWitnesses.json`), served only once its capture lands (Q-T4-B1, W-B1 had not
// landed 2026-11-22): its alignment is the named constant `BREADTH_DAILY_ALIGNMENT`, and these rails inject the row
// exactly as the landed capture's one data edit writes it (witness + captured), both alignments.
//
// What these rails hold, both lanes where a lane answers:
//   R1  every breadth row is `breadthWitnessRow` (the constant, the store key, the blocks), and every one is PENDING;
//   R2  refused by name from the spelling alone: volume, TICK / TRIN, another exchange, any other USI series, a spread;
//       a pending spelling by its capture row; bare ADVN / DECN keep the bare refusal;
//   R3  ISOLATION: the rows come from the breadth door only, never `/api/bars`, never `/api/ticker-meta`;
//   R4  the placement: same-date on its own bar, previous-session on the next; a bar before UCT's counts is withheld BY
//       NAME (`other-symbol:breadth-before-record`), never `na`; weekly by our resampler;
//   R5  refused at the bind: an intraday chart, the door dark or refused for the member; a load waits;
//   R6  the member's words: UCT breadth data (our own counts), not the exchange's official figures;
//   R7  the grade: a run that reads UCT breadth never reads MATCH.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { translatePine } from './ast/pine'
import {
  resolveOtherSymbols, fetchableOtherSymbols, staticallyUnservable, spellingUnservable, setRequestWitnessRows,
  heldFetchesOf, breadthReadsOf, OTHER_SYMBOL_REFUSAL as R,
} from './otherSymbols'
import {
  BREADTH_SPELLINGS, BREADTH_ALIASES, BREADTH_DAILY_ALIGNMENT, BREADTH_DATA_WORDS, breadthWitnessRow, breadthKeyOf,
  isBreadthKey,
} from './pineBreadth'
import { SERIES_UNKNOWN_BEFORE_FIRST, SERIES_EVENT_RECORD, BREADTH_BEFORE_RECORD_CODE } from './ast/interpret'
import WITNESSES from './requestWitnesses.json'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { computeFor, columnErrors } from './nativeRegistry'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from './runtime/runtimeColumns'
import { ensureChartSources, exchangeLookupTickers } from './useSecondarySources'
import { clearBreadth } from './breadthSupply'
import { otherSymbolSourceNotesFor } from './ast/symbolSubstitution'

const pine = (lines) => ['//@version=5', 'indicator("breadth")', ...lines].join('\n')
function docOf(src) {
  const t = translatePine(src, { strict: true })
  const trees = {}
  ;(t.outputs || []).forEach((o, i) => { if (o && o.ast) trees[`p${i}`] = o.ast })
  return { t, def: { id: 'u_brd', compute: { kind: 'ast', trees },
    meta: { recurrenceOrigin: 'pine', ...(t.otherSymbols ? { otherSymbols: t.otherSymbols } : {}) } } }
}

// the chart: Mon 2026-01-05 .. Fri 2026-01-16 (10 sessions)
const DAYS = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
  '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16']
const CHART = DAYS.map((t, i) => ({ t, o: 10, h: 11, l: 9, c: 10 + i, v: 1000 }))
// UCT's counts start 2026-01-06 (bar 0 is before them): close = 1000 + day index
const ROWS = DAYS.slice(1).map((t, i) => ({ t, o: 900 + i, h: 1100 + i, l: 800 + i, c: 1001 + i, v: NaN }))
const ENTRY = { status: 'available', spelling: 'ADVN.NY', bars: ROWS, knownFrom: '2026-01-06', newestBarIsForming: false, at: 0, rev: 'x' }
const KEY = 'USI~ADVN.NY'
const CTX = { tf: 'D', symbol: { ticker: 'AAPL', exchange: 'NASDAQ' }, newestBarIsForming: false, historyFromListing: false,
  secondary: new Map([[KEY, ENTRY]]), exchangeOf: () => null }

/** The rows as the landed capture's data edit writes them: witness + captured, at an alignment. */
function witnessed(alignment = BREADTH_DAILY_ALIGNMENT, period = false) {
  const rows = { ...WITNESSES.rows }
  for (const [k, v] of Object.entries(rows)) {
    if (!v || v.kind !== 'breadth') continue
    const ticker = k.slice('USI:'.length)
    const row = breadthWitnessRow(ticker, alignment)
    const block = (b) => ({ ...b, ...(period ? { witness: 'test-period', captured: '2026-11-22' } : {}) })
    rows[k] = { ...v, ...row, periods: { W: block(row.periods.W), M: block(row.periods.M) }, witness: 'test', captured: '2026-11-22' }
  }
  setRequestWitnessRows(rows)
}

const W = null
const asWant = (col) => Array.from(col).map((v) => (Number.isNaN(v) ? W : v))

afterEach(() => { setRequestWitnessRows(null); clearBreadth(); resetRuntimeSessions(); resetRuntimeLedgers(); vi.restoreAllMocks() })

describe('B2 R1 — the witness rows: one per served spelling and alias, each the template, each PENDING', () => {
  it('every breadth row equals `breadthWitnessRow` at the alignment constant, and none serves yet', () => {
    const rows = Object.entries(WITNESSES.rows).filter(([, v]) => v && v.kind === 'breadth')
    expect(rows.map(([k]) => k).sort()).toEqual([...Object.keys(BREADTH_SPELLINGS), ...Object.keys(BREADTH_ALIASES)]
      .map((t) => `USI:${t}`).sort())
    for (const [k, v] of rows) {
      const want = breadthWitnessRow(k.slice(4))
      for (const [field, value] of Object.entries(want)) expect(v[field], `${k}.${field}`).toEqual(value)
      expect(v.alignment).toBe(BREADTH_DAILY_ALIGNMENT)
      expect(v.witness, k).toBe('')
      expect(v.captured, k).toBe('')
    }
  })

  it('an alias reads its long spelling\'s rows (one fetch, one key)', () => {
    expect(breadthKeyOf('ADV')).toBe('USI~ADVN.NY')
    expect(breadthKeyOf('DECLQ')).toBe('USI~DECL.NQ')
    expect(WITNESSES.rows['USI:ADV'].aliasOf).toBe('USI:ADVN.NY')
  })
})

describe('B2 R2 — refused by name from the spelling alone', () => {
  it('the translation reads `USI:ADVN.NY` as the ticker ADVN.NY under the USI venue', () => {
    expect(docOf(pine(['plot(request.security("USI:ADVN.NY", "D", close))'])).t.otherSymbols)
      .toEqual([{ ticker: 'ADVN.NY', spellings: ['USI'] }])
  })

  it('a served spelling whose capture has not landed is refused by its capture row (Q-T4-B1)', () => {
    for (const t of ['ADVN.NY', 'DECL.NQ', 'ADD', 'ADDQ', 'ADV']) {
      const why = staticallyUnservable(t, 'USI')
      expect(why, t).toMatchObject({ code: R.WITNESS_PENDING })
      expect(why.reason).toMatch(/Q-T4-B1/)
    }
  })

  it('volume, TICK / TRIN: not held; another exchange; any other USI series; a spread', () => {
    for (const t of ['UVOL', 'DVOL', 'UVOLQ', 'DVOLQ', 'TVOL', 'TVOLQ']) {
      expect(spellingUnservable(`USI:${t}`), t).toMatchObject({ code: R.BREADTH_NOT_HELD })
      expect(spellingUnservable(`USI:${t}`).reason).toMatch(/VOLUME/)
    }
    expect(spellingUnservable('USI:TICK')).toMatchObject({ code: R.BREADTH_NOT_HELD })
    for (const t of ['ADVN.AM', 'ADVN.US', 'ADVN.DJ', 'ADVN.AX', 'DECL.AM', 'ADVA', 'DECLA']) {
      expect(spellingUnservable(`USI:${t}`), t).toMatchObject({ code: R.BREADTH_EXCHANGE })
    }
    for (const t of ['PCC', 'PC', 'OVSPX']) expect(spellingUnservable(`USI:${t}`), t).toMatchObject({ code: R.BREADTH_UNKNOWN })
    const spread = '(USI:ADVN.NY - USI:DECL.NY) / (USI:UNCH.NY + 1)'
    expect(spellingUnservable(spread)).toMatchObject({ code: R.BREADTH_SPREAD })
    expect(spellingUnservable(spread).reason).toMatch(/read each with its own `request.security`/)
    expect(spellingUnservable('USI:ADVN.NY-USI:DECL.NY')).toMatchObject({ code: R.BREADTH_SPREAD })
  })

  it('the bare legacy spellings keep the bare refusal (whether TradingView maps them waits on U17/U18)', () => {
    expect(staticallyUnservable('ADVN', '')).toMatchObject({ code: R.BARE })
    expect(staticallyUnservable('DECN', '')).toMatchObject({ code: R.BARE })
  })

  it('a pending read is never fetched', () => {
    const { def } = docOf(pine(['plot(request.security("USI:ADVN.NY", "D", close))']))
    expect(fetchableOtherSymbols(def)).toEqual([])
  })
})

describe('B2 R3 — ISOLATION: the breadth door only, never /api/bars, never the symbol resolver', () => {
  it('a witnessed read is fetched under its breadth key, from the breadth door, on D and (held at D) on W', async () => {
    witnessed(BREADTH_DAILY_ALIGNMENT, true)
    const { def } = docOf(pine(['plot(request.security("USI:ADVN.NY", "D", close))', 'plot(request.security("USI:ADV", "D", close))']))
    expect(fetchableOtherSymbols(def)).toEqual([KEY])
    expect(heldFetchesOf(KEY, 'W').map((h) => h.key)).toEqual([`${KEY}@D`])
    const asked = []
    const fetcher = vi.fn((url) => { asked.push(url); return Promise.resolve({ state: 'pending' }) })
    const barsFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('a breadth key reached fetch') })
    const d = ensureChartSources([KEY], 'D', 200, fetcher, 'AAPL')
    const w = ensureChartSources([`${KEY}@D`], 'W', 200, fetcher, 'AAPL')
    expect(d.get(KEY)).toMatchObject({ status: 'loading', spelling: 'ADVN.NY' })
    expect(w.get(`${KEY}@D`)).toBe(d.get(KEY))
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(asked).toEqual(['/api/pine/breadth/USI%3AADVN.NY'])
    expect(asked.some((u) => /\/api\/bars|ticker-meta/.test(u))).toBe(false)
    expect(barsFetch).not.toHaveBeenCalled()
  })

  it('the exchange lookup is never asked about a breadth key', () => {
    witnessed()
    const { def } = docOf(pine(['plot(request.security("USI:ADVN.NY", "D", close))', 'plot(request.security("AMEX:SPY", "D", close))']))
    const tickers = [...exchangeLookupTickers([{ defId: 'x' }], () => def)]
    expect(tickers).toEqual(['SPY'])
    expect(tickers.some(isBreadthKey)).toBe(false)
  })
})

describe('B2 R4 — the placement, on both lanes', () => {
  const src = pine(['plot(nz(request.security("USI:ADVN.NY", "D", close), -1), "a")'])
  const SAME = [W, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009]
  const PREV = [W, W, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008]

  it('host lane, same-date: each session\'s count on its own bar; bar 0 (before UCT\'s counts) withheld BY NAME', async () => {
    witnessed('same-date')
    const { withheldBarsReport } = await import('./astColumns')
    const { externalReadNotices } = await import('./nativeRegistry')
    const d = memberPaneDefinition({ source: src, id: 'u_brdhost', name: 'b' })
    expect(d.ok, d.reason).toBe(true)
    const cols = computeFor(d.definition, CHART, undefined, CTX)
    expect(Object.values(columnErrors(cols))).toEqual([])
    const key = Object.keys(cols)[0]
    expect(asWant(cols[key])).toEqual(SAME)
    // the bar is named by the BREADTH code, never by an event family's (the code is printed when this goes red)
    expect(Object.keys(withheldBarsReport(cols)[key])).toEqual([BREADTH_BEFORE_RECORD_CODE])
    expect(Array.from(withheldBarsReport(cols)[key][BREADTH_BEFORE_RECORD_CODE])).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const notes = externalReadNotices(d.definition, cols).filter((n) => n.code === BREADTH_BEFORE_RECORD_CODE)
    expect(notes).toEqual([{ code: BREADTH_BEFORE_RECORD_CODE, reason: 'Not drawn before 2026-01-06: UCT\'s NYSE breadth '
      + 'counts start there, so what `USI:ADVN.NY` reads on those bars is not known here.' }])
  })

  it('host lane, previous-session (the constant flipped by the capture): each count on the NEXT session', () => {
    witnessed('previous-session')
    const d = memberPaneDefinition({ source: src, id: 'u_brdprev', name: 'b' })
    const cols = computeFor(d.definition, CHART, undefined, CTX)
    expect(asWant(cols[Object.keys(cols)[0]])).toEqual(PREV)
  })

  it('runtime lane, same-date: the run starts at UCT\'s first count and names the bars before it', async () => {
    witnessed('same-date')
    const { runtimeWarmupOf } = await import('./runtime/runtimeObjects')
    const doc = { id: 'u_brdrt', meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: 'runtime:u_brdrt', outputs: { a: 0 },
      source: src } }
    const out = computeRuntimeColumns(doc, CHART, { ...CTX, historyFromListing: true })
    const got = asWant(out.a)
    // the run starts at UCT's first count (bar 1) and its own start proof withholds a few bars more (as E2's run does);
    // every bar it draws is the host lane's value, and nothing before the counts is ever drawn
    expect(got[0]).toBe(W)
    for (let i = 1; i < got.length; i += 1) if (got[i] !== W) expect(got[i], `bar ${i}`).toBe(SAME[i])
    expect(got.filter((v) => v !== W).length).toBeGreaterThanOrEqual(7)
    expect(runtimeWarmupOf(out)).toMatchObject({ knownFrom: 1, knownFromCode: BREADTH_BEFORE_RECORD_CODE })
    expect(runtimeWarmupOf(out).knownFromReason).toMatch(/^Not drawn before 2026-01-06: UCT's NYSE breadth counts start there/)
  })

  it('the served series carries its record and is unknown before its first row', () => {
    witnessed()
    const r = resolveOtherSymbols(docOf(src).def, CTX)
    expect(r.served).toEqual(['ADVN.NY'])
    const s = r.symbols['ADVN.NY']
    expect(s[SERIES_UNKNOWN_BEFORE_FIRST]).toBe(true)
    expect(s[SERIES_EVENT_RECORD]).toMatchObject({ code: BREADTH_BEFORE_RECORD_CODE, spelling: 'ADVN.NY', exchange: 'NYSE',
      knownFrom: '2026-01-06' })
  })

  it('a weekly chart (its block witnessed): `timeframe.period` reads OUR resampler\'s week, on its own week', () => {
    witnessed('same-date', true)
    const weeks = [{ t: '2026-01-09' }, { t: '2026-01-16' }].map((b) => ({ ...b, o: 1, h: 1, l: 1, c: 1, v: 1 }))
    const r = resolveOtherSymbols(docOf(pine(['plot(request.security("USI:ADVN.NY", timeframe.period, close))'])).def,
      { ...CTX, tf: 'W', secondary: new Map([[`${KEY}@D`, ENTRY]]), chartBars: weeks })
    expect(r.served).toEqual(['ADVN.NY'])
    // the week of 01-05..09 holds 01-06..09 (close 1004), the next week 01-12..16 (close 1009), each on its own Friday
    expect(r.symbols['ADVN.NY'].map((b) => [b.t, b.c])).toEqual([['2026-01-09', 1004], ['2026-01-16', 1009]])
  })

  it('a weekly chart whose block is still pending is refused by name', () => {
    witnessed('same-date', false)
    const r = resolveOtherSymbols(docOf(pine(['plot(request.security("USI:ADVN.NY", timeframe.period, close))'])).def,
      { ...CTX, tf: 'W', secondary: new Map([[`${KEY}@D`, ENTRY]]) })
    expect(r.refused[0]).toMatchObject({ code: R.WITNESS_TIMEFRAME })
    expect(r.refused[0].reason).toMatch(/Q-T4-B2/)
  })

  it('ADD holds the close only: its high reads na, never the close repeated', () => {
    witnessed()
    const addRows = ROWS.map((b) => ({ ...b, o: NaN, h: NaN, l: NaN }))
    const ctx = { ...CTX, secondary: new Map([['USI~ADD', { ...ENTRY, spelling: 'ADD', bars: addRows }]]) }
    const d = memberPaneDefinition({ source: pine(['plot(request.security("USI:ADD", "D", high), "h")']), id: 'u_brdadd', name: 'b' })
    const cols = computeFor(d.definition, CHART, undefined, ctx)
    expect(asWant(cols[Object.keys(cols)[0]]).every((v) => v === W)).toBe(true)
  })
})

describe('B2 R5 — refused at the bind; a load waits', () => {
  const read = pine(['plot(request.security("USI:ADVN.NY", "D", close))'])
  const decide = (ctx) => resolveOtherSymbols(docOf(read).def, ctx).refused[0]

  it('an intraday chart: UCT holds one count per session', () => {
    witnessed()
    expect(decide({ ...CTX, tf: '5' })).toMatchObject({ code: R.BREADTH_INTRADAY })
    expect(decide({ ...CTX, tf: '5' }).reason).toMatch(/one breadth count per session/)
  })

  it('the door dark (404) or refused by the licence: named, never a wait', () => {
    witnessed()
    const dark = decide({ ...CTX, secondary: new Map([[KEY, { status: 'dark', spelling: 'ADVN.NY' }]]) })
    expect(dark).toMatchObject({ code: R.BREADTH_NOT_AVAILABLE })
    expect(dark.pending).toBeUndefined()
    const refused = decide({ ...CTX, secondary: new Map([[KEY, { status: 'refused', spelling: 'ADVN.NY', said: 'Not served: `UCT:`.' }]]) })
    expect(refused).toMatchObject({ code: R.BREADTH_NOT_AVAILABLE })
    expect(refused.reason).toMatch(/Not served/)
  })

  it('loading or still gathering (202): a wait, never a settled refusal', () => {
    witnessed()
    expect(decide({ ...CTX, secondary: new Map() })).toMatchObject({ pending: true })
    expect(decide({ ...CTX, secondary: new Map([[KEY, { status: 'pending', spelling: 'ADVN.NY' }]]) })).toMatchObject({ pending: true })
  })
})

describe('B2 R6 — the member\'s words', () => {
  it('a breadth read is disclosed as UCT breadth data (our own counts), never as TradingView\'s series', () => {
    const notes = otherSymbolSourceNotesFor([{ ticker: 'ADVN.NY', spellings: ['USI'] }, { ticker: 'ADD', spellings: ['USI'] }])
    expect(notes.map((n) => n.name)).toEqual(['USI:ADVN.NY', 'USI:ADD'])
    for (const n of notes) expect(n.note).toContain(BREADTH_DATA_WORDS)
    expect(notes[1].note).toMatch(/holds each session's close only/)
    expect(BREADTH_DATA_WORDS).toBe("UCT breadth data (our own counts), not the exchange's official figures")
  })
})

describe('B2 R7 — the grade: a run that reads UCT breadth NEVER reads MATCH (the grade: vendorHarness.b2Breadth.test.js)', () => {
  it('our side tags every run that reads a USI spelling, served or pending', () => {
    expect(breadthReadsOf(docOf(pine(['plot(request.security("USI:ADVN.NY", "D", close))'])).def))
      .toEqual({ spellings: ['USI:ADVN.NY'], words: BREADTH_DATA_WORDS })
    expect(breadthReadsOf(docOf(pine(['plot(request.security("AMEX:SPY", "D", close))'])).def)).toBeNull()
  })
})

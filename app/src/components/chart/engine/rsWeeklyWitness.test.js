// ─── ⭐⭐ RS RATING L11 (Q-RS7) — SP:SPX AND THE RS SEED ON A WEEKLY CHART, HELD AT "D" ──────────────────
//
// The rules (`requestWitnesses.json` `periods.W`, witnessed on the rs-weekly-2026-11-17 captures; graded
// against them by `__tests__/vendorHarness/vendorHarness.l11WeeklyWitness.test.js`):
//   R1  SP:SPX at `timeframe.period` on a weekly chart: each week reads the PREVIOUS week's last daily close
//       (`previous-week`), in the host lane (the RS line) and in the run alike;
//   R2  SP:SPX at "D": each week reads the previous-session-aligned daily bar at its LAST session
//       (`week-last-row`: the Thursday close in a full week, Wednesday's in a Good Friday week), in the run;
//   R3  this chart's own symbol at "D": the week's last daily close, which IS the weekly close, served for a
//       bare `close` only (any other expression needs daily bars a weekly chart does not hold: refused by name);
//   R4  the seed at "D": the row dated the week's MONDAY, `na` where there is none (`week-first-day`), in the run.
// On a weekly chart both series are FETCHED AND HELD AT "D" (`/api/bars/SPX?tf=W` is ten years of yfinance
// keyed by Monday; a seed is served daily only) under their own cache keys (`SPX@D`), deep enough for the chart.
// Every fixture here is in the SHAPE the server answers with (synthetic values, no vendor data): weekly
// chart bars keyed by their FRIDAY as an ISO day (holiday Fridays included), SPX daily rows keyed by the UTC
// midnight of the session in unix seconds, seed rows by ISO calendar day.
// ⭐ A DAILY chart is untouched: its rows have no weekly block, its keys and series are what they were.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as registry from './nativeRegistry'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { runtimeColumnsFor, computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from './runtime/runtimeColumns'
import { runHalfOf, runtimeObjectsOf } from './runtime/runtimeObjects'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList, runtimeSourceHash } from './runtimeKill'
import { setRunHalfObjectEvidence } from './runHalfRailSeam'
import {
  resolveOtherSymbols, witnessedBarsOf, requestWitnessRows, setRequestWitnessRows, heldFetchOf, heldDepthOf,
  otherSymbolsSignature, OTHER_SYMBOL_REFUSAL as R,
} from './otherSymbols'
import { symbolsNeeded } from './sourceRef'
import { ensureChartSources } from './useSecondarySources'
import { clearSecondaryBars } from './secondaryBars'
import { computeHeadless } from './headlessCompute'
import WITNESSES from './requestWitnesses.json'

vi.setConfig({ testTimeout: 120000 })

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const SEED_KEY = 'SEED_FRED6725_RS_RATING:RSRATING'
const TODAY = '2026-11-17'
const utc = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000
const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
const weekdayOf = (iso) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7 // Mon=0 … Sun=6
const fridayOf = (iso) => isoPlus(iso, 4 - weekdayOf(iso))
const mondayOf = (iso) => isoPlus(iso, -weekdayOf(iso))

// Good Friday (2025-04-18, 2026-04-03), a Friday Independence Day (2026-07-03) and Monday holidays
const HOLIDAYS = new Set(['2025-04-18', '2025-05-26', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-07-03', '2026-09-07'])
const SESSIONS = (() => {
  const out = []
  for (let d = '2025-01-02'; d <= TODAY; d = isoPlus(d, 1)) if (weekdayOf(d) < 5 && !HOLIDAYS.has(d)) out.push(d)
  return out
})()
const dailyClose = (i) => 80 + 20 * Math.sin(i / 17) + i * 0.05
/** The chart's WEEKLY bars as `/api/bars/<T>?tf=W` serves them: keyed by the week's Friday (holiday Fridays
 *  included), the close the week's last daily close; the newest week (2026-11-16..17) forming. */
const WEEKLY = (() => {
  const byFri = new Map()
  SESSIONS.forEach((s, i) => {
    const f = fridayOf(s)
    const c = dailyClose(i)
    const w = byFri.get(f)
    if (!w) byFri.set(f, { t: f, o: c - 0.3, h: c + 1, l: c - 1, c, v: 1e6 })
    else { w.h = Math.max(w.h, c + 1); w.l = Math.min(w.l, c - 1); w.c = c; w.v += 1e6 }
  })
  return [...byFri.values()]
})()
const spxClose = (i) => 5400 + 300 * Math.sin(i / 41) + i * 3
/** SPX's DAILY rows as `/api/bars/SPX?tf=D` serves them (unix seconds at the session's UTC midnight), today included. */
const SPX_D = SESSIONS.map((s, i) => ({ t: utc(s), o: spxClose(i) - 5, h: spxClose(i) + 20, l: spxClose(i) - 22, c: spxClose(i), v: 3e9 }))
/** The seed's rows as `/api/bars/<SEED>?tf=D` serves them: calendar days, 2026-10-13 .. 2026-11-16, a new
 *  value every fifth day (the seed's own encoding). */
const SEED_D = (() => {
  const out = []
  let k = 0
  for (let d = '2026-10-13'; d <= '2026-11-16'; d = isoPlus(d, 1), k += 1) {
    out.push({ t: d, o: 0, h: 1000, l: 0, c: 200 - 25 * Math.floor(k / 5), v: 0 })
  }
  return out
})()

const spxByDay = new Map(SPX_D.map((b) => [new Date(b.t * 1000).toISOString().slice(0, 10), b]))
/** R1, stated from the rows: the last SPX daily close of the ISO week BEFORE this bar's. */
const previousWeekClose = (friday) => {
  const days = [...spxByDay.keys()].filter((d) => fridayOf(d) === isoPlus(friday, -7))
  return days.length ? spxByDay.get(days[days.length - 1]).c : NaN
}
/** R2, stated from the rows: the SPX bar of the session BEFORE this week's last session. */
const weekLastPreviousSession = (friday, field = 'c') => {
  const days = [...spxByDay.keys()]
  const last = days.filter((d) => fridayOf(d) === friday).pop()
  const k = days.indexOf(last)
  return k > 0 ? spxByDay.get(days[k - 1])[field] : NaN
}
/** R4, stated from the rows: the seed row dated this week's Monday, else `na`. */
const seedMonday = (friday) => {
  const row = SEED_D.find((r) => r.t === mondayOf(friday))
  return row ? row.c : NaN
}

const held = (spx = SPX_D, seed = SEED_D) => new Map([
  ['SPX@D', { bars: spx, status: 'available' }], [`${SEED_KEY}@D`, { bars: seed, status: 'available' }]])
const ctxW = (secondary = held(), over = {}) => ({
  tf: 'W', newestBarIsForming: true, historyFromListing: true,
  symbol: { ticker: 'AGL', exchange: 'NYSE', industry: 'Medical Care Facilities', sector: 'Healthcare', securityType: 'stock' },
  secondary, exchangeOf: (t) => (t === 'SPX' ? 'SP' : null), ...over,
})
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
const pine = (lines) => ['//@version=5', 'indicator("l11", overlay = false)', ...lines].join('\n')

/** A runtime document of `source`, built as the RUN HALF builds (`compute.objects`: the drawing build). */
const runDef = (source, keys) => ({
  id: 'u_l11-run', compute: { kind: 'runtime', fn: 'runtime:u_l11-run', rev: 1, source, objects: true,
    outputs: Object.fromEntries(keys.map((k, i) => [k, i])) },
  inputs: [], meta: { runtimeHistory: 'listing' },
})
const run = (source, keys, ctx = ctxW()) => computeRuntimeColumns(runDef(source, keys), WEEKLY, ctx, { now: () => 0 })

let installed = []
function install(def) {
  const { installed: got, errors } = registry.installUserDefinitions([def])
  expect(got.length, errors.join(' | ')).toBe(1)
  installed.push(got[0].id)
  return got[0]
}

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
  setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(RS), captures: [
    { capture: 'a', verdict: 'MATCH', objectsV2: true, runtimeOn: true },
    { capture: 'b', verdict: 'MATCH', objectsV2: true, runtimeOn: true }] }])
})
afterEach(() => {
  for (const id of installed) registry.uninstallUserDefinition(id)
  installed = []
  setRunHalfObjectEvidence([])
  setRuntimeKillList([])
  setRequestWitnessRows(null)
  resetRuntimeSessions()
  resetRuntimeLedgers()
  clearSecondaryBars()
  vi.unstubAllEnvs()
})

describe('the fixture is shaped as the server answers', () => {
  it('weekly bars keyed by Friday (holiday Fridays included), SPX by UTC-midnight seconds, the seed by ISO day', () => {
    expect(WEEKLY.every((b) => weekdayOf(b.t) === 4)).toBe(true)
    expect(WEEKLY.map((b) => b.t)).toEqual(expect.arrayContaining(['2025-04-18', '2026-04-03', '2026-07-03']))
    expect(WEEKLY[WEEKLY.length - 1].t).toBe('2026-11-20')
    expect(SPX_D[SPX_D.length - 1].t).toBe(utc(TODAY))
    expect(SEED_D[0].t).toBe('2026-10-13')
  })
})

describe('R1 — SP:SPX at `timeframe.period` on a weekly chart reads the PREVIOUS week\'s last daily close', () => {
  it('host lane, through the member door: every week, holiday weeks included', () => {
    const d = memberPaneDefinition({ source: pine(['plot(request.security("SP:SPX", timeframe.period, close), "spx")']),
      id: 'u_l11-r1', name: 'r1' })
    expect(d.ok, d.reason).toBe(true)
    const def = install(d.definition)
    const cols = registry.computeFor(def, WEEKLY, {}, ctxW())
    expect(Object.values(registry.columnErrors(cols))).toEqual([])
    const col = cols[Object.keys(cols)[0]]
    WEEKLY.forEach((b, i) => expect(same(col[i], previousWeekClose(b.t)), `${b.t}: ${col[i]} vs ${previousWeekClose(b.t)}`).toBe(true))
    // Good Friday 2026-04-03: the week after reads Thursday 2026-04-02's close
    const after = WEEKLY.findIndex((b) => b.t === '2026-04-10')
    expect(col[after]).toBe(spxByDay.get('2026-04-02').c)
    // ⏳ the forming week reads the week before it (TradingView reads the latest SPX value: PR 2)
    expect(col[WEEKLY.length - 1]).toBe(spxByDay.get('2026-11-13').c)
  })

  it('RS Rating\'s RS line on a weekly chart: close / R1 × (4200 × 70 / 100) on every week', () => {
    const def = install(memberPaneDefinition({ source: RS, name: 'RS Rating', id: 'u_l11-rs' }).definition)
    const cols = registry.computeFor(def, WEEKLY, {}, ctxW())
    const line = cols.value
    WEEKLY.forEach((b, i) => {
      const want = (b.c / previousWeekClose(b.t)) * 2940
      expect(same(line[i], want), `${b.t}: ${line[i]} vs ${want}`).toBe(true)
    })
  })

  it('in the run, the same read: R1 is one rule in both lanes', () => {
    const cols = run(pine(['plot(request.security("SP:SPX", timeframe.period, close))']), ['x'])
    WEEKLY.forEach((b, i) => expect(same(cols.x[i], previousWeekClose(b.t)), b.t).toBe(true))
  })
})

describe('R2 / R4 — a daily read below the weekly chart is the run\'s: the held daily series, sampled per week', () => {
  const SRC = pine([
    'x = request.security("SP:SPX", "D", close)',
    'xo = request.security("SP:SPX", "D", open)',
    's = request.seed("seed_fred6725_rs_rating", "RSRATING", close)',
    'plot(x)', 'plot(xo)', 'plot(s)', 'plot(na(s) ? 1 : 0)',
  ])

  it('R2: each week reads the previous-session bar at its LAST session (Wednesday\'s in a Good Friday week)', () => {
    const cols = run(SRC, ['x', 'xo', 's', 'sna'])
    WEEKLY.forEach((b, i) => {
      // ⭐ RS RATING L13 — THE FORMING WEEK reads the NEWEST SPX row (today's close), which the previous-session
      // read places on its NEXT session (2026-11-18, inside this week): TradingView's X04 on the 21:18Z weekly
      // capture (7340.53, the 2026-11-17 close) and on the pre-market monthly one (`otherSymbols.js::
      // belowChartSeriesOf`). Every settled week as before.
      const forming = i === WEEKLY.length - 1
      const want = (field) => (forming ? spxByDay.get(TODAY)[field] : weekLastPreviousSession(b.t, field))
      expect(same(cols.x[i], want('c')), `${b.t}: ${cols.x[i]}`).toBe(true)
      expect(same(cols.xo[i], want('o')), b.t).toBe(true)
    })
    expect(cols.x[WEEKLY.length - 1]).not.toBe(weekLastPreviousSession(WEEKLY[WEEKLY.length - 1].t))   // it moved
    const gf = WEEKLY.findIndex((b) => b.t === '2026-04-03')
    expect(cols.x[gf]).toBe(spxByDay.get('2026-04-01').c)
    const full = WEEKLY.findIndex((b) => b.t === '2026-11-13')
    expect(cols.x[full]).toBe(spxByDay.get('2026-11-12').c)
  })

  it('R4: each week reads the seed row of its Monday; a week whose Monday has no row reads `na`', () => {
    const cols = run(SRC, ['x', 'xo', 's', 'sna'])
    WEEKLY.forEach((b, i) => {
      expect(same(cols.s[i], seedMonday(b.t)), `${b.t}: ${cols.s[i]} vs ${seedMonday(b.t)}`).toBe(true)
      expect(cols.sna[i], b.t).toBe(Number.isNaN(seedMonday(b.t)) ? 1 : 0)
    })
    // the week of 2026-10-12: the series begins on its Tuesday, so that week reads `na`, not 200
    const oct = WEEKLY.findIndex((b) => b.t === '2026-10-16')
    expect(cols.s[oct]).toBeNaN()
    expect(cols.s[oct + 1]).toBe(seedMonday('2026-10-23'))
  })

  it('⛔ a daily read of a LISTING below the weekly chart is refused by name (no capture witnesses one)', () => {
    expect(() => run(pine(['plot(request.security("AMEX:SPY", "D", close))']), ['x'],
      ctxW(new Map([['SPY', { bars: WEEKLY, status: 'available', exchange: 'NYSE Arca' }]]))))
      .toThrow(/other-symbol:witness-timeframe — `SPY` is read at `"D"` below this `W` chart/)
  })

  it('⛔ SP:SPX read at a period its weekly block does not name ("M" on a weekly chart) is refused by name', () => {
    expect(() => run(pine(['plot(request.security("SP:SPX", "M", close))']), ['x']))
      .toThrow(/other-symbol:witness-timeframe — `SP:SPX` on a `W` chart is witnessed only as read at `timeframe.period` and at `"D"`/)
  })

  it('⛔ a weekly block without its witness is pending: refused by name, citing Q-RS7', () => {
    const rows = JSON.parse(JSON.stringify(WITNESSES.rows))
    delete rows['SP:SPX'].periods.W.witness
    setRequestWitnessRows(rows)
    expect(() => run(SRC, ['x', 'xo', 's', 'sna'])).toThrow(/served only once a TradingView capture witnesses it there \(capture-queue row Q-RS7/)
  })

  it('⛔ a held series not in hand holds the run (waiting), never reads the weekly store\'s rows', () => {
    // the daily rows filed under the PLAIN key (a `sym:SPX` source at the chart's own timeframe) are not the held ones
    const plain = new Map([['SPX', { bars: SPX_D, status: 'available' }], [SEED_KEY, { bars: SEED_D, status: 'available' }]])
    expect(() => run(SRC, ['x', 'xo', 's', 'sna'], ctxW(plain))).toThrow(/still loading/)
  })
})

describe('R3 — this chart\'s own symbol at "D" on a weekly chart: a bare `close`, the weekly close', () => {
  it('served as the identity: the week\'s last daily close on every week, the forming week included', () => {
    const cols = run(pine(['plot(request.security(syminfo.tickerid, "D", close))']), ['c'])
    WEEKLY.forEach((b, i) => expect(cols.c[i], b.t).toBe(b.c))
  })

  it('⛔ any other expression needs daily bars this chart does not hold: refused by name', () => {
    expect(() => run(pine(['plot(request.security(syminfo.tickerid, "D", open))']), ['o']))
      .toThrow(/reads this chart's own symbol at the `D` timeframe on a `W` chart/)
    expect(() => run(pine(['plot(request.security(syminfo.tickerid, "D", ta.sma(close, 5)))']), ['o']))
      .toThrow(/reads this chart's own symbol at the `D` timeframe on a `W` chart/)
  })
})

describe('RS Rating\'s run half on a weekly chart, through the real door', () => {
  it('served: the two labels TradingView draws ("RS Rating" and the empty rating text) on the newest week, at the RS line', () => {
    const def = install(memberPaneDefinition({ source: RS, name: 'RS Rating', id: 'u_l11-rs-half' }).definition)
    const cols = registry.computeFor(def, WEEKLY, {}, ctxW())
    expect(runHalfOf(cols)).toEqual({ state: 'served', code: null })
    const labels = runtimeObjectsOf(cols).live.filter((o) => o.family === 'label' && o.createdBar === WEEKLY.length - 1)
    expect(labels.map((o) => o.props.text)).toEqual(['                RS Rating', ''])
    for (const l of labels) expect(l.props.y).toBe(cols.value[WEEKLY.length - 1])
  })

  it('⛔ CONTROL: with SP:SPX and the seed filed under their plain keys (not held at D), nothing reads them: the RS line is refused while it waits and the run half is not served', () => {
    const def = install(memberPaneDefinition({ source: RS, name: 'RS Rating', id: 'u_l11-rs-plain' }).definition)
    const plain = new Map([['SPX', { bars: SPX_D, status: 'available' }], [SEED_KEY, { bars: SEED_D, status: 'available' }]])
    const cols = registry.computeFor(def, WEEKLY, {}, ctxW(plain))
    expect(runHalfOf(cols).state).not.toBe('served')
    expect(cols.value === undefined || Array.from(cols.value).every((v) => Number.isNaN(v))).toBe(true)
  })
})

describe('the fetch: on a weekly chart SP:SPX and the seed are fetched at D, deep enough, under their held keys', () => {
  const rsDef = () => memberPaneDefinition({ source: RS, name: 'RS Rating', id: 'u_l11-fetch' }).definition

  it('symbolsNeeded names the held keys on a weekly chart, the plain keys on a daily one (unchanged)', () => {
    const def = rsDef()
    const insts = [{ defId: def.id, instanceId: 'i1', inputs: {} }]
    expect(symbolsNeeded(insts, () => def, 'W')).toEqual([`${SEED_KEY}@D`, 'SPX@D'])
    expect(symbolsNeeded(insts, () => def, 'D')).toEqual([SEED_KEY, 'SPX'])
    expect(symbolsNeeded(insts, () => def)).toEqual([SEED_KEY, 'SPX'])
    expect(heldFetchOf('SPX', 'W')).toEqual({ symbol: 'SPX', tf: 'D', key: 'SPX@D' })
    expect(heldFetchOf('SPX', 'D')).toBe(null)
    // ⭐ L13 — a monthly chart holds SPX at D too (`periods.M`); ⭐ L12 — an intraday chart holds it at its own
    // timeframe under the plain key (`rsIntradayWitness.test.js`; ⭐ e98 a 4h chart too, `rsFourHourWitness.test.js`); an
    // unwitnessed timeframe holds nothing
    expect(heldFetchOf('SPX', 'M')).toEqual({ symbol: 'SPX', tf: 'D', key: 'SPX@D' })
    expect(heldFetchOf('SPX', '60')).toEqual({ symbol: 'SPX', tf: '60', key: 'SPX' })
    expect(heldFetchOf('SPX', '240')).toEqual({ symbol: 'SPX', tf: '240', key: 'SPX' })
    expect(heldFetchOf('SPX', '120')).toBe(null)
  })

  it('the chart asks /api/bars at D, seven calendar days a week deep plus two weeks, capped at the index door\'s 12,500', async () => {
    const asked = []
    const fetcher = (url) => { asked.push(url); return Promise.resolve({ bars: [] }) }
    const map = ensureChartSources(['SPX@D', `${SEED_KEY}@D`, 'QQQ'], 'W', 300, fetcher)
    expect([...map.keys()].sort()).toEqual(['QQQ', `${SEED_KEY}@D`, 'SPX@D'].sort())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(asked.sort()).toEqual([
      `/api/bars/${encodeURIComponent('QQQ')}?tf=W&bars=300`,
      `/api/bars/${encodeURIComponent(SEED_KEY)}?tf=D&bars=${300 * 7 + 14}`,
      '/api/bars/SPX?tf=D&bars=2114',
    ].sort())
    expect(heldDepthOf(5000)).toBe(12500)
  })

  it('the headless door files a held key the same way: the RS line computes on a weekly series from DAILY rows', () => {
    const def = rsDef()
    const out = computeHeadless(def, WEEKLY, { tf: 'W', symbol: ctxW().symbol, historyFromListing: true,
      otherBars: { SPX: SPX_D, [SEED_KEY]: SEED_D } })
    expect(out.refusal || null).toBe(null)
    const line = out.outputs.find((o) => o.key === 'value').values
    WEEKLY.forEach((b, i) => expect(same(line[i], (b.c / previousWeekClose(b.t)) * 2940), b.t).toBe(true))
  })
})

describe('a DAILY chart is untouched', () => {
  it('the rows carry a weekly block and nothing else moved: on D the series is the daily read, under the plain key', () => {
    const rows = requestWitnessRows()
    // ⭐ L13 adds M, ⭐ L12 the intraday timeframes, ⭐ e98 the 4h one (each its own block)
    expect(rows['SP:SPX'].timeframes).toEqual(['D', 'W', 'M', '1', '5', '15', '30', '60', '240'])
    expect(rows['SP:SPX'].alignment).toBe('previous-session')
    const def = { compute: { kind: 'ast', ast: { type: 'sym', value: 'SPX', args: [{ type: 'series', name: 'close' }] } },
      meta: { recurrenceOrigin: 'pine', otherSymbols: [{ ticker: 'SPX', spellings: ['SP'] }] } }
    const secondary = new Map([['SPX', { bars: SPX_D, status: 'available' }]])
    const r = resolveOtherSymbols(def, { tf: 'D', secondary, exchangeOf: () => null, symbol: { ticker: 'AGL', exchange: 'NYSE' } })
    expect(Object.keys(r)).toEqual(['symbols', 'served', 'refused'])
    expect(r.symbols.SPX).toEqual(witnessedBarsOf(rows['SP:SPX'], SPX_D))
    expect(otherSymbolsSignature(def, secondary, 'D')).toBe(otherSymbolsSignature(def, secondary))
    // ⛔ and the weekly fold reaches no daily chart: the held key is never asked for there
    const heldOnly = resolveOtherSymbols(def, { tf: 'D', secondary: held(), exchangeOf: () => null, symbol: { ticker: 'AGL', exchange: 'NYSE' } })
    expect(heldOnly.served).toEqual([])
    expect(heldOnly.refused[0].code).toBe(R.NO_BARS)
  })
})

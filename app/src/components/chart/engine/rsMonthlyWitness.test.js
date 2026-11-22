// ─── ⭐⭐ RS RATING L13 (Q-RS-M) — SP:SPX AND THE RS SEED ON A MONTHLY CHART, HELD AT "D" ─────────────────
//
// The rules (`requestWitnesses.json` `periods.M`, witnessed on the rs-monthly-2026-11-18c captures, NYSE:RDDT 1M
// 33 months and NASDAQ:NVDA 1M 335; graded against them by `__tests__/vendorHarness/vendorHarness.l13MonthlyWitness.test.js`):
//   R1  SP:SPX at `timeframe.period`: each month reads the PREVIOUS month's last daily close (`previous-month`), in the
//       host lane (Fred RS's RS line: close / that × 4200 × 80 / 100) and in the run alike;
//   R2  SP:SPX at "D": each month reads the previous-session-aligned daily bar at its LAST session (`month-last-row`),
//       and the FORMING month the newest SPX row, which that read places on its NEXT session (`belowChartSeriesOf`);
//   R3  this chart's own symbol at "D": the month's last daily close, which IS the monthly close (32 of 32 RDDT months),
//       a bare `close` only;
//   R4  the seed at "D": the row dated the month's FIRST SESSION, `na` where there is none (`month-first-session`).
// Both series are FETCHED AND HELD AT "D" under their held keys (`SPX@D`), 31 calendar days a month deep.
// Fixtures in the SHAPE the server answers with (synthetic values, no vendor data): monthly chart bars keyed by
// their month's 1st (`bars_fetch._resample_monthly_iso`), SPX daily rows by the session's UTC midnight in unix
// seconds, seed rows by ISO calendar day. Sessions from the one exchange calendar (`sessionCalendar.js`).
// ⭐ A DAILY chart is untouched (its series and its enumerable rows are what they were).
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
  periodSampleOf, belowChartSeriesOf, previousMonthBarsOf, SERIES_NEWEST_UNPLACED, WITNESS_PERIOD_READS as READS,
} from './otherSymbols'
import { symbolsNeeded } from './sourceRef'
import { ensureChartSources } from './useSecondarySources'
import { clearSecondaryBars } from './secondaryBars'
import { isTradingDay } from '../../../lib/marketClock/sessionCalendar.js'
import WITNESSES from './requestWitnesses.json'

vi.setConfig({ testTimeout: 120000 })

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const SEED_KEY = 'SEED_FRED6725_RS_RATING:RSRATING'
const TODAY = '2026-11-17'
const utc = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000
const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
const firstOf = (iso) => `${iso.slice(0, 8)}01`
const prevFirst = (first) => firstOf(isoPlus(first, -1))

const SESSIONS = (() => {
  const out = []
  for (let d = '2024-01-02'; d <= TODAY; d = isoPlus(d, 1)) if (isTradingDay(d)) out.push(d)
  return out
})()
const dailyClose = (i) => 80 + 20 * Math.sin(i / 17) + i * 0.05
/** The chart's MONTHLY bars as `/api/bars/<T>?tf=M` serves them: keyed by the month's 1st, the close the month's
 *  last daily close; the newest month (2026-11-02..17) forming. */
const MONTHLY = (() => {
  const by = new Map()
  SESSIONS.forEach((s, i) => {
    const f = firstOf(s)
    const c = dailyClose(i)
    const m = by.get(f)
    if (!m) by.set(f, { t: f, o: c - 0.3, h: c + 1, l: c - 1, c, v: 1e6 })
    else { m.h = Math.max(m.h, c + 1); m.l = Math.min(m.l, c - 1); m.c = c; m.v += 1e6 }
  })
  return [...by.values()]
})()
const spxClose = (i) => 5400 + 300 * Math.sin(i / 41) + i * 3
const SPX_D = SESSIONS.map((s, i) => ({ t: utc(s), o: spxClose(i) - 5, h: spxClose(i) + 20, l: spxClose(i) - 22, c: spxClose(i), v: 3e9 }))
/** The seed's rows as served: calendar days 2026-10-13 .. 2026-11-16, a new value every day (so Sunday 2026-11-01
 *  and Monday 2026-11-02 differ, the pair R4 tells apart). */
const SEED_D = (() => {
  const out = []
  let k = 0
  for (let d = '2026-10-13'; d <= '2026-11-16'; d = isoPlus(d, 1), k += 1) out.push({ t: d, o: 0, h: 1000, l: 0, c: 200 - 3 * k, v: 0 })
  return out
})()

const spxByDay = new Map(SPX_D.map((b) => [new Date(b.t * 1000).toISOString().slice(0, 10), b]))
const spxDays = [...spxByDay.keys()]
/** R1 from the rows: the last SPX daily close of the calendar month BEFORE this bar's. */
const previousMonthClose = (first) => {
  const days = spxDays.filter((d) => firstOf(d) === prevFirst(first))
  return days.length ? spxByDay.get(days[days.length - 1]).c : NaN
}
/** R2 from the rows: the SPX bar of the session BEFORE this month's last session. */
const monthLastPreviousSession = (first, field = 'c') => {
  const last = spxDays.filter((d) => firstOf(d) === first).pop()
  const k = spxDays.indexOf(last)
  return k > 0 ? spxByDay.get(spxDays[k - 1])[field] : NaN
}
const firstSession = (first) => { let d = first; while (!isTradingDay(d)) d = isoPlus(d, 1); return d }
/** R4 from the rows: the seed row dated this month's first session, else `na`. */
const seedFirstSession = (first) => {
  const row = SEED_D.find((r) => r.t === firstSession(first))
  return row ? row.c : NaN
}

const held = (spx = SPX_D, seed = SEED_D, spxOver = {}) => new Map([
  ['SPX@D', { bars: spx, status: 'available', ...spxOver }], [`${SEED_KEY}@D`, { bars: seed, status: 'available' }]])
const ctxM = (secondary = held(), over = {}) => ({
  tf: 'M', newestBarIsForming: true, historyFromListing: true,
  symbol: { ticker: 'AGL', exchange: 'NYSE', industry: 'Medical Care Facilities', sector: 'Healthcare', securityType: 'stock' },
  secondary, exchangeOf: (t) => (t === 'SPX' ? 'SP' : null), ...over,
})
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
const pine = (lines) => ['//@version=5', 'indicator("l13", overlay = false)', ...lines].join('\n')
const runDef = (source, keys) => ({
  id: 'u_l13-run', compute: { kind: 'runtime', fn: 'runtime:u_l13-run', rev: 1, source, objects: true,
    outputs: Object.fromEntries(keys.map((k, i) => [k, i])) },
  inputs: [], meta: { runtimeHistory: 'listing' },
})
const run = (source, keys, ctx = ctxM()) => computeRuntimeColumns(runDef(source, keys), MONTHLY, ctx, { now: () => 0 })
const LAST = MONTHLY.length - 1

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
  it('monthly bars keyed by the 1st, SPX by UTC-midnight seconds, the seed by ISO day; November forming', () => {
    expect(MONTHLY.every((b) => b.t.endsWith('-01'))).toBe(true)
    expect(MONTHLY[LAST].t).toBe('2026-11-01')
    expect(SPX_D[SPX_D.length - 1].t).toBe(utc(TODAY))
    expect(firstSession('2026-11-01')).toBe('2026-11-02')        // a Sunday 1st
    expect(firstSession('2025-09-01')).toBe('2025-09-02')        // Labor Day on the 1st
    expect(firstSession('2026-01-01')).toBe('2026-01-02')        // New Year's Day
  })
})

describe('R1 — SP:SPX at `timeframe.period` on a monthly chart reads the PREVIOUS month\'s last daily close', () => {
  it('host lane, through the member door: every month', () => {
    const d = memberPaneDefinition({ source: pine(['plot(request.security("SP:SPX", timeframe.period, close), "spx")']),
      id: 'u_l13-r1', name: 'r1' })
    expect(d.ok, d.reason).toBe(true)
    const def = install(d.definition)
    const cols = registry.computeFor(def, MONTHLY, {}, ctxM())
    expect(Object.values(registry.columnErrors(cols))).toEqual([])
    const col = cols[Object.keys(cols)[0]]
    MONTHLY.forEach((b, i) => expect(same(col[i], previousMonthClose(b.t)), `${b.t}: ${col[i]} vs ${previousMonthClose(b.t)}`).toBe(true))
    // the forming month (a fresh load, the index session not on) reads October's last close, as TradingView did
    expect(col[LAST]).toBe(spxByDay.get('2026-10-30').c)
  })

  it('Fred RS\'s RS line on a monthly chart: close / R1 × (4200 × 80 / 100) on every month (TradingView: × 3360, 33 of 33 RDDT months)', () => {
    const def = install(memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_l13-rs' }).definition)
    const cols = registry.computeFor(def, MONTHLY, {}, ctxM())
    MONTHLY.forEach((b, i) => {
      const want = (b.c / previousMonthClose(b.t)) * 3360
      expect(same(cols.value[i], want), `${b.t}: ${cols.value[i]} vs ${want}`).toBe(true)
    })
  })

  it('in the run, the same read', () => {
    const cols = run(pine(['plot(request.security("SP:SPX", timeframe.period, close))']), ['x'])
    MONTHLY.forEach((b, i) => expect(same(cols.x[i], previousMonthClose(b.t)), b.t).toBe(true))
  })

  it('⭐ PR 2 — while the index session is on, the forming month reads its OWN month\'s latest close', () => {
    const cols = run(pine(['plot(request.security("SP:SPX", timeframe.period, close))']), ['x'],
      ctxM(held(SPX_D, SEED_D, { newestBarIsForming: true })))
    expect(cols.x[LAST]).toBe(spxByDay.get(TODAY).c)
    MONTHLY.slice(0, LAST).forEach((b, i) => expect(same(cols.x[i], previousMonthClose(b.t)), b.t).toBe(true))
  })
})

describe('R2 / R4 — a daily read below the monthly chart is the run\'s: the held daily series, sampled per month', () => {
  const SRC = pine([
    'x = request.security("SP:SPX", "D", close)',
    'xo = request.security("SP:SPX", "D", open)',
    's = request.seed("seed_fred6725_rs_rating", "RSRATING", close)',
    'plot(x)', 'plot(xo)', 'plot(s)', 'plot(na(s) ? 1 : 0)',
  ])

  it('R2: each settled month reads the previous-session bar at its LAST session; the forming month the newest row', () => {
    const cols = run(SRC, ['x', 'xo', 's', 'sna'])
    MONTHLY.forEach((b, i) => {
      const want = (f) => (i === LAST ? spxByDay.get(TODAY)[f] : monthLastPreviousSession(b.t, f))
      expect(same(cols.x[i], want('c')), `${b.t}: ${cols.x[i]}`).toBe(true)
      expect(same(cols.xo[i], want('o')), b.t).toBe(true)
    })
    // October 2026: its last session is 2026-10-30, so it reads 2026-10-29's bar
    expect(cols.x[MONTHLY.findIndex((b) => b.t === '2026-10-01')]).toBe(spxByDay.get('2026-10-29').c)
  })

  it('R4: each month reads the seed row of its FIRST SESSION; none reads `na`', () => {
    const cols = run(SRC, ['x', 'xo', 's', 'sna'])
    MONTHLY.forEach((b, i) => {
      expect(same(cols.s[i], seedFirstSession(b.t)), `${b.t}: ${cols.s[i]} vs ${seedFirstSession(b.t)}`).toBe(true)
      expect(cols.sna[i], b.t).toBe(Number.isNaN(seedFirstSession(b.t)) ? 1 : 0)
    })
    // November: Monday 2026-11-02's row, not Sunday 2026-11-01's (TradingView: 75, not 92.81)
    expect(cols.s[LAST]).toBe(SEED_D.find((r) => r.t === '2026-11-02').c)
    expect(cols.s[LAST]).not.toBe(SEED_D.find((r) => r.t === '2026-11-01').c)
    // October: its first session (2026-10-01) has no row; the series begins on the 13th
    expect(cols.s[MONTHLY.findIndex((b) => b.t === '2026-10-01')]).toBeNaN()
  })

  it('⛔ SP:SPX at a period the monthly block does not name ("W" on a monthly chart) is refused by name', () => {
    // a weekly read below a monthly chart is no merge the run reads: refused before any witness is asked
    expect(() => run(pine(['plot(request.security("SP:SPX", "W", close))']), ['x']))
      .toThrow(/reads the `W` timeframe on a `M` chart; the run reads another timeframe only as a weekly or monthly merge above the chart's own/)
  })

  it('⛔ a monthly block without its witness is pending: refused by name, citing Q-RS-M', () => {
    const rows = JSON.parse(JSON.stringify(WITNESSES.rows))
    delete rows['SP:SPX'].periods.M.witness
    setRequestWitnessRows(rows)
    expect(() => run(SRC, ['x', 'xo', 's', 'sna'])).toThrow(/served only once a TradingView capture witnesses it there \(capture-queue row Q-RS-M/)
  })
})

describe('the samples and the newest row, read directly', () => {
  it('month-first-session reads the first SESSION\'s row (Labor Day on the 1st: the 2nd), month-last-row the last row', () => {
    const series = [{ t: '2025-09-01', c: 1 }, { t: '2025-09-02', c: 2 }, { t: '2025-09-30', c: 3 }, { t: '2025-10-01', c: 4 }]
    const chart = [{ t: '2025-09-01' }, { t: '2025-10-01' }]
    expect(periodSampleOf(series, chart, READS.MONTH_FIRST_SESSION).index).toEqual([1, 3])
    expect(periodSampleOf(series, chart, READS.MONTH_LAST_ROW).index).toEqual([2, 3])
    // a week's sample keeps its own rule (the Monday)
    expect(periodSampleOf(series, [{ t: '2025-09-05' }], READS.WEEK_FIRST_DAY).index).toEqual([0])
    // ⛔ a fold is no sample
    expect(Array.from(periodSampleOf(series, chart, READS.PREVIOUS_MONTH).withheld)).toEqual([1, 1])
  })

  it('the newest row is placed on its NEXT SESSION for a last-row sample only (Thanksgiving skipped), unseen by every other read', () => {
    const rows = requestWitnessRows()
    const spx = ['2026-11-23', '2026-11-24', '2026-11-25'].map((d, i) => ({ t: utc(d), o: 1, h: 2, l: 0, c: 10 + i, v: 0 }))
    const series = witnessedBarsOf(rows['SP:SPX'], spx)
    expect(series.map((b) => b.t)).toEqual(['2026-11-24', '2026-11-25'])           // the placement, as before
    expect(Object.keys(series)).toEqual(['0', '1'])                                  // nothing new enumerable
    expect(series[SERIES_NEWEST_UNPLACED].c).toBe(12)
    const below = belowChartSeriesOf(series, READS.MONTH_LAST_ROW)
    expect(below.map((b) => [b.t, b.c])).toEqual([['2026-11-24', 10], ['2026-11-25', 11], ['2026-11-27', 12]])
    expect(belowChartSeriesOf(series, READS.WEEK_LAST_ROW).map((b) => b.t).pop()).toBe('2026-11-27')
    expect(belowChartSeriesOf(series, READS.MONTH_FIRST_SESSION)).toBe(series)
  })
})

describe('R3 — this chart\'s own symbol at "D" on a monthly chart: a bare `close`, the monthly close', () => {
  it('served as the identity on every month, the forming month included', () => {
    const cols = run(pine(['plot(request.security(syminfo.tickerid, "D", close))']), ['c'])
    MONTHLY.forEach((b, i) => expect(cols.c[i], b.t).toBe(b.c))
  })

  it('⛔ any other expression needs daily bars this chart does not hold: refused by name', () => {
    expect(() => run(pine(['plot(request.security(syminfo.tickerid, "D", open))']), ['o']))
      .toThrow(/reads this chart's own symbol at the `D` timeframe on a `M` chart/)
  })
})

describe('Fred RS\'s run half on a monthly chart, through the real door', () => {
  it('served: the two labels TradingView draws on 1M ("RS Rating" and the EMPTY rating text: the number is daily only)', () => {
    const def = install(memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_l13-rs-half' }).definition)
    const cols = registry.computeFor(def, MONTHLY, {}, ctxM())
    expect(runHalfOf(cols)).toEqual({ state: 'served', code: null })
    const labels = runtimeObjectsOf(cols).live.filter((o) => o.family === 'label' && o.createdBar === LAST)
    expect(labels.map((o) => o.props.text)).toEqual(['                RS Rating', ''])
    for (const l of labels) expect(l.props.y).toBe(cols.value[LAST])
  })
})

describe('the fetch: on a monthly chart SP:SPX and the seed are fetched at D, 31 days a month deep, under their held keys', () => {
  it('symbolsNeeded names the held keys on a monthly chart', () => {
    const def = memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_l13-fetch' }).definition
    const insts = [{ defId: def.id, instanceId: 'i1', inputs: {} }]
    expect(symbolsNeeded(insts, () => def, 'M')).toEqual([`${SEED_KEY}@D`, 'SPX@D'])
    expect(heldFetchOf('SPX', 'M')).toEqual({ symbol: 'SPX', tf: 'D', key: 'SPX@D' })
  })

  it('the chart asks /api/bars at D, 31 calendar days a month plus two months, capped at 12,500; a weekly chart as before', async () => {
    const asked = []
    const fetcher = (url) => { asked.push(url); return Promise.resolve({ bars: [] }) }
    ensureChartSources(['SPX@D', `${SEED_KEY}@D`], 'M', 300, fetcher)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(asked.sort()).toEqual([
      `/api/bars/${encodeURIComponent(SEED_KEY)}?tf=D&bars=${300 * 31 + 62}`,
      `/api/bars/SPX?tf=D&bars=${300 * 31 + 62}`,
    ].sort())
    expect(heldDepthOf(5000, 'M')).toBe(12500)
    expect(heldDepthOf(300, '1M')).toBe(9362)
    expect(heldDepthOf(300)).toBe(2114)          // the weekly default, unchanged
  })
})

describe('the monthly fold, read directly', () => {
  it('each month keyed on the FOLLOWING month\'s 1st (December rolls the year); the own month only while the session is on', () => {
    const d = [['2025-11-28', 1], ['2025-12-01', 2], ['2025-12-31', 3], ['2026-01-02', 4]]
      .map(([t, c]) => ({ t: utc(t), o: c, h: c, l: c, c, v: 1 }))
    expect(previousMonthBarsOf(d).map((b) => [b.t, b.c])).toEqual([['2025-12-01', 1], ['2026-01-01', 3], ['2026-02-01', 4]])
    expect(previousMonthBarsOf(d, { tf: 'M', key: '2026-01' }).map((b) => [b.t, b.c]))
      .toEqual([['2025-12-01', 1], ['2026-01-01', 4], ['2026-02-01', 4]])
  })
})

describe('a DAILY chart is untouched', () => {
  it('on D the series is the daily read, under the plain key, and its enumerable rows are exactly the placement', () => {
    const rows = requestWitnessRows()
    const def = { compute: { kind: 'ast', ast: { type: 'sym', value: 'SPX', args: [{ type: 'series', name: 'close' }] } },
      meta: { recurrenceOrigin: 'pine', otherSymbols: [{ ticker: 'SPX', spellings: ['SP'] }] } }
    const secondary = new Map([['SPX', { bars: SPX_D, status: 'available' }]])
    const r = resolveOtherSymbols(def, { tf: 'D', secondary, exchangeOf: () => null, symbol: { ticker: 'AGL', exchange: 'NYSE' } })
    expect(r.symbols.SPX).toEqual(witnessedBarsOf(rows['SP:SPX'], SPX_D))
    expect(r.symbols.SPX.length).toBe(SPX_D.length - 1)                  // the newest row still has no session to land on
    expect(JSON.parse(JSON.stringify(r.symbols.SPX)).length).toBe(SPX_D.length - 1)
  })
})

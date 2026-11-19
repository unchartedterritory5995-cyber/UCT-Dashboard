// ─── ⭐⭐ RS RATING L12 (Q-L12-1) — SP:SPX ON AN INTRADAY CHART: THE LATEST VALUE AT OR BEFORE EACH BAR ─────────────
//
// The rule (`requestWitnesses.json` `periods.<1|5|15|30|60>`, `latest-at-or-before`; witnessed on the local
// l12-pm / l12-is batches, Q-L12-1): SP:SPX at `timeframe.period` on an intraday chart reads, at each chart bar, the
// index's latest value at or before its open (Pine's `gaps_off`): in the regular session the index bar that opened at
// or before it (the same bar on a 5m grid, the 09:30 bar for a 10:00 bar on the hour-aligned 60m grid); before the
// open the PREVIOUS session's official close; from the close on the day's official close. So the index is held at the
// chart's timeframe AND at D (`SPX@D`, its official closes: an intraday bar's last print is the 15:59 trade, never the
// closing auction). Laid out on the chart's own extended-hours grid (`otherSymbols.js::atOrBeforeGridOf`), so both
// lanes read it by an exact bar time. A chart bar the held rows cannot answer is UNKNOWN (withheld), never `na`, never
// the last print repeated. The rating's daily reads (`"D"` on an intraday chart) are not this unit: refused by name.
// Fixtures in the shape the server answers with (synthetic values): intraday bars keyed by their open, unix seconds;
// the index's daily rows at the session's UTC midnight.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as registry from './nativeRegistry'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { runtimeColumnsFor, computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeWarmupOf } from './runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'
import {
  resolveOtherSymbols, requestWitnessRows, setRequestWitnessRows, heldFetchOf, heldFetchesOf, heldDepthOf,
  atOrBeforeGridOf, witnessedBarsOf, OTHER_SYMBOL_REFUSAL as R,
} from './otherSymbols'
import { symAlignmentMask, SERIES_UNKNOWN_BEFORE_FIRST } from './ast/interpret'
import { symbolsNeeded } from './sourceRef'
import { clearSecondaryBars } from './secondaryBars'
import WITNESSES from './requestWitnesses.json'

vi.setConfig({ testTimeout: 120000 })

// EST (UTC-5): 09:30 ET = 14:30Z. Day 1 Monday 2026-11-16, day 2 Tuesday 2026-11-17.
const ET = (day, hh, mm) => {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000
}
const D1 = '2026-11-16'
const D2 = '2026-11-17'
const FIVE = 300
const spxClose = (i) => Math.round((7300 + 10 * Math.sin(i / 7)) * 100) / 100
const rthTimes = (day, step) => Array.from({ length: 390 / step }, (_, k) => ET(day, 9, 30) + k * step * 60)
// The index holds only DAY 2's 5m bars (our store's depth) and no extended bar
const SPX_5 = rthTimes(D2, 5).map((t, i) => ({ t, o: spxClose(i) - 1, h: spxClose(i) + 2, l: spxClose(i) - 2, c: spxClose(i), v: 1e6 }))
const spxAt = new Map(SPX_5.map((b) => [b.t, b]))
// Its official daily closes (the closing auction: not the 15:55 bar's close)
const utcMid = (day) => Date.parse(`${day}T00:00:00Z`) / 1000
const SPX_D = [{ t: utcMid('2026-11-13'), o: 1, h: 1, l: 1, c: 7561.67, v: 1 }, { t: utcMid(D1), o: 1, h: 1, l: 1, c: 7416.59, v: 1 },
  { t: utcMid(D2), o: 1, h: 1, l: 1, c: 7340.53, v: 1 }]
// The chart: day 1's regular bars (before our depth), day 2's pre-market 08:00..09:25, regular, post 16:00..16:55
const PRE = Array.from({ length: 18 }, (_, k) => ET(D2, 8, 0) + k * FIVE)
const POST = Array.from({ length: 12 }, (_, k) => ET(D2, 16, 0) + k * FIVE)
const CHART_T = [...rthTimes(D1, 5), ...PRE, ...rthTimes(D2, 5), ...POST]
const CHART = CHART_T.map((t, i) => ({ t, o: 50 + i * 0.01, h: 50.5 + i * 0.01, l: 49.5 + i * 0.01, c: 50 + i * 0.01, v: 1000 }))
const expectAt = (t) => {
  if (spxAt.has(t)) return spxAt.get(t).c
  if (PRE.includes(t)) return 7416.59
  if (POST.includes(t)) return 7340.53
  return null // day 1: before our first index row
}

const secondaryOf = (intraday = SPX_5, daily = SPX_D, dailyForming = false) => new Map([
  ['SPX', { bars: intraday, status: 'available' }],
  ['SPX@D', { bars: daily, status: 'available', newestBarIsForming: dailyForming }]])
const ctx5 = (secondary = secondaryOf(), over = {}) => ({
  tf: '5', newestBarIsForming: false, historyFromListing: false,
  symbol: { ticker: 'AGL', exchange: 'NYSE', securityType: 'stock' },
  secondary, exchangeOf: (t) => (t === 'SPX' ? 'SP' : null), ...over,
})
const pine = (lines) => ['//@version=5', 'indicator("l12", overlay = false)', ...lines].join('\n')
const runDef = (source, keys) => ({
  id: 'u_l12-run', compute: { kind: 'runtime', fn: 'runtime:u_l12-run', rev: 1, source, objects: true,
    outputs: Object.fromEntries(keys.map((k, i) => [k, i])) },
  inputs: [], meta: { runtimeHistory: 'listing' },
})
const sym = { type: 'sym', value: 'SPX', args: [{ type: 'series', name: 'close' }] }
const symDef = { compute: { kind: 'ast', ast: sym }, meta: { recurrenceOrigin: 'pine', otherSymbols: [{ ticker: 'SPX', spellings: ['SP'] }] } }
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
})
afterEach(() => {
  for (const id of installed) registry.uninstallUserDefinition(id)
  installed = []
  setRequestWitnessRows(null)
  resetRuntimeSessions()
  resetRuntimeLedgers()
  clearSecondaryBars()
  vi.unstubAllEnvs()
})

describe('SP:SPX at timeframe.period on a 5m extended-hours chart: the latest value at or before each bar', () => {
  it('host lane: regular bars read the same bar, pre-market the previous official close, post-market the day\'s', () => {
    const d = memberPaneDefinition({ source: pine(['plot(request.security("SP:SPX", timeframe.period, close), "spx")']), id: 'u_l12-r1', name: 'r1' })
    expect(d.ok, d.reason).toBe(true)
    const def = install(d.definition)
    const cols = registry.computeFor(def, CHART, {}, ctx5())
    const col = cols[Object.keys(cols)[0]]
    CHART.forEach((b, i) => {
      const want = expectAt(b.t)
      if (want === null) expect(Number.isNaN(col[i]), `${b.t} is before our index depth: withheld`).toBe(true)
      else expect(col[i], `${b.t}`).toBe(want)
    })
    // ⭐ the official close, not the 15:55 bar's last print
    expect(col[CHART_T.indexOf(POST[0])]).not.toBe(SPX_5[SPX_5.length - 1].c)
  })

  it('the alignment mask names the bars before our first row UNKNOWN (withheld), not na; every grid bar is known', () => {
    const grid = atOrBeforeGridOf(SPX_5, SPX_D, '5')
    expect(grid[SERIES_UNKNOWN_BEFORE_FIRST]).toBe(true)
    const mask = symAlignmentMask(sym, CHART, { symbols: { SPX: grid } })
    expect(mask).not.toBe(null)
    CHART.forEach((b, i) => expect(mask[i], `${b.t}`).toBe(expectAt(b.t) === null ? 1 : 0))
    // ⛔ CONTROL: the same rows WITHOUT the marker read the bars before them as `na` (history not begun), not unknown
    const plain = symAlignmentMask(sym, CHART, { symbols: { SPX: grid.slice() } })
    expect(plain ? Array.from(plain.slice(0, 78)) : new Array(78).fill(0)).toEqual(new Array(78).fill(0))
  })

  it('⛔ a chart reaching BEFORE our index depth: the run refuses, and the sentence names the DEPTH (never "after its history began")', () => {
    // ⚰️ 2026-11-19: Fred RS's 5m bar 0 (2026-04-27) was refused "SPX has no bar on 1777276800, after its history
    // began", four months BEFORE our first SPX 5m row, and the cause was first misread as an extended-hours gap.
    const src = pine(['plot(request.security("SP:SPX", timeframe.period, close))'])
    let msg = ''
    try { computeRuntimeColumns(runDef(src, ['x']), CHART, ctx5(), { now: () => 0 }) } catch (e) { msg = String(e && e.message) }
    expect(msg).toMatch(/cannot be read on every bar/)
    expect(msg).toMatch(new RegExp(`this chart's history reaches ${CHART[0].t}, and the \`SPX\` bars we hold begin at \\d+`))
    expect(msg).not.toMatch(/after its history began/)
  })

  it('in the run, the same read: every bar from the listing; off it, every bar after the run’s own warm-up curtain', () => {
    const rows = [...PRE, ...rthTimes(D2, 5), ...POST].map((t, i) => ({ t, o: 50, h: 51, l: 49, c: 50 + i * 0.01, v: 1 }))
    const src = pine(['plot(request.security("SP:SPX", timeframe.period, close))'])
    const listed = computeRuntimeColumns(runDef(src, ['x']), rows, ctx5(undefined, { historyFromListing: true }), { now: () => 0 })
    rows.forEach((r, i) => expect(listed.x[i], `${r.t}`).toBe(expectAt(r.t)))
    // an intraday chart's history never reaches the listing: the run withholds its warm-up (two starts agreeing),
    // and reads the same value on every bar after it
    resetRuntimeSessions()
    const off = computeRuntimeColumns(runDef(src, ['x']), rows, ctx5(), { now: () => 0 })
    const warm = runtimeWarmupOf(off)
    const from = warm && Number.isInteger(warm.withheldBars) ? warm.withheldBars : 0
    expect(from).toBeLessThan(rows.length / 2)
    rows.forEach((r, i) => {
      if (i < from) expect(Number.isNaN(off.x[i]), `${r.t} inside the warm-up curtain`).toBe(true)
      else expect(off.x[i], `${r.t}`).toBe(expectAt(r.t))
    })
  })

  it('Fred RS-style line: close / SP:SPX x k on every bar the held rows answer', () => {
    const d = memberPaneDefinition({ source: pine(['plot(close / request.security("SP:SPX", timeframe.period, close) * 3360, "rs")']), id: 'u_l12-rs', name: 'rs' })
    const def = install(d.definition)
    const cols = registry.computeFor(def, CHART, {}, ctx5())
    const col = cols[Object.keys(cols)[0]]
    let n = 0
    CHART.forEach((b, i) => {
      const want = expectAt(b.t)
      if (want !== null) { n += 1; expect(Math.abs(col[i] - (b.c / want) * 3360)).toBeLessThan(1e-9) }
    })
    expect(n).toBe(18 + 78 + 12)
  })
})

describe('the grid (`atOrBeforeGridOf`)', () => {
  it('an hour-aligned 60m chart reads the hourly index bar that OPENED at or before each bar (the 09:30 bar at 10:00)', () => {
    const spx60 = [0, 1, 2, 3, 4, 5, 6].map((k) => ({ t: ET(D2, 9, 30) + k * 3600, o: 1, h: 2, l: 0, c: 7300 + k, v: 1 }))
    const byT = new Map(atOrBeforeGridOf(spx60, SPX_D, '60').map((r) => [r.t, r.c]))
    expect(byT.get(ET(D2, 9, 0))).toBe(7416.59)      // 09:00 opens before the session: the previous close
    expect(byT.get(ET(D2, 10, 0))).toBe(7300)        // the 09:30 bar
    expect(byT.get(ET(D2, 15, 0))).toBe(7305)        // the 14:30 bar
    expect(byT.get(ET(D2, 16, 0))).toBe(7340.53)     // the day's official close
    expect(byT.get(ET(D2, 19, 0))).toBe(7340.53)
    expect(byT.has(ET(D2, 20, 0))).toBe(false)       // the grid ends with the extended session
  })

  it('⛔ a stale copy withholds: no row past the newest index bar\'s own period (never its last print repeated)', () => {
    const stale = SPX_5.filter((b) => b.t <= ET(D2, 10, 10))
    const byT = new Map(atOrBeforeGridOf(stale, SPX_D.slice(0, 2), '5').map((r) => [r.t, r.c]))
    expect(byT.get(ET(D2, 10, 10))).toBe(spxAt.get(ET(D2, 10, 10)).c)
    expect(byT.has(ET(D2, 10, 15))).toBe(false)
    expect(byT.has(ET(D2, 16, 0))).toBe(false)       // and no close of day 2 is held: no post-market row
  })

  it('⛔ the newest daily row of a session in progress is not a close: no post-market row from it', () => {
    const byT = new Map(atOrBeforeGridOf(SPX_5, SPX_D, '5', { dailyForming: true }).map((r) => [r.t, r.c]))
    expect(byT.has(ET(D2, 16, 0))).toBe(false)
    expect(byT.get(ET(D2, 8, 0))).toBe(7416.59)      // the previous close is settled
  })

  it('a half-day closes at 13:00: its post-market rows read its close from 13:00 (2026-11-27)', () => {
    const day = '2026-11-27'
    const s = [0, 1].map((k) => ({ t: ET(day, 9, 30) + k * FIVE, o: 1, h: 1, l: 1, c: 7000 + k, v: 1 }))
    const daily = [...SPX_D, { t: utcMid('2026-11-25'), o: 1, h: 1, l: 1, c: 7100, v: 1 }, { t: utcMid(day), o: 1, h: 1, l: 1, c: 7200, v: 1 }]
    const byT = new Map(atOrBeforeGridOf(s, daily, '5').map((r) => [r.t, r.c]))
    expect(byT.get(ET(day, 13, 0))).toBe(7200)
    expect(byT.get(ET(day, 8, 0))).toBe(7100)        // Thanksgiving is no session: the previous one is 11-25
  })
})

describe('which intraday timeframes are served, and what the chart fetches', () => {
  it('1, 5, 15, 30 and 60 are all witnessed; a timeframe with no block refuses by name', () => {
    const rows = requestWitnessRows()
    for (const tf of ['1', '5', '15', '30', '60']) {
      expect(heldFetchOf('SPX', tf), tf).toEqual({ symbol: 'SPX', tf, key: 'SPX' })
      // ⭐ L12 PR 2 — and its daily read above the chart (U-DAILY, `rsIntradayDaily.test.js`)
      expect(rows['SP:SPX'].periods[tf].reads).toEqual({ period: 'latest-at-or-before', D: 'session-completed' })
      expect(rows['SP:SPX'].periods[tf].alsoHeld).toBe('D')
      expect(rows['SP:SPX'].periods[tf].witness, tf).toMatch(/2026-11-18/)
    }
    for (const tf of ['3', '45', '120', '240']) {
      expect(heldFetchOf('SPX', tf), tf).toBe(null)
      const r = resolveOtherSymbols(symDef, { ...ctx5(), tf })
      expect(r.served, tf).toEqual([])
      expect(r.refused[0].code, tf).toBe(R.WITNESS_TIMEFRAME)
    }
  })

  it('an intraday chart holds SPX at its own timeframe AND at D; a weekly chart at D only; a daily chart nothing', () => {
    expect(heldFetchesOf('SPX', '5')).toEqual([{ symbol: 'SPX', tf: '5', key: 'SPX' }, { symbol: 'SPX', tf: 'D', key: 'SPX@D' }])
    expect(heldFetchesOf('SPX', 'W')).toEqual([{ symbol: 'SPX', tf: 'D', key: 'SPX@D' }])
    expect(heldFetchesOf('SPX', 'D')).toEqual([])
    const def = memberPaneDefinition({ source: pine(['plot(request.security("SP:SPX", timeframe.period, close))']), id: 'u_l12-f', name: 'f' }).definition
    expect(symbolsNeeded([{ defId: def.id, instanceId: 'i1', inputs: {} }], () => def, '5')).toEqual(['SPX', 'SPX@D'])
    // the daily rows a 5,000-bar 5m chart spans (390 regular minutes a session: the deeper answer), plus ten
    expect(heldDepthOf(5000, '5')).toBe(Math.ceil((5000 * 5) / 390) + 10)
    expect(heldDepthOf(5000, '60')).toBe(Math.ceil((5000 * 60) / 390) + 10)
  })

  it('⛔ without the daily rows the read is pending by name, never drawn from the intraday bars alone', () => {
    const r = resolveOtherSymbols(symDef, ctx5(new Map([['SPX', { bars: SPX_5, status: 'available' }]])))
    expect(r.served).toEqual([])
    expect(r.refused[0].code).toBe(R.NO_BARS)
    expect(r.refused[0].reason).toMatch(/daily rows/)
    expect(r.refused[0].pending).toBe(true)
  })

  it('⭐ L12 PR 2 — a "D" read on an intraday chart is handed the daily rows keyed by session, unplaced (the run places them)', () => {
    const def = { compute: { kind: 'ast', ast: { type: 'sym', value: 'SPX', args: [{ type: 'num', value: 0 }] } },
      meta: { recurrenceOrigin: 'pine', otherSymbols: [{ ticker: 'SPX', spellings: ['SP'] }] } }
    const r = resolveOtherSymbols(def, { ...ctx5(), requestCode: 'D' })
    expect(r.served).toEqual(['SPX'])
    expect(r.samples.SPX).toBe('session-completed')
    expect(r.symbols.SPX.map((b) => [b.t, b.c])).toEqual(SPX_D.map((b) => [new Date(b.t * 1000).toISOString().slice(0, 10), b.c]))
    // ⛔ a read at another code is still refused by name
    const w = resolveOtherSymbols(def, { ...ctx5(), requestCode: 'W' })
    expect(w.served).toEqual([])
    expect(w.refused[0].code).toBe(R.WITNESS_TIMEFRAME)
  })
})

describe('a daily chart is untouched', () => {
  it('the daily read is the row\'s own previous-session placement, as before', () => {
    const rows = requestWitnessRows()
    const r = resolveOtherSymbols(symDef, { tf: 'D', secondary: new Map([['SPX', { bars: SPX_D, status: 'available' }]]), exchangeOf: () => null, symbol: { ticker: 'AGL', exchange: 'NYSE' } })
    expect(r.symbols.SPX).toEqual(witnessedBarsOf(rows['SP:SPX'], SPX_D))
    expect(WITNESSES.rows['SP:SPX'].alignment).toBe('previous-session')
  })
})

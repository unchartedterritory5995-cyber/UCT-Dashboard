// ─── ⭐⭐ RS RATING L12 PR 2 (Q-L12-2 / Q-L12-3) — THE RS SEED ON AN INTRADAY CHART ─────────────────────────────────
//
// TradingView's `request.seed('seed_fred6725_rs_rating', 'RSRATING', close)` on NYSE:RDDT 1 / 5 / 15 / 30 / 60m
// (`l12-now-2026-11-18`, `l12-seed3-now-2026-11-18`, extended-hours charts): each row, dated D, is read on the FIRST
// chart bar opening at or after D 00:00 UTC; several rows on one bar, the NEWEST; every other bar `na`. Every graded
// bar matched, values and na; "the oldest wins" is off on the 2 weekend bars (`requestWitnesses.json`, the seed row's
// intraday blocks; `otherSymbols.js::utcMidnightAtOrAfterOf`). A seed is served daily only, so on an intraday chart
// it is HELD at D (`<store>@D`) and folded onto the chart's OWN bars, never onto a grid.
// Fixtures (synthetic values, the server's shapes): a 5m extended-hours chart over the end of daylight saving time
// (2026-11-01), the seed's rows as calendar days.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from './runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'
import {
  utcMidnightAtOrAfterOf, periodBlockServes, heldFetchesOf, resolveOtherSymbols, withChartNewestDay,
  setRequestWitnessRows, OTHER_SYMBOL_REFUSAL as R,
} from './otherSymbols'
import { SERIES_GAPS_READ_NA } from './ast/interpret'
import { clearSecondaryBars } from './secondaryBars'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as registry from './nativeRegistry'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { runtimeColumnsFor } from './runtime/runtimeColumns'
import { runHalfOf, runtimeObjectsOf } from './runtime/runtimeObjects'
import { runtimeSourceHash } from './runtimeKill'
import { setRunHalfObjectEvidence } from './runHalfRailSeam'
import { OWN_DAILY_KEY } from './otherSymbols'

vi.setConfig({ testTimeout: 120000 })

const STORE = 'SEED_FRED6725_RS_RATING:RSRATING'
const HELD = `${STORE}@D`
// ET wall clock -> unix seconds: EDT (UTC-4) before 2026-11-01, EST (UTC-5) from it
const ET = (day, hh, mm) => {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d, hh + (day < '2026-11-01' ? 4 : 5), mm) / 1000
}
const slab = (day, hh, mm, n) => Array.from({ length: n }, (_, k) => ET(day, hh, mm) + k * 300)
// Thu 10-29 and Fri 10-30 (EDT), Mon 11-02 and Tue 11-03 (EST); ⛔ Tue 11-03 has NO 19:00 bar
const TIMES = [
  ...slab('2026-10-29', 4, 0, 4), ...slab('2026-10-29', 9, 30, 4), ...slab('2026-10-29', 18, 55, 5),
  ...slab('2026-10-30', 4, 0, 4), ...slab('2026-10-30', 9, 30, 4), ...slab('2026-10-30', 18, 55, 5),
  ...slab('2026-11-02', 4, 0, 4), ...slab('2026-11-02', 9, 30, 4), ...slab('2026-11-02', 18, 55, 5),
  ...slab('2026-11-03', 4, 0, 4), ...slab('2026-11-03', 9, 30, 4), ET('2026-11-03', 18, 55), ...slab('2026-11-03', 19, 5, 3),
]
const ROWS = TIMES.map((t, i) => ({ t, o: 50, h: 51, l: 49, c: 50 + i * 0.01, v: 1 }))
const DAYS = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']
const SEED = DAYS.map((d, k) => ({ t: d, o: 0, h: 1000, l: 0, c: 100 + k, v: 0 }))
const seedC = (day) => SEED.find((r) => r.t === day).c
// where each row lands (the witnessed rule, worked by hand):
const WANT = new Map([
  [ET('2026-10-29', 4, 0), seedC('2026-10-29')],  // EDT: D 00:00Z is the previous evening's 20:00, past the session: D's 04:00
  [ET('2026-10-30', 4, 0), seedC('2026-10-30')],
  [ET('2026-11-02', 4, 0), seedC('2026-11-02')],  // Sat, Sun (Fri / Sat 20:00 EDT, Sat 19:00 EST) and Mon: the NEWEST
  [ET('2026-11-02', 19, 0), seedC('2026-11-03')], // EST: D 00:00Z is the previous session's 19:00 bar
  [ET('2026-11-03', 19, 5), seedC('2026-11-04')], // no 19:00 bar: the next one
])
// 10-28's row (10-27 20:00 EDT) landed before this chart's first bar; 11-05's (11-04 19:00) after its newest

const ctxOf = (over = {}) => ({
  tf: '5', newestBarIsForming: false, historyFromListing: true,
  symbol: { ticker: 'RDDT', exchange: 'NYSE', securityType: 'stock' },
  secondary: new Map([[HELD, { bars: SEED, status: 'available' }]]),
  exchangeOf: () => null, ...over,
})
const pine = (lines) => ['//@version=5', 'indicator("seed5", overlay = false)', ...lines].join('\n')
const runDef = (source, keys) => ({
  id: 'u_seed-intraday', compute: { kind: 'runtime', fn: 'runtime:u_seed-intraday', rev: 1, source, objects: true,
    outputs: Object.fromEntries(keys.map((k, i) => [k, i])) },
  inputs: [], meta: { runtimeHistory: 'listing' },
})
const run = (lines, keys, ctx = ctxOf(), rows = ROWS) => computeRuntimeColumns(runDef(pine(lines), keys), rows, ctx, { now: () => 0 })
const SEED_SRC = ['s = request.seed("seed_fred6725_rs_rating", "RSRATING", close)', 'plot(s)', 'plot(na(s) ? 1 : 0)']
const seedDef = () => ({
  compute: { kind: 'ast', ast: { type: 'sym', value: 'RSRATING', args: [{ type: 'num', value: 0 }] } },
  meta: { recurrenceOrigin: 'pine', otherSymbols: [{ ticker: 'RSRATING', spellings: ['SEED_FRED6725_RS_RATING'] }] },
})

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
})
afterEach(() => {
  setRequestWitnessRows(null)
  resetRuntimeSessions()
  resetRuntimeLedgers()
  clearSecondaryBars()
  vi.unstubAllEnvs()
})

describe('the fold: each row on the first chart bar at or after its date\'s 00:00 UTC, the newest wins, na elsewhere', () => {
  it('lands every row where the witness put it, on the chart\'s own bars', () => {
    const out = utcMidnightAtOrAfterOf(SEED, { bars: ROWS, tf: '5' })
    expect(out[SERIES_GAPS_READ_NA]).toBe(true)                       // the gaps are known na, never withheld
    expect(out.map((r) => [r.t, r.c])).toEqual([...WANT.entries()])
  })

  it('⛔ several rows on one bar: the NEWEST (the weekend bar reads Monday\'s row, not Saturday\'s)', () => {
    const out = utcMidnightAtOrAfterOf(SEED, { bars: ROWS, tf: '5' })
    const mon = out.find((r) => r.t === ET('2026-11-02', 4, 0))
    expect(mon.c).toBe(seedC('2026-11-02'))
    expect(mon.c).not.toBe(seedC('2026-10-31'))
  })

  it('⭐ the chart\'s first bar: a row after the grid slot before it lands there; one at or before it does not', () => {
    // a chart opening at 10-29 09:30: 10-29's row (10-28 20:00 EDT) landed on 04:00, a bar before this chart's first
    const late = ROWS.filter((r) => r.t >= ET('2026-10-29', 9, 30))
    expect(utcMidnightAtOrAfterOf(SEED, { bars: late, tf: '5' }).some((r) => r.t === late[0].t)).toBe(false)
    // a chart opening on a Monday's 04:00 bar: the weekend's rows and Monday's landed there (after Friday's 19:55)
    const mon = ROWS.filter((r) => r.t >= ET('2026-11-02', 4, 0))
    expect(utcMidnightAtOrAfterOf(SEED, { bars: mon, tf: '5' })[0]).toMatchObject({ t: mon[0].t, c: seedC('2026-11-02') })
  })

  it('⛔ not handed the chart\'s bars, or bars out of order: null, never a guessed grid', () => {
    expect(utcMidnightAtOrAfterOf(SEED, null)).toBe(null)
    expect(utcMidnightAtOrAfterOf(SEED, { bars: ROWS, tf: 'D' })).toBe(null)
    expect(utcMidnightAtOrAfterOf(SEED, { bars: [ROWS[1], ROWS[0]], tf: '5' })).toBe(null)
  })
})

describe('the block: a series held at D alone, the second shape an intraday timeframe takes', () => {
  // `request.seed` IS `request.security(<seed>, "D", …)` (`pine.js::seedAsSecurity`): the block names its read AT D
  const block = (over = {}) => ({ held: 'D', reads: { D: 'utc-midnight-at-or-after' }, witness: 'w', captured: 'c', ...over })
  it('served on every intraday timeframe; not on a weekly chart; never another read; never with a second held series', () => {
    for (const tf of ['1', '5', '15', '30', '60']) expect(periodBlockServes(block(), tf), tf).toBe(true)
    expect(periodBlockServes(block(), 'W')).toBe(false)
    // ⛔ e98 — a 4h chart serves SP:SPX (Q-FRED-4H), but no capture witnesses a seed there: no seed shape on 240
    expect(periodBlockServes(block(), '240')).toBe(false)
    expect(periodBlockServes(block({ reads: { D: 'latest-at-or-before' } }), '5')).toBe(false)
    expect(periodBlockServes(block({ reads: { period: 'utc-midnight-at-or-after' } }), '5')).toBe(false)
    expect(periodBlockServes(block({ alsoHeld: 'D' }), '5')).toBe(false)
    expect(periodBlockServes(block({ witness: '' }), '5')).toBe(false)
  })

  it('the committed seed row: fetched at D only, under its held key', () => {
    for (const tf of ['1', '5', '15', '30', '60']) {
      expect(heldFetchesOf(STORE, tf), tf).toEqual([{ symbol: STORE, tf: 'D', key: HELD }])
    }
    expect(heldFetchesOf(STORE, '240')).toEqual([])
  })
})

describe('the bind and the run', () => {
  it('the bind folds onto the chart\'s bars it is handed; ⛔ not handed them: refused by name', () => {
    const ok = resolveOtherSymbols(seedDef(), withChartNewestDay(ctxOf(), ROWS))
    expect(ok.served).toEqual(['RSRATING'])
    expect(ok.symbols.RSRATING.map((r) => r.t)).toEqual([...WANT.keys()])
    const bare = resolveOtherSymbols(seedDef(), ctxOf())
    expect(bare.refused[0]).toMatchObject({ ticker: 'RSRATING', code: R.WITNESS_TIMEFRAME })
    expect(bare.refused[0].reason).toMatch(/not handed the chart's bars/)
  })

  it('in the run: the row on its landing bar, `na` (known, nothing withheld) on every other', () => {
    const cols = run(SEED_SRC, ['s', 'sna'])
    ROWS.forEach((r, i) => {
      const want = WANT.has(r.t) ? WANT.get(r.t) : NaN
      if (Number.isNaN(want)) {
        expect(cols.s[i], `${r.t}`).toBeNaN()
        expect(cols.sna[i], `${r.t}`).toBe(1)
      } else {
        expect(cols.s[i], `${r.t}`).toBe(want)
        expect(cols.sna[i], `${r.t}`).toBe(0)
      }
    })
  })

  it('⛔ the seed\'s rows not in hand: pending while loading, never drawn', () => {
    const loading = ctxOf({ secondary: new Map([[HELD, { bars: [], status: 'loading' }]]) })
    expect(() => run(SEED_SRC, ['s', 'sna'], loading)).toThrow(/pending|loading|not in hand/i)
  })
})

// ─── Fred RS's run half on a 5m extended-hours chart, through the real door ────────────────────────────────────────
// Ten EST sessions (2026-11-02 .. 11-13), every 5-minute slot 04:00..19:55 ET; SP:SPX's regular-session 5m bars and
// daily closes (L12 PR 1), this chart symbol's daily rows (`OWN~D`) and the seed's rows (the real series' calendar
// span, 10-13 .. 11-16). TradingView on NYSE:RDDT 5m / 60m (`l12-now-2026-11-18`): the label "RS Rating" and an EMPTY
// rating text at the RS line (the number prints only on a daily chart; the seed's loop finds fewer than 7 values).
const RS = fs.readFileSync(path.join(path.resolve(process.cwd(), '..'), 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
const SESS = []
for (let d = '2026-11-02'; d <= '2026-11-13'; d = isoPlus(d, 1)) if (![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) SESS.push(d)
const CHART = SESS.flatMap((d, k) => Array.from({ length: 192 }, (_, j) => {
  const t = ET(d, 4, 0) + j * 300
  const c = 90 + k + Math.sin(j / 9)
  return { t, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 }
}))
const SPX5 = SESS.flatMap((d, k) => Array.from({ length: 78 }, (_, j) => {
  const c = 7300 + k * 5 + Math.cos(j / 7) * 3
  return { t: ET(d, 9, 30) + j * 300, o: c, h: c + 1, l: c - 1, c, v: 1 }
}))
const PREV = '2026-10-30'
const SPXD = [PREV, ...SESS].map((d, k) => ({ t: Date.parse(`${d}T00:00:00Z`) / 1000, o: 1, h: 1, l: 1, c: 7290 + k * 5, v: 1 }))
const OWND = [PREV, ...SESS].map((d, k) => ({ t: d, o: 1, h: 1, l: 1, c: 89 + k, v: 1 }))
const SEED_REAL = []
for (let d = '2026-10-13', k = 0; d <= '2026-11-16'; d = isoPlus(d, 1), k += 1) SEED_REAL.push({ t: d, o: 0, h: 1000, l: 0, c: [190.9, 123.49, 75, 39.88, 12.98, 5, 2][Math.floor(k / 5) % 7], v: 0 })
const held5 = (seed = SEED_REAL) => new Map([
  ['SPX', { bars: SPX5, status: 'available' }], ['SPX@D', { bars: SPXD, status: 'available' }],
  [OWN_DAILY_KEY, { bars: OWND, status: 'available' }],
  ...(seed ? [[HELD, { bars: seed, status: 'available' }]] : []),
])
const ctx5 = (secondary = held5()) => ({
  tf: '5', newestBarIsForming: false, historyFromListing: true,
  // Fred RS reads `syminfo.industry` / `syminfo.sector` (its watermark row): the binding settles them
  symbol: { ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Content & Information', sector: 'Communication Services', securityType: 'stock' },
  secondary, exchangeOf: (t) => (t === 'SPX' ? 'SP' : null),
})

describe('Fred RS\'s run half on a 5m chart, through the real door', () => {
  let installed = []
  const install = (def) => {
    const { installed: got, errors } = registry.installUserDefinitions([def])
    expect(got.length, errors.join(' | ')).toBe(1)
    installed.push(got[0].id)
    return got[0]
  }
  beforeEach(() => {
    registry.registerRuntimeLane(runtimeColumnsFor)
    setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(RS), captures: [
      { capture: 'a', verdict: 'MATCH', objectsV2: true, runtimeOn: true },
      { capture: 'b', verdict: 'MATCH', objectsV2: true, runtimeOn: true }] }])
  })
  afterEach(() => {
    for (const id of installed) registry.uninstallUserDefinition(id)
    installed = []
    setRunHalfObjectEvidence([])
  })

  it('served: "RS Rating" and the empty rating text on the newest bar, at the RS line', () => {
    const def = install(memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_l12-seed-half' }).definition)
    const cols = registry.computeFor(def, CHART, {}, withChartNewestDay(ctx5(), CHART))
    expect(runHalfOf(cols)).toEqual({ state: 'served', code: null })
    const n = CHART.length
    const labels = runtimeObjectsOf(cols).live.filter((o) => o.family === 'label' && o.createdBar === n - 1)
    expect(labels.map((o) => o.props.text)).toEqual(['                RS Rating', ''])
    for (const l of labels) expect(l.props.y).toBe(cols.value[n - 1])
  })

  it('⛔ CONTROL: the seed not held, the run half is not served (the RS line still is: it reads no seed)', () => {
    const def = install(memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_l12-seed-none' }).definition)
    const cols = registry.computeFor(def, CHART, {}, withChartNewestDay(ctx5(held5(null)), CHART))
    expect(runHalfOf(cols).state).not.toBe('served')
  })
})

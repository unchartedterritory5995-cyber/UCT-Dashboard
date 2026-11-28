// ─── ⭐⭐ (2026-11-28) — A DEEP INDEX STORE NEVER STOPS FRED RS ON AN INTRADAY CHART ─────────────────────────────────────
//
// ⚰️ CAPTURED (production, the runtime worker's own replies, 2026-11-28 00:5xZ, smoke@ on a UCT slot): every deep intraday
// Fred RS run half was refused `runtime:limit`, "this script went past the number of bars a script may be drawn over (at
// most 32,768, it reached 96,406)", on SPY 15m (30,396 rows), SPY 5m (20,158 / 26,158) and AGL 30m (23,410): no rating
// heading, no new-high dot. SP:SPX reaches an intraday chart laid on the chart's extended-hours grid
// (`otherSymbols.js::atOrBeforeGridOf`), and that grid was laid over our store's WHOLE depth (SP:SPX 15m, 39,012 rows,
// about six years: 64 slots a session), so the request's series was three times the chart. The chart never reads a grid
// row before its own first bar (`interpret.js` `sym` is an exact `t` match), so the grid now starts there (`from`).
// These rails hold: the grid from the chart's first bar is the same rows, byte for byte, as the whole grid there; and the
// product path at the owner's preset draws on a 15m chart whose index store is deeper than the run's ceiling.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from './nativeRegistry'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { resetRuntimeSessions, resetRuntimeLedgers, runtimeColumnsFor, setRuntimeRunner, __barCapOffForTests, setRuntimeDoorClock, computeRuntimeColumns } from './runtime/runtimeColumns'
import { runtimeWarmupOf } from './runtime/runtimeObjects'
import { runHalfOf, RUNTIME_OBJECTS_KEY } from './runtime/runtimeObjects'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'
import { __admitEveryRunHalfForTests, __resetRunHalfAdmissionForTests } from './runHalfRailSeam'
import { clearSecondaryBars } from './secondaryBars'
import { OWN_DAILY_KEY, atOrBeforeGridOf } from './otherSymbols'
import { isTradingDay, closeTime } from '../../../lib/marketClock/sessionCalendar'
import { DEFAULT_LIMITS, runBarCapCut, RUN_BAR_CAP_STEP, RUN_BAR_CAP_CODE } from './runtime/limits'
import { isStartFreeDot } from './runtime/startLatched'

vi.setConfig({ testTimeout: 300000 })

const RS = fs.readFileSync(path.join(path.resolve(process.cwd(), '..'), 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const OWNER = Object.freeze({ SpxValue: 7200, offset: 90, rsNewHigh: 'Historical RS New Highs', lookback: 30 })
const SPY = Object.freeze({ ticker: 'SPY', exchange: 'AMEX', industry: 'Investment Trusts/Mutual Funds', sector: 'Miscellaneous',
  securityType: 'etf' })
const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 86400000).toISOString().slice(0, 10)

// the index's store: 15m regular-session bars of every NYSE session from 2024-01-02 to 2026-11-25, as the route serves
// them (unix seconds), and its daily rows (UTC midnight of the session date)
const DAYS = []
for (let d = '2024-01-02'; d <= '2026-11-25'; d = isoPlus(d, 1)) if (isTradingDay(d)) DAYS.push(d)
const SPX15 = []
const SPXD = []
DAYS.forEach((d, k) => {
  const close = closeTime(d).getTime() / 1000
  const open = close - (close - Date.parse(`${d}T00:00:00Z`) / 1000 > 20 * 3600 ? 6.5 : 3.5) * 3600
  let c = 4800 + k * 2
  for (let t = open; t < close; t += 900) { c += Math.sin(t / 7000); SPX15.push({ t, o: c, h: c + 1, l: c - 1, c, v: 1 }) }
  SPXD.push({ t: Date.parse(`${d}T00:00:00Z`) / 1000, o: c, h: c + 1, l: c - 1, c, v: 1 })
})
const FULL = atOrBeforeGridOf(SPX15, SPXD, '15')
// the chart: SPY's extended-hours 15m bars over its last 60 sessions (the grid's own slots, which is the chart's grid)
const FROM = Date.parse(`${DAYS[DAYS.length - 60]}T00:00:00Z`) / 1000
// (ending with the last session held: the grid also lays the NEXT session's pre-market from the last close)
const END = Date.parse(`${isoPlus(DAYS[DAYS.length - 1], 1)}T05:00:00Z`) / 1000
const CHART = FULL.filter((r) => r.t >= FROM && r.t < END).map((r, i) => { const c = 500 + i * 0.02 + Math.sin(i / 11); return { t: r.t, o: c, h: c + 0.3, l: c - 0.3, c, v: 1000 } })
const OWND = SPXD.map((r, k) => ({ t: new Date(r.t * 1000).toISOString().slice(0, 10), o: 1, h: 1, l: 1, c: 400 + k * 0.1, v: 1 }))
const SEED = OWND.map((r, k) => ({ t: r.t, o: 0, h: 1000, l: 0, c: [190.9, 123.49, 75, 39.88, 12.98, 5, 2][Math.floor(k / 5) % 7], v: 0 }))

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1'); vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests(); setRuntimeKillList([]); __admitEveryRunHalfForTests()
  registry.registerRuntimeLane(runtimeColumnsFor)
})
afterEach(() => {
  __barCapOffForTests(false); setRuntimeDoorClock(null); __resetRunHalfAdmissionForTests(); setRuntimeRunner(null); resetRuntimeSessions(); resetRuntimeLedgers(); clearSecondaryBars()
  vi.unstubAllEnvs()
})

describe('the grid from the chart\'s first bar', () => {
  it('the fixture: the whole grid is past the run\'s ceiling, the chart well inside it', () => {
    expect(FULL.length).toBeGreaterThan(DEFAULT_LIMITS.HISTORY)
    expect(CHART.length).toBeLessThan(DEFAULT_LIMITS.HISTORY / 4)
  })
  it('is the same rows, byte for byte, as the whole grid from the newest row before the chart on', () => {
    const from = CHART[0].t
    const cut = atOrBeforeGridOf(SPX15, SPXD, '15', { from })
    expect(cut.length).toBeLessThan(FULL.length)
    const k = FULL.findIndex((r) => r.t >= from)
    expect(k).toBeGreaterThan(0)
    // the one row before the chart: where the series' rows begin, so a missing chart bar stays a hole
    expect(cut[0].t).toBeLessThan(from)
    expect(JSON.stringify(cut)).toBe(JSON.stringify(FULL.slice(k - 1)))
  })
  it('a grid that ends before the chart begins keeps its newest row (every chart bar is the tail it was)', () => {
    const cut = atOrBeforeGridOf(SPX15, SPXD, '15', { from: FULL[FULL.length - 1].t + 86400 * 30 })
    expect(JSON.stringify(cut)).toBe(JSON.stringify([FULL[FULL.length - 1]]))
  })
})

describe("the product path: Fred RS at the owner's preset on a 15m chart over a deep index store", () => {
  it('SERVED (was: refused runtime:limit): the line, the heading and the dots', () => {
    const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_deep-index' }).definition))
    const { installed, errors } = registry.installUserDefinitions([stored])
    expect(installed.length, errors.join(' | ')).toBe(1)
    const def = installed[0]
    try {
      const manifest = (def.compute && def.compute.paramManifest) || {}
      const inputs = {}
      for (const [name, v] of Object.entries(OWNER)) {
        const spec = def.inputs.find((x) => x && (x.key === name || (x.fromParam && manifest[x.fromParam]
          && manifest[x.fromParam].sourceName === name)))
        inputs[spec.key] = v
      }
      const secondary = new Map([['SPX', { bars: SPX15, status: 'available', newestBarIsForming: false }],
        ['SPX@D', { bars: SPXD, status: 'available', newestBarIsForming: false }],
        [OWN_DAILY_KEY, { bars: OWND, status: 'available', newestBarIsForming: false }],
        ['SEED_FRED6725_RS_RATING:RSRATING@D', { bars: SEED, status: 'available' }]])
      const cols = registry.computeFor(def, CHART, inputs, { tf: '15', newestBarIsForming: false, historyFromListing: false,
        symbol: SPY, secondary, exchangeOf: (t) => (t === 'SPX' ? 'SP' : null) })
      const rh = runHalfOf(cols)
      expect(`${rh && rh.state}:${rh && rh.code}`).toBe('served:null')
      const p = cols[RUNTIME_OBJECTS_KEY]
      expect(p.status).toBe('ok')
      expect(p.live.some((o) => o.props && o.props.text === '                RS Rating')).toBe(true)
      expect(p.live.some(isStartFreeDot)).toBe(true)
    } finally { registry.uninstallUserDefinition(def.id) }
  })
})

// ─── ⭐⭐ (owner, 2026-11-28) — A CHART LONGER THAN THE RUN'S CEILING IS COMPUTED ON ITS NEWEST BARS ─────────────────────
// ⚰️ CAPTURED (production, 2026-11-28): AGL 30m loads 40,000-52,000 bars, and every run over it was refused at bar 0
// (`runtime:limit`, HISTORY 32,768). TradingView computes a script on the bars it has loaded; so does this run now.
const CEIL = DEFAULT_LIMITS.HISTORY
const LONG = FULL.filter((r) => r.t < END).slice(-(CEIL + 500)).map((r, i) => { const c = 500 + i * 0.002 + Math.sin(i / 11); return { t: r.t, o: c, h: c + 0.3, l: c - 0.3, c, v: 1000 } })
/** Fred RS's run half at the owner's preset over `rows` (15m), through the product path. The pane's clock is held still:
 *  these rails measure the bar ceiling, never how fast this machine runs 33,000 bars in one thread. */
function fredOn(rows, id) {
  setRuntimeDoorClock(() => 0)
  const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: RS, name: 'Fred RS', id }).definition))
  const { installed, errors } = registry.installUserDefinitions([stored])
  expect(installed.length, errors.join(' | ')).toBe(1)
  const def = installed[0]
  try {
    const manifest = (def.compute && def.compute.paramManifest) || {}
    const inputs = {}
    for (const [name, v] of Object.entries(OWNER)) {
      const spec = def.inputs.find((x) => x && (x.key === name || (x.fromParam && manifest[x.fromParam] && manifest[x.fromParam].sourceName === name)))
      inputs[spec.key] = v
    }
    const secondary = new Map([['SPX', { bars: SPX15, status: 'available', newestBarIsForming: false }],
      ['SPX@D', { bars: SPXD, status: 'available', newestBarIsForming: false }],
      [OWN_DAILY_KEY, { bars: OWND, status: 'available', newestBarIsForming: false }],
      ['SEED_FRED6725_RS_RATING:RSRATING@D', { bars: SEED, status: 'available' }]])
    return registry.computeFor(def, rows, inputs, { tf: '15', newestBarIsForming: false, historyFromListing: false,
      symbol: SPY, secondary, exchangeOf: (t) => (t === 'SPX' ? 'SP' : null) })
  } finally { registry.uninstallUserDefinition(def.id) }
}

describe("the run's bar cap", () => {
  it('a run over the ceiling or fewer bars is not moved; past it, it starts in whole steps and covers at most the ceiling', () => {
    expect(runBarCapCut(CEIL)).toBe(0)
    expect(runBarCapCut(100)).toBe(0)
    for (const n of [CEIL + 1, CEIL + 500, CEIL + RUN_BAR_CAP_STEP, 46000, 51891, 200000]) {
      const cut = runBarCapCut(n)
      expect(cut % RUN_BAR_CAP_STEP, `n=${n}`).toBe(0)
      expect(n - cut, `n=${n}`).toBeLessThanOrEqual(CEIL)
      expect(n - cut, `n=${n}`).toBeGreaterThan(CEIL - RUN_BAR_CAP_STEP)
    }
    // a chart growing a bar at a time keeps its start for a whole step (its run resumes)
    expect(runBarCapCut(CEIL + 1)).toBe(runBarCapCut(CEIL + RUN_BAR_CAP_STEP))
  })
  it('the grid never holds more rows than a run covers: the oldest go', () => {
    const capped = atOrBeforeGridOf(SPX15, SPXD, '15', { maxRows: 1000 })
    expect(JSON.stringify(capped)).toBe(JSON.stringify(FULL.slice(-1000)))
  })
  it("SERVED (was: refused runtime:limit at bar 0): Fred RS at the owner's preset on a 15m chart past the ceiling", () => {
    expect(LONG.length).toBeGreaterThan(CEIL)
    const cols = fredOn(LONG, 'u_bar-cap')
    const rh = runHalfOf(cols)
    expect(`${rh && rh.state}:${rh && rh.code}`).toBe('served:null')
    const p = cols[RUNTIME_OBJECTS_KEY]
    expect(p.live.some((o) => o.props && o.props.text === '                RS Rating')).toBe(true)
    expect(p.live.some(isStartFreeDot)).toBe(true)
    // drawn on the newest bars, the drawings in the CHART's bar indices
    for (const o of p.live) expect(o.createdBar).toBeGreaterThanOrEqual(runBarCapCut(LONG.length))
    expect(p.live.some((o) => o.createdBar === LONG.length - 1)).toBe(true)
  })
  it("SERVED on a SPARSE chart (AGL 30m's shape: half the extended-hours slots), its grid capped where the chart is not", () => {
    // every other slot of two-plus years: fewer bars than the ceiling, a grid over its span past it
    const sparse = FULL.filter((r) => r.t < END).filter((_, i) => i % 2 === 0)
      .map((r, i) => { const c = 500 + i * 0.002 + Math.sin(i / 11); return { t: r.t, o: c, h: c + 0.3, l: c - 0.3, c, v: 1000 } })
    expect(sparse.length).toBeLessThan(CEIL)
    expect(atOrBeforeGridOf(SPX15, SPXD, '15', { from: sparse[0].t }).length).toBeGreaterThan(CEIL)
    const cols = fredOn(sparse, 'u_bar-cap-sparse')
    const rh = runHalfOf(cols)
    expect(`${rh && rh.state}:${rh && rh.code}`).toBe('served:null')
    expect(cols[RUNTIME_OBJECTS_KEY].live.some((o) => o.props && o.props.text === '                RS Rating')).toBe(true)
  })
  // the run itself (no other-symbol grid: the row cap alone), as the run half's document is run
  const runDef = { id: 'u_bar-cap~run', compute: { kind: 'runtime', fn: 'runtime:u_bar-cap~run', rev: 1, source: RS, objects: true,
    outputs: { rs: 0 } }, inputs: [], meta: { runtimeHistory: 'listing' } }
  const runCtx = () => ({ tf: '15', newestBarIsForming: false, historyFromListing: false, symbol: SPY, runtimeInputs: OWNER,
    secondary: new Map([['SPX', { bars: SPX15, status: 'available', newestBarIsForming: false }],
      ['SPX@D', { bars: SPXD, status: 'available', newestBarIsForming: false }],
      [OWN_DAILY_KEY, { bars: OWND, status: 'available', newestBarIsForming: false }],
      ['SEED_FRED6725_RS_RATING:RSRATING@D', { bars: SEED, status: 'available' }]]),
    exchangeOf: (t) => (t === 'SPX' ? 'SP' : null) })
  it('the run over more bars than the ceiling starts at the cap, widened back, the bars before it named runtime:bar-cap', () => {
    const cut = runBarCapCut(LONG.length)
    const cols = computeRuntimeColumns(runDef, LONG, runCtx(), { now: () => 0 })
    expect(cols.rs.length).toBe(LONG.length)
    for (let i = 0; i < cut; i += 1) expect(Number.isNaN(cols.rs[i]), `bar ${i}`).toBe(true)
    expect(Number.isFinite(cols.rs[LONG.length - 1])).toBe(true)
    expect(runtimeWarmupOf(cols)).toMatchObject({ knownFrom: cut, knownFromCode: RUN_BAR_CAP_CODE })
    expect(runtimeWarmupOf(cols).withheldBars).toBeGreaterThanOrEqual(cut)
  })
  // a script that reads no other symbol: no grid moves its start, so the row cap alone decides it
  const PLAIN = ['//@version=5', 'indicator("bar cap")', 'plot(ta.sma(close, 3))'].join(String.fromCharCode(10))
  const plainDef = { id: 'u_bar-cap-plain', compute: { kind: 'runtime', fn: 'runtime:u_bar-cap-plain', rev: 1, source: PLAIN,
    outputs: { value: 0 } }, inputs: [], meta: {} }
  const plainCtx = { tf: '15', newestBarIsForming: false, historyFromListing: false, symbol: SPY }
  it('a script reading no other symbol: computed on the newest bars, the bars before them named runtime:bar-cap', () => {
    const cut = runBarCapCut(LONG.length)
    const cols = computeRuntimeColumns(plainDef, LONG, plainCtx, { now: () => 0 })
    const col = cols[Object.keys(cols)[0]]
    expect(col.length).toBe(LONG.length)
    expect(Number.isNaN(col[cut - 1])).toBe(true)
    expect(Number.isFinite(col[LONG.length - 1])).toBe(true)
    expect(runtimeWarmupOf(cols)).toMatchObject({ knownFrom: cut, knownFromCode: RUN_BAR_CAP_CODE })
  })
  it('⛔ CONTROL: the cap switched off, that script is stopped at bar 0, runtime:limit (HISTORY)', () => {
    __barCapOffForTests(true)
    let guard = null
    try { computeRuntimeColumns(plainDef, LONG, plainCtx, { now: () => 0 }) } catch (e) { guard = e && e.guard }
    expect(guard).toBe('runtime:limit')
  })
})

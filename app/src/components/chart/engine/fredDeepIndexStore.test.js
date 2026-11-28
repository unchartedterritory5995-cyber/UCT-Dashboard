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
import { resetRuntimeSessions, resetRuntimeLedgers, runtimeColumnsFor, setRuntimeRunner } from './runtime/runtimeColumns'
import { runHalfOf, RUNTIME_OBJECTS_KEY } from './runtime/runtimeObjects'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'
import { __admitEveryRunHalfForTests, __resetRunHalfAdmissionForTests } from './runHalfRailSeam'
import { clearSecondaryBars } from './secondaryBars'
import { OWN_DAILY_KEY, atOrBeforeGridOf } from './otherSymbols'
import { isTradingDay, closeTime } from '../../../lib/marketClock/sessionCalendar'
import { DEFAULT_LIMITS } from './runtime/limits'
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
  __resetRunHalfAdmissionForTests(); setRuntimeRunner(null); resetRuntimeSessions(); resetRuntimeLedgers(); clearSecondaryBars()
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

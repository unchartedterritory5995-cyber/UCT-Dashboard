// ─── ⭐⭐ (e103, coordinator ruling 2026-11-27) — FRED RS'S START-FREE DRAWINGS ON A CHART THAT DOES NOT START AT THE LISTING ──
//
// The off-listing curtain releases nothing (#2893): Fred RS's run half was refused whole (`runtime:history-start`) on
// every chart whose history does not reach the listing, so its new-high dot was never drawn there. The dot and the RS
// line are start-free past 252 + 250 bars; the rating label is not (`var float[] different_values` latches the first 7
// distinct seed values the run meets). These rails hold the release (`runtimeColumns.js::computeStartFree`,
// `runtime/startLatched.js`) to: the dots served, the rating labels withheld BY NAME (`runtime:start-latched-state`),
// every column `NaN` before the first start-free bar, and each of its four gates (the label filter, the defaults, the
// 502-bar floor, the script's identity) able to fail.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from './nativeRegistry'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeColumnsFor, setRuntimeRunner,
  setOffListingCurtainEnabled, __startFreeReleaseOffForTests, startFreeEligible,
} from './runtime/runtimeColumns'
import { runHalfOf, runtimeObjectsOf, runtimeWarmupOf, RUNTIME_OBJECTS_KEY } from './runtime/runtimeObjects'
import {
  RUNTIME_START_LATCHED_GUARD, START_LATCHED_REASON, FRED_RS_SOURCE_SHA256, START_FREE_MIN_BARS, START_FREE_FROM_BAR,
  isStartFreeDot,
} from './runtime/startLatched'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList, runtimeSourceHash } from './runtimeKill'
import { setRunHalfObjectEvidence } from './runHalfRailSeam'
import { clearSecondaryBars } from './secondaryBars'

vi.setConfig({ testTimeout: 300000 })

const RS = fs.readFileSync(path.join(path.resolve(process.cwd(), '..'), 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const SEED = 'SEED_FRED6725_RS_RATING:RSRATING'
const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
const weekdays = (from, count) => {
  const out = []
  for (let d = from; out.length < count; d = isoPlus(d, 1)) if (![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) out.push(d)
  return out
}
// a stock that keeps outrunning SPX: its RS line makes a new 250-bar high on the newest bar (the default dot)
const DAYS = weekdays('2023-01-02', 640)
const chartOf = (n) => DAYS.slice(0, n).map((t, i) => { const c = 50 + i * 0.1 + Math.sin(i / 9); return { t, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 } })
// SPX's daily rows as `/api/bars/SPX?tf=D` serves them: keyed by the session's UTC midnight in unix SECONDS
const SPX = DAYS.map((t, i) => { const c = 4000 + i * 0.5 + 20 * Math.cos(i / 13); return { t: Date.parse(`${t}T00:00:00Z`) / 1000, o: c, h: c + 1, l: c - 1, c, v: 1 } })
const SEED_ROWS = DAYS.map((t, k) => ({ t, o: 0, h: 1000, l: 0, c: [190.9, 123.49, 75, 39.88, 12.98, 5, 2][Math.floor(k / 5) % 7], v: 0 }))
const RDDT = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Content & Information',
  sector: 'Communication Services', securityType: 'stock' })
const ctxOf = (_rows, over = {}) => ({ tf: 'D', newestBarIsForming: false, historyFromListing: false, symbol: RDDT,
  secondary: new Map([['SPX', { bars: SPX, status: 'available' }], [SEED, { bars: SEED_ROWS, status: 'available' }]]),
  exchangeOf: (t) => (t === 'SPX' ? 'SP' : null), ...over })
// the run half's own document shape (`nativeRegistry.js::runHalfDefOf`)
const runDef = (source = RS) => ({ id: 'u_e103-fred~run', compute: { kind: 'runtime', fn: 'runtime:u_e103-fred~run', rev: 1,
  source, objects: true, outputs: { rs: 0 } }, inputs: [], meta: { runtimeHistory: 'listing' } })
const guardOf = (fn) => { try { fn(); return null } catch (e) { return (e && e.guard) || String(e && e.message) } }
const N = 600

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests(); setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
})
afterEach(() => {
  __startFreeReleaseOffForTests(false); setOffListingCurtainEnabled(false)
  setRuntimeRunner(null); setRunHalfObjectEvidence([]); setRuntimeKillList([])
  resetRuntimeSessions(); resetRuntimeLedgers(); clearSecondaryBars(); vi.unstubAllEnvs()
})

describe('the identity the release is keyed on', () => {
  it('Fred RS\'s committed source digests to the house indicator\'s sha256', () => {
    expect(runtimeSourceHash(RS)).toBe(FRED_RS_SOURCE_SHA256)
  })
  it('a dot is a circle label with no text on a start-free bar; a rating label is not', () => {
    const at = START_FREE_FROM_BAR
    expect(isStartFreeDot({ family: 'label', createdBar: at, props: { style: 'label.style_circle', text: '' } })).toBe(true)
    expect(isStartFreeDot({ family: 'label', createdBar: at, props: { style: 'label.style_circle', text: '99' } })).toBe(false)
    expect(isStartFreeDot({ family: 'label', createdBar: at, props: { style: 'label.style_label_center', text: '' } })).toBe(false)
    expect(isStartFreeDot({ family: 'label', createdBar: at - 1, props: { style: 'label.style_circle', text: '' } })).toBe(false)
    expect(isStartFreeDot({ family: 'line', createdBar: at, props: { style: 'label.style_circle' } })).toBe(false)
  })
})

describe('the run, off the listing: the dots served, the rating withheld by name', () => {
  it('SERVED: every column NaN before the first start-free bar, the warm-up recorded, only dots drawn, the labels named', () => {
    const rows = chartOf(N)
    const cols = computeRuntimeColumns(runDef(), rows, ctxOf(rows), { now: () => 0 })
    expect(cols.rs.length).toBe(N)
    for (let i = 0; i < N; i += 1) {
      if (i < START_FREE_FROM_BAR) expect(Number.isNaN(cols.rs[i]), `bar ${i}`).toBe(true)
      else expect(Number.isFinite(cols.rs[i]), `bar ${i}`).toBe(true)
    }
    expect(runtimeWarmupOf(cols)).toMatchObject({ withheldBars: START_FREE_FROM_BAR, startFree: RUNTIME_START_LATCHED_GUARD })
    const p = cols[RUNTIME_OBJECTS_KEY]
    expect(p.status).toBe('ok')
    // the newest bar's RS line is a new 250-bar high: the default dot stands there
    expect(p.live.length).toBeGreaterThanOrEqual(1)
    for (const o of p.live) expect(isStartFreeDot(o), JSON.stringify(o)).toBe(true)
    expect(p.live.some((o) => o.createdBar === N - 1)).toBe(true)
    // ⛔ the rating ("RS Rating" and the number) is never released off the listing
    expect(p.live.some((o) => typeof o.props.text === 'string' && o.props.text !== '')).toBe(false)
    expect(p.startLatched).toMatchObject({ guard: RUNTIME_START_LATCHED_GUARD, reason: START_LATCHED_REASON, count: 2 })
    expect(p.startLatched.sites.length).toBe(2)
    // never as a withheld FAMILY (one the host draws refuses the whole run half)
    expect(Object.keys(p.withheld || {})).not.toContain('label')
  })
  it('⛔ CONTROL: the same chart FROM the listing draws the rating labels, as before (the release is off-listing only)', () => {
    const rows = chartOf(N)
    const cols = computeRuntimeColumns(runDef(), rows, ctxOf(rows, { historyFromListing: true }), { now: () => 0 })
    const texts = runtimeObjectsOf(cols).live.filter((o) => o.createdBar === N - 1 && !isStartFreeDot(o))
      .map((o) => o.props.text)
    expect(texts[0]).toBe('                RS Rating')
    expect(cols[RUNTIME_OBJECTS_KEY].startLatched).toBeUndefined()
  })
  it('⛔ the curtain switched on (a rail) never releases the label either: the read-off rule answers first', () => {
    setOffListingCurtainEnabled(true)
    const rows = chartOf(N)
    const cols = computeRuntimeColumns(runDef(), rows, ctxOf(rows), { now: () => 0 })
    expect(runtimeObjectsOf(cols).live.every(isStartFreeDot)).toBe(true)
    expect(cols[RUNTIME_OBJECTS_KEY].startLatched.guard).toBe(RUNTIME_START_LATCHED_GUARD)
  })
})

describe('⛔ every gate refuses as before (`runtime:history-start`)', () => {
  it('a moved setting (any member input) is not the script as written', () => {
    const rows = chartOf(N)
    expect(guardOf(() => computeRuntimeColumns(runDef(), rows, ctxOf(rows, { runtimeInputs: { lookback: 100 } }), { now: () => 0 })))
      .toBe('runtime:history-start')
  })
  it(`a chart of ${START_FREE_MIN_BARS - 1} bars is refused; ${START_FREE_MIN_BARS} is served`, () => {
    const short = chartOf(START_FREE_MIN_BARS - 1)
    expect(guardOf(() => computeRuntimeColumns(runDef(), short, ctxOf(short), { now: () => 0 }))).toBe('runtime:history-start')
    const enough = chartOf(START_FREE_MIN_BARS)
    expect(guardOf(() => computeRuntimeColumns(runDef(), enough, ctxOf(enough), { now: () => 0 }))).toBe(null)
  })
  it('an edited script (one comment line) is another script', () => {
    const rows = chartOf(N)
    const edited = `${RS}\n// edited`
    expect(startFreeEligible(runDef(edited), rows, ctxOf(rows))).toBe(false)
    expect(guardOf(() => computeRuntimeColumns(runDef(edited), rows, ctxOf(rows), { now: () => 0 }))).toBe('runtime:history-start')
  })
  it('the release switched off: refused whole, as before e103', () => {
    __startFreeReleaseOffForTests(true)
    const rows = chartOf(N)
    expect(guardOf(() => computeRuntimeColumns(runDef(), rows, ctxOf(rows), { now: () => 0 }))).toBe('runtime:history-start')
  })
})

describe('the product path: Fred RS\'s run half on an off-listing daily chart', () => {
  let def = null
  beforeEach(() => {
    setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(RS), captures: [
      { capture: 'a', verdict: 'MATCH', objectsV2: true, runtimeOn: true },
      { capture: 'b', verdict: 'MATCH', objectsV2: true, runtimeOn: true }] }])
    const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_e103-fred' }).definition))
    const { installed, errors } = registry.installUserDefinitions([stored])
    expect(installed.length, errors.join(' | ')).toBe(1)
    def = installed[0]
  })
  afterEach(() => { if (def) registry.uninstallUserDefinition(def.id); def = null })
  it('SERVED (was: refused runtime:history-start): the dot drawn, the rating labels withheld by name', () => {
    const rows = chartOf(N)
    const cols = registry.computeFor(def, rows, {}, ctxOf(rows))
    const rh = runHalfOf(cols)
    expect(`${rh && rh.state}:${rh && rh.code}`).toBe('served:null')
    const p = cols[RUNTIME_OBJECTS_KEY]
    expect(p.live.length).toBeGreaterThanOrEqual(1)
    expect(p.live.every(isStartFreeDot)).toBe(true)
    expect(p.startLatched.guard).toBe(RUNTIME_START_LATCHED_GUARD)
  })
  it('⛔ a moved setting no drawing reads (the RS MA type): handed to the run, which is then refused, runtime:history-start', () => {
    expect((def.inputs || []).some((x) => x && x.key === 'typMa'), JSON.stringify((def.inputs || []).map((x) => x && x.key))).toBe(true)
    const rows = chartOf(N)
    const rh = runHalfOf(registry.computeFor(def, rows, { typMa: 'SMA' }, ctxOf(rows)))
    expect(`${rh && rh.state}:${rh && rh.code}`).toBe('refused:runtime:history-start')
  })
  it('⛔ a chart short of the floor: refused, runtime:history-start', () => {
    const rows = chartOf(START_FREE_MIN_BARS - 1)
    const rh = runHalfOf(registry.computeFor(def, rows, {}, ctxOf(rows)))
    expect(`${rh && rh.state}:${rh && rh.code}`).toBe('refused:runtime:history-start')
  })
})

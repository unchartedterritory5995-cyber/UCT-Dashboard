// ─── ⭐⭐ (the e81 live capture, 2026-11-19) — A CHART DEEPER THAN OUR DATA IS DRAWN FROM WHERE OUR DATA BEGINS ───
//
// ⚰️ CAPTURED on the served e81 build (smoke@, RDDT, the runtime worker's own messages, runs/wprobe-e81-live): every
// intraday chart's backfill reached far before the first SP:SPX row our store holds, and Fred RS's run half was refused
// whole ("a `request.security` (line 89) cannot be read on every bar — `SPX` has no bar on <the chart's first bar>…").
// A refusal that names ONLY such a depth gap now carries `knownFrom` (`requestSupply.js`), and `computeRuntimeColumns`
// runs from there under the off-listing two-start proof, widened back to the chart. These rails hold: the supply's
// `knownFrom`; the run served from it (NaN before, the same reads after, the record); a hole AFTER the series began
// still refusing; and Fred RS's run half SERVED through the REAL runtime worker on a 5m chart deeper than its SPX.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from './nativeRegistry'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeColumnsFor, setRuntimeRunner,
  onRuntimeColumnsLanded, RUNTIME_KNOWN_FROM_KEY,
} from './runtime/runtimeColumns'
import { runtimeRequestSupply } from './runtime/requestSupply'
import { buildRuntimeIr } from './ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from './runtime/lowerIr.js'
import { workerRunner, resetRuntimeAsync } from './runtime/runtimeAsync'
import { runHalfOf, runtimeObjectsOf, runtimeWarmupOf } from './runtime/runtimeObjects'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList, runtimeSourceHash } from './runtimeKill'
import { setRunHalfObjectEvidence } from './runHalfRailSeam'
import { OWN_DAILY_KEY } from './otherSymbols'
import { clearSecondaryBars } from './secondaryBars'

vi.setConfig({ testTimeout: 300000 })

// ── the L12 witness fixture (rsIntradayWitness.test.js): day 1's regular bars BEFORE our index depth ──
const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
const D1 = '2026-11-16'
const D2 = '2026-11-17'
const FIVE = 300
const spxClose = (i) => Math.round((7300 + 10 * Math.sin(i / 7)) * 100) / 100
const rthTimes = (day, step) => Array.from({ length: 390 / step }, (_, k) => ET(day, 9, 30) + k * step * 60)
const SPX_5 = rthTimes(D2, 5).map((t, i) => ({ t, o: spxClose(i) - 1, h: spxClose(i) + 2, l: spxClose(i) - 2, c: spxClose(i), v: 1e6 }))
const utcMid = (day) => Date.parse(`${day}T00:00:00Z`) / 1000
const SPX_D = [{ t: utcMid('2026-11-13'), o: 1, h: 1, l: 1, c: 7561.67, v: 1 }, { t: utcMid(D1), o: 1, h: 1, l: 1, c: 7416.59, v: 1 },
  { t: utcMid(D2), o: 1, h: 1, l: 1, c: 7340.53, v: 1 }]
const PRE = Array.from({ length: 18 }, (_, k) => ET(D2, 8, 0) + k * FIVE)
const POST = Array.from({ length: 12 }, (_, k) => ET(D2, 16, 0) + k * FIVE)
const CHART_T = [...rthTimes(D1, 5), ...PRE, ...rthTimes(D2, 5), ...POST]
const CHART = CHART_T.map((t, i) => ({ t, o: 50 + i * 0.01, h: 50.5 + i * 0.01, l: 49.5 + i * 0.01, c: 50 + i * 0.01, v: 1000 }))
const spxAt = new Map(SPX_5.map((b) => [b.t, b]))
const expectAt = (t) => (spxAt.has(t) ? spxAt.get(t).c : PRE.includes(t) ? 7416.59 : POST.includes(t) ? 7340.53 : null)
const secondaryOf = (intraday = SPX_5) => new Map([['SPX', { bars: intraday, status: 'available' }],
  ['SPX@D', { bars: SPX_D, status: 'available', newestBarIsForming: false }]])
const ctx5 = (over = {}) => ({ tf: '5', newestBarIsForming: false, historyFromListing: false,
  symbol: { ticker: 'AGL', exchange: 'NYSE', securityType: 'stock' }, secondary: secondaryOf(), exchangeOf: (t) => (t === 'SPX' ? 'SP' : null), ...over })
const pine = (lines) => ['//@version=5', 'indicator("kf", overlay = false)', ...lines].join('\n')
const SRC = pine(['plot(request.security("SP:SPX", timeframe.period, close))'])
const runDef = (source) => ({ id: 'u_kf-run', compute: { kind: 'runtime', fn: 'runtime:u_kf-run', rev: 1, source, objects: true, outputs: { x: 0 } },
  inputs: [], meta: { runtimeHistory: 'listing' } })
const DEPTH_STARTS_AT = rthTimes(D1, 5).length          // 78: the first chart bar our SPX grid answers (D2's pre-market)

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests(); setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
})
afterEach(() => {
  setRuntimeRunner(null); resetRuntimeAsync(); setRunHalfObjectEvidence([]); setRuntimeKillList([])
  resetRuntimeSessions(); resetRuntimeLedgers(); clearSecondaryBars(); vi.unstubAllEnvs(); vi.unstubAllGlobals()
})

describe('the supply names a DEPTH gap by where the reads become known', () => {
  const requestsOf = () => {
    const built = buildRuntimeIr(SRC, { bars: CHART, inputs: {}, tf: '5', basePeriod: '5', symbol: { ticker: 'AGL', exchange: 'NYSE' } })
    expect(built.ok, built.ok ? '' : built.refusal.message).toBe(true)
    return lowerIrProgram(built.ir).requests
  }
  it('a chart reaching before our SPX depth: refused for the whole chart, with knownFrom = the first bar our data answers', () => {
    const sup = runtimeRequestSupply(requestsOf(), CHART, ctx5())
    expect(sup.refusal).not.toBeNull()
    expect(sup.refusal.knownFrom).toBe(DEPTH_STARTS_AT)
  })
  it('⛔ CONTROL: a bar missing AFTER the series began is a hole, not a depth: no knownFrom', () => {
    const holed = SPX_5.filter((_, i) => i !== 40)
    const sup = runtimeRequestSupply(requestsOf(), CHART.slice(DEPTH_STARTS_AT), ctx5({ secondary: secondaryOf(holed) }))
    expect(sup.refusal).not.toBeNull()
    expect(sup.refusal.knownFrom).toBeUndefined()
  })
})

describe('the run starts where our data begins, under the two-start proof, widened back to the chart', () => {
  it('served: NaN before the depth, the latest-at-or-before read after the warm-up, the depth recorded', () => {
    const cols = computeRuntimeColumns(runDef(SRC), CHART, ctx5(), { now: () => 0 })
    expect(cols.x.length).toBe(CHART.length)
    const rec = cols[RUNTIME_KNOWN_FROM_KEY]
    expect(rec).toMatchObject({ knownFrom: DEPTH_STARTS_AT, firstKnownT: CHART[DEPTH_STARTS_AT].t })
    const warm = runtimeWarmupOf(cols)
    expect(warm.withheldBars).toBeGreaterThanOrEqual(DEPTH_STARTS_AT)
    for (let i = 0; i < CHART.length; i += 1) {
      if (i < warm.withheldBars) expect(Number.isNaN(cols.x[i]), `bar ${i} is before what our data can prove`).toBe(true)
      else expect(cols.x[i], `bar ${i}`).toBe(expectAt(CHART[i].t))
    }
  })
  it('⛔ CONTROL: the hole after the series began still refuses the run (nothing is guessed)', () => {
    const holed = SPX_5.filter((_, i) => i !== 40)
    let err = null
    try { computeRuntimeColumns(runDef(SRC), CHART, ctx5({ secondary: secondaryOf(holed) }), { now: () => 0 }) } catch (e) { err = e }
    expect(err, 'the run must refuse').not.toBeNull()
    expect(String(err.message)).toMatch(/cannot be read on every bar/)
    expect(err.knownFrom).toBeUndefined()
  })
})

// ── the product path: Fred RS's run half, through the REAL runtime worker, on a 5m chart deeper than its SPX ──
const RS = fs.readFileSync(path.join(path.resolve(process.cwd(), '..'), 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const HELD = 'SEED_FRED6725_RS_RATING:RSRATING@D'
const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
const SESS = []
for (let d = '2026-11-02'; d <= '2026-11-13'; d = isoPlus(d, 1)) if (![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) SESS.push(d)
const RS_CHART = SESS.flatMap((d, k) => Array.from({ length: 192 }, (_, j) => {
  const t = ET(d, 4, 0) + j * 300
  const c = 90 + k + Math.sin(j / 9)
  return { t, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 }
}))
// our store holds SPX's 5m bars from the FIFTH session on: the chart reaches four sessions deeper
const SPX5_LATE = SESS.slice(4).flatMap((d, k) => Array.from({ length: 78 }, (_, j) => {
  const c = 7300 + (k + 4) * 5 + Math.cos(j / 7) * 3
  return { t: ET(d, 9, 30) + j * 300, o: c, h: c + 1, l: c - 1, c, v: 1 }
}))
const PREV = '2026-10-30'
const SPXD = [PREV, ...SESS].map((d, k) => ({ t: Date.parse(`${d}T00:00:00Z`) / 1000, o: 1, h: 1, l: 1, c: 7290 + k * 5, v: 1 }))
const OWND = [PREV, ...SESS].map((d, k) => ({ t: d, o: 1, h: 1, l: 1, c: 89 + k, v: 1 }))
const SEED_REAL = []
for (let d = '2026-10-13', k = 0; d <= '2026-11-16'; d = isoPlus(d, 1), k += 1) SEED_REAL.push({ t: d, o: 0, h: 1000, l: 0, c: [190.9, 123.49, 75, 39.88, 12.98, 5, 2][Math.floor(k / 5) % 7], v: 0 })
// ⭐ AS THE CHART BUILDS IT: no chartBars / chartNewestDay pre-applied
const rsCtx = () => ({ tf: '5', newestBarIsForming: false, historyFromListing: false,
  symbol: { ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Content & Information', sector: 'Communication Services', securityType: 'stock' },
  secondary: new Map([['SPX', { bars: SPX5_LATE, status: 'available' }], ['SPX@D', { bars: SPXD, status: 'available' }],
    [OWN_DAILY_KEY, { bars: OWND, status: 'available' }], [HELD, { bars: SEED_REAL, status: 'available' }]]),
  exchangeOf: (t) => (t === 'SPX' ? 'SP' : null) })

const SELF = { postMessage: (m) => SELF.out.push(m), out: [] }
async function realWorkerFactory() {
  vi.stubGlobal('self', SELF)
  await import('./runtime/runtimeWorker.js')
  return () => ({
    postMessage(msg) {
      queueMicrotask(() => {
        SELF.out.length = 0
        SELF.onmessage({ data: structuredClone(msg) })
        this.onmessage({ data: structuredClone(SELF.out[0]) })
      })
    },
    terminate() {},
  })
}

describe('the product path: Fred RS\'s run half through the real runtime worker, on a 5m chart deeper than its SPX', () => {
  it('SERVED: "RS Rating" and the empty rating text on the newest bar (was: refused runtime:request, the whole chart)', async () => {
    setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(RS), captures: [
      { capture: 'a', verdict: 'MATCH', objectsV2: true, runtimeOn: true },
      { capture: 'b', verdict: 'MATCH', objectsV2: true, runtimeOn: true }] }])
    const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_kf-fred' }).definition))
    const { installed, errors } = registry.installUserDefinitions([stored])
    expect(installed.length, errors.join(' | ')).toBe(1)
    const def = installed[0]
    try {
      setRuntimeRunner(workerRunner(await realWorkerFactory()))
      let cols = null
      const states = []
      for (let pass = 0; pass < 8; pass += 1) {
        let landed = false
        const off = onRuntimeColumnsLanded(() => { landed = true })
        cols = registry.computeFor(def, RS_CHART, {}, rsCtx())
        const rh = runHalfOf(cols)
        states.push(rh ? `${rh.state}:${rh.code}` : 'none')
        for (let i = 0; i < 400 && !landed; i += 1) await new Promise((r) => setTimeout(r, 0))
        off()
        if (!landed) break
      }
      expect(states[states.length - 1], states.join(' > ')).toBe('served:null')
      const n = RS_CHART.length
      const labels = runtimeObjectsOf(cols).live.filter((o) => o.family === 'label' && o.createdBar === n - 1)
      expect(labels.map((o) => o.props.text)).toEqual(['                RS Rating', ''])
    } finally {
      registry.uninstallUserDefinition(def.id)
    }
  })
})

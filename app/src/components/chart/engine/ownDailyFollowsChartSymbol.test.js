// ─── ⭐⭐ RS RATING (2026-11-19, the e83 live capture) — THE CHART FETCHES ITS OWN DAILY ROWS FOR FRED RS ───
//
// ⚰️ CAPTURED on the served e83 build (smoke@, RDDT, the runtime worker's own messages, runs/e83-live): once SP:SPX was
// held as deep as the chart, every 5m / 30m / 1h run of Fred RS's run half was refused: "a `request.security` reads this
// chart's own symbol at the `D` timeframe above this `5` chart, and this run is not handed that symbol's daily bars".
// The worker request's `secondaryEntries` carried SPX, SPX@D and the seed, and NO `OWN_DAILY_KEY`.
// ⚰️ THE TEST OUTPUT THAT NAMED IT (a local probe of the real source, before any fix): `runtimeReadsOwnDaily(RS, '5')`
// was false, because the predicate built the script WITHOUT a symbol and Fred RS refused at its `syminfo.industry`
// branch (line 94, `interpret:bind-time-text`), so `ownDailyNeeded` said no and the chart never fetched the rows.
// These rails hold: the predicate asks with the chart's symbol binding; the PRODUCT PATH (the chart's own hook
// assembling the entries → the REAL runtime worker) hands `OWN_DAILY_KEY` and SERVES on 5m / 30m / 1h; and the
// DERIVATION: on every timeframe, every `request.security` site of the document reads an entry the chart fetches.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from './nativeRegistry'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import {
  resetRuntimeSessions, resetRuntimeLedgers, runtimeColumnsFor, setRuntimeRunner, onRuntimeColumnsLanded,
  runtimeReadsOwnDaily,
} from './runtime/runtimeColumns'
import { runtimeRequestSupply } from './runtime/requestSupply'
import { buildRuntimeIr } from './ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from './ast/pineRuntimeClock.js'
import { workerRunner, resetRuntimeAsync } from './runtime/runtimeAsync'
import { runHalfOf, runtimeObjectsOf } from './runtime/runtimeObjects'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList, runtimeSourceHash } from './runtimeKill'
import { setRunHalfObjectEvidence } from './runHalfRailSeam'
import { OWN_DAILY_KEY } from './otherSymbols'
import { clearSecondaryBars } from './secondaryBars'
import { useSecondarySources, ownDailyNeeded } from './useSecondarySources'

vi.setConfig({ testTimeout: 300000 })

const RS = fs.readFileSync(path.join(path.resolve(process.cwd(), '..'), 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const SEED = 'SEED_FRED6725_RS_RATING:RSRATING@D'
// the chart's symbol binding as StockChart builds it (`symbolMeta`: our store's ticker meta for RDDT)
const RDDT = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Content & Information',
  sector: 'Communication Services', securityType: 'Stock' })

// ── the data the store would answer, per (symbol, timeframe) ──
const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
const weekday = (iso) => ![0, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay())
const DAYS = []
for (let d = '2025-01-06'; d <= '2026-11-13'; d = isoPlus(d, 1)) if (weekday(d)) DAYS.push(d)
const SESS = DAYS.slice(-10)                                  // the intraday charts' ten sessions
const stepMin = (tf) => Number(tf)
const between = (day, h0, m0, h1, m1, s) => {
  const out = []
  for (let t = ET(day, h0, m0); t < ET(day, h1, m1); t += s * 60) out.push(t)
  return out
}
const bar = (t, c) => ({ t, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 })
// the chart: extended hours 04:00-20:00 ET; our SPX: regular hours, from the FIFTH session on (the chart reaches deeper)
const chartOf = (tf) => {
  if (tf === 'D') return DAYS.map((d, k) => bar(d, 90 + (k % 40) * 0.5))
  if (tf === 'W') return DAYS.filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 1).map((d, k) => bar(d, 90 + (k % 20)))
  return SESS.flatMap((d, k) => between(d, 4, 0, 20, 0, stepMin(tf)).map((t, j) => bar(t, 90 + k + Math.sin(j / 9))))
}
const spxIntraday = (tf) => SESS.slice(4).flatMap((d, k) => between(d, 9, 30, 16, 0, stepMin(tf))
  .map((t, j) => bar(t, 7300 + (k + 4) * 5 + Math.cos(j / 7) * 3)))
const DAILY = (base) => DAYS.map((d, k) => bar(d, base + k * 0.5))
const SEED_ROWS = DAYS.map((d, k) => ({ t: d, o: 0, h: 1000, l: 0, c: [190.9, 123.49, 75, 39.88, 12.98, 5, 2][Math.floor(k / 5) % 7], v: 0 }))

/** the store, by the URL the chart asks (`secondaryBarsUrl`); anything else is recorded and answered empty */
function storeFetcher(unknown) {
  return async (url) => {
    const u = new URL(String(url), 'https://x.test')
    const sym = decodeURIComponent(u.pathname.replace(/^\/api\/bars\//, ''))
    const tf = u.searchParams.get('tf')
    if (sym === 'SEED_FRED6725_RS_RATING:RSRATING' && tf === 'D') return { bars: SEED_ROWS }
    if (sym === 'SPX' && tf === 'D') return { bars: DAILY(7000) }
    if (sym === 'SPX' && tf === 'W') return { bars: chartOf('W').map((b) => ({ ...b, c: b.c + 7000 })) }
    if (sym === 'SPX') return { bars: spxIntraday(tf) }
    if (sym === 'RDDT' && tf === 'D') return { bars: DAILY(80) }
    unknown.push(String(url))
    return { bars: [] }
  }
}

const SELF = { postMessage: (m) => SELF.out.push(m), out: [] }
const handed = []                                             // each worker request's secondaryEntries keys
async function realWorkerFactory() {
  vi.stubGlobal('self', SELF)
  await import('./runtime/runtimeWorker.js')
  return () => ({
    postMessage(msg) {
      if (msg && msg.ctx && Array.isArray(msg.ctx.secondaryEntries)) handed.push(msg.ctx.secondaryEntries.map(([k]) => k))
      queueMicrotask(() => {
        SELF.out.length = 0
        SELF.onmessage({ data: structuredClone(msg) })
        this.onmessage({ data: structuredClone(SELF.out[0]) })
      })
    },
    terminate() {},
  })
}

let def = null
beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests(); setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
  setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(RS), captures: [
    { capture: 'a', verdict: 'MATCH', objectsV2: true, runtimeOn: true },
    { capture: 'b', verdict: 'MATCH', objectsV2: true, runtimeOn: true }] }])
  const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_own-daily-fred' }).definition))
  const { installed, errors } = registry.installUserDefinitions([stored])
  expect(installed.length, errors.join(' | ')).toBe(1)
  def = installed[0]
  handed.length = 0
})
afterEach(() => {
  if (def) registry.uninstallUserDefinition(def.id)
  setRuntimeRunner(null); resetRuntimeAsync(); setRunHalfObjectEvidence([]); setRuntimeKillList([])
  resetRuntimeSessions(); resetRuntimeLedgers(); clearSecondaryBars(); vi.unstubAllEnvs(); vi.unstubAllGlobals()
})

const INSTANCES = () => [{ instanceId: 'inst:u_own-daily-fred:1', defId: 'u_own-daily-fred' }]
/** the chart's own hook, as StockChart calls it, until every entry it asked for has landed */
async function chartEntries(tf, rows, symbolMeta) {
  const unknown = []
  const fetcher = storeFetcher(unknown)
  const hook = renderHook(() => useSecondarySources(INSTANCES, registry.getDefinition, tf, rows.length, fetcher, 0, null,
    'RDDT', symbolMeta))
  await waitFor(() => {
    const m = hook.result.current
    expect(m && m.size, 'the hook holds entries').toBeGreaterThan(0)
    for (const [k, e] of m) expect(e.status, k).toBe('available')
  }, { timeout: 20000 })
  const map = hook.result.current
  hook.unmount()
  expect(unknown, 'every URL the chart asked is one the store answers').toEqual([])
  return map
}
const ctxOf = (tf, secondary, symbol = RDDT) => ({ tf, newestBarIsForming: false, historyFromListing: false, symbol, secondary,
  exchangeOf: (t) => (t === 'SPX' ? 'SP' : null) })

// a binding the chart holds before (or without) the store's classification: no industry, no sector
const RDDT_BARE = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE' })
const pine = (lines) => ['//@version=5', 'indicator("t", overlay = false)', ...lines].join('\n')
// reads NO own daily row, and branches on a classification field: its build is refused when the binding lacks it
const SECTOR_BRANCH = pine(['x = 1.0', "if (syminfo.sector == 'Technology')", '    x := 2.0', 'plot(x)'])

describe('the own-daily question is asked with the chart\'s symbol binding (the captured cause)', () => {
  it('⚰️ without a symbol, Fred RS\'s build refuses at `syminfo.industry` (what the e83 predicate read as "no")', () => {
    const built = buildRuntimeIr(RS, { bars: [], inputs: {}, objectsInRun: true, pane: true, plotColours: true, basePeriod: '5',
      tf: '5', ...runtimeClockOpts(false, { tf: '5' }) })
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('interpret:bind-time-text')
    expect(built.refusal.message).toMatch(/syminfo\.industry/)
  })
  it('with RDDT\'s binding: yes on every intraday chart, no on D / W / M (read on the chart\'s own timeframe or below)', () => {
    for (const tf of ['1', '5', '15', '30', '60']) expect(runtimeReadsOwnDaily(RS, tf, RDDT), tf).toBe(true)
    for (const tf of ['D', 'W', 'M']) expect(runtimeReadsOwnDaily(RS, tf, RDDT), tf).toBe(false)
  })
  it('ownDailyNeeded on the REAL installed definition (the shape the chart\'s registry hands the hook)', () => {
    expect(def.compute.runtimeObjects && def.compute.runtimeObjects.source, 'the run half is minted').toBe(RS)
    expect(ownDailyNeeded(INSTANCES(), registry.getDefinition, '5', RDDT)).toBe(true)
  })
})

describe('⛔⛔ A PREDICATE THAT CANNOT ANSWER NEVER SAYS NO (the class behind the e83 failure)', () => {
  it('a REFUSED build answers NEEDED, whatever refused it; only a build that succeeds and reads no own row says no', () => {
    // the e83 case itself: Fred RS with no binding, or with one that has no industry yet
    expect(runtimeReadsOwnDaily(RS, '5')).toBe(true)
    expect(runtimeReadsOwnDaily(RS, '5', RDDT_BARE)).toBe(true)
    // an UNRELATED refusal (a script that reads no own row, refused at `syminfo.sector`) is still not a "no"
    const refused = buildRuntimeIr(SECTOR_BRANCH, { bars: [], inputs: {}, objectsInRun: true, pane: true, plotColours: true,
      basePeriod: '5', tf: '5', symbol: { ...RDDT_BARE }, ...runtimeClockOpts(false, { tf: '5' }) })
    expect(refused.ok, 'the control build is refused').toBe(false)
    expect(runtimeReadsOwnDaily(SECTOR_BRANCH, '5', RDDT_BARE)).toBe(true)
    // CONTROL: the same script, built (its sector settled), reads no own row: the predicate still discriminates
    expect(runtimeReadsOwnDaily(SECTOR_BRANCH, '5', { ...RDDT_BARE, sector: 'Communication Services' })).toBe(false)
    expect(runtimeReadsOwnDaily(pine(['plot(close)']), '5', RDDT)).toBe(false)
    // and no timeframe the read cannot be served on is opened by a refusal
    expect(runtimeReadsOwnDaily(SECTOR_BRANCH, 'D', RDDT_BARE)).toBe(false)
  })
  it('the chart\'s hook fetches OWN_DAILY_KEY for Fred RS while the binding is still missing a field', async () => {
    const map = await chartEntries('5', chartOf('5'), RDDT_BARE)
    expect([...map.keys()]).toContain(OWN_DAILY_KEY)
    expect(ownDailyNeeded(INSTANCES(), registry.getDefinition, '5', null)).toBe(true)
  })
})

describe('the product path: the chart\'s hook assembles the entries, the REAL worker runs Fred RS\'s run half', () => {
  for (const tf of ['5', '30', '60']) {
    it(`${tf}: OWN_DAILY_KEY is handed to the worker and the run half SERVES (was: refused, not handed the daily rows)`, async () => {
      const rows = chartOf(tf)
      const map = await chartEntries(tf, rows, RDDT)
      expect([...map.keys()].sort()).toEqual([OWN_DAILY_KEY, 'SPX', 'SPX@D', SEED].sort())
      setRuntimeRunner(workerRunner(await realWorkerFactory()))
      let cols = null
      const states = []
      for (let pass = 0; pass < 8; pass += 1) {
        let landed = false
        const off = onRuntimeColumnsLanded(() => { landed = true })
        cols = registry.computeFor(def, rows, {}, ctxOf(tf, map))
        const rh = runHalfOf(cols)
        states.push(rh ? `${rh.state}:${rh.code}` : 'none')
        for (let i = 0; i < 400 && !landed; i += 1) await new Promise((r) => setTimeout(r, 0))
        off()
        if (!landed) break
      }
      expect(handed.length, 'the worker was asked').toBeGreaterThan(0)
      for (const keys of handed) expect(keys, 'every worker request carries the own daily rows').toContain(OWN_DAILY_KEY)
      expect(states[states.length - 1], states.join(' > ')).toBe('served:null')
      const labels = runtimeObjectsOf(cols).live.filter((o) => o.family === 'label' && o.createdBar === rows.length - 1)
      expect(labels.map((o) => o.props.text)).toEqual(['                RS Rating', ''])
    })
  }
})

describe('DERIVATION: every `request.security` site of the document reads an entry the chart fetches', () => {
  // the run's own supply (`runtimeRequestSupply`) over the requests the run builds, handed EXACTLY the entries the
  // chart's hook assembled: a site whose entry the chart never fetches reads as pending or "not handed", never served
  const supplyOver = (tf, rows, map) => {
    const built = buildRuntimeIr(RS, { bars: rows, inputs: {}, objectsInRun: true, pane: true, plotColours: true,
      basePeriod: tf, tf, symbol: RDDT, ...runtimeClockOpts(false, { tf }) })
    expect(built.ok, JSON.stringify(built.refusal)).toBe(true)
    const requests = built.ir.requests || []
    expect(requests.length, 'Fred RS reads three request sites').toBe(3)
    return runtimeRequestSupply(requests, rows, ctxOf(tf, map))
  }
  for (const tf of ['1', '5', '15', '30', '60', 'D', 'W']) {
    it(`${tf}: no site is left unfetched`, async () => {
      const rows = chartOf(tf)
      const map = await chartEntries(tf, rows, RDDT)
      const out = supplyOver(tf, rows, map)
      expect(out.pending, 'nothing waits on an entry the chart never asks for').toBe(false)
      expect(out.refusal && out.refusal.message).toBeFalsy()
      if (['1', '5', '15', '30', '60'].includes(tf)) {
        // ⛔ CONTROL: the same supply without the own daily rows is the captured refusal (the check can fail)
        const without = new Map(map)
        without.delete(OWN_DAILY_KEY)
        expect(String((supplyOver(tf, rows, without).refusal || {}).message)).toMatch(/not handed that symbol's daily bars/)
      }
    })
  }
})

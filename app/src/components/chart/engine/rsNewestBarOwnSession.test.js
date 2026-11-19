// ─── ⭐⭐ RS RATING L11 PR 2 — THE CHART'S NEWEST BAR READS ITS OWN SESSION OF SP:SPX ───────────────────
//
// Witnessed (2026-11-17/18): every SETTLED bar of a stock chart reads SP:SPX one session back, but TradingView's
// newest bar reads the SAME session once the chart has had a realtime update; in session every symbol ticks, so
// in session it always does (post-close RDDT/NVDA RS lines differed from ours only on the newest bar; the
// after-close probe read 7340.53, the same session, on ALAB and RDDT; a FRESH load overnight read the previous
// session, 7416.59, on ALAB, RDDT and AGL). The rule is one authority (`otherSymbols.newestOwnPeriodOf`), decided
// by the held index series' own session (its `newestBarIsForming`) and placed by `witnessedBarsOf` (daily) and
// `previousWeekBarsOf` (the weekly fold) for every lane.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as registry from './nativeRegistry'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { runtimeColumnsFor, resetRuntimeSessions, resetRuntimeLedgers } from './runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList, runtimeSourceHash } from './runtimeKill'
import { setRunHalfObjectEvidence } from './runHalfRailSeam'
import { runHalfOf } from './runtime/runtimeObjects'
import { witnessedBarsOf, previousWeekBarsOf, newestOwnPeriodOf, withChartNewestDay, WITNESS_ALIGNMENTS, otherSymbolsSignature } from './otherSymbols'

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const SEED_KEY = 'SEED_FRED6725_RS_RATING:RSRATING'
const TODAY = '2026-11-17'
const utcMidnight = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000
const SESSIONS = (() => {
  const out = []
  for (let t = Date.parse(`${TODAY}T00:00:00Z`); out.length < 600; t -= 86400000) {
    const wd = new Date(t).getUTCDay()
    if (wd !== 0 && wd !== 6) out.unshift(new Date(t).toISOString().slice(0, 10))
  }
  return out
})()
const CHART = SESSIONS.map((t, i) => { const c = 80 + 20 * Math.sin(i / 17) + i * 0.05; return { t, o: c - 0.4, h: c + 1.1, l: c - 1.2, c, v: 1e6 + i } })
const SPX = SESSIONS.map((iso, i) => { const c = 5400 + 300 * Math.sin(i / 41) + i * 3; return { t: utcMidnight(iso), o: c - 5, h: c + 20, l: c - 22, c, v: 3e9 } })
const SEED = SESSIONS.slice(-35, -1).map((t, i) => ({ t, o: 0, h: 1000, l: 0, c: 300 - 7 * i, v: 0 }))
const SYMBOL = { ticker: 'AGL', exchange: 'NYSE', industry: 'Medical Care Facilities', sector: 'Healthcare', securityType: 'stock' }
const SEED_IN = { bars: SEED, status: 'available', newestBarIsForming: false }
const ROW = { alignment: WITNESS_ALIGNMENTS.PREVIOUS_SESSION }

let defId = null
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
  if (defId) registry.uninstallUserDefinition(defId)
  defId = null
  setRunHalfObjectEvidence([])
  setRuntimeKillList([])
  resetRuntimeSessions()
  resetRuntimeLedgers()
  vi.unstubAllEnvs()
})

function rsDef() {
  const minted = memberPaneDefinition({ source: RS, id: 'u_rsl11pr2', name: 'RS Rating' }).definition
  const { installed, errors } = registry.installUserDefinitions([JSON.parse(JSON.stringify(minted))])
  expect(installed.length, errors.join(' | ')).toBe(1)
  defId = installed[0].id
  return installed[0]
}
const rsCols = (def, spxForming, spxBars = SPX) => registry.computeFor(def, CHART, {}, {
    tf: 'D', symbol: SYMBOL, newestBarIsForming: true, historyFromListing: true, exchangeOf: (t) => (t === 'SPX' ? 'SP' : null),
    secondary: new Map([['SPX', { bars: spxBars, status: 'available', newestBarIsForming: spxForming }], [SEED_KEY, SEED_IN]]) })
const rsLine = (def, spxForming, spxBars = SPX) => Array.from(rsCols(def, spxForming, spxBars).value)

describe('the placement (`witnessedBarsOf`, `previousWeekBarsOf`)', () => {
  const days = ['2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17']
  const held = days.map((t, i) => ({ t, o: 1, h: 1, l: 1, c: 100 + i, v: 0 }))

  it('without the rule every bar reads the session before it, and the newest held row is read by nobody', () => {
    expect(witnessedBarsOf(ROW, held).map((b) => [b.t, b.c])).toEqual([['2026-11-13', 100], ['2026-11-16', 101], ['2026-11-17', 102]])
  })

  it('with it, the chart\'s newest session reads its OWN row; every earlier session is unchanged', () => {
    const own = { tf: 'D', key: '2026-11-17' }
    expect(witnessedBarsOf(ROW, held, own).map((b) => [b.t, b.c])).toEqual([['2026-11-13', 100], ['2026-11-16', 101], ['2026-11-17', 103]])
  })

  it('⛔ a held series that has not reached the chart\'s newest session is never stretched to it', () => {
    const own = { tf: 'D', key: '2026-11-18' }
    expect(witnessedBarsOf(ROW, held, own)).toEqual(witnessedBarsOf(ROW, held))
  })

  it('the weekly fold: the chart\'s newest week reads its own week (the latest close), earlier weeks the week before', () => {
    const daily = ['2026-11-09', '2026-11-10', '2026-11-13', '2026-11-16', '2026-11-17'].map((t, i) => ({ t, o: 10 + i, h: 20 + i, l: 1 + i, c: 100 + i, v: 1 }))
    const plain = previousWeekBarsOf(daily)
    const own = previousWeekBarsOf(daily, { tf: 'W', key: newestOwnPeriodOf({ tf: 'W', chartNewestDay: '2026-11-17' }, { newestBarIsForming: true }).key })
    const at = (rows, t) => (rows.find((r) => r.t === t) || {}).c
    expect(at(plain, '2026-11-20')).toBe(102)   // the week of 11-16 reads the week of 11-09 (its last close)
    expect(at(own, '2026-11-20')).toBe(104)     // ...and with the rule, its own week's latest close
    expect(at(own, '2026-11-13')).toBe(at(plain, '2026-11-13'))
  })
})

describe('the one authority (`newestOwnPeriodOf`)', () => {
  it('answers only while the held series\' own session is in progress, and only for a day or week chart', () => {
    const ctx = withChartNewestDay({ tf: 'D' }, CHART)
    expect(ctx.chartNewestDay).toBe(TODAY)
    expect(newestOwnPeriodOf(ctx, { newestBarIsForming: true })).toEqual({ tf: 'D', key: TODAY })
    expect(newestOwnPeriodOf(ctx, { newestBarIsForming: false })).toBeNull()
    expect(newestOwnPeriodOf(ctx, {})).toBeNull()
    expect(newestOwnPeriodOf({ ...ctx, tf: '60' }, { newestBarIsForming: true })).toBeNull()
  })
})

describe('RS Rating on a forming daily chart: the newest bar reads TODAY\'S SP:SPX while the index session is on', () => {
  it('every settled bar is unchanged; the newest RS line moves by exactly yesterday\'s SPX over today\'s', () => {
    const def = rsDef()
    const settled = rsLine(def, false)
    const live = rsLine(def, true)
    const n = CHART.length
    expect(live.slice(0, n - 1)).toEqual(settled.slice(0, n - 1))
    expect(Number.isFinite(live[n - 1]) && Number.isFinite(settled[n - 1])).toBe(true)
    // RS line = close / SPX x (a factor that does not read SPX): today's SPX in place of yesterday's
    expect(live[n - 1] / settled[n - 1]).toBeCloseTo(SPX[n - 2].c / SPX[n - 1].c, 10)
  })

  it("the RUN half reads it too: its columns still equal the host's on every bar, so the label is served", () => {
    const def = rsDef()
    // the run half's column rail refuses the run if any run column differs from the host's (nativeRegistry
    // withRunHalf), so a run lane still reading yesterday's SPX on the newest bar would be refused here
    // the session opening with the bars unchanged (the same rows, the flag flipped) must be a NEW run, not the
    // memo of the settled one: both keys carry the flag (runtimeColumns.requestSupplyKey, otherSymbolsSignature)
    expect(runHalfOf(rsCols(def, false))).toEqual(expect.objectContaining({ state: 'served' }))
    expect(runHalfOf(rsCols(def, true))).toEqual(expect.objectContaining({ state: 'served' }))
    expect(runHalfOf(rsCols(def, false))).toEqual(expect.objectContaining({ state: 'served' }))
  })

  it('the BINDER recomputes when the index session opens or closes (its key carries the flag)', () => {
    const def = rsDef()
    const sig = (forming) => otherSymbolsSignature(def, new Map([
      ['SPX', { bars: SPX, status: 'available', newestBarIsForming: forming }], [SEED_KEY, SEED_IN]]), 'D')
    expect(sig(true)).not.toBe(sig(false))
  })

  it('⛔ CONTROL: with no index row for today the newest bar is not stretched to read one', () => {
    const def = rsDef()
    const noToday = SPX.slice(0, -1)
    expect(rsLine(def, true, noToday)).toEqual(rsLine(def, false, noToday))
  })
})

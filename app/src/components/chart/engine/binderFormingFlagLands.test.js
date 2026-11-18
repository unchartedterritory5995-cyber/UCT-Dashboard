// ─── ⭐⭐ (2026-11-18) THE CHART'S FORMING FLAG LANDS: THE RUN IS RECOMPUTED ────────────────────────────
//
// The post-close production check, RDDT 1D at 22:05Z: `/api/bars` said the newest daily bar was closed
// (`newest_bar_is_forming: false`, `bar_close_state` from 21:00Z), yet the member's strategy report read "As of
// the bar closed 2026-11-17" and its backtest was refused by [B-EXEC]: the run had been handed "unknown" for a
// newest bar that had closed. One of the two ways that happens is here: the binder memoised a compute on
// (bars, inputs, …) and NOT on the newest bar's tri-state, so a flag that landed over the SAME bars array (an
// answer arriving after a cached first paint, or the close itself) was a memo hit, and the run kept the answer it
// gave while the newest bar was unknown. From engine 80 that answer is a backtest one bar stale.
//
// This rail drives the REAL binder with a member's strategy (the door's broker document of
// supertrend-strategy), on RDDT 1D bars that end at a bar the route calls closed: synced with the flag unknown,
// then synced again with the flag landed (`false`) and NOTHING else changed (the same bars array).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as registry from './nativeRegistry'
import { createBinder } from './binder'
import { addInstance } from './instanceControls'
import { mergeChartSettings } from '../chartDefaults'
import { createFakeChart } from './__tests__/fakeChart'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { runtimeColumnsFor, resetRuntimeSessions, resetRuntimeLedgers } from './runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'
import { strategyRecordFor, resetStrategyRecords } from './strategyReportNotice'
import { isStrategyWindowDefinition } from './strategyWindow'
import { loadCapture } from './__tests__/vendorHarness/harness.js'
import { toProductBars } from './__tests__/vendorHarness/ourSide.js'
import { historyWindowBarsOf } from './runtime/__tests__/strategyArmed.js'

vi.setConfig({ testTimeout: 300000 })

const REPO = path.resolve(process.cwd(), '..')
const GATE = (f) => fs.readFileSync(path.resolve(process.cwd(), `src/components/chart/engine/${f}`), 'utf8')
const FLAGS = ['objectsOnlyPaneGate.js', 'runtimePaneGate.js', 'strategyBrokerGate.js']
  .map((f) => (GATE(f).match(/(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1])
const SUPERTREND = fs.readFileSync(path.join(REPO, 'corpus/committed/supertrend-strategy__rcRbtoBiKG.pine'), 'utf8')
// RDDT 1D from the listing through 2026-11-18 (the in-session capture's bars, as a member's daily chart holds them)
const BARS = toProductBars(loadCapture(path.join(REPO, 'tests/fixtures/vendor/harness/supertrend-strategy-is-rddt-1d-2026-11-18.json')).capture)
const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' }
const day = (t) => (typeof t === 'string' ? t.slice(0, 10) : new Date(t * 1000).toISOString().slice(0, 10))

let defId = null
beforeEach(() => {
  for (const f of FLAGS) vi.stubEnv(f, '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
})
afterEach(() => {
  if (defId) registry.uninstallUserDefinition(defId)
  defId = null
  resetStrategyRecords()
  resetRuntimeSessions()
  resetRuntimeLedgers()
  vi.unstubAllEnvs()
})

function chartWithStrategy() {
  const d = memberPaneDefinition({ source: SUPERTREND, name: 'SuperTrend STRATEGY', id: 'u_forming-flag-lands' })
  expect(d.ok, d.reason).toBe(true)
  expect(isStrategyWindowDefinition(d.definition), 'the door did not mint the broker document').toBe(true)
  const { installed, errors } = registry.installUserDefinitions([JSON.parse(JSON.stringify(d.definition))])
  expect(installed.length, errors.join(' | ')).toBe(1)
  const def = installed[0]
  defId = def.id
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const cs = addInstance(mergeChartSettings({}), def.id, registry)
  const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
  const sync = (newestBarIsForming) => binder.sync({
    enabled: true, cs, instances, registry, bars: BARS, tf: 'D', sym: 'RDDT', symbol: SYMBOL, newestBarIsForming,
    historyFromListing: true, historyWindowBars: historyWindowBarsOf(REPO),
    adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
    createObjectLayer: () => ({ set: () => {}, clear: () => {} }),
  })
  return { sync, id: instances[0].instanceId }
}
const asOf = (id) => {
  const rec = strategyRecordFor(id)
  return rec && rec.window && rec.window.asOfBar != null ? day(rec.window.asOfBar) : null
}

describe('the newest bar\'s flag lands over the same bars: the strategy run is recomputed', () => {
  it('unknown, then closed (nothing else changes): the report moves from one bar stale to the newest bar', () => {
    const newest = day(BARS[BARS.length - 1].t)
    const before = day(BARS[BARS.length - 2].t)
    const c = chartWithStrategy()
    c.sync(null)
    expect(asOf(c.id)).toBe(before)          // unknown fails closed: the newest bar is left out
    c.sync(false)
    expect(asOf(c.id)).toBe(newest)          // ⚰️ was `before`: the memo kept the unknown answer
  })

  it('CONTROL: synced closed from the first, the report is as of the newest bar', () => {
    const c = chartWithStrategy()
    c.sync(false)
    expect(asOf(c.id)).toBe(day(BARS[BARS.length - 1].t))
  })
})

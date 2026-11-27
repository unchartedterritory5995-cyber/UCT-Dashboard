// ⭐⭐ (2026-11-26, Fred RS warm reload) THE FIRST PAGE ON THE CHART'S THREAD, WHEN IT FITS A FIRST PAINT'S BUDGET.
// Measured (local bundle, AGL 1D, Fred RS, 20 warm reloads): the chart's rows came from the device store already deep, the
// pane's first job went to the worker, and Fred RS drew 224 / 281 / 297 ms after the candles; a cold reload's first 600
// rows computed on this thread drew it IN the candles' frame. So a cold pane whose full job goes to the worker, whose
// document this tab has NOT measured on this timeframe, gets its first page HERE over the newest HOST_UNMEASURED_MAIN_ROWS:
//   F1 the FIRST call answers a picture (not an empty pane), the full job is in the worker, no page job is posted; every
//      value drawn equals the full history's, nothing before the page is drawn, the page's withholding is named
//   F2 a plot whose values depend on where history began is withheld whole, by name (the same two-start test)
//   F3 a document this tab measured on this timeframe takes the worker's page as before (the cost is learned: F1's
//      document, once measured dear, never takes this path again)
//   F4 switched off (or a short chart, or a pane holding a picture): no page here
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as registry from '../nativeRegistry'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import {
  setHostLaneWorkerFactory, resetHostLaneAsync, isHostLanePending, hostLaneStats, setFirstPageEnabled,
  setFirstPageOnMainEnabled, __routeEveryHostDocumentForTests, FIRST_PAGE_PROBE, FIRST_PAGE_CODE,
} from '../hostLaneAsync'
import { HOST_UNMEASURED_MAIN_ROWS, resetHostLaneRoute, __setHostLaneCostClockForTests } from '../hostLaneRoute'
import { withheldBarsReport } from '../astColumns'
import { standInWorkers, firstDifference } from './hostLaneStandIn'
import { asMember } from '../../../../testing/runtimeGate'

vi.setConfig({ testTimeout: 300000 })

const RDDT = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE', securityType: 'stock' })
const ET = (iso, hh, mm) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
function fiveMinute(days) {
  const out = []
  for (let t = Date.parse('2026-11-18T00:00:00Z'), n = 0; n < days; t -= 86400000) {
    const wd = new Date(t).getUTCDay(); if (wd === 0 || wd === 6) continue
    n += 1
    const d = new Date(t).toISOString().slice(0, 10)
    for (let k = 0; k < 192; k += 1) out.push({ t: ET(d, 4, 0) + k * 300 })
  }
  out.sort((a, b) => a.t - b.t)
  return out.map((r, i) => { const c = 150 + 30 * Math.sin(i / 700) + 5 * Math.sin(i / 37); return { t: r.t, o: c - 0.2, h: c + 0.5, l: c - 0.6, c, v: 1e4 + (i % 97) } })
}
const PROBE_SRC = '//@version=5\nindicator("fpm-probe")\nplot(close * 2, "exact")\nplot(ta.sma(close, 400), "sma400")\n'
let defId = null
function probeDef() {
  const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: PROBE_SRC, name: 'fpm-probe', id: 'u_fpm-probe' }).definition))
  const { installed, errors } = registry.installUserDefinitions([stored])
  expect(installed.length, errors.join(' | ')).toBe(1)
  defId = installed[0].id
  return installed[0]
}
const ctx = { sym: 'RDDT', tf: '5', newestBarIsForming: false, symbol: RDDT }
const finite = (col) => Array.from(col).filter(Number.isFinite).length
const PAGE = HOST_UNMEASURED_MAIN_ROWS - FIRST_PAGE_PROBE

let workers
asMember({ allow: true, pane: true, hkd: true })
beforeEach(() => {
  resetHostLaneAsync(); resetHostLaneRoute()
  setFirstPageEnabled(true); setFirstPageOnMainEnabled(true)
  workers = standInWorkers()
  setHostLaneWorkerFactory(workers.factory)
  __routeEveryHostDocumentForTests(true)            // the full job always goes to the worker (the deep rows' route)
})
afterEach(() => {
  if (defId) registry.uninstallUserDefinition(defId)
  defId = null
  setHostLaneWorkerFactory(null); setFirstPageEnabled(true); setFirstPageOnMainEnabled(true)
  __routeEveryHostDocumentForTests(false); resetHostLaneAsync(); resetHostLaneRoute()
})

describe('the first page on the chart thread, within a first paint\'s budget', () => {
  it('F1+F2 the first call draws the page here: byte-equal where drawn, the start-dependent plot withheld, no page job', () => {
    const def = probeDef()
    const chart = fiveMinute(22)                        // 4,224 rows: deep
    expect(chart.length).toBeGreaterThan(HOST_UNMEASURED_MAIN_ROWS + 100)
    const full = registry.computeFor(def, chart, {}, { ...ctx })
    const first = registry.computeFor(def, chart, {}, { ...ctx, hostPane: 'fpm\u0001a' })
    expect(isHostLanePending(first), 'the full job is in the worker').toBe(true)
    expect(hostLaneStats().firstPagesMain).toBe(1)
    expect(workers.made.flatMap((w) => w.inbox).some((m) => m.kind === 'firstPage'), 'no page job posted').toBe(false)
    const [exactKey, smaKey] = Object.keys(full)
    expect(finite(first[exactKey]), 'the page draws the exact plot on its newest bars').toBe(PAGE)
    for (let i = 0; i < chart.length; i += 1) {
      if (Number.isFinite(first[exactKey][i])) expect(Object.is(first[exactKey][i], full[exactKey][i])).toBe(true)
    }
    for (let i = 0; i < chart.length - PAGE; i += 1) expect(Number.isFinite(first[exactKey][i])).toBe(false)
    expect(finite(full[smaKey])).toBeGreaterThan(3000)
    expect(finite(first[smaKey]), 'F2: a start-dependent plot is never drawn from a page').toBe(0)
    const named = withheldBarsReport(first)
    expect(named[exactKey][FIRST_PAGE_CODE]).toBeTruthy()
    expect(named[smaKey][FIRST_PAGE_CODE].every((x) => x === 1)).toBe(true)
    workers.drain()
    const landed = registry.computeFor(def, chart, {}, { ...ctx, hostPane: 'fpm\u0001a' })
    expect(isHostLanePending(landed)).toBe(false)
    expect(firstDifference(full, landed)).toBeNull()
  })

  it('F3 once this tab measures the document dear here, a cold pane takes the worker page, as before', () => {
    const def = probeDef()
    __setHostLaneCostClockForTests(() => 500)          // every measurement this tab takes reads 500 ms: dear
    const chart = fiveMinute(22)
    registry.computeFor(def, chart, {}, { ...ctx, hostPane: 'fpm-b1' })     // unmeasured: the page here, measured dear
    expect(hostLaneStats().firstPagesMain).toBe(1)
    const second = registry.computeFor(def, fiveMinute(22), {}, { ...ctx, hostPane: 'fpm-b2' })   // fresh rows: the memo is per bars array
    expect(hostLaneStats().firstPagesMain, 'measured dear: never here again').toBe(1)
    expect(Object.keys(second).length, 'nothing computed here').toBe(0)
    workers.drain()
    const st = hostLaneStats()
    expect(st.firstPages + st.firstPageDiscarded + st.firstPageFailed, 'the worker page job was made for it').toBeGreaterThan(0)
  })

  it('F4 switched off, or a short chart: no page here', () => {
    const def = probeDef()
    setFirstPageOnMainEnabled(false)
    registry.computeFor(def, fiveMinute(22), {}, { ...ctx, hostPane: 'fpm\u0001c' })
    expect(hostLaneStats().firstPagesMain).toBe(0)
    setFirstPageOnMainEnabled(true)
    const measured = vi.fn((ms) => ms)
    __setHostLaneCostClockForTests(measured)           // a page computed here is measured: none may be
    registry.computeFor(def, fiveMinute(5), {}, { ...ctx, hostPane: 'fpm\u0001d' })   // 960 rows: under the budget's rows
    expect(hostLaneStats().firstPagesMain).toBe(0)
    expect(measured, 'nothing computed here for a short chart').not.toHaveBeenCalled()
  })
})

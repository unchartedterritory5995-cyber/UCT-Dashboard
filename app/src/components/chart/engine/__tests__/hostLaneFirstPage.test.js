// ⭐⭐ THE FIRST PAGE (coordinator-approved first-draw unit, 2026-11-23): on a cold timeframe the pane draws the newest
// FIRST_PAGE_ROWS bars at once (computed twice, from two starts; a plot only where both agree bit for bit), while the
// worker computes the full history, which then REPLACES it.
// ⛔ THE CORRECTNESS BAR: every value the first page draws is BYTE-EQUAL to the full-history answer on that bar; a plot
// whose page values depend on where history began is withheld whole on the page, by name; the drawings wait.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as registry from '../nativeRegistry'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import {
  setHostLaneWorkerFactory, resetHostLaneAsync, isHostLanePending, hostLaneStats, setFirstPageEnabled,
  __routeEveryHostDocumentForTests,
  FIRST_PAGE_ROWS, FIRST_PAGE_PROBE, FIRST_PAGE_CODE,
} from '../hostLaneAsync'
import { withheldBarsReport } from '../astColumns'
import { standInWorkers, firstDifference } from './hostLaneStandIn'
import { OWN_DAILY_KEY } from '../otherSymbols'
import { asMember } from '../../../../testing/runtimeGate'

vi.setConfig({ testTimeout: 300000 })

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const SEED_KEY = 'SEED_FRED6725_RS_RATING:RSRATING'
const ET = (iso, hh, mm) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
function sessions(n, end = '2026-11-18') {
  const out = []
  for (let t = Date.parse(`${end}T00:00:00Z`); out.length < n; t -= 86400000) {
    const wd = new Date(t).getUTCDay()
    if (wd !== 0 && wd !== 6) out.unshift(new Date(t).toISOString().slice(0, 10))
  }
  return out
}
/** RDDT-like 5m rows 04:00-20:00 ET; SPX at 5m in the regular session of every day (the hostLaneLearnedRoute fixture). */
function fiveMinute(days) {
  const chart = []
  const spx = []
  sessions(days).forEach((d) => {
    for (let k = 0; k < 192; k += 1) {
      const t = ET(d, 4, 0) + k * 300
      const i = chart.length
      const c = 150 + 30 * Math.sin(i / 700) + 5 * Math.sin(i / 37) + i * 0.0005
      chart.push({ t, o: c - 0.2, h: c + 0.5, l: c - 0.6, c, v: 1e4 + (i % 97) })
      if (t >= ET(d, 9, 30) && t < ET(d, 16, 0)) {
        const s = 6500 + 200 * Math.sin(i / 900) + i * 0.01
        spx.push({ t, o: s - 1, h: s + 2, l: s - 2, c: s, v: 1e6 })
      }
    }
  })
  return { chart, spx }
}
const DAILY_DAYS = sessions(700)
const utcMid = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000
const SPX_D = DAILY_DAYS.map((d, i) => ({ t: utcMid(d), o: 1, h: 1, l: 1, c: 5000 + i * 3 + 100 * Math.sin(i / 30), v: 1 }))
const OWN_D = DAILY_DAYS.slice(-420).map((d, i) => ({ t: d, o: 1, h: 1, l: 1, c: 40 + i * 0.3 + 10 * Math.sin(i / 20), v: 1 }))
const SEED = DAILY_DAYS.slice(-35, -1).map((t, i) => ({ t, o: 0, h: 1000, l: 0, c: 300 - 7 * i, v: 0 }))
const RDDT = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Software/Services', sector: 'Technology Services', securityType: 'stock' })
const fredCtx = (spx) => ({
  sym: 'RDDT', tf: '5', newestBarIsForming: false, symbol: RDDT,
  secondary: new Map([
    ['SPX', { bars: spx, status: 'available', newestBarIsForming: false }],
    ['SPX@D', { bars: SPX_D, status: 'available', newestBarIsForming: false }],
    [OWN_DAILY_KEY, { bars: OWN_D, status: 'available', newestBarIsForming: false }],
    [SEED_KEY, { bars: SEED, status: 'available', newestBarIsForming: false }],
  ]),
  exchangeOf: (t) => (t === 'SPX' ? 'SP' : null),
})
let fredId = null
function fredDef() {
  const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: RS, name: 'RS Rating', id: 'u_fred-first-page' }).definition))
  const { installed, errors } = registry.installUserDefinitions([stored])
  expect(installed.length, errors.join(' | ')).toBe(1)
  fredId = installed[0].id
  return installed[0]
}

let workers
asMember({ allow: true, pane: true, hkd: true })
beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '0')
  resetHostLaneAsync()
  setFirstPageEnabled(true)
  workers = standInWorkers()
  setHostLaneWorkerFactory(workers.factory)
})
afterEach(() => {
  if (fredId) registry.uninstallUserDefinition(fredId)
  fredId = null
  setHostLaneWorkerFactory(null)
  setFirstPageEnabled(true)
  __routeEveryHostDocumentForTests(false)
  resetHostLaneAsync()
  vi.unstubAllEnvs()
})

const finite = (col) => Array.from(col).filter(Number.isFinite).length

describe('the first page: drawn at once, byte-equal to the full history where it draws', () => {
  it('Fred RS at 5m: the RS line is drawn on the newest bars at once; every drawn value equals the full answer', () => {
    const def = fredDef()
    const { chart, spx } = fiveMinute(22)          // 4,224 rows: a deep history (the worker's)
    expect(chart.length).toBeGreaterThan(2 * FIRST_PAGE_ROWS + FIRST_PAGE_PROBE)
    const fc = fredCtx(spx)
    const full = registry.computeFor(def, chart, {}, { ...fc })                  // the full history, on this thread
    const first = registry.computeFor(def, chart, {}, { ...fc, hostPane: 'fp\u0001a' })
    expect(isHostLanePending(first), 'the full job is in the worker').toBe(true)
    expect(hostLaneStats().firstPages).toBe(1)
    const keys = Object.keys(first)
    expect(keys.length, 'the first page is a picture, not an empty pane').toBeGreaterThan(0)
    let drawn = 0
    for (const k of keys) {
      const a = first[k]; const b = full[k]
      expect(a.length).toBe(chart.length)
      for (let i = 0; i < a.length; i += 1) {
        if (!Number.isFinite(a[i])) continue
        drawn += 1
        expect(Object.is(a[i], b[i]), `${k}[${i}] equals the full history`).toBe(true)
      }
    }
    // non-vacuity: Fred's RS line is drawn on the page (the newest FIRST_PAGE_ROWS bars, where SPX is held)
    expect(drawn, 'the first page draws values').toBeGreaterThan(FIRST_PAGE_ROWS / 4)
    // nothing before the page is drawn, and the page's withholdings are named
    for (const k of keys) for (let i = 0; i < chart.length - FIRST_PAGE_ROWS; i += 1) expect(Number.isFinite(first[k][i])).toBe(false)
    const named = withheldBarsReport(first)
    expect(named && Object.values(named).every((codes) => codes[FIRST_PAGE_CODE]), 'every plot names the first page').toBe(true)
    // the worker's full answer replaces the page: byte-equal to the full history
    workers.drain()
    const landed = registry.computeFor(def, chart, {}, { ...fc, hostPane: 'fp\u0001a' })
    expect(isHostLanePending(landed)).toBe(false)
    expect(firstDifference(full, landed)).toBeNull()
  })

  it('⛔ a plot whose page values depend on where history began is withheld WHOLE on the page, by name', () => {
    // a Pine document with an exact plot and a start-dependent one (a 400-bar mean: the page's first 400 bars read
    // history the page does not hold, so the two starts disagree there)
    const src = '//@version=5\nindicator("fp-probe")\nplot(close * 2, "exact")\nplot(ta.sma(close, 400), "sma400")\n'
    const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: src, name: 'fp-probe', id: 'u_fp-probe' }).definition))
    const { installed } = registry.installUserDefinitions([stored])
    const def = installed[0]; fredId = def.id
    const { chart } = fiveMinute(22)
    const ctx = { sym: 'RDDT', tf: '5', newestBarIsForming: false, symbol: RDDT }
    const full = registry.computeFor(def, chart, {}, { ...ctx })
    __routeEveryHostDocumentForTests(true)
    const first = registry.computeFor(def, chart, {}, { ...ctx, hostPane: 'fp\u0001b' })
    expect(isHostLanePending(first), 'routed to the worker').toBe(true)
    const [exactKey, cumKey] = Object.keys(full)
    expect(finite(first[exactKey])).toBe(FIRST_PAGE_ROWS)
    expect(finite(full[cumKey]), 'non-vacuity: the full history draws the mean').toBeGreaterThan(3000)
    expect(finite(first[cumKey]), 'the start-dependent plot is not drawn from a page').toBe(0)
    expect(withheldBarsReport(first)[cumKey][FIRST_PAGE_CODE].every((x) => x === 1)).toBe(true)
  })

  it('⛔ CONTROLS: a short chart, the switch off, or a pane that already has a picture: no first page', () => {
    const def = fredDef()
    const fc = fredCtx(fiveMinute(22).spx)
    const short = fiveMinute(8).chart                 // 1,536 rows: under 2 * FIRST_PAGE_ROWS + FIRST_PAGE_PROBE
    registry.computeFor(def, short, {}, { ...fc, hostPane: 'fp\u0001c' })
    expect(hostLaneStats().firstPages).toBe(0)
    setFirstPageEnabled(false)
    const { chart } = fiveMinute(22)
    const off = registry.computeFor(def, chart, {}, { ...fc, hostPane: 'fp\u0001d' })
    expect(hostLaneStats().firstPages).toBe(0)
    expect(Object.keys(off).length, 'switched off: the cold pane is blank, as before').toBe(0)
    setFirstPageEnabled(true)
    workers.drain()
    registry.computeFor(def, chart, {}, { ...fc, hostPane: 'fp\u0001d' })    // the pane now holds the full picture
    const longer = fiveMinute(23).chart
    registry.computeFor(def, longer, {}, { ...fc, hostPane: 'fp\u0001d' })    // new rows: pending, the OLD picture shown
    expect(hostLaneStats().firstPages, 'a pane with a picture keeps it; no page is computed').toBe(0)
  })
})

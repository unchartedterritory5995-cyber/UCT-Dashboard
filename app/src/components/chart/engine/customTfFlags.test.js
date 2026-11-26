// ─── ⭐⭐ e98 (Q-FRED-4H) — THE CLOCK'S TIMEFRAME FLAGS ON A 4-HOUR CHART ─────────────────────────────────────────────
//
// `indicators.js::timeframeFlags` (the one authority the clock columns, the bind fold and both lanes read) answered
// `null` for every code but the eight native ones, so on a 4h chart `timeframe.isweekly` was unanswered and every
// tree reading it blank: Fred RS's `rsRatio = timeframe.isweekly ? … : …` left its RS line `na` on every 4h bar.
// It now answers the custom intraday codes it can answer with certainty, by NAME (`CLOCK_CUSTOM_INTRADAY_TFS`): `240`,
// a code the chart offers, Pine defines as 240 minutes, and the translator already holds (`pine.js::PINE_TF_SPELLING`,
// so `timeframe.multiplier` / `isminutes` / `isdwm` / `in_seconds` answer for the same codes). Every other code is
// still `null`. TradingView's own captures (Q-FRED-4H, local) read `isweekly` = 0 on 240: graded below when present.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import crypto from 'node:crypto'
import * as registry from './nativeRegistry'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { runtimeColumnsFor, resetRuntimeSessions, resetRuntimeLedgers } from './runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'
import { timeframeFlags, computeClock, CLOCK_PERIOD_SECONDS } from '../indicators'
import { timeframeMultiplier, timeframeIsMinutes, timeframeIsDwm, timeframeSeconds } from './ast/pine'
import { TF_MENU, resampleSpec } from '../timeframes'
import { resampleForSpec } from '../../../utils/resampleBars'
import { isTradingDay } from '../../../lib/marketClock/sessionCalendar.js'

vi.setConfig({ testTimeout: 240000 })

describe('(a) a 240 chart answers the timeframe flags as Pine defines a 240-minute chart', () => {
  it('isintraday 1, isdaily / isweekly / ismonthly 0, one bar 14,400 s; the translator\'s family agrees', () => {
    expect(timeframeFlags('240')).toEqual({ isintraday: true, isdaily: false, isweekly: false, ismonthly: false })
    expect(CLOCK_PERIOD_SECONDS['240']).toBe(14400)
    const cols = computeClock([{ t: 1795536000, o: 1, h: 1, l: 1, c: 1, v: 1 }], '240')
    expect([cols.isintraday[0], cols.isdaily[0], cols.isweekly[0], cols.ismonthly[0], cols.periodseconds[0]])
      .toEqual([1, 0, 0, 0, 14400])
    // ONE vocabulary: the translator's `timeframe.*` family answers the same code, and agrees on its length
    expect([timeframeMultiplier('240'), timeframeIsMinutes('240'), timeframeIsDwm('240'), timeframeSeconds('240')])
      .toEqual([240, 1, 0, CLOCK_PERIOD_SECONDS['240']])
  })
})

describe('(b) every other non-native code still answers null (never a guess from its shape)', () => {
  it('codes the chart does not offer, and offered custom codes the translator does not hold', () => {
    for (const tf of ['7', '4h', '4H', '1H', '', undefined, null, '240m', '0240']) expect(timeframeFlags(tf), String(tf)).toBe(null)
    // the chart's other custom codes: offered, but no `timeframe.*` code in the translator, so not answered here
    const offered = TF_MENU.flatMap((g) => g.codes)
    for (const tf of ['2', '3', '10', '45', '65', '195', '120', '2D', '3D', '5D', '2W', '3M', '6M', '12M']) {
      expect(offered, tf).toContain(tf)
      expect(timeframeFlags(tf), tf).toBe(null)
      expect(CLOCK_PERIOD_SECONDS[tf], tf).toBe(undefined)
    }
    const cols = computeClock([{ t: 1795536000, o: 1, h: 1, l: 1, c: 1, v: 1 }], '120')
    expect(Number.isNaN(cols.isweekly[0]) && Number.isNaN(cols.periodseconds[0])).toBe(true)
  })
})

// ─── (c) END TO END: FRED RS ON A SYNTHETIC 4h CHART ─────────────────────────────────────────────────────────────────
// Fred RS (MPL-2.0, `docs/pine/rs-rating/`) with its RS line's comparative symbol set to AMEX:SPY (a listing served at
// the chart's own timeframe, so this unit is measured alone: SP:SPX on 240 is PR #2745's). The chart and SPY's bars are
// the product's own 4h bars of extended-hours 60m rows (`resampleForSpec`).
const FRED = path.resolve(process.cwd(), '../docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine')
const to240 = (rows) => resampleForSpec(rows, resampleSpec('240'))
const etOff = (day) => (/GMT-4/.test(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
  .format(new Date(`${day}T12:00:00Z`))) ? 4 : 5)
const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + etOff(day), mm) / 1000 }
function synthetic(nDays) {
  const days = []
  for (let t = Date.UTC(2025, 0, 2); days.length < nDays; t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10)
    if (isTradingDay(day)) days.push(day)
  }
  const stock = []
  const spy = []
  days.forEach((day, i) => {
    const hours = [...[4, 5, 6, 7, 8, 9].map((h) => ET(day, h, 0)), ...[0, 1, 2, 3, 4, 5, 6].map((k) => ET(day, 9, 30) + k * 3600),
      ...[16, 17, 18, 19].map((h) => ET(day, h, 0))]
    hours.forEach((t, k) => {
      stock.push({ t, o: 50, h: 51, l: 49, c: 50 + i * 0.1 + k * 0.01, v: 1000 })
      spy.push({ t, o: 600, h: 601, l: 599, c: 600 + i * 0.5 + k * 0.02, v: 1000 })
    })
  })
  return { chart: to240(stock), spy: to240(spy) }
}
const fredWith = (line) => fs.readFileSync(FRED, 'utf8')
  .replace("lineTicker  = input('SP:SPX',", `lineTicker  = input('${line}',`)

let installed = []
beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
})
afterEach(() => {
  for (const id of installed) registry.uninstallUserDefinition(id)
  installed = []
  resetRuntimeSessions()
  resetRuntimeLedgers()
  vi.unstubAllEnvs()
})

function rsLineOn(tf, chart, spy) {
  const src = fredWith('AMEX:SPY')
  expect(src).toContain("input('AMEX:SPY',")
  const d = memberPaneDefinition({ source: src, id: `u_e98-fred-${tf}`, name: 'fred' })
  expect(d.ok, d.reason).toBe(true)
  const { installed: got, errors } = registry.installUserDefinitions([d.definition])
  expect(got.length, errors.join(' | ')).toBe(1)
  installed.push(got[0].id)
  const ctx = { tf, newestBarIsForming: false, historyFromListing: false,
    symbol: { ticker: 'AGL', exchange: 'NYSE', industry: 'Medical Care Facilities', sector: 'Healthcare', securityType: 'stock' },
    secondary: new Map([['SPY', { bars: spy, status: 'available' }]]), exchangeOf: (t) => (t === 'SPY' ? 'NYSE Arca' : null) }
  const cols = registry.computeFor(got[0], chart, {}, ctx)
  expect(Object.keys(cols)).toContain('value')
  return Array.from(cols.value)
}

describe('(c) Fred RS draws its RS line on a 4h chart', () => {
  it('on 240: the RS line on >= 99% of bars, each close / SPY x 4200 x 80% (isweekly = 0)', () => {
    const { chart, spy } = synthetic(200)
    expect(chart.length).toBe(1000)
    const line = rsLineOn('240', chart, spy)
    const drawn = line.filter(Number.isFinite).length
    expect(drawn / chart.length).toBeGreaterThanOrEqual(0.99)
    const spyAt = new Map(spy.map((b) => [b.t, b.c]))
    chart.forEach((b, i) => {
      if (Number.isFinite(line[i])) expect(Math.abs(line[i] - (b.c / spyAt.get(b.t)) * 3360), `${b.t}`).toBeLessThan(1e-9)
    })
  })

  it('⛔ CONTROL: the same bars on a code the flags do not answer (120): the line is empty', () => {
    const { chart, spy } = synthetic(200)
    const line = rsLineOn('120', chart, spy)
    expect(line.length).toBe(chart.length)
    expect(line.filter(Number.isFinite).length).toBe(0)
  })
})

// ─── (d) TRADINGVIEW READS isweekly = 0 ON 240 (local, licence-held: never committed) ──────────────────────────────
// Fred RS's line is close / SP:SPX x SpxValue x (timeframe.isweekly ? offset - 10 : offset) / 100: 4200 x 80% = 3360 on
// a stock when `isweekly` is 0, 4200 x 70% = 2940 when it is 1. On the RDDT 240 capture's 16:00 bars (which read the
// day's official close, Q-FRED-4H) the constant is recovered with our held SPX@D rows: plot_0 x SPX / close.
const RUN = 'fred-4h-2026-11-24'
const STORE_ENV = 'UCT_VENDOR_CAPTURE_STORE'
const storeRoot = () => (process.env[STORE_ENV] || '').trim()
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'uct-vendor-batch', 'runs')
const CAP = { id: 'rs-rating-fred6724-4h-rddt-240-2026-11-25', sha256: '1686b267a685088aaa5a8304b1fa360d31da8cacdef94f4869abee6c6aadbefc' }
const SUPPLY = { file: 'rs-rating-fred6724-intra-spy-60-2026-11-21.json', sha256: '5b08df0fc8131392b705d7f0461066a8c93debf8843daa0217f952d4807c5a03' }
function localFile(p, sha256) {
  if (!fs.existsSync(p)) return null
  const got = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  if (got !== sha256) throw new Error(`${path.basename(p)}: the local copy hashes to ${got.slice(0, 12)}, not ${sha256.slice(0, 12)}`)
  return p
}
const skipNote = (what) => `⏭ SKIPPED, NOT VERIFIED — ${what} is absent on this machine (licence-held TradingView / index data, `
  + `kept out of git); put it under $${STORE_ENV}/${RUN}/captures (the supply in <store>/../supply-held) at its recorded hash`

describe('(d) TradingView\'s Fred RS on NYSE:RDDT 240 reads timeframe.isweekly = 0', () => {
  const cap = localFile(path.join(storeRoot(), RUN, 'captures', `${CAP.id}.json`), CAP.sha256)
  const sup = localFile(path.join(storeRoot(), '..', 'supply-held', SUPPLY.file), SUPPLY.sha256)
  const what = !cap ? `the capture ${CAP.id}` : `the SPX supply ${SUPPLY.file}`
  if (!cap || !sup) console.warn(skipNote(what))
  const run = cap && sup ? it : it.skip
  run(cap && sup ? 'every 16:00 bar: close / plot_0 x SPX close = 4200 x 80% (3360), never the weekly 2940'
    : `RDDT 240 isweekly — ${skipNote(what)}`, () => {
    const capture = JSON.parse(fs.readFileSync(cap, 'utf8'))
    expect(capture.timeframe).toBe('240')
    const daily = JSON.parse(fs.readFileSync(sup, 'utf8')).other['SPX@D'].bars
    const spxOn = new Map(daily.map((r) => [new Date(r.t * 1000).toISOString().slice(0, 10), r.c]))
    const close = new Map(capture.bars.rows.map((r) => [r[0], r[4]]))
    const p0 = capture.plotValues.fields.indexOf('plot_0')
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    let n = 0
    for (const r of capture.plotValues.rows) {
      if (r[p0] === null || r[p0] === undefined) continue
      const parts = Object.fromEntries(fmt.formatToParts(new Date(r[0] * 1000)).map((p) => [p.type, p.value]))
      if (`${parts.hour}:${parts.minute}` !== '16:00') continue
      const spx = spxOn.get(`${parts.year}-${parts.month}-${parts.day}`)
      if (!spx) continue
      const k = (r[p0] * spx) / close.get(r[0])
      expect(Math.abs(k - 3360), `${parts.year}-${parts.month}-${parts.day} k=${k}`).toBeLessThan(0.01)
      n += 1
    }
    expect(n).toBeGreaterThan(600)
  })
})

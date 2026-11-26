// ─── ⭐⭐ e98 (Q-FRED-4H) — SP:SPX ON A 4-HOUR CHART: THE LATEST VALUE AT OR BEFORE EACH BAR ──────────────────────────
//
// The rule (`requestWitnesses.json` `periods.240`, `latest-at-or-before`; witnessed on the local `fred-4h-2026-11-24`
// batch, Fred RS on AMEX:SPY / NYSE:RDDT / NYSE:ADT 240, extended hours): the 60 block's rule, over the index's OWN 4h
// bars. A chart bar opening before 09:30 reads the previous session's official close; one opening from the close the
// day's; one inside the session the index's 4h bar that opened at or before it, those bars built from the index's 60m
// rows on its own 09:30-anchored session ([09:30, 13:30) and [13:30, 16:00)). An index 4h bar that HOLDS the session's
// close is closed by the official print (every half-day of the capture).
// ⭐ THE CHART'S OWN 4h BARS are built by the chart's rule (`resampleBars.js::resampleIntradaySession`, anchored at
// 09:30), and the index's entry under the plain key by the SAME rule (`secondaryBars.js`, e95: fetched at 60,
// resampled by `resampleForSpec`). So the grid's slots are the chart's (01:30, 05:30, 09:30, 13:30, 17:30 ET), and the
// TradingView grade lays TradingView's own slots (04:00, 08:00, 12:00, 16:00, `firstSlotMin`) over the same reads.
// The rating's daily reads (`"D"` on a 4h chart) are NOT witnessed by these captures (the rating label is empty on all
// three): refused by name.
// Synthetic fixtures in the shape the server answers with; the TradingView grade reads the local, licence-held captures
// only when present (`UCT_VENDOR_CAPTURE_STORE`), and SKIPS BY NAME otherwise.
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
import {
  resolveOtherSymbols, requestWitnessRows, setRequestWitnessRows, heldFetchOf, heldFetchesOf, heldDepthOf,
  atOrBeforeGridOf, witnessReadOf, periodBlockServes, OTHER_SYMBOL_REFUSAL as R,
} from './otherSymbols'
import { symbolsNeeded } from './sourceRef'
import { clearSecondaryBars } from './secondaryBars'
import { resampleSpec } from '../timeframes'
import { resampleForSpec } from '../../../utils/resampleBars'

vi.setConfig({ testTimeout: 120000 })

// EST (UTC-5). Day 1 Monday 2026-11-16, day 2 Tuesday 2026-11-17; 2026-11-27 is a half-day (13:00 close).
const ET = (day, hh, mm) => {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000
}
const D1 = '2026-11-16'
const D2 = '2026-11-17'
const HALF = '2026-11-27'
const utcMid = (day) => Date.parse(`${day}T00:00:00Z`) / 1000
const HOUR = 3600
// The index's 60m rows as our store holds them: 09:30, 10:30, ... 15:30 (12:30 the last on a half-day), unix seconds
const spx60Of = (day, base, n = 7) => Array.from({ length: n }, (_, k) => ({
  t: ET(day, 9, 30) + k * HOUR, o: base + k - 0.5, h: base + k + 1, l: base + k - 1, c: base + k, v: 1e6 }))
const SPX_60 = [...spx60Of(D1, 7300), ...spx60Of(D2, 7400)]
// The index's 4h bars, built by the SAME rule as the chart's and as the plain key's entry (`secondaryBars.js`)
const to240 = (rows) => resampleForSpec(rows, resampleSpec('240'))
const SPX_240 = to240(SPX_60)
// Its official daily closes (the closing auction: never a 60m row's last print)
const SPX_D = [{ t: utcMid('2026-11-13'), o: 1, h: 1, l: 1, c: 7200.5, v: 1 }, { t: utcMid(D1), o: 1, h: 1, l: 1, c: 7310.25, v: 1 },
  { t: utcMid(D2), o: 1, h: 1, l: 1, c: 7410.75, v: 1 }]

const secondaryOf = (intraday = SPX_240, daily = SPX_D, dailyForming = false) => new Map([
  ['SPX', { bars: intraday, status: 'available' }],
  ['SPX@D', { bars: daily, status: 'available', newestBarIsForming: dailyForming }]])
const ctx240 = (secondary = secondaryOf(), over = {}) => ({
  tf: '240', newestBarIsForming: false, historyFromListing: false,
  symbol: { ticker: 'AGL', exchange: 'NYSE', securityType: 'stock' },
  secondary, exchangeOf: (t) => (t === 'SPX' ? 'SP' : null), ...over,
})
const pine = (lines) => ['//@version=5', 'indicator("e98", overlay = false)', ...lines].join('\n')
const sym = { type: 'sym', value: 'SPX', args: [{ type: 'series', name: 'close' }] }
const symDef = { compute: { kind: 'ast', ast: sym }, meta: { recurrenceOrigin: 'pine', otherSymbols: [{ ticker: 'SPX', spellings: ['SP'] }] } }

// The chart: the product's OWN 4h bars of a stock's extended-hours 60m rows (clock hours before 09:30 and from 16:00,
// 09:30 + whole hours inside the session: `bars_fetch.bucket_60_et_unix_seconds`), resampled by the chart's rule
const stock60Of = (day) => [
  ...[4, 5, 6, 7, 8, 9].map((h) => ET(day, h, 0)),
  ...[0, 1, 2, 3, 4, 5, 6].map((k) => ET(day, 9, 30) + k * HOUR),
  ...[16, 17, 18, 19].map((h) => ET(day, h, 0)),
].map((t, i) => ({ t, o: 50 + i, h: 51 + i, l: 49 + i, c: 50 + i, v: 1000 }))
const CHART = to240([...stock60Of(D1), ...stock60Of(D2)])
// What each of the chart's 4h bars reads (by its OPEN)
const want = (t) => {
  const at = (day, hh, mm) => t === ET(day, hh, mm)
  if (at(D1, 1, 30) || at(D1, 5, 30)) return 7200.5                 // before the open: the previous session's close
  if (at(D1, 9, 30)) return 7303                                      // the index's [09:30, 13:30) bar: the 12:30 row's close
  if (at(D1, 13, 30) || at(D1, 17, 30)) return 7310.25                // [13:30, 16:00) holds the close: the official print; from 16:00 the day's close
  if (at(D2, 1, 30) || at(D2, 5, 30)) return 7310.25
  if (at(D2, 9, 30)) return 7403
  if (at(D2, 13, 30) || at(D2, 17, 30)) return 7410.75
  return undefined
}

let installed = []
function install(def) {
  const { installed: got, errors } = registry.installUserDefinitions([def])
  expect(got.length, errors.join(' | ')).toBe(1)
  installed.push(got[0].id)
  return got[0]
}
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
  setRequestWitnessRows(null)
  resetRuntimeSessions()
  resetRuntimeLedgers()
  clearSecondaryBars()
  vi.unstubAllEnvs()
})

describe('the committed 240 block, and what a 4h chart fetches', () => {
  it('SP:SPX lists 240, its block is witnessed and served: held at 240 (the plain key) and at D', () => {
    const row = requestWitnessRows()['SP:SPX']
    expect(row.timeframes).toContain('240')
    const block = row.periods['240']
    expect(block).toMatchObject({ held: '240', alsoHeld: 'D', reads: { period: 'latest-at-or-before' }, queue_row: 'Q-FRED-4H',
      captured: '2026-11-25' })
    expect(block.witness).toMatch(/rs-rating-fred6724-4h-spy-240-2026-11-25/)
    expect(periodBlockServes(block, '240')).toBe(true)
    // ⭐ the wiring: one list for the chart's fetch, the binder's signature and the harness
    expect(heldFetchOf('SPX', '240')).toEqual({ symbol: 'SPX', tf: '240', key: 'SPX' })
    expect(heldFetchesOf('SPX', '240')).toEqual([{ symbol: 'SPX', tf: '240', key: 'SPX' }, { symbol: 'SPX', tf: 'D', key: 'SPX@D' }])
    const def = memberPaneDefinition({ source: pine(['plot(request.security("SP:SPX", timeframe.period, close))']), id: 'u_e98-f', name: 'f' }).definition
    expect(symbolsNeeded([{ defId: def.id, instanceId: 'i1', inputs: {} }], () => def, '240')).toEqual(['SPX', 'SPX@D'])
    // the daily rows a 600-bar 4h chart spans, counted at 390 regular minutes a session, plus ten
    expect(heldDepthOf(600, '240')).toBe(Math.ceil((600 * 240) / 390) + 10)
  })

  it('witnessReadOf serves timeframe.period on a 4h chart; ⛔ "D" there is not witnessed and refuses by name', () => {
    const row = requestWitnessRows()['SP:SPX']
    expect(witnessReadOf(row, '240', null)).toEqual({ held: '240', key: 'SPX', fold: 'latest-at-or-before', sample: null, alsoKey: 'SPX@D' })
    expect(witnessReadOf(row, '240', undefined)).toMatchObject({ key: 'SPX', fold: 'latest-at-or-before', alsoKey: 'SPX@D' })
    expect(witnessReadOf(row, '240', 'D')).toBe(null)
    const r = resolveOtherSymbols(symDef, { ...ctx240(), requestCode: 'D' })
    expect(r.served).toEqual([])
    expect(r.refused[0].code).toBe(R.WITNESS_TIMEFRAME)
    expect(r.refused[0].reason).toMatch(/on a `240` chart is witnessed only as read at `timeframe.period` \(capture-queue row Q-FRED-4H\)/)
  })

  it('⛔ the other unwitnessed intraday timeframes still refuse by name (3, 45, 120)', () => {
    for (const tf of ['3', '45', '120']) {
      expect(heldFetchesOf('SPX', tf), tf).toEqual([])
      const r = resolveOtherSymbols(symDef, ctx240(undefined, { tf }))
      expect(r.served, tf).toEqual([])
      expect(r.refused[0].code, tf).toBe(R.WITNESS_TIMEFRAME)
    }
  })

  it('⛔ a 240 block that is not held at 240, or names a seed\'s shape, serves nothing', () => {
    const block = requestWitnessRows()['SP:SPX'].periods['240']
    expect(periodBlockServes({ ...block, held: '60' }, '240')).toBe(false)
    expect(periodBlockServes({ ...block, alsoHeld: undefined }, '240')).toBe(false)
    expect(periodBlockServes({ held: 'D', reads: { D: 'utc-midnight-at-or-after' }, witness: 'w', captured: 'c' }, '240')).toBe(false)
  })
})

describe('the grid on the chart\'s own 4h bars (`atOrBeforeGridOf`)', () => {
  it('the slots are the chart\'s (anchored at 09:30); each reads by its open', () => {
    const grid = atOrBeforeGridOf(SPX_240, SPX_D, '240')
    const times = CHART.map((b) => b.t)
    // ⭐ non-vacuity: every chart bar is a grid slot, and the chart has the five slots a session
    expect(CHART.length).toBe(10)
    expect(grid.slice(0, 10).map((r) => r.t)).toEqual(times)
    for (const r of grid.slice(0, 10)) expect(r.c, new Date(r.t * 1000).toISOString()).toBe(want(r.t))
    // and the next session's pre-market slots read the newest held close (as on every intraday grid)
    expect(grid.slice(10).map((r) => [r.t, r.c])).toEqual([[ET('2026-11-18', 1, 30), 7410.75], [ET('2026-11-18', 5, 30), 7410.75]])
  })

  it('TradingView\'s extended-hours grid (04:00, 08:00, 12:00, 16:00) reads the same rule (`firstSlotMin`)', () => {
    const byT = new Map(atOrBeforeGridOf(SPX_240, SPX_D, '240', { firstSlotMin: 240 }).map((r) => [r.t, r.c]))
    expect(byT.get(ET(D2, 4, 0))).toBe(7310.25)
    expect(byT.get(ET(D2, 8, 0))).toBe(7310.25)
    expect(byT.get(ET(D2, 12, 0))).toBe(7403)     // the [09:30, 13:30) bar, opened at or before 12:00
    expect(byT.get(ET(D2, 16, 0))).toBe(7410.75)
    expect(byT.size).toBe(10)                     // two sessions' four slots, and the next one's two pre-market slots
  })

  it('a half-day: the [09:30, 13:30) bar holds the 13:00 close, so it reads the official print once the day is held', () => {
    const s = to240(spx60Of(HALF, 7500, 4))
    const daily = [...SPX_D, { t: utcMid('2026-11-25'), o: 1, h: 1, l: 1, c: 7480.5, v: 1 }, { t: utcMid(HALF), o: 1, h: 1, l: 1, c: 7504.25, v: 1 }]
    const byT = new Map(atOrBeforeGridOf(s, daily, '240').map((r) => [r.t, r.c]))
    expect(byT.get(ET(HALF, 9, 30))).toBe(7504.25)
    expect(byT.get(ET(HALF, 13, 30))).toBe(7504.25)     // from the 13:00 close: the day's close
    expect(byT.get(ET(HALF, 5, 30))).toBe(7480.5)       // Thanksgiving is no session: the previous one is 11-25
    // ⛔ while the day's row is not held (forming), the bar's own last print, never a guessed close
    const forming = new Map(atOrBeforeGridOf(s, daily, '240', { dailyForming: true }).map((r) => [r.t, r.c]))
    expect(forming.get(ET(HALF, 9, 30))).toBe(7503)
  })

  it('⛔ a native timeframe never takes the official close for an in-session bar (30m: the 15:30 row is its own print)', () => {
    const spx30 = Array.from({ length: 13 }, (_, k) => ({ t: ET(D2, 9, 30) + k * 1800, o: 1, h: 9000, l: 0, c: 7400 + k, v: 1 }))
    const byT = new Map(atOrBeforeGridOf(spx30, SPX_D, '30').map((r) => [r.t, r.c]))
    expect(byT.get(ET(D2, 15, 30))).toBe(7412)
    expect(byT.get(ET(D2, 16, 0))).toBe(7410.75)
  })
})

describe('the bind and the host lane on a 4h chart', () => {
  it('the bind serves SP:SPX on the chart\'s slots, from the plain key and SPX@D', () => {
    const r = resolveOtherSymbols(symDef, ctx240())
    expect(r.served).toEqual(['SPX'])
    const byT = new Map(r.symbols.SPX.map((b) => [b.t, b.c]))
    expect(CHART.map((b) => [b.t, byT.get(b.t)])).toEqual(CHART.map((b) => [b.t, want(b.t)]))
    // ⛔ without the daily rows: pending by name, never drawn from the 4h bars alone
    const p = resolveOtherSymbols(symDef, ctx240(new Map([['SPX', { bars: SPX_240, status: 'available' }]])))
    expect(p.served).toEqual([])
    expect(p.refused[0].code).toBe(R.NO_BARS)
    expect(p.refused[0].pending).toBe(true)
  })

  it('Fred RS-style line: close / SP:SPX x k on every chart bar', () => {
    const d = memberPaneDefinition({ source: pine(['plot(close / request.security("SP:SPX", timeframe.period, close) * 3360, "rs")']), id: 'u_e98-rs', name: 'rs' })
    expect(d.ok, d.reason).toBe(true)
    const def = install(d.definition)
    const cols = registry.computeFor(def, CHART, {}, ctx240())
    const col = cols[Object.keys(cols)[0]]
    CHART.forEach((b, i) => expect(Math.abs(col[i] - (b.c / want(b.t)) * 3360), `${b.t}`).toBeLessThan(1e-9))
  })
})

// ─── TRADINGVIEW'S OWN NUMBERS (local, licence-held: never committed) ───────────────────────────────────────────────────
// The captures' `plot_0` is Fred RS's line, close / SPX x SpxValue x offset% (4200 x 90% on a fund, x 80% on a stock:
// `syminfo.industry == 'Investment Trusts/Mutual Funds'`), so close / plot_0 x k is TradingView's SP:SPX on each bar.
// Graded against the rule over OUR held rows (`supply-held/…-spy-60-2026-11-21.json`: production's /api/bars/SPX?tf=60
// and SPX@D, to 2026-11-20), the 60m rows resampled by the chart's own rule, on TradingView's 04:00..16:00 slots.
const RUN = 'fred-4h-2026-11-24'
const STORE_ENV = 'UCT_VENDOR_CAPTURE_STORE'
const storeRoot = () => (process.env[STORE_ENV] || '').trim()
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'uct-vendor-batch', 'runs')
const SUPPLY = { file: 'rs-rating-fred6724-intra-spy-60-2026-11-21.json', sha256: '5b08df0fc8131392b705d7f0461066a8c93debf8843daa0217f952d4807c5a03' }
const CAPS = [
  { sym: 'SPY', k: 3780, id: 'rs-rating-fred6724-4h-spy-240-2026-11-25', sha256: '969125e449b904c907cd0232910535493baa683f9a09b1eca7f844b385c538af',
    want: { pre: [1462, 0], in: [728, 2], post: [730, 0] } },
  { sym: 'RDDT', k: 3360, id: 'rs-rating-fred6724-4h-rddt-240-2026-11-25', sha256: '1686b267a685088aaa5a8304b1fa360d31da8cacdef94f4869abee6c6aadbefc',
    want: { pre: [1334, 0], in: [669, 2], post: [671, 0] } },
  { sym: 'ADT', k: 3360, id: 'rs-rating-fred6724-4h-adt-240-2026-11-25', sha256: 'fca1969108bb302262d98e26acec0067d2e878a463638dc1e92baa9b3c332dfd',
    want: { pre: [1119, 0], in: [728, 2], post: [725, 0] } },
]
/** The two in-session days our store's 60m rows differ from TradingView's SP:SPX (the 12:30 row's close, by 0.16 and
 *  0.66: index data, not the rule). Named, so a new difference fails. */
const DATA_DAYS = ['2024-09-19', '2026-01-06']
const ONE_CENT = 0.0101
function localFile(p, sha256) {
  if (!fs.existsSync(p)) return null
  const got = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  if (got !== sha256) throw new Error(`${path.basename(p)}: the local copy hashes to ${got.slice(0, 12)}, not ${sha256.slice(0, 12)}`)
  return p
}
const capturePath = (c) => path.join(storeRoot(), RUN, 'captures', `${c.id}.json`)
const supplyPath = () => path.join(storeRoot(), '..', 'supply-held', SUPPLY.file)
const skipNote = (what) => `⏭ SKIPPED, NOT VERIFIED — ${what} is absent on this machine (licence-held TradingView / index data, `
  + `kept out of git); put the captures in $${STORE_ENV}/${RUN}/captures and the supply in <store>/../supply-held at their recorded hashes`
const etParts = (t) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t * 1000))
  const g = (k) => p.find((x) => x.type === k).value
  return { day: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour')}:${g('minute')}` }
}

describe('⭐ TradingView\'s Fred RS on 4h: the implied SP:SPX per bar equals the rule over our held rows', () => {
  for (const c of CAPS) {
    const cap = localFile(capturePath(c), c.sha256)
    const sup = localFile(supplyPath(), SUPPLY.sha256)
    const run = cap && sup ? it : it.skip
    if (!cap || !sup) {
      console.warn(skipNote(!sup ? `the SPX supply ${SUPPLY.file}` : `the capture ${c.id}`))
    }
    run(cap && sup ? `${c.sym} 240: every pre-market / post-market bar exact; in-session exact but the two named data days`
      : `${c.sym} 240 — ${skipNote(!sup ? `the SPX supply ${SUPPLY.file}` : `the capture ${c.id}`)}`, () => {
      const capture = JSON.parse(fs.readFileSync(cap, 'utf8'))
      const supply = JSON.parse(fs.readFileSync(sup, 'utf8')).other
      expect(capture.timeframe).toBe('240')
      expect(capture.symbol.session).toBe('0400-2000')
      const h60 = supply.SPX.bars
      const daily = supply['SPX@D'].bars
      const grid = new Map(atOrBeforeGridOf(to240(h60), daily, '240', { firstSlotMin: 240 }).map((r) => [r.t, r.c]))
      const close = new Map(capture.bars.rows.map((r) => [r[0], r[4]]))
      const p0 = capture.plotValues.fields.indexOf('plot_0')
      const counts = { pre: [0, 0], in: [0, 0], post: [0, 0] }
      const off = []
      for (const r of capture.plotValues.rows) {
        const rs = r[p0]
        const ours = grid.get(r[0])
        if (rs === null || rs === undefined || ours === undefined) continue
        const tv = (close.get(r[0]) / rs) * c.k
        const { day, hm } = etParts(r[0])
        const kind = hm < '09:30' ? 'pre' : hm >= '16:00' ? 'post' : 'in'
        const ok = Math.abs(tv - ours) <= ONE_CENT
        counts[kind][ok ? 0 : 1] += 1
        if (!ok) off.push(day)
      }
      expect(counts).toEqual(c.want)
      expect(off).toEqual(DATA_DAYS)
    })
  }
})

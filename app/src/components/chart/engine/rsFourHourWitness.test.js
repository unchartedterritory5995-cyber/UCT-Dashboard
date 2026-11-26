// ─── ⭐⭐ e98 (Q-FRED-4H) — SP:SPX ON A 4-HOUR CHART: THE LATEST VALUE AT OR BEFORE EACH BAR ──────────────────────────
//
// The rule (`requestWitnesses.json` `periods.240`, `latest-at-or-before`; witnessed on the local `fred-4h-2026-11-24`
// batch, Fred RS on AMEX:SPY / NYSE:RDDT / NYSE:ADT 240, extended hours): the 60 block's rule, over the index's OWN 4h
// bars. A chart bar opening before 09:30 reads the previous session's official close; one opening from the close the
// day's; one inside the session the index's 4h bar that opened at or before it, those bars built from the index's 60m
// rows on its own 09:30-anchored session ([09:30, 13:30) and [13:30, 16:00)). An index 4h bar that HOLDS the session's
// close is closed by the official print (every half-day of the capture).
// ⭐⭐ (2026-11-26) THE GRID FOLLOWS THE CHART'S SPEC. The product has two 240 specs (`timeframes.js::resampleSpec`): the
// REGULAR chart's bars start 09:30 (two a day, 09:30 and 13:30, from regular-session rows only, #2788), the EXTENDED
// chart's 04:00 (04:00, 08:00, 12:00, 16:00, TradingView's grid). The grid's slots start where the CHART's spec starts
// its bars (the chart's session rides its secondary map, `CHART_SESSION_KEY`): a regular chart 01:30, 05:30, 09:30,
// 13:30, 17:30, an extended one 04:00, 08:00, 12:00, 16:00. ⚰️ Before, the grid laid the 09:30-anchored slots on every
// chart, so an EXTENDED 4h chart read SP:SPX on none of its bars, and the TradingView grade (an extended-hours batch)
// passed only because this rail handed the grid TradingView's slots itself (`firstSlotMin`, now gone).
// ⭐ THE INDEX'S 4h BARS are built on the index's own 09:30-anchored session whatever the chart's view (the witness):
// a key a witness row holds is fetched on the regular session (`useSecondarySources.js::ensureChartSources`).
// Each synthetic chart below is built with the EXPLICIT spec of the chart it stands for.
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
import { clearSecondaryBars, cachedBars } from './secondaryBars'
import { CHART_SESSION_KEY, chartSessionEntryOf, otherSymbolsSignature } from './otherSymbols'
import { ensureChartSources, liveTailTick } from './useSecondarySources'
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
// The index's 4h bars, built on its own REGULAR session (the plain key's entry: `secondaryBars.js`, fetched on the
// regular session for a held key whatever the chart's view, `ensureChartSources`)
const RTH_240 = resampleSpec('240', { extended: false })
const ETH_240 = resampleSpec('240', { extended: true })
const to240 = (rows) => resampleForSpec(rows, RTH_240)
const SPX_240 = to240(SPX_60)
// Its official daily closes (the closing auction: never a 60m row's last print)
const SPX_D = [{ t: utcMid('2026-11-13'), o: 1, h: 1, l: 1, c: 7200.5, v: 1 }, { t: utcMid(D1), o: 1, h: 1, l: 1, c: 7310.25, v: 1 },
  { t: utcMid(D2), o: 1, h: 1, l: 1, c: 7410.75, v: 1 }]

// `extended`: the CHART's session, as the chart's map carries it (`ensureChartSources`); null: a map that names none
const secondaryOf = (intraday = SPX_240, daily = SPX_D, dailyForming = false, extended = false) => new Map([
  ['SPX', { bars: intraday, status: 'available' }],
  ['SPX@D', { bars: daily, status: 'available', newestBarIsForming: dailyForming }],
  ...(extended === null ? [] : [[CHART_SESSION_KEY, chartSessionEntryOf(extended)]])])
const ctx240 = (secondary = secondaryOf(), over = {}) => ({
  tf: '240', newestBarIsForming: false, historyFromListing: false,
  symbol: { ticker: 'AGL', exchange: 'NYSE', securityType: 'stock' },
  secondary, exchangeOf: (t) => (t === 'SPX' ? 'SP' : null), ...over,
})
const pine = (lines) => ['//@version=5', 'indicator("e98", overlay = false)', ...lines].join('\n')
const sym = { type: 'sym', value: 'SPX', args: [{ type: 'series', name: 'close' }] }
const symDef = { compute: { kind: 'ast', ast: sym }, meta: { recurrenceOrigin: 'pine', otherSymbols: [{ ticker: 'SPX', spellings: ['SP'] }] } }

// THE REGULAR CHART: the product's own 4h bars of a stock's REGULAR-view 60m page (the 60m session grid: clock hours
// before 09:30 and from 16:00, 09:30 + whole hours inside: `bars_fetch.bucket_60_et_unix_seconds`), by the REGULAR spec
// (regular-session rows only, #2788): 09:30 and 13:30.
const stock60Of = (day) => [
  ...[4, 5, 6, 7, 8, 9].map((h) => ET(day, h, 0)),
  ...[0, 1, 2, 3, 4, 5, 6].map((k) => ET(day, 9, 30) + k * HOUR),
  ...[16, 17, 18, 19].map((h) => ET(day, h, 0)),
].map((t, i) => ({ t, o: 50 + i, h: 51 + i, l: 49 + i, c: 50 + i, v: 1000 }))
const CHART_RTH = resampleForSpec([...stock60Of(D1), ...stock60Of(D2)], RTH_240)
// THE EXTENDED CHART (the Q-FRED-4H batch's: session 0400-2000): the product's own 4h bars of the EXTENDED-view 60m page
// (`&session=eth`: TradingView's clock-hour grid, 04:00 .. 19:00), by the EXTENDED spec: 04:00, 08:00, 12:00, 16:00.
const stockEth60Of = (day) => Array.from({ length: 16 }, (_, k) => ET(day, 4 + k, 0))
  .map((t, i) => ({ t, o: 60 + i, h: 61 + i, l: 59 + i, c: 60 + i, v: 1000 }))
const CHART_ETH = resampleForSpec([...stockEth60Of(D1), ...stockEth60Of(D2)], ETH_240)
const hm = (day, hh, mm) => ET(day, hh, mm)
const RTH_BARS = [hm(D1, 9, 30), hm(D1, 13, 30), hm(D2, 9, 30), hm(D2, 13, 30)]
const ETH_BARS = [hm(D1, 4, 0), hm(D1, 8, 0), hm(D1, 12, 0), hm(D1, 16, 0), hm(D2, 4, 0), hm(D2, 8, 0), hm(D2, 12, 0), hm(D2, 16, 0)]
// What a chart bar opening at `t` reads (by its OPEN), on either chart
const want = (t) => {
  for (const [day, prev, inSession, own] of [[D1, 7200.5, 7303, 7310.25], [D2, 7310.25, 7403, 7410.75]]) {
    if (t < ET(day, 0, 0) || t >= ET(day, 20, 0)) continue
    if (t < ET(day, 9, 30)) return prev                  // before the open: the previous session's official close
    if (t < ET(day, 13, 30)) return inSession            // the index's [09:30, 13:30) bar: the 12:30 row's close
    return own                                           // [13:30, 16:00) holds the close: the official print; from 16:00 the day's
  }
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

  it('the chart\'s map: SP:SPX fetched on the index\'s own regular session in BOTH views, a listing on the chart\'s, and the chart\'s session beside them', async () => {
    for (const extended of [false, true]) {
      clearSecondaryBars()
      const asked = []
      const map = ensureChartSources(['SPX', 'SPX@D', 'QQQ'], '240', 300, (url) => { asked.push(url); return new Promise(() => {}) }, null, 0, extended)
      await Promise.resolve()
      const spx = asked.filter((u) => u.startsWith('/api/bars/SPX?tf=60&'))
      expect(spx.length, String(extended)).toBe(1)
      expect(spx[0], String(extended)).not.toContain('session=')           // the index's own session, whatever the view
      const qqq = asked.filter((u) => u.startsWith('/api/bars/QQQ?'))
      expect(qqq.length).toBe(1)
      expect(qqq[0].includes('&session=eth'), String(extended)).toBe(extended)   // a listing: the chart's own grid (#2753)
      expect(map.get(CHART_SESSION_KEY)).toBe(chartSessionEntryOf(extended))
      expect(map.get(CHART_SESSION_KEY).extended).toBe(extended)
    }
    // ⛔ a native chart's map carries no session (its grid has one spec)
    clearSecondaryBars()
    expect(ensureChartSources(['SPX', 'SPX@D'], '60', 300, () => new Promise(() => {}), null, 0, true).has(CHART_SESSION_KEY)).toBe(false)
  })

  it('the live tail on an EXTENDED 4h chart re-reads the index entry on the session it was fetched on (regular)', async () => {
    clearSecondaryBars()
    const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() }
    ensureChartSources(['SPX'], '240', 300, () => Promise.resolve({ bars: SPX_60, newest_bar_is_forming: true }), null, 0, true)
    await flush()
    expect(cachedBars('SPX', '240', 300, { extended: false })?.status).toBe('available')
    expect(cachedBars('SPX', '240', 300, { extended: true })).toBe(null)
    const asked = []
    const started = liveTailTick(['SPX'], '240', 300, (url) => { asked.push(url); return new Promise(() => {}) }, null, null, 0, true)
    await flush()
    expect(started).toBe(1)
    expect(asked.length).toBe(1)
    expect(asked[0]).toMatch(/^\/api\/bars\/SPX\?tf=60&/)
    expect(asked[0]).not.toContain('session=')
  })
})

describe('the grid on the chart\'s own 4h bars (`atOrBeforeGridOf`)', () => {
  it('the charts are what each spec builds: REGULAR 09:30 / 13:30, EXTENDED 04:00 / 08:00 / 12:00 / 16:00', () => {
    expect(RTH_240.anchorMin).not.toBe(ETH_240.anchorMin)
    expect(CHART_RTH.map((b) => b.t)).toEqual(RTH_BARS)
    expect(CHART_ETH.map((b) => b.t)).toEqual(ETH_BARS)
  })

  it('(b) a REGULAR chart\'s slots start where its spec starts its bars (01:30 .. 17:30); each chart bar is a slot and reads by its open', () => {
    for (const grid of [atOrBeforeGridOf(SPX_240, SPX_D, '240', { extended: false }), atOrBeforeGridOf(SPX_240, SPX_D, '240')]) {
      const slots = grid.map((r) => r.t)
      expect(slots.slice(0, 10)).toEqual([D1, D2].flatMap((d) => [[1, 30], [5, 30], [9, 30], [13, 30], [17, 30]].map(([h, m]) => ET(d, h, m))))
      for (const t of RTH_BARS) expect(grid.find((r) => r.t === t)?.c, new Date(t * 1000).toISOString()).toBe(want(t))
      for (const r of grid.slice(0, 10)) expect(r.c).toBe(want(r.t))
      // and the next session's pre-market slots read the newest held close (as on every intraday grid)
      expect(grid.slice(10).map((r) => [r.t, r.c])).toEqual([[ET('2026-11-18', 1, 30), 7410.75], [ET('2026-11-18', 5, 30), 7410.75]])
    }
  })

  it('(a) an EXTENDED chart\'s slots are its own bars (04:00, 08:00, 12:00, 16:00), each read by its open', () => {
    const grid = atOrBeforeGridOf(SPX_240, SPX_D, '240', { extended: true })
    expect(grid.slice(0, 8).map((r) => r.t)).toEqual(ETH_BARS)
    for (const r of grid.slice(0, 8)) expect(r.c, new Date(r.t * 1000).toISOString()).toBe(want(r.t))
    const byT = new Map(grid.map((r) => [r.t, r.c]))
    expect(byT.get(ET(D2, 12, 0))).toBe(7403)     // the index's [09:30, 13:30) bar, opened at or before 12:00
    expect(byT.get(ET(D2, 16, 0))).toBe(7410.75)  // the day's official close
    expect(grid.slice(8).map((r) => [r.t, r.c])).toEqual([[ET('2026-11-18', 4, 0), 7410.75], [ET('2026-11-18', 8, 0), 7410.75]])
  })

  it('⛔ the two grids share no slot: a regular chart\'s grid holds none of the extended bars, and the extended grid none of the regular ones', () => {
    const rth = new Set(atOrBeforeGridOf(SPX_240, SPX_D, '240', { extended: false }).map((r) => r.t))
    const eth = new Set(atOrBeforeGridOf(SPX_240, SPX_D, '240', { extended: true }).map((r) => r.t))
    expect(rth.size).toBe(12)
    expect(eth.size).toBe(10)
    for (const t of ETH_BARS) expect(rth.has(t), new Date(t * 1000).toISOString()).toBe(false)
    for (const t of RTH_BARS) expect(eth.has(t), new Date(t * 1000).toISOString()).toBe(false)
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
  it('the bind serves SP:SPX on EACH chart\'s own bars, by the session its map carries (`CHART_SESSION_KEY`)', () => {
    for (const [extended, chart] of [[false, CHART_RTH], [true, CHART_ETH]]) {
      const r = resolveOtherSymbols(symDef, ctx240(secondaryOf(SPX_240, SPX_D, false, extended)))
      expect(r.served).toEqual(['SPX'])
      const byT = new Map(r.symbols.SPX.map((b) => [b.t, b.c]))
      expect(chart.map((b) => [b.t, byT.get(b.t)]), String(extended)).toEqual(chart.map((b) => [b.t, want(b.t)]))
      // ⛔ and the OTHER chart's bars are not on this grid
      const other = extended ? CHART_RTH : CHART_ETH
      for (const b of other) expect(byT.has(b.t), `${extended} ${b.t}`).toBe(false)
    }
    // a map that names no session: `resampleSpec`'s own default, the regular chart
    const plain = new Map(resolveOtherSymbols(symDef, ctx240(secondaryOf(SPX_240, SPX_D, false, null))).symbols.SPX.map((b) => [b.t, b.c]))
    expect(CHART_RTH.map((b) => plain.get(b.t))).toEqual(CHART_RTH.map((b) => want(b.t)))
    // ⛔ without the daily rows: pending by name, never drawn from the 4h bars alone
    const p = resolveOtherSymbols(symDef, ctx240(new Map([['SPX', { bars: SPX_240, status: 'available' }]])))
    expect(p.served).toEqual([])
    expect(p.refused[0].code).toBe(R.NO_BARS)
    expect(p.refused[0].pending).toBe(true)
  })

  it('an EXT toggle is a recompute: the bind\'s signature names the chart\'s session on a 4h chart', () => {
    const rth = otherSymbolsSignature(symDef, secondaryOf(SPX_240, SPX_D, false, false), '240')
    const eth = otherSymbolsSignature(symDef, secondaryOf(SPX_240, SPX_D, false, true), '240')
    expect(rth).not.toBe(eth)
    expect(eth).toMatch(/\|session:eth$/)
  })

  const rsLine = (chart, secondary, id) => {
    const d = memberPaneDefinition({ source: pine(['plot(close / request.security("SP:SPX", timeframe.period, close) * 3360, "rs")']), id, name: 'rs' })
    expect(d.ok, d.reason).toBe(true)
    const def = install(d.definition)
    const cols = registry.computeFor(def, chart, {}, ctx240(secondary))
    return Array.from(cols[Object.keys(cols)[0]])
  }

  it('(a) EXTENDED 240: the Fred RS-style line (close / SP:SPX x k) is finite and right on EVERY chart bar, read at the bar\'s own slot', () => {
    const col = rsLine(CHART_ETH, secondaryOf(SPX_240, SPX_D, false, true), 'u_e98-rs-eth')
    expect(col.length).toBe(8)
    CHART_ETH.forEach((b, i) => {
      expect(Number.isFinite(col[i]), `${b.t}`).toBe(true)
      expect(Math.abs(col[i] - (b.c / want(b.t)) * 3360), `${b.t}`).toBeLessThan(1e-9)
    })
  })

  it('(b) REGULAR 240: finite and right on BOTH regular bars of every day (09:30 and 13:30)', () => {
    const col = rsLine(CHART_RTH, secondaryOf(SPX_240, SPX_D, false, false), 'u_e98-rs-rth')
    expect(col.length).toBe(4)
    CHART_RTH.forEach((b, i) => {
      expect(Number.isFinite(col[i]), `${b.t}`).toBe(true)
      expect(Math.abs(col[i] - (b.c / want(b.t)) * 3360), `${b.t}`).toBeLessThan(1e-9)
    })
  })
})

// ─── TRADINGVIEW'S OWN NUMBERS (local, licence-held: never committed) ───────────────────────────────────────────────────
// The captures' `plot_0` is Fred RS's line, close / SPX x SpxValue x offset% (4200 x 90% on a fund, x 80% on a stock:
// `syminfo.industry == 'Investment Trusts/Mutual Funds'`), so close / plot_0 x k is TradingView's SP:SPX on each bar.
// Graded against the rule over OUR held rows (`supply-held/…-spy-60-2026-11-21.json`: production's /api/bars/SPX?tf=60
// and SPX@D, to 2026-11-20), the 60m rows resampled on the index's own regular session, read through the BIND on a map
// that carries the capture's own session (0400-2000: extended), so the grid lays the chart's slots itself (no override).
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
      const extended = capture.symbol.session === '0400-2000'
      const bound = resolveOtherSymbols(symDef, ctx240(secondaryOf(to240(h60), daily, false, extended)))
      expect(bound.served).toEqual(['SPX'])
      const grid = new Map(bound.symbols.SPX.map((r) => [r.t, r.c]))
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

// app/src/components/chart/engine/__tests__/vendorHarness/strategyReadbackWitness.test.js
//
// ─── VALUE READ-BACKS: WHAT THE STRATEGY CAPTURES WITNESS, READ OFF THE CAPTURES ALONE ───────────
//
// Four broker facts no TradingView text states are served (behind their own rules, unpinned) because
// the committed strategy captures SHOW them. This file re-derives each one from the captures and
// nothing else: no engine import, no broker run. It reads only what TradingView itself reported (the
// Strategy Tester's fills and trades, the bars, the plotted `strategy.*` values) and asserts the fact
// on every row that can show it, with the counts pinned, and with the alternative rules shown to FAIL
// on the same rows (so the data separates the rule served from the ones not served).
//
//   B-ROUND       a fill on a bar OPEN off the tick grid is that open rounded to the nearest tick, a tie up
//   B-ROUND-MARK  open trades are marked at the CLOSE rounded the same way (`strategy.openprofit`)
//   (W9-K1..K3)   an open trade's paid entry fee is in `strategy.netprofit`, not in `strategy.openprofit`
//   (B-VAL)       `strategy.closedtrades.entry_time` / `exit_time` are the fill BAR's `time`, in ms
//
// The captures: every `tests/fixtures/vendor/harness/<id>-2026-11-15.json` strategy capture (runs
// s25 / s26 / s27, 2026-11-15). The same table, by capture: docs/pine/evidence/2026-11-15-strategy-readbacks/.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { HARNESS_DIR } from './harness'
import { referenceOfCapture, tickOfCapture } from '../../../../../../../tools/vendor_harness/strategy_reference.mjs'

const FILES = fs.readdirSync(HARNESS_DIR).filter((f) => /^(w9-|s1-broker).*-2026-11-15\.json$/.test(f)).sort()
const CAPTURES = FILES.map((f) => JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, f), 'utf8')))
const shortId = (c) => c.id.replace(/-2026-11-15$/, '')

const offGrid = (px, tick) => Math.abs(px / tick - Math.round(px / tick)) > 1e-6
/** the rule served: the nearest tick, a tie up */
const nearestTieUp = (px, tick) => Math.floor(px / tick + 0.5 + 1e-6) * tick
/** the rules NOT served, as controls */
const nearestTieDown = (px, tick) => Math.ceil(px / tick - 0.5 - 1e-6) * tick
const floorTick = (px, tick) => Math.floor(px / tick + 1e-9) * tick
const ceilTick = (px, tick) => Math.ceil(px / tick - 1e-9) * tick
const at = (a, b, tick) => Math.abs(a - b) < tick / 1000
const kindOf = (px, tick) => { const k = px / tick; const frac = k - Math.floor(k); return Math.abs(frac - 0.5) < 1e-6 ? 'tie' : frac > 0.5 ? 'above' : 'below' }
/** a plot column of the capture by its style title, as an index into `plotValues.rows[i]` (or -1) */
const colOf = (c, title) => c.plotValues.fields.findIndex((f, i) => i > 0 && c.study.styles[f] && c.study.styles[f].title === title)

it('the witnesses are the 33 committed strategy captures of 2026-11-15, each with a readable report', () => {
  expect(CAPTURES).toHaveLength(33)
  for (const c of CAPTURES) expect(referenceOfCapture(c).ok, c.id).toBe(true)
})

describe('[B-ROUND] a fill on an off-grid OPEN is that open rounded to the nearest tick, a tie up', () => {
  // every reported fill that sits at the rounded open of a bar whose open is off the grid
  const rows = []
  let fills = 0
  let offGridFills = 0
  for (const c of CAPTURES) {
    const tick = tickOfCapture(c)
    const bars = new Map(c.bars.rows.map((r) => [r[0], r]))
    const ref = referenceOfCapture(c)
    expect(ref.fillsTimed, c.id).toBe(true)
    for (const f of ref.fills) {
      fills += 1
      if (offGrid(f.price, tick)) offGridFills += 1
      const bar = bars.get(f.time)
      if (!bar || !offGrid(bar[1], tick) || !at(f.price, nearestTieUp(bar[1], tick), tick)) continue
      rows.push({ capture: shortId(c), symbol: c.symbol.pro_name, time: f.time, open: bar[1], tick, price: f.price, type: f.type, side: f.side, role: f.role, kind: kindOf(bar[1], tick) })
    }
  }
  const count = (key) => rows.reduce((m, r) => { m[r[key]] = (m[r[key]] || 0) + 1; return m }, {})

  it('TradingView reports NO fill off the tick grid, in any of the 33 captures (1,402 fills)', () => {
    expect(fills).toBe(1402)
    expect(offGridFills).toBe(0)
  })

  it('96 fills on 18 distinct bars of 23 captures sit at the rounded open: 70 ties (all UP), 22 below a half tick, 4 above', () => {
    expect(rows).toHaveLength(96)
    expect(new Set(rows.map((r) => `${r.symbol}|${r.time}`)).size).toBe(18)
    expect(new Set(rows.map((r) => r.capture)).size).toBe(23)
    expect(count('kind')).toEqual({ tie: 70, below: 22, above: 4 })
    expect(count('side')).toEqual({ buy: 12, sell: 84 })
    expect(count('role')).toEqual({ entry: 27, exit: 65, order: 4 })
    // both symbols: NYSE:RDDT 1D and AMEX:SPY 15
    expect(Object.keys(count('symbol')).sort()).toEqual(['AMEX:SPY', 'NYSE:RDDT'])
  })

  it('⛔ ONLY the witnessed kinds: 93 MARKET fills and 3 STOP fills; no LIMIT, no STOP_LIMIT (those stay refused, Q-S1l)', () => {
    expect(count('type')).toEqual({ MARKET: 93, STOP: 3 })
    // the three stops are exits the open reached, on three different bars
    const stops = rows.filter((r) => r.type === 'STOP')
    expect(stops.map((r) => [r.capture, r.side, r.role, r.kind]).sort()).toEqual([
      ['s1-broker-core-rddt-1d', 'buy', 'exit', 'tie'],
      ['w9-q-s1e-live-past-rddt-1d', 'sell', 'exit', 'below'],
      ['w9-q-s1e-live-past-rddt-1d', 'sell', 'exit', 'tie'],
    ])
  })

  it('⛔ the data SEPARATES the rule: ties-down fails on all 70 ties, floor on 74 rows, ceiling on 22', () => {
    const fails = (rule) => rows.filter((r) => !at(r.price, rule(r.open, r.tick), r.tick)).length
    expect(fails(nearestTieUp)).toBe(0)
    expect(fails(nearestTieDown)).toBe(70)
    expect(fails(floorTick)).toBe(74)
    expect(fails(ceilTick)).toBe(22)
    // a tie filled UP on a SELL is the less favorable direction's opposite: it is rounding, not slippage
    expect(rows.filter((r) => r.kind === 'tie' && r.side === 'sell').length).toBe(60)
    expect(rows.filter((r) => r.kind === 'tie' && r.side === 'buy').length).toBe(10)
  })

  it('W9-K4 (slippage 3): its four market fills on an off-grid open are the ROUNDED open, 3 ticks less favorable', () => {
    const c = CAPTURES.find((x) => shortId(x) === 'w9-k4-slippage-rddt-1d')
    const tick = tickOfCapture(c)
    const bars = new Map(c.bars.rows.map((r) => [r[0], r]))
    const seen = []
    for (const f of referenceOfCapture(c).fills) {
      const bar = bars.get(f.time)
      if (!offGrid(bar[1], tick)) continue
      const slipped = nearestTieUp(bar[1], tick) + (f.side === 'buy' ? 3 : -3) * tick
      expect(at(f.price, slipped, tick), `${f.time}: ${bar[1]} -> ${f.price}`).toBe(true)
      seen.push([bar[1], f.price])
    }
    expect(seen).toEqual([[114.725, 114.7], [244.804, 244.77], [141.875, 141.85], [155.775, 155.75]])
  })
})

describe('[B-ROUND-MARK] strategy.openprofit marks open trades at the close rounded to the nearest tick, a tie up', () => {
  // (rounded close - position_avg_price) x position_size, against the plotted S09_openprofit
  const tally = (c, mark) => {
    const tick = tickOfCapture(c)
    const [ks, ka, ko] = ['S03_position_size', 'S04_position_avg_price', 'S09_openprofit'].map((t) => colOf(c, t))
    if (ks < 0 || ka < 0 || ko < 0) return null
    const bars = new Map(c.bars.rows.map((r) => [r[0], r]))
    const out = { onGrid: 0, onGridOk: 0, off: 0, offOk: 0, kinds: { tie: 0, above: 0, below: 0 } }
    for (const r of c.plotValues.rows) {
      const size = r[ks]
      if (!size || r[ka] === null || r[ko] === null) continue
      const close = bars.get(r[0])[4]
      const ok = Math.abs((mark(close, tick) - r[ka]) * size - r[ko]) < 1e-7 * Math.max(1, Math.abs(r[ko]))
      if (offGrid(close, tick)) { out.off += 1; out.kinds[kindOf(close, tick)] += 1; if (ok) out.offOk += 1 } else { out.onGrid += 1; if (ok) out.onGridOk += 1 }
    }
    return out
  }
  const raw = (px) => px

  it('on every bar of every capture with a position and an ON-grid close, openprofit is (close - avg) x size (no fee in it)', () => {
    let bars = 0
    let withPlots = 0
    for (const c of CAPTURES) {
      const t = tally(c, nearestTieUp)
      if (!t) continue
      withPlots += 1
      expect(t.onGridOk, c.id).toBe(t.onGrid)
      bars += t.onGrid
    }
    expect(withPlots).toBe(32) // every capture but the v3 properties probe, which plots no strategy value
    expect(bars).toBe(10099)
  })

  it('AMEX:SPY 15: on all 47 bars with a position and an OFF-grid close the plot is the ROUNDED close\'s; the raw close explains none', () => {
    const c = CAPTURES.find((x) => shortId(x) === 'w9-r1-risk-intraday-range-spy-15')
    const t = tally(c, nearestTieUp)
    expect(t.off).toBe(47)
    expect(t.offOk).toBe(47)
    expect(t.kinds).toEqual({ tie: 24, above: 10, below: 13 })
    expect(tally(c, raw).offOk).toBe(0)
    // ⛔ the data separates the tie: ties-down explains only the 23 bars that are not ties
    expect(tally(c, nearestTieDown).offOk).toBe(23)
  })

  it('no NYSE:RDDT 1D capture holds a bar with a position and an off-grid close (so there the rule is never reached)', () => {
    for (const c of CAPTURES.filter((x) => x.symbol.pro_name === 'NYSE:RDDT')) {
      const t = tally(c, nearestTieUp)
      if (t) expect(t.off, c.id).toBe(0)
    }
  })
})

describe('(W9-K1..K3) an open trade\'s paid entry fee is in strategy.netprofit, not in strategy.openprofit', () => {
  const FEES = {
    // the probes' declarations (tools/visual_conformance/probes/w9-k{1,2,3}-*.pine), fixed size 1
    'w9-k1-commission-pct-rddt-1d': (price, size) => price * size * 0.1 / 100,
    'w9-k2-commission-contract-rddt-1d': (_price, size) => 1.5 * size,
    'w9-k3-commission-order-rddt-1d': () => 5,
  }
  it.each(Object.keys(FEES))('%s: on all 372 bars in position, netprofit = the flat bar\'s netprofit - the entry fee; openprofit has no fee', (id) => {
    const c = CAPTURES.find((x) => shortId(x) === id)
    expect(c.source.text).toMatch(/commission_value = (0\.1|1\.5|5)[,)]/)
    const [ks, ka, kn, ko, ke] = ['S03_position_size', 'S04_position_avg_price', 'S07_netprofit', 'S09_openprofit', 'S08_equity'].map((t) => colOf(c, t))
    const bars = new Map(c.bars.rows.map((r) => [r[0], r]))
    let flatNet = 0
    let inPosition = 0
    for (const r of c.plotValues.rows) {
      // equity is initial capital + netprofit + openprofit on every bar, with or without a position
      expect(Math.abs(r[ke] - (100000 + r[kn] + r[ko]))).toBeLessThan(1e-6)
      if (!r[ks]) { flatNet = r[kn]; continue }
      inPosition += 1
      const fee = FEES[id](r[ka], Math.abs(r[ks]))
      expect(Math.abs(r[kn] - (flatNet - fee)), `netprofit at ${r[0]}`).toBeLessThan(1e-9)
      expect(Math.abs(r[ko] - (bars.get(r[0])[4] - r[ka]) * r[ks]), `openprofit at ${r[0]}`).toBeLessThan(1e-9)
      // ⛔ the refuted hypothesis (the fee off the open profit) is off by the fee on this very bar
      expect(Math.abs(r[ko] - ((bars.get(r[0])[4] - r[ka]) * r[ks] - fee))).toBeGreaterThan(fee / 2)
    }
    expect(inPosition).toBe(372)
  })
})

describe('(B-VAL) strategy.closedtrades.entry_time / exit_time are the fill BAR\'s `time`, in milliseconds', () => {
  // the std set plots the last closed trade's entry_time (S10) and exit_time (S11); the Strategy Tester's own
  // trade list (in closing order) states each trade's entry and exit bar time
  const check = (c) => {
    const [k6, k10, k11] = ['S06_closedtrades', 'S10_c0_entry_time', 'S11_c0_exit_time'].map((t) => colOf(c, t))
    if (k10 < 0) return null
    const closed = referenceOfCapture(c).trades.filter((t) => !t.open)
    const bars = new Set(c.bars.rows.map((r) => r[0]))
    const out = { bars: 0, timesOfDay: new Set() }
    for (const r of c.plotValues.rows) {
      const n = r[k6]
      if (!(n > 0)) { expect(r[k10], `${c.id} ${r[0]}`).toBeNull(); expect(r[k11]).toBeNull(); continue }
      const t = closed[n - 1]
      expect(r[k10], `${c.id} entry_time at ${r[0]}`).toBe(t.entryTime * 1000)
      expect(r[k11], `${c.id} exit_time at ${r[0]}`).toBe(t.exitTime * 1000)
      // a BAR time of the capture, in UNIX milliseconds (no time zone in it)
      expect(bars.has(r[k10] / 1000) && bars.has(r[k11] / 1000)).toBe(true)
      out.bars += 1
      out.timesOfDay.add((r[k10] / 1000) % 86400)
    }
    return out
  }

  it('on every bar of the 29 captures that plot them (20,000+ bars)', () => {
    let captures = 0
    let bars = 0
    for (const c of CAPTURES) {
      const r = check(c)
      if (!r) continue
      captures += 1
      bars += r.bars
    }
    expect(captures).toBe(29)
    expect(bars).toBeGreaterThan(20000)
  })

  it('⛔ INTRADAY (AMEX:SPY 15): the time is the 15-minute BAR\'s, never the session\'s or the day\'s (14 distinct times of day)', () => {
    // a daily capture cannot tell a bar's open time from its session's: every RDDT 1D bar time IS its session open
    const spy = check(CAPTURES.find((x) => shortId(x) === 'w9-r1-risk-intraday-range-spy-15'))
    expect(spy.bars).toBe(3753)
    expect(spy.timesOfDay.size).toBe(14)
    const rddt = check(CAPTURES.find((x) => shortId(x) === 'w9-k1-commission-pct-rddt-1d'))
    expect(rddt.timesOfDay.size).toBe(2) // 13:30 and 14:30 UTC: the same session open, either side of a clock change
  })
})

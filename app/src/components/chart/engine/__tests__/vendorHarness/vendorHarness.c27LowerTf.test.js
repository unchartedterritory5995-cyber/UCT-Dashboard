// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c27LowerTf.test.js
//
// ─── ⭐⭐ C27 — a timeframe BELOW the chart's own, replayed on TradingView's bars ─
//
// ⚰️ C27 wrote: "no committed capture holds a lower-timeframe `request.security`
// read on a higher-timeframe chart, so … the member door refuses every such read
// by name (`lower-tf:unwitnessed`)". ⭐ C41 (2026-09-30 evening): the capture
// exists (`vw-lower-tf-{spy-1d,spy-1w,rddt-1d}-2026-09-30`), it agrees with this
// replay, and the witnessed shapes are SERVED — graded against the capture itself
// in `vendorHarness.c41LowerTfServe.test.js`. This file keeps what it always
// proved on TradingView's own intraday and daily bars for AMEX:SPY — the
// mechanism (`lowerTf.js`):
//
//   1. BUCKETING, witnessed: TradingView's regular-session 60m bars ARE its
//      regular-session 5m bars bucketed from 09:30 — every complete bucket equal,
//      OHLCV, and the one the 5m capture only half covers is not built.
//   2. THE DAILY BAR IS NOT THE AGGREGATE of the intraday bars (close equal on 190
//      of 2,951 sessions) — so the lower read is a different number from `close`,
//      and cannot be derived from the bars a daily chart holds.
//   3. THE MECHANISM on 2,951 SPY sessions: `request.security("60", close)` reads
//      each day's last 60m bar; `ema(close, 9)` is evaluated on the 60m series; the
//      intrabar array is the day's 60m closes in order; an incomplete session and
//      every day before the intraday history are UNKNOWN; a gap poisons exactly
//      the days within the expression's reach.
//   4. THE DOOR: a read below the chart is an `ltf` node on a chart; a screen and
//      every unwitnessed shape still name their refusal.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { toProductBars } from './ourSide'
import { intrabarSeries, readLowerTf, LOWER_TF_REFUSAL as R } from '../../lowerTf.js'
import { parseFormula } from '../../ast/parse.js'
import { translatePine } from '../../ast/pine.js'
import { etClockAt } from '../../../indicators.js'
import { tradingViewCloseMinute } from '../../../../../lib/marketClock/tradingViewSession.js'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import * as registry from '../../nativeRegistry'

const REPO = path.resolve(process.cwd(), '..')
const H = path.join(REPO, 'tests/fixtures/vendor/harness')
const load = (n) => JSON.parse(fs.readFileSync(path.join(H, n), 'utf8'))
const rows = (cap) => cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const ymdOf = (t) => { const p = etClockAt(t); return p.y * 10000 + p.m * 100 + p.d }
const hhmm = (t) => { const p = etClockAt(t); return p.h * 60 + p.min }

const SPY_5_EXT = load('vw-clock-vwap-spy-5-ext-2026-09-28.json')
const SPY_60_RTH = load('vw-time-session-spy-60-rth-2026-09-28.json')
const SPY_60_LONG = load('vw-bool-cast-spy-60-2026-09-28.json')
const SPY_1D = load('vw-bool-cast-spy-1d-2026-09-28.json')

describe('C27 witness 1 — TradingView\'s 60m regular-session bars are its 5m bars bucketed from 09:30', () => {
  it('⭐ every complete bucket equals the vendor\'s 60m bar, OHLCV; the half-covered one is not built', () => {
    expect(SPY_5_EXT.symbol.session).toBe('0400-2000') // extended bars in, regular session out
    expect(SPY_60_RTH.symbol.session).toBe('0930-1600')
    const built = intrabarSeries(rows(SPY_5_EXT), '60', '5')
    const vendor = new Map(rows(SPY_60_RTH).map((b) => [b.t, b]))
    let equal = 0
    for (const b of built.bars) {
      const v = vendor.get(b.t)
      expect(v, `no vendor 60m bar at ${b.t}`).toBeTruthy()
      expect([b.o, b.h, b.l, b.c, b.v]).toEqual([v.o, v.h, v.l, v.c, v.v])
      equal++
    }
    expect(equal).toBe(12) // 2026-09-24 from 11:30 (5) + 2026-09-25 whole (7)
    // the 5m capture starts 2026-09-24 10:55, so the 10:30 bucket is short: absent,
    // and that session incomplete — the vendor's own 10:30 bar differs from it
    expect(built.sessions.get(20260924).complete).toBe(false)
    expect(built.sessions.get(20260925).complete).toBe(true)
    expect(built.bars.some((b) => b.t === 1790260200)).toBe(false) // 2026-09-24 10:30 ET
    // the bucket opens: 09:30 + 60k, the last one 15:30 — never the clock hour
    expect([...new Set(rows(SPY_60_RTH).map((b) => hhmm(b.t)))].sort((a, b) => a - b))
      .toEqual([570, 630, 690, 750, 810, 870, 930])
  })
})

describe('C27 witness 2 — the daily bar is not the aggregate of the intraday bars', () => {
  it('⭐ on 2,951 SPY sessions the daily close equals the last 60m close on only 190', () => {
    const byDay = new Map()
    for (const b of rows(SPY_60_LONG)) {
      const k = ymdOf(b.t)
      if (!byDay.has(k)) byDay.set(k, [])
      byDay.get(k).push(b)
    }
    const daily = new Map(rows(SPY_1D).map((b) => [ymdOf(b.t), b]))
    let n = 0; let close = 0; let high = 0
    for (const [k, bs] of byDay) {
      const d = daily.get(k)
      if (!d) continue
      n++
      if (Math.abs(d.c - bs[bs.length - 1].c) < 1e-9) close++
      if (Math.abs(d.h - Math.max(...bs.map((b) => b.h))) < 1e-9) high++
    }
    expect(n).toBe(2951)
    expect(close).toBe(190)
    expect(high).toBe(2792)
  })
})

describe('C27 mechanism — replayed on TradingView\'s SPY 1D chart with its own 60m bars', () => {
  const chart = toProductBars(SPY_1D)
  const store = rows(SPY_60_LONG) // TradingView's 60m bars ARE the regular-session buckets
  const lastByDay = new Map()
  const byDay = new Map()
  for (const b of store) {
    const k = ymdOf(b.t)
    lastByDay.set(k, b)
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k).push(b)
  }
  const keyOf = (bar) => Number(String(bar.t).replace(/-/g, ''))
  const readClose = readLowerTf({ tree: parseFormula('close').ast, code: '60', sourceCode: '60',
    chartTf: 'D', chartBars: chart, storeBars: store })

  it('⭐ (a) each day reads its LAST 60m bar\'s close — and that is not the daily close', () => {
    let known = 0; let differs = 0
    for (let i = 0; i < chart.length; i++) {
      if (readClose.unknown[i]) continue
      known++
      const last = lastByDay.get(keyOf(chart[i]))
      expect(readClose.column[i], chart[i].t).toBe(last.c)
      if (readClose.column[i] !== chart[i].c) differs++
    }
    expect(known).toBeGreaterThan(2900)
    expect(differs).toBeGreaterThan(2700)
  })

  it('⛔ every day before the intraday history, and the partial newest session, is UNKNOWN — never `na`', () => {
    const first = Math.min(...byDay.keys())
    let before = 0
    for (let i = 0; i < chart.length; i++) {
      if (keyOf(chart[i]) < first) { expect(readClose.unknown[i], chart[i].t).toBe(1); before++ }
    }
    expect(before).toBeGreaterThan(5000)
    // every session the capture holds SHORT of TradingView's own calendar for that
    // day is unknown — pre-2019 half-days, whose session TradingView keeps at 16:00
    // while trading stopped at 13:00 (2017-11-24 holds 5 of 7 buckets)
    const short = [...byDay].filter(([k, bs]) => bs.length < Math.ceil((tradingViewCloseMinute(k) - 570) / 60))
    expect(short.map(([k]) => k)).toContain(20171124)
    for (const [k] of short) {
      const j = chart.findIndex((b) => keyOf(b) === k)
      if (j >= 0) expect(readClose.unknown[j], k).toBe(1)
    }
    // a half-day TradingView DOES apply (13:00 close, four buckets) is COMPLETE
    const half = [...byDay].filter(([k, bs]) => tradingViewCloseMinute(k) === 780 && bs.length === 4)
    expect(half.length).toBeGreaterThan(5)
    for (const [k] of half) {
      const j = chart.findIndex((b) => keyOf(b) === k)
      expect(readClose.unknown[j], k).toBe(0)
    }
  })

  it('⭐ (b) the intrabar array is the day\'s 60m closes, in order', () => {
    let checked = 0
    for (let i = 0; i < chart.length; i++) {
      if (readClose.unknown[i]) { expect(readClose.arrays[i]).toBe(null); continue }
      expect(readClose.arrays[i], chart[i].t).toEqual(byDay.get(keyOf(chart[i])).map((b) => b.c))
      checked++
    }
    expect(checked).toBeGreaterThan(2900)
  })

  it('⭐ the expression runs on the 60m series: `ema(close, 9)` equals an independent EMA at each day\'s last bar', () => {
    const r = readLowerTf({ tree: parseFormula('ema(close, 9)').ast, code: '60', sourceCode: '60',
      chartTf: 'D', chartBars: chart, storeBars: store })
    // independent: Pine's ema — SMA seed over the first 9, then alpha = 2/10
    const closes = r.series.bars.map((b) => b.c)
    const ema = new Array(closes.length).fill(NaN)
    let s = 0
    for (let j = 0; j < 9; j++) s += closes[j]
    ema[8] = s / 9
    for (let j = 9; j < closes.length; j++) ema[j] = 0.2 * closes[j] + 0.8 * ema[j - 1]
    const pos = new Map(r.series.bars.map((b, j) => [b.t, j]))
    let compared = 0
    for (let i = 0; i < chart.length; i++) {
      if (r.unknown[i] || Number.isNaN(r.column[i])) continue
      const want = ema[pos.get(lastByDay.get(keyOf(chart[i])).t)]
      expect(Math.abs(r.column[i] - want) <= 1e-9 * Math.abs(want), chart[i].t).toBe(true)
      compared++
    }
    expect(compared).toBeGreaterThan(2900)
  })

  it('⛔ a missing 60m bar poisons exactly the days within the expression\'s reach', () => {
    const tree = parseFormula('sma(close, 5)').ast
    const cutAt = store.findIndex((b) => ymdOf(b.t) === 20250505 && hhmm(b.t) === 690)
    expect(cutAt).toBeGreaterThan(0)
    const cut = store.slice(0, cutAt).concat(store.slice(cutAt + 1))
    const whole = readLowerTf({ tree, code: '60', sourceCode: '60', chartTf: 'D', chartBars: chart, storeBars: store })
    const hurt = readLowerTf({ tree, code: '60', sourceCode: '60', chartTf: 'D', chartBars: chart, storeBars: cut })
    const at = (k) => chart.findIndex((b) => keyOf(b) === k)
    expect(hurt.unknown[at(20250505)]).toBe(1) // its own session is incomplete
    expect(hurt.unknown[at(20250502)]).toBe(0) // the day before is untouched
    // sma(5) at the next day's last bar reads 5 of its own 7 buckets: past the gap
    expect(hurt.unknown[at(20250506)]).toBe(0)
    let same = 0
    for (let i = at(20250506); i < chart.length; i++) {
      if (hurt.unknown[i] || whole.unknown[i]) continue
      expect(hurt.column[i], chart[i].t).toBe(whole.column[i])
      same++
    }
    expect(same).toBeGreaterThan(300)
  })
})

describe('C27 / C41 the door — a read below the chart is served on a chart, refused by name elsewhere', () => {
  const pine = (line) => ['//@version=5', 'indicator("c27")', line].join('\n')
  const refusalOf = (line, opts) => translatePine(pine(line), opts).refusal
  const HOST = { strict: true }

  it('⭐ C41 — `request.security(own, "60", close)` on a daily CHART is an `ltf` node; a SCREEN names `lower-tf:screen`', () => {
    const line = 'plot(request.security(syminfo.tickerid, "60", close))'
    const t = translatePine(pine(line), HOST)
    expect(t.ok).toBe(true)
    expect(t.outputs[0].ast).toEqual({ type: 'ltf', value: '60', args: [{ type: 'series', name: 'close' }] })
    expect(t.lowerTf).toEqual(['60'])
    // a screen evaluates daily bars only: refused, by name, and the sentence still
    // names what the engine CAN serve
    const r = refusalOf(line)
    expect(r.guard).toBe('pine:request')
    expect(r.message).toContain(R.SCREEN)
    expect(r.message).toMatch(/weekly and monthly/)
    // control: a script with no lower read carries no `lowerTf` at all
    expect(translatePine(pine('plot(close)'), HOST).lowerTf).toBeUndefined()
  })

  it('⛔ each shape that is not served names its own reason, on the chart lane too', () => {
    expect(refusalOf('plot(request.security(syminfo.tickerid, "5", close, lookahead = barmerge.lookahead_on))', HOST).message)
      .toContain(R.LOOKAHEAD)
    expect(refusalOf('plot(request.security("AMEX:SPY", "15", close))', HOST).message).toContain(R.OTHER_SYMBOL)
    // a code the store could build but no capture shows read below a chart
    expect(refusalOf('plot(request.security(syminfo.tickerid, "30", close))', HOST).message).toContain(R.UNWITNESSED)
    // (every code the Pine spelling table knows is now one the store builds, so
    // `lower-tf:not-served` is reached only through `lowerTfRefusal` itself — `lowerTf.test.js`)
    expect(refusalOf('plot(request.security_lower_tf(syminfo.tickerid, "5", close))', HOST).message)
      .toContain(R.INTRABAR_ARRAY)
  })

  it('control: a timeframe ABOVE the chart, and the chart\'s own, are untouched', () => {
    expect(translatePine(pine('plot(request.security(syminfo.tickerid, "W", close))')).ok).toBe(true)
    expect(translatePine(pine('plot(request.security(syminfo.tickerid, "D", close))')).ok).toBe(true)
    const onHourly = refusalOf('plot(request.security(syminfo.tickerid, "D", close))', { basePeriod: '60' })
    expect(onHourly.message).not.toContain('lower-tf:')
  })

  it('⭐ C41 — the graded script that reads 15/60/240 below a 1D chart carries three `ltf` reads (ema-ribbon)', () => {
    const cap = load('ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28.json')
    let door
    let text
    try {
      door = enterMemberDoor(cap.source.text)
      text = JSON.stringify(door, (k, v) => (typeof v === 'bigint' ? String(v) : v))
    } finally {
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
    }
    expect(door.def.meta.lowerTf).toEqual(['15', '60', '240'])
    for (const code of ['15', '60', '240']) expect(text).toContain(`{"type":"ltf","value":"${code}"`)
    expect(text).not.toContain(R.UNWITNESSED)
    // the one lower-tf code left is the dark runtime lane's own: it holds no
    // intraday bars, so its rescue run refuses the script by name
    expect([...new Set(text.match(/lower-tf:[a-z-]+/g) || [])]).toEqual([R.RUNTIME_LANE])
  })
})

// app/src/components/chart/engine/__tests__/binderCalcFrames.test.js
//
// ─── THE BINDER COMPUTES A FRAMED INSTANCE ON ITS FRAME'S BARS ────────────────
//
// Independent oracles: every expected value below is computed HERE from the frame
// bars with plain arithmetic, never by calling the engine being tested.

import { describe, it, expect, beforeEach } from 'vitest'
import { createBinder } from '../binder'
import { createFakeChart } from './fakeChart'
import * as registry from '../nativeRegistry'
import { etDateOf } from '../mtfProjection'
import { computeRSI } from '../../indicators'

const DAY = 86400
/** 5-minute RTH bars for consecutive sessions ending `lastIso` (UTC-4 summer). */
function fiveMinute(isos) {
  const out = []
  for (const iso of isos) {
    const open = Date.parse(`${iso}T13:30:00Z`) / 1000   // 09:30 EDT
    for (let k = 0; k < 78; k++) out.push({ t: open + k * 300, o: 1, h: 1, l: 1, c: 1, v: 1 })
  }
  return out
}
const sma = (xs, n, i) => (i + 1 < n ? NaN : xs.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n)

const placement = () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: null })

let fake
let binder
beforeEach(() => {
  fake = createFakeChart()
  binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
})

const drawnFor = (key) => {
  const b = binder.bindings().find((x) => x.key === key)
  if (!b) return null
  const set = fake.calls.filter((c) => c.id === b.series.__id && c.method === 'setData').pop()
  return set ? set.args[0] : null
}
const sync = (instances, bars, frames, extra = {}) => binder.sync({
  enabled: true, instances, registry, bars, adjustTime: (t) => t, plan: { fresh: true },
  resolvePlacement: placement, tf: '5', sym: 'AAPL', frames, ...extra,
})

describe('⭐⭐ 1D SMA on a 5m chart — computed from DAILY bars, projected without lookahead', () => {
  // 40 daily bars, Aug 3 … Sep 25 (weekdays), closes 100, 101, … ; the chart
  // shows Sep 23–25. Sep 25's daily bar is the FORMING one.
  const dailyIsos = []
  for (let d = new Date('2026-08-03T12:00:00Z'); dailyIsos.length < 40; d = new Date(d.getTime() + DAY * 1000)) {
    if (d.getUTCDay() % 6 !== 0) dailyIsos.push(d.toISOString().slice(0, 10))
  }
  const daily = dailyIsos.map((iso, i) => ({ t: iso, o: 0, h: 0, l: 0, c: 100 + i, v: 1 }))
  const closes = daily.map((b) => b.c)
  const chartIsos = dailyIsos.slice(-3)
  const bars = fiveMinute(chartIsos)
  const avg = { instanceId: 'm', defId: 'movingAverage', inputs: { source: 'close', period: 20, maType: 'sma', color: '#abcdef' }, calculationTimeframe: 'D' }
  const frames = new Map([['D|AAPL', { bars: daily, status: 'available', newestBarIsForming: true }]])

  it('every 5m bar of day D shows the SMA 20 of DAILY closes through D-1', () => {
    sync([avg], bars, frames)
    const drawn = drawnFor('m::ma')
    expect(drawn, 'the framed average drew nothing').toBeTruthy()
    for (let i = 0; i < bars.length; i++) {
      const day = etDateOf(bars[i].t)
      const prevIdx = dailyIsos.indexOf(day) - 1
      expect(drawn[i].value, `${day} bar ${i % 78}`).toBeCloseTo(sma(closes, 20, prevIdx), 10)
    }
    // …and it is NOT the 5m SMA (all closes are 1 on the chart) — a relabelled chart-frame MA would read 1.
    expect(drawn[0].value).toBeGreaterThan(100)
  })

  it('⛔ a frame that has not landed computes NOTHING — never the chart\'s own bars', () => {
    sync([avg], bars, new Map([['D|AAPL', { bars: [], status: 'loading' }]]))
    expect(binder.bindings().find((b) => b.key === 'm::ma')).toBeUndefined()
  })

  it('a chart that outruns the snapshot reports the frame STALE', () => {
    const stale = []
    const short = daily.slice(0, -2)   // the snapshot ends two sessions before the chart
    sync([avg], bars, new Map([['D|AAPL', { bars: short, status: 'available', newestBarIsForming: false }]]),
      { onFrameStale: (f, s) => stale.push(`${f}|${s}`) })
    expect(stale).toEqual(['D|AAPL'])
  })

  it('a CHART-frame average beside it is untouched (byte-identical to no frames at all)', () => {
    const plain = { instanceId: 'p', defId: 'movingAverage', inputs: { source: 'close', period: 5, maType: 'sma', color: '#111111' } }
    sync([plain], bars, undefined)
    const alone = drawnFor('p::ma').map((p) => p.value)
    fake = createFakeChart(); binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    sync([plain, avg], bars, frames)
    expect(drawnFor('p::ma').map((p) => p.value)).toEqual(alone)
  })

  it('the binding says which frame it came from (the live writer leaves it alone)', () => {
    sync([avg], bars, frames)
    expect(binder.bindings().find((b) => b.key === 'm::ma').frame).toBe('D')
  })
})

describe('⭐⭐ 1h RSI on 5m, and an MA of it — the dependent INHERITS the 1h frame', () => {
  const iso = ['2026-09-21', '2026-09-22', '2026-09-23']
  // 60m RTH bars anchored 09:30 EDT: 09:30 … 15:30 (7 per day).
  const hourly = []
  let px = 50
  for (const d of iso) {
    const open = Date.parse(`${d}T13:30:00Z`) / 1000
    for (let k = 0; k < 7; k++) {
      px += (k % 3 === 0 ? 1.7 : -0.9)
      hourly.push({ t: open + k * 3600, o: px, h: px + 1, l: px - 1, c: px, v: 1 })
    }
  }
  const bars = fiveMinute(iso)
  const rsi = { instanceId: 'r', defId: 'rsi', inputs: { period: 5 }, calculationTimeframe: '60' }
  const ma = { instanceId: 'a', defId: 'movingAverage', inputs: { source: '@r::rsi', period: 3, maType: 'sma', color: '#222222' } }
  const frames = new Map([['60|AAPL', { bars: hourly, status: 'available', newestBarIsForming: false }]])

  it('RSI on the 5m chart equals RSI computed directly on 1h bars, held until the next 1h bar closes', () => {
    sync([rsi, ma], bars, frames)
    const oracle = computeRSI(hourly, 5)
    const rsiAt = new Map(oracle.map((p) => [p.time, p.value]))
    const drawn = drawnFor('r::rsi')
    expect(drawn).toBeTruthy()
    for (let i = 0; i < bars.length; i++) {
      const t = bars[i].t
      // the newest 1h bar whose END (start + 3600, or next start) is <= t
      let want = NaN
      for (let j = hourly.length - 1; j >= 0; j--) {
        const end = Math.min(hourly[j].t + 3600, j + 1 < hourly.length ? hourly[j + 1].t : Infinity)
        if (end <= t) { want = rsiAt.get(hourly[j].t); break }
      }
      if (Number.isFinite(want)) expect(drawn[i].value, `bar ${i}`).toBeCloseTo(want, 10)
      else expect(Number.isFinite(drawn[i].value)).toBe(false)
    }
  })

  it('MA 3 of that RSI averages 1h RSI VALUES (not 5m repeats of them)', () => {
    sync([rsi, ma], bars, frames)
    const rsiVals = computeRSI(hourly, 5).map((p) => p.value)
    const offset = hourly.length - rsiVals.length
    const drawn = drawnFor('a::ma')
    expect(drawn, 'the dependent did not bind').toBeTruthy()
    const last = bars.length - 1
    // The last 5m bar (15:55 on day 3) reads the 14:30 bar (closed 15:30).
    const j = hourly.length - 2
    const want = sma(rsiVals, 3, j - offset)
    expect(drawn[last].value).toBeCloseTo(want, 10)
    expect(binder.bindings().find((b) => b.key === 'a::ma').frame).toBe('60')
  })
})

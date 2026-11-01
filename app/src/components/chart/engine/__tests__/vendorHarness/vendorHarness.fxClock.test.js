// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.fxClock.test.js
//
// ─── ⭐⭐ 2026-10-31 (`fix/fx-clock-blank`) — THE CLOCK ON FX AND ON DEEP HISTORY,
//     AGAINST TRADINGVIEW'S OWN CAPTURES, THROUGH THE MEMBER DOOR ───────────────
//
// MEASURED BEFORE THE FIX: on FX:EURUSD 1D (`vw-time-tf-fx-eurusd-1d-2026-10-01`,
// 14,329 bars from 1971-01-03) the host lane drew NOTHING for `time`, `dayofweek`,
// `hour`, `minute`, `time_close` on every bar, with no note — and a session test
// `not na(time(timeframe.period, "0930-1600")) ? 1 : 0` drew a confident 0 on every
// bar. The cause was not FX: it was the 1990 unit floor (`VWAP_MIN_INSTANT`) reached
// by an ISO DATE (`barOpenInstant` → `etWallInstant` → `etClockAt`), so ONE bar
// before 1990 blanked the whole series. The same blank hit AAPL / BRK.A 1D deep
// history (`vw-deadband-ticks-{aapl,brk-a}-1d-2026-09-28`, from 1980 / 1979) — and
// production serves AAPL from 1980-12-12 and KO from 1976-12-17 on a deep pan.
//
// AFTER: the date is read (`etClockRead`); TradingView's own bar stamps match ours on
// every bar of both equity captures, pre-1990 bars included; on FX the DATE matches
// on every bar and the TIME OF DAY — which a 09:30 New York stamp cannot give for a
// 17:00 FX open — is withheld whole and named (`time-clock:weekend-session`).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { HARNESS_DIR } from './harness'
import { runOurSide, toProductBars, tfCodeOf } from './ourSide'
import { computeClock, VWAP_MIN_INSTANT } from '../../../indicators.js'

const load = (id) => JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, `${id}.json`), 'utf8'))
const FX = 'vw-time-tf-fx-eurusd-1d-2026-10-01'
const BTC = 'vw-time-tf-bitstamp-btcusd-1d-2026-09-30'
const CODE = 'time-clock:weekend-session'

const PROBE = `//@version=5
indicator("FXCLOCK", overlay = false)
plot(time, "time")
plot(dayofweek, "dow")
plot(hour, "hour")
plot(minute, "minute")
plot(time_close, "time_close")
plot(time(timeframe.period), "time_tf")
plot(not na(time(timeframe.period, "0930-1600")) ? 1 : 0, "in_sess")
plot(timeframe.change("W") ? 1 : 0, "wchg")
plot(year * 10000 + month * 100 + dayofmonth, "ymd")
`
const probe = (cap) => runOurSide({ ...cap, source: { ...cap.source, text: PROBE } })
const plotOf = (ours, title) => ours.plots.find((p) => p.title === title)
const finite = (col) => Array.from(col || []).filter((v) => Number.isFinite(v)).length

describe('⭐⭐ deep daily history before 1990: TradingView\'s own bar stamp, every bar', () => {
  for (const id of ['vw-deadband-ticks-aapl-1d-2026-09-28', 'vw-deadband-ticks-brk-a-1d-2026-09-28']) {
    it(`${id}: our \`time\` IS the vendor's bar time on every bar, the pre-1990 ones included`, () => {
      const cap = load(id)
      const rows = cap.bars.rows
      const pre = rows.filter((r) => r[0] < VWAP_MIN_INSTANT).length
      expect(pre).toBeGreaterThan(2000) // non-vacuous: the capture really reaches back
      const cols = computeClock(toProductBars(cap), tfCodeOf(cap.timeframe), null)
      const off = rows.map((r, i) => (cols.time[i] === r[0] ? -1 : i)).filter((i) => i >= 0)
      expect(off).toEqual([])
    })
  }
})

describe('⭐⭐ FX:EURUSD 1D through the member door: the date drawn, the time of day withheld by name', () => {
  const cap = load(FX)
  const ours = probe(cap)
  const n = cap.bars.rows.length

  it('the door ran and the capture is the 1971 one', () => {
    expect(ours.ok).toBe(true)
    expect(n).toBe(14329)
    expect(cap.bars.rows[0][0]).toBeLessThan(VWAP_MIN_INSTANT)
  })
  it('`dayofweek` is drawn on every bar and equals TradingView\'s (row T17) on every bar', () => {
    const k = cap.plotValues.fields.indexOf('plot_17')
    const vendor = new Map(cap.plotValues.rows.map((r) => [r[0], r[k]]))
    const dow = plotOf(ours, 'dow').column
    expect(finite(dow)).toBe(n)
    const off = cap.bars.rows.map((r, i) => (vendor.get(r[0]) === dow[i] ? -1 : i)).filter((i) => i >= 0)
    expect(off).toEqual([])
    expect(finite(plotOf(ours, 'ymd').column)).toBe(n)
  })
  it('every time-of-day read is withheld on every bar — never 09:30, never a confident 0 — and NAMED', () => {
    for (const t of ['time', 'hour', 'minute', 'time_close', 'time_tf', 'in_sess', 'wchg']) {
      expect(finite(plotOf(ours, t).column), t).toBe(0)
    }
    const named = ours.notes.filter((s) => s.includes(`(${CODE})`))
    expect(named.length).toBe(1)
    expect(named[0]).toMatch(/on 7 plot\(s\)/)
  })
})

describe('⛔ the fix is narrow: an every-day chart (BITSTAMP:BTCUSD 1D) draws what it drew', () => {
  it('no weekend-session withholding there, and `time` is still served (its 00:00 UTC stamp is a separate, stated divergence)', () => {
    const ours = probe(load(BTC))
    expect(ours.notes.some((s) => s.includes(CODE))).toBe(false)
    expect(finite(plotOf(ours, 'time').column)).toBe(5491)
    expect(finite(plotOf(ours, 'dow').column)).toBe(5491)
  })
})

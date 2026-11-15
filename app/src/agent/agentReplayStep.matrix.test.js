// D20 · chart.replayStep's step (replayMode.stepReplay), GENERATED: timeframe × direction × N × start × boundary, against the
// INDEPENDENT oracle (components/chart/__tests__/replayOracle.js — its own ET sessions from market_calendar.json, its own DST
// rule). The chart is a stand-in that holds bars the way a Replay window does (only bars on days ≤ the window's day: the
// cutoff's, or a later look-ahead day) and answers host.charts.replayBarTimes from exactly those.
import { describe, it, expect } from 'vitest'
import { stepReplay } from './capabilities/replayMode'
import { cutoffFetchDay } from '../components/chart/replayCutoff'
import * as O from '../components/chart/__tests__/replayOracle'

// two CONTIGUOUS windows (a real chart has no half-year gap): the March DST change + Good Friday, and the November DST
// change + Thanksgiving + its half-day
const WIN = { A: O.sessions('2026-02-02', '2026-05-29'), B: O.sessions('2026-09-01', '2026-12-31') }
const winOf = (v) => (v.slice(0, 10) < '2026-07-01' ? 'A' : 'B')
const DAYS = WIN.A
const dayOfBar = (b) => (typeof b.t === 'number' ? O.unixToEt(b.t).day : b.t)

function stand({ tf, extended = false, bars, cutoff }) {
  const st = { cut: cutoff, writes: [], asked: [] }
  const charts = {
    read: (ref) => ({ ref, tf, replay: st.cut }),
    list: () => [{ ref: 'c', tf, replay: st.cut }],
    setReplay: (v) => { st.writes.push(v); st.cut = v; return true },
    replayBarTimes: async (ref, { throughDay } = {}) => {
      st.asked.push(throughDay || null)
      const to = throughDay || cutoffFetchDay(st.cut, tf)        // the window the chart holds (W/M: its period's end)
      return { tf, extended, times: bars.filter(b => dayOfBar(b) <= to).map(b => b.t) }
    },
  }
  return { host: { charts }, st }
}

// starts: day-only values (incl. before a weekend, Good Friday, Thanksgiving, the half-day) and precise instants
const DAY_STARTS = ['2026-02-02', '2026-05-29', '2026-03-06', '2026-03-09', '2026-03-13', '2026-04-01', '2026-04-02', '2026-10-30', '2026-11-25', '2026-11-27', '2026-11-30']
const preciseStarts = () => [['2026-03-06', 600], ['2026-03-09', 571], ['2026-04-02', 955], ['2026-10-30', 630], ['2026-11-27', 775], ['2026-11-02', 960]]
  .map(([d, m]) => O.preciseOf(O.etToUnix(d, m)))
const CASES = []
for (const tf of ['1', '5', '15', '30', '60', 'D', 'W', 'M']) {
  for (const extended of (tf === '5' ? [false, true] : [false])) {
    const starts = ['D', 'W', 'M'].includes(tf) ? [...DAY_STARTS, ...preciseStarts().slice(0, 3)] : [...DAY_STARTS.slice(0, 5), ...preciseStarts()]
    for (const v of starts) for (const direction of ['forward', 'back']) for (const n of [1, 2, 10]) CASES.push([tf, extended, v, direction, n])
  }
}

describe('stepReplay == the oracle: timeframe × direction × N × start (and every boundary refuses with nothing written)', () => {
  const barsOf = new Map()
  const bars = (w, tf, extended) => {
    const k = `${w}|${tf}|${extended}`
    if (!barsOf.has(k)) barsOf.set(k, ['D', 'W', 'M'].includes(tf) ? O.dwmBars(WIN[w], tf) : O.intradayBars(WIN[w], tf, { extended }))
    return barsOf.get(k)
  }
  const NOW = O.etToUnix('2026-12-31', 20 * 60) * 1000          // after the fixtures' last session
  it.each(CASES)('%s ext=%s from %s · %s %i', async (tf, extended, v, direction, n) => {
    const all = bars(winOf(v), tf, extended)
    const { host, st } = stand({ tf, extended, bars: all, cutoff: v })
    const want = O.expectedStep(all, tf, v, direction, n, { extended, nowSec: NOW / 1000 })
    let got = null, err = null
    try { got = await stepReplay(host, 'c', { direction, bars: n, from: v }, { now: NOW }) } catch (e) { err = e }
    if (want == null) {
      expect(err?.complete, `${tf} ${v} ${direction} ${n}: should refuse`).toBe(true)
      expect(err.message).toMatch(/Nothing was changed\./)
      expect(st.writes).toEqual([])
      expect(st.cut).toBe(v)
    } else {
      expect(err, err?.message).toBe(null)
      expect(got.to).toBe(want)
      expect(st.writes).toEqual([want])
    }
  })
})

describe('boundaries', () => {
  const tf = '5'
  const all = O.intradayBars(DAYS, tf)
  it('forward onto the bar still FORMING is refused (now is inside it)', async () => {
    const last = all.at(-1)
    const v = O.preciseOf(last.t)                           // the cutoff is the start of the last bar = end of the one before
    const { host, st } = stand({ tf, bars: all, cutoff: v })
    await expect(stepReplay(host, 'c', { direction: 'forward', bars: 1, from: v }, { now: (last.t + 60) * 1000 })).rejects.toThrow(/still forming/)
    expect(st.writes).toEqual([])
  })
  it('past the last real bar, and before the first, are refused with the reason', async () => {
    const vEnd = DAYS.at(-1), vStart = O.preciseOf(all[0].t + 300)
    const a = stand({ tf, bars: all, cutoff: vEnd })
    await expect(stepReplay(a.host, 'c', { direction: 'forward', bars: 1, from: vEnd }, { now: Date.UTC(2027, 0, 1) })).rejects.toThrow(/no later bar/)
    const b = stand({ tf, bars: all, cutoff: vStart })
    await expect(stepReplay(b.host, 'c', { direction: 'back', bars: 1, from: vStart }, { now: Date.UTC(2027, 0, 1) })).rejects.toThrow(/already at this chart’s first bar/)
    const c = stand({ tf, bars: all, cutoff: vStart })
    await expect(stepReplay(c.host, 'c', { direction: 'back', bars: 5, from: vStart }, { now: Date.UTC(2027, 0, 1) })).rejects.toThrow(/first bar/)
    expect([a.st.writes, b.st.writes, c.st.writes]).toEqual([[], [], []])
  })
  it('daily steps are SESSIONS: Friday → Monday, Thursday before Good Friday → the Monday after, never a calendar day', async () => {
    const d = O.dwmBars([...WIN.A, ...WIN.B], 'D')
    for (const [from, to] of [['2026-03-06', '2026-03-09'], ['2026-04-02', '2026-04-06'], ['2026-11-25', '2026-11-27']]) {
      const { host } = stand({ tf: 'D', bars: d, cutoff: from })
      expect((await stepReplay(host, 'c', { direction: 'forward', bars: 1, from }, { now: Date.UTC(2027, 0, 1) })).to).toBe(to)
    }
  })
  it('intraday crosses the overnight gap to the next session’s first bar; the half-day ends at 13:00', async () => {
    const v = O.preciseOf(O.etToUnix('2026-11-25', 960))
    const { host } = stand({ tf: '60', bars: O.intradayBars(WIN.B, '60'), cutoff: v })
    // Thanksgiving is closed: the next 60m bar is Fri 11-27 09:30, ending 10:30
    expect((await stepReplay(host, 'c', { direction: 'forward', bars: 1, from: v }, { now: Date.UTC(2027, 0, 1) })).to).toBe(O.preciseOf(O.etToUnix('2026-11-27', 630)))
    const v2 = O.preciseOf(O.etToUnix('2026-11-27', 750))
    const h2 = stand({ tf: '60', bars: O.intradayBars(WIN.B, '60'), cutoff: v2 })
    expect((await stepReplay(h2.host, 'c', { direction: 'forward', bars: 1, from: v2 }, { now: Date.UTC(2027, 0, 1) })).to).toBe(O.preciseOf(O.etToUnix('2026-11-27', 780)))
  })
  it('the look-ahead asks the chart for a LATER window only when the held bars run out', async () => {
    const d = O.dwmBars(DAYS, 'D')
    const { host, st } = stand({ tf: 'D', bars: d, cutoff: '2026-03-06' })
    await stepReplay(host, 'c', { direction: 'back', bars: 2, from: '2026-03-06' }, { now: Date.UTC(2027, 0, 1) })
    expect(st.asked).toEqual([null])
    const s2 = stand({ tf: 'D', bars: d, cutoff: '2026-03-06' })
    await stepReplay(s2.host, 'c', { direction: 'forward', bars: 2, from: '2026-03-06' }, { now: Date.UTC(2027, 0, 1) })
    expect(s2.st.asked[0]).toBe(null)
    expect(s2.st.asked[1] > '2026-03-06').toBe(true)
  })
  it('a cutoff the member moved meanwhile, a custom timeframe, and an unreadable chart are refused; nothing written', async () => {
    const d = O.dwmBars(DAYS, 'D')
    const a = stand({ tf: 'D', bars: d, cutoff: '2026-03-06' })
    await expect(stepReplay(a.host, 'c', { direction: 'forward', bars: 1, from: '2026-03-05' })).rejects.toThrow(/moved while I was stepping/)
    const b = stand({ tf: '45', bars: O.intradayBars(DAYS, '15'), cutoff: '2026-03-06' })
    await expect(stepReplay(b.host, 'c', { direction: 'forward', bars: 1, from: '2026-03-06' })).rejects.toThrow(/custom timeframe/)
    const c = stand({ tf: 'D', bars: d, cutoff: '2026-03-06' })
    c.host.charts.replayBarTimes = async () => null
    await expect(stepReplay(c.host, 'c', { direction: 'forward', bars: 1, from: '2026-03-06' })).rejects.toThrow(/couldn’t read that chart’s bars/)
    expect([a.st.writes, b.st.writes, c.st.writes]).toEqual([[], [], []])
  })
})

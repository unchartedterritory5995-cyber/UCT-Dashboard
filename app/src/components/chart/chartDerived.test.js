// The per-bar arrays StockChart derives (`chartDerived.js`) are the memo bodies they were moved from, and
// the neighbor-frames path (`useNeighborFrames.derive*`, filed per array) answers with the same values.
//
// ⛔ THE ORACLES BELOW ARE THE MEMO BODIES AS THEY STOOD IN StockChart.jsx BEFORE THE MOVE (2026-11-20,
// perf/switch-fast-1 02e65b567e), transcribed with each component value made a parameter. A change to
// `chartDerived.js` that changes a value fails here against the shipped behaviour, not against itself.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sessionBarsOf, ohlcBaseOf, closeDataOf, volDataOf, volMaDataOf, computeHVC } from './chartDerived'
import { deriveSession, deriveDisplay, deriveHvc, deriveOhlcBase, deriveClose, deriveVol, deriveVolMa, EMPTY_HVC } from './useNeighborFrames'
import { keepRthBars, toChartTime } from './barTime'
import { foldOffGridBars } from './offGridBars'
import { toHeikinAshi } from './indicators'
import {
  __setNeighborFramesForTests, stableSig, identitySig, chartTimesFor, neighborFramesStats,
  __resetNeighborFramesStatsForTests, __resetDerivedForTests, deriveFrom, SOURCES_KEPT,
} from './neighborFrames'

// ── oracles: the StockChart memo bodies, verbatim but for parameters ──
function oracleSession(bars, { _intradayLike, isIntraday, showExtended, resolvedTf }) {
  if (!bars || !_intradayLike) return bars
  const gridBars = isIntraday ? foldOffGridBars(bars, resolvedTf, { showExtended }) : bars
  if (showExtended) return gridBars
  return keepRthBars(gridBars)
}
function oracleOhlcBase(displayBars, adjustTime, canvasTheme) {
  const arr = displayBars.map(b => ({ time: adjustTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c }))
  if (canvasTheme === 'sunrise') {
    for (let i = 1; i < arr.length; i++) {
      const cur = arr[i], prev = arr[i - 1]
      if (cur.high != null && cur.low != null && prev.high != null && prev.low != null
          && cur.high <= prev.high && cur.low >= prev.low) {
        arr[i] = { ...cur, color: '#000000', borderColor: '#000000', wickColor: '#000000' }
      }
    }
  }
  return arr
}
function oracleClose(displayBars, adjustTime, cs, mbUp, mbDown, breadthLineColor) {
  const isLineArea = cs.chartType === 'line' || cs.chartType === 'area'
  const mode = cs.candleColorMode || 'netchange'
  if (!isLineArea || mode === 'onecolor' || breadthLineColor) {
    return displayBars.map(b => ({ time: adjustTime(b.t), value: b.c }))
  }
  let prevClose = null
  return displayBars.map(b => {
    let up
    if (mode === 'netchange') up = prevClose == null ? true : b.c >= prevClose
    else up = (b.o != null) ? b.c >= b.o : true
    prevClose = b.c
    const col = up ? mbUp : mbDown
    return { time: adjustTime(b.t), value: b.c, color: col, lineColor: col }
  })
}
function oracleVol(sessionAppliedBars, o) {
  const { blankVolume, adjustTime, userCandleColors, cs, mbVolUp, mbVolDown, boldCandles, modelBookLook, BOLD_UP, BOLD_DOWN,
    colorByNetChange, resolvedTf, liveVolForSym, volExtremes, hvcSet } = o
  if (blankVolume) return sessionAppliedBars.map(b => ({ time: adjustTime(b.t) }))
  const upC = userCandleColors ? (cs.volume.upColor || mbVolUp) : boldCandles ? mbVolUp : modelBookLook ? BOLD_UP : cs.volume.upColor
  const downC = userCandleColors ? (cs.volume.downColor || mbVolDown) : boldCandles ? mbVolDown : modelBookLook ? BOLD_DOWN : cs.volume.downColor
  const gold = '#e6b800'
  const lastIdx = sessionAppliedBars.length - 1
  return sessionAppliedBars.map((b, i) => {
    const prevC = i > 0 ? sessionAppliedBars[i - 1].c : b.o
    const isUp = colorByNetChange ? (b.c >= prevC) : (b.c >= b.o)
    const useLiveDayVol = ['D', 'W', 'M'].includes(resolvedTf) &&
      Number.isFinite(liveVolForSym) && liveVolForSym > (b.v || 0)
    const value = (i === lastIdx && useLiveDayVol) ? liveVolForSym : b.v
    return {
      time: adjustTime(b.t),
      value,
      color: volExtremes?.goldTimes.has(b.t) ? gold
        : (!boldCandles && hvcSet.has(b.t)) ? 'rgba(201,168,76,0.9)'
          : isUp ? upC : downC,
    }
  })
}
function oracleVolMa(sessionAppliedBars, volMaPeriodEff, adjustTime) {
  const out = []
  const q = []
  let sum = 0
  for (const b of sessionAppliedBars) {
    const v = b.v || 0
    q.push(v); sum += v
    if (q.length > volMaPeriodEff) sum -= q.shift()
    if (q.length === volMaPeriodEff) out.push({ time: adjustTime(b.t), value: sum / volMaPeriodEff })
  }
  return out
}

// ── fixtures ──
const adjustTime = (t) => (typeof t === 'number' ? toChartTime(t) : t)
const daily = (n) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  const c = 100 + Math.sin(i / 4) * 6 + (i % 7) - 3
  return { t: d, o: c - 1 + (i % 3), h: c + 2, l: c - 2 - (i % 2), c, v: 1e6 + ((i * 7919) % 400000) }
})
// 60m bars over a DST change, with a pre-market row, an after-hours row and one off-grid (trade-time) row
const ET = (y, m, d, hh, mm, dst) => Date.UTC(y, m - 1, d, hh + (dst ? 4 : 5), mm) / 1000
const hourly = () => {
  const out = []
  let i = 0
  for (let d = 28; d <= 31; d++) {
    for (const [hh, mm] of [[8, 0], [9, 30], [10, 30], [11, 30], [12, 30], [13, 30], [14, 30], [15, 30], [17, 0]]) {
      const c = 50 + Math.sin(i / 3) * 2 + i * 0.01
      out.push({ t: ET(2026, 10, d, hh, mm, true), o: c - 0.2, h: c + 0.6, l: c - 0.7, c, v: 1000 + (i * 37) % 900 }); i++
    }
  }
  for (let d = 2; d <= 4; d++) {
    for (const [hh, mm] of [[9, 30], [10, 30], [11, 30], [12, 30], [13, 30], [14, 30], [15, 30]]) {
      const c = 52 + Math.cos(i / 3) * 2
      out.push({ t: ET(2026, 11, d, hh, mm, false), o: c + 0.1, h: c + 0.5, l: c - 0.5, c, v: 900 + (i * 53) % 700 }); i++
    }
  }
  out.splice(5, 0, { ...out[4], t: out[4].t + 1337, v: 77 })   // a trade-time stamped stray
  return out
}

beforeEach(() => { __resetNeighborFramesStatsForTests(); __resetDerivedForTests() })
afterEach(() => { __setNeighborFramesForTests(null) })

describe('the moved bodies are the memo bodies', () => {
  const cases = [
    ['daily', daily(400), { _intradayLike: false, isIntraday: false, showExtended: false, resolvedTf: 'D' }],
    ['60m RTH', hourly(), { _intradayLike: true, isIntraday: true, showExtended: false, resolvedTf: '60' }],
    ['60m ETH', hourly(), { _intradayLike: true, isIntraday: true, showExtended: true, resolvedTf: '60' }],
    ['60m showExtended unset', hourly(), { _intradayLike: true, isIntraday: true, showExtended: undefined, resolvedTf: '60' }],
  ]
  for (const [name, bars, v] of cases) {
    it(`${name}: session, candles, closes, volume, its average, HVC`, () => {
      const p = { intradayLike: v._intradayLike, isIntraday: v.isIntraday, showExtended: v.showExtended, tf: v.resolvedTf }
      const session = sessionBarsOf(bars, p)
      expect(session).toEqual(oracleSession(bars, v))
      for (const theme of ['dark', 'sunrise']) expect(ohlcBaseOf(session, theme === 'sunrise', adjustTime)).toEqual(oracleOhlcBase(session, adjustTime, theme))
      for (const chartType of ['candles', 'line', 'area']) {
        for (const candleColorMode of [undefined, 'netchange', 'openclose', 'onecolor']) {
          for (const blc of [null, '#abc']) {
            const cs = { chartType, candleColorMode }
            const cp = {
              plain: !(chartType === 'line' || chartType === 'area') || (candleColorMode || 'netchange') === 'onecolor' || !!blc,
              mode: candleColorMode || 'netchange', up: '#0f0', down: '#f00',
            }
            expect(closeDataOf(session, cp, adjustTime)).toEqual(oracleClose(session, adjustTime, cs, '#0f0', '#f00', blc))
          }
        }
      }
      const hvcSet = computeHVC(session)
      for (const blankVolume of [false, true]) {
        for (const colorByNetChange of [false, true]) {
          for (const [boldCandles, modelBookLook, userCandleColors] of [[false, false, false], [true, false, false], [false, true, false], [false, false, true]]) {
            for (const liveVolForSym of [NaN, 5e9]) {
              const cs = { volume: { upColor: '#1a1', downColor: '#a11' } }
              const o = { blankVolume, adjustTime, userCandleColors, cs, mbVolUp: '#2b2', mbVolDown: '#b22', boldCandles, modelBookLook,
                BOLD_UP: '#21c45c', BOLD_DOWN: '#f23645', colorByNetChange, resolvedTf: v.resolvedTf, liveVolForSym,
                volExtremes: { goldTimes: new Set([session[3].t]) }, hvcSet }
              const vp = {
                blank: blankVolume,
                upC: userCandleColors ? (cs.volume.upColor || '#2b2') : boldCandles ? '#2b2' : modelBookLook ? '#21c45c' : cs.volume.upColor,
                downC: userCandleColors ? (cs.volume.downColor || '#b22') : boldCandles ? '#b22' : modelBookLook ? '#f23645' : cs.volume.downColor,
                netChange: colorByNetChange, dwm: ['D', 'W', 'M'].includes(v.resolvedTf), liveVol: liveVolForSym, bold: boldCandles,
              }
              expect(volDataOf(session, vp, hvcSet, o.volExtremes, adjustTime)).toEqual(oracleVol(session, o))
            }
          }
        }
      }
      for (const period of [2, 5, 20]) expect(volMaDataOf(session, period, adjustTime)).toEqual(oracleVolMa(session, period, adjustTime))
    })
  }

  it('the shared chart times are each bar\'s own adjustTime', () => {
    const bars = hourly()
    const times = chartTimesFor(bars, adjustTime)
    expect(times).toEqual(bars.map((b) => adjustTime(b.t)))
    expect(chartTimesFor(bars, adjustTime)).toBe(times)
    expect(ohlcBaseOf(bars, false, adjustTime, times)).toEqual(oracleOhlcBase(bars, adjustTime, 'dark'))
  })
})

describe('filed per array (the switch on): the same values, and the same object for the same question', () => {
  const recipesFor = (o = {}) => {
    const sessionP = { intradayLike: true, isIntraday: true, showExtended: false, tf: '60' }
    const at = identitySig(adjustTime)
    const closeP = { plain: true, mode: 'netchange', up: '#0f0', down: '#f00' }
    const volP = { blank: false, upC: '#1a1', downC: '#a11', netChange: true, dwm: false, liveVol: NaN, bold: false }
    return {
      adjustTime,
      session: { p: sessionP, sig: stableSig(sessionP) },
      heikinAshi: !!o.heikinAshi,
      hvcOn: true,
      ohlc: { sunrise: false, sig: `plain|at${at}` },
      close: { p: closeP, sig: `${stableSig(closeP)}|at${at}` },
      vol: { on: true, p: volP, sig: `${stableSig(volP)}|at${at}` },
      volMa: { on: true, period: 5, sig: `p${stableSig(5)}|at${at}` },
      plain: true,
    }
  }
  it('every derive* equals the unfiled function, and asking twice returns the first answer', () => {
    __setNeighborFramesForTests(true)
    const bars = hourly()
    const r = recipesFor()
    const s = deriveSession(bars, r)
    expect(s).toEqual(sessionBarsOf(bars, r.session.p))
    expect(deriveSession(bars, r)).toBe(s)
    const disp = deriveDisplay(s, r)
    expect(disp).toBe(s)
    const ha = deriveDisplay(s, { heikinAshi: true })
    expect(ha).toEqual(toHeikinAshi(s))
    expect(deriveDisplay(s, { heikinAshi: true })).toBe(ha)
    const o = deriveOhlcBase(disp, r)
    expect(o).toEqual(ohlcBaseOf(disp, false, adjustTime))
    expect(deriveOhlcBase(disp, r)).toBe(o)
    const c = deriveClose(disp, r)
    expect(c).toEqual(closeDataOf(disp, r.close.p, adjustTime))
    const h = deriveHvc(s, r)
    expect([...h]).toEqual([...computeHVC(s)])
    expect(deriveHvc(s, r)).toBe(h)
    expect(deriveHvc(s, { hvcOn: false })).toBe(EMPTY_HVC)
    const vd = deriveVol(s, h, null, r)
    expect(vd).toEqual(volDataOf(s, r.vol.p, h, null, adjustTime))
    expect(deriveVol(s, h, null, r)).toBe(vd)
    // a different HVC set is a different question
    expect(deriveVol(s, new Set(), null, r)).not.toBe(vd)
    const vm = deriveVolMa(s, r)
    expect(vm).toEqual(volMaDataOf(s, 5, adjustTime))
    // the second asking of session, Heikin-Ashi, candles, HVC and volume
    expect(neighborFramesStats().derivedHit).toBe(5)
  })

  it('a changed recipe is a different question (a new answer, never the old one)', () => {
    __setNeighborFramesForTests(true)
    const bars = daily(50)
    const r1 = recipesFor()
    const r2 = { ...r1, close: { p: { ...r1.close.p, plain: false }, sig: `${stableSig({ ...r1.close.p, plain: false })}|at${identitySig(adjustTime)}` } }
    const a = deriveClose(bars, r1)
    const b = deriveClose(bars, r2)
    expect(b).not.toBe(a)
    expect(b).toEqual(closeDataOf(bars, r2.close.p, adjustTime))
  })

  it('only the most recent sources keep what was derived from them (bounded memory)', () => {
    const arrays = Array.from({ length: SOURCES_KEPT + 3 }, () => daily(5))
    const first = deriveFrom(arrays[0], 'x', '', () => ({ n: 0 }))
    for (const a of arrays.slice(1)) deriveFrom(a, 'x', '', () => ({}))
    expect(deriveFrom(arrays[0], 'x', '', () => ({ n: 1 }))).not.toBe(first)
  })

  it('stableSig names values, and refuses what it cannot name', () => {
    expect(stableSig({ a: 1, b: 'x', c: [true, null, undefined] })).toBe(stableSig({ c: [true, null, undefined], b: 'x', a: 1 }))
    expect(stableSig({ a: '1' })).not.toBe(stableSig({ a: 1 }))
    expect(stableSig(NaN)).not.toBe(stableSig(0))
    expect(() => stableSig({ f: () => 1 })).toThrow()
  })
})

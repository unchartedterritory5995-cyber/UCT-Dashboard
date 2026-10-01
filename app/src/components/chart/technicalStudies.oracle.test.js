// app/src/components/chart/technicalStudies.oracle.test.js
//
// ─── THE TECHNICAL LIBRARY'S TIER 1, AGAINST AN INDEPENDENT ORACLE ──────────
//
// `tests/fixtures/technical_library/oracle.json` is written by `_oracle.py`: a
// NumPy implementation of every Tier 1 study from its published definition and
// the UCT conventions in `docs/decisions/2026-10-01-technical-library-tier1.md`,
// cross-checked against TA-Lib wherever TA-Lib uses the same convention (the
// agreement it measured is stored in `crossChecks`). It is not a port of this
// code, so agreement here is evidence rather than a tautology.
//
// ⛔ EACH COMPARISON IS EXACT ABOUT GAPS AND TIGHT ABOUT VALUES:
//   • a bar is a gap in UCT's output iff it is a gap in the oracle's — so the
//     FIRST VALID BAR (warm-up and seed) and every zero-denominator rule agree;
//   • a value agrees within 1e-9 relative to max(1, |expected|);
//   • nothing in any output is ±Infinity.
// The fixture carries a flat run (bars 300-329), a zero-volume run (360-364) and
// an 8% gap (420), so the edge rules are compared, not just the happy path.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as S from './technicalStudies'
import { maSeries, MA_TYPE_IDS } from './movingAverages'
import { computeVWAP, computeVWAPDeviation } from './indicators'
import * as registry from './engine/nativeRegistry'

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'tests', 'fixtures', 'technical_library', 'oracle.json'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`technicalStudies.oracle.test.js: oracle.json not found from ${process.cwd()}`)
})()

const ORACLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/technical_library/oracle.json'), 'utf8'))
const BARS = ORACLE.bars
const E = ORACLE.expected
const CLOSE = BARS.map((b) => b.c)
const VOL = BARS.map((b) => b.v)

/** The comparison: identical gaps, values within 1e-9 relative, no infinities. */
function agrees(label, got, exp) {
  expect(got.length, `${label}: length`).toBe(exp.length)
  let compared = 0
  for (let i = 0; i < exp.length; i++) {
    const g = got[i]
    const e = exp[i]
    expect(g === Infinity || g === -Infinity, `${label}[${i}] is infinite`).toBe(false)
    if (e === null) {
      expect(Number.isFinite(g), `${label}[${i}]: UCT has ${g}, the oracle has a gap`).toBe(false)
      continue
    }
    expect(Number.isFinite(g), `${label}[${i}]: UCT has a gap, the oracle has ${e}`).toBe(true)
    const tol = 1e-9 * Math.max(1, Math.abs(e))
    expect(Math.abs(g - e) <= tol, `${label}[${i}]: UCT ${g} vs oracle ${e}`).toBe(true)
    compared++
  }
  // ⛔ NON-VACUITY: a column of gaps on both sides would "agree" about nothing.
  expect(compared, `${label}: compared no values`).toBeGreaterThan(20)
}

/** Points (`{value}` holes) → numbers, for the compute-adapter comparisons. */
const nums = (col) => Array.from(col, (v) => (Number.isFinite(v) ? v : NaN))

describe('the oracle is the one generated, and it was cross-checked', () => {
  it('carries the fixture, every expected column, and the TA-Lib agreement', () => {
    expect(BARS.length).toBe(600)
    expect(Object.keys(E).length).toBeGreaterThan(30)
    // TA-Lib and the NumPy oracle agreed to ~1e-12 or better on every shared study.
    for (const [k, err] of Object.entries(ORACLE.crossChecks)) {
      expect(err, `${k}: the two references disagreed when generated`).toBeLessThan(1e-6)
    }
  })
  it('the edge segments are really in the fixture', () => {
    expect(BARS.slice(300, 330).every((b) => b.h === b.l && b.o === b.c)).toBe(true)
    expect(BARS.slice(360, 365).every((b) => b.v === 0)).toBe(true)
  })
})

describe('the moving-average kit — all nine types, period 21, over the close', () => {
  for (const type of MA_TYPE_IDS) {
    it(type, () => agrees(`ma.${type}`, maSeries(type, CLOSE, 21, VOL), E.ma[type]))
  }
  it('…and the Moving Average DEFINITION draws exactly the kit (computeFor)', () => {
    const def = registry.getDefinition('movingAverage')
    for (const type of MA_TYPE_IDS) {
      const cols = registry.computeFor(def, BARS, { period: 21, maType: type, source: 'close' }, { source: Float64Array.from(CLOSE) })
      agrees(`movingAverage[${type}]`, nums(cols.ma), E.ma[type])
    }
  })
})

describe('Trend & Moving Averages', () => {
  it('SuperTrend (10, 3)', () => {
    const r = S.superTrend(BARS, 10, 3)
    agrees('superTrend.up', r.up, E.superTrend.up)
    agrees('superTrend.down', r.down, E.superTrend.down)
  })
  it('Aroon (14)', () => {
    const r = S.aroon(BARS, 14)
    agrees('aroon.up', r.up, E.aroon.up)
    agrees('aroon.down', r.down, E.aroon.down)
  })
  it('Vortex (14)', () => {
    const r = S.vortex(BARS, 14)
    agrees('vortex.plus', r.plus, E.vortex.plus)
    agrees('vortex.minus', r.minus, E.vortex.minus)
  })
  it('Choppiness (14)', () => agrees('choppiness', S.choppiness(BARS, 14), E.choppiness))
})

describe('Momentum & Oscillators', () => {
  it('Stochastic RSI (14, 14, 3, 3)', () => {
    const r = S.stochRsi(CLOSE, 14, 14, 3, 3)
    agrees('stochRsi.k', r.k, E.stochRsi.k)
    agrees('stochRsi.d', r.d, E.stochRsi.d)
  })
  it('PPO (12, 26, 9)', () => {
    const r = S.ppo(CLOSE, 12, 26, 9)
    agrees('ppo.line', r.line, E.ppo.line)
    agrees('ppo.signal', r.signal, E.ppo.signal)
    agrees('ppo.histogram', r.histogram, E.ppo.histogram)
  })
  it('Rate of Change (12)', () => agrees('roc', S.rateOfChange(CLOSE, 12), E.roc))
  it('Momentum (10)', () => agrees('momentum', S.momentum(CLOSE, 10), E.momentum))
  it('TSI (25, 13, 13)', () => {
    const r = S.tsi(CLOSE, 25, 13, 13)
    agrees('tsi.line', r.line, E.tsi.line)
    agrees('tsi.signal', r.signal, E.tsi.signal)
  })
  it('CMO (14)', () => agrees('cmo', S.cmo(CLOSE, 14), E.cmo))
  it('TRIX (15, 9)', () => {
    const r = S.trix(CLOSE, 15, 9)
    agrees('trix.line', r.line, E.trix.line)
    agrees('trix.signal', r.signal, E.trix.signal)
  })
  it('Awesome Oscillator (5, 34)', () => agrees('awesome', S.awesome(BARS, 5, 34).ao, E.awesome))
  it('Ultimate Oscillator (7, 14, 28)', () => agrees('ultimate', S.ultimate(BARS, 7, 14, 28), E.ultimate))
  it('Balance of Power (14)', () => agrees('bop', S.balanceOfPower(BARS, 14), E.balanceOfPower))
  it('Bull/Bear Power (13)', () => {
    const r = S.bullBearPower(BARS, 13)
    agrees('bull', r.bull, E.bullBearPower.bull)
    agrees('bear', r.bear, E.bullBearPower.bear)
  })
})

describe('Volatility & Bands', () => {
  it('Keltner (20, 2, ATR 10)', () => {
    const r = S.keltner(BARS, 20, 2, 10)
    agrees('keltner.upper', r.upper, E.keltner.upper)
    agrees('keltner.middle', r.middle, E.keltner.middle)
    agrees('keltner.lower', r.lower, E.keltner.lower)
  })
  it('MA Envelope (SMA 20, 2.5%)', () => {
    const r = S.envelope(CLOSE, 20, 2.5, 'sma')
    agrees('envelope.upper', r.upper, E.envelope.upper)
    agrees('envelope.middle', r.middle, E.envelope.middle)
    agrees('envelope.lower', r.lower, E.envelope.lower)
  })
  it('Bollinger %B and BandWidth (20, 2)', () => {
    const r = S.bollingerDerived(BARS, 20, 2)
    agrees('percentB', r.percentB, E.percentB)
    agrees('bandwidth', r.bandwidth, E.bandwidth)
  })
  it('ATR % (14)', () => agrees('atrPercent', S.atrPercent(BARS, 14), E.atrPercent))
  it('ADR % (20)', () => agrees('adrPercent', S.adrPercent(BARS, 20), E.adrPercent))
  it('Historical Volatility (20, daily → 252)', () => {
    expect(S.periodsPerYearOf(BARS), 'daily bars were not recognised as daily').toBe(252)
    agrees('historicalVolatility', S.historicalVolatility(BARS, 20), E.historicalVolatility)
  })
  it('Squeeze (20, 2, 1.5)', () => {
    const r = S.squeeze(BARS, 20, 2, 1.5)
    agrees('squeeze.histogram', r.histogram, E.squeeze.histogram)
    agrees('squeeze.on', r.on, E.squeeze.on)
  })
})

describe('Volume & Money Flow', () => {
  it('Relative Volume (50)', () => agrees('rvol', S.relativeVolume(BARS, 50), E.relativeVolume))
  it('Accumulation/Distribution', () => agrees('ad', S.accumulationDistribution(BARS), E.accumulationDistribution))
  it('Chaikin Money Flow (20)', () => agrees('cmf', S.chaikinMoneyFlow(BARS, 20), E.chaikinMoneyFlow))
  it('Chaikin Oscillator (3, 10)', () => agrees('chaikinOsc', S.chaikinOscillator(BARS, 3, 10), E.chaikinOscillator))
  it('Elder Force Index (13)', () => agrees('efi', S.forceIndex(BARS, 13), E.forceIndex))
  it('Price Volume Trend', () => agrees('pvt', S.priceVolumeTrend(BARS), E.priceVolumeTrend))
  it('Up/Down Volume Ratio (50)', () => agrees('udVol', S.upDownVolumeRatio(BARS, 50), E.upDownVolumeRatio))
})

describe('Relative Strength · Levels & Statistics', () => {
  it('% From MA (SMA 50)', () => agrees('percentFromMa', S.percentFromMa(CLOSE, 50, 'sma'), E.percentFromMa))
  it('52-Week High/Low', () => {
    const r = S.fiftyTwoWeek(BARS)
    agrees('fromHigh', r.fromHigh, E.fiftyTwoWeek.fromHigh)
    agrees('fromLow', r.fromLow, E.fiftyTwoWeek.fromLow)
  })
  it('Standard Deviation (20)', () => agrees('stdev', S.standardDeviation(CLOSE, 20), E.standardDeviation))
})

describe('VWAP σ bands — the session deviation, over the intraday session fixture', () => {
  const intraday = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/src/pages/parityBars/intraday5m.json'), 'utf8')).bars
  it('the line is the shipped VWAP and the σ is the session\'s volume-weighted deviation', () => {
    const line = computeVWAP(intraday).map((p) => (p && Number.isFinite(p.value) ? p.value : NaN))
    agrees('vwap', line, E.vwapBands.vwap)
    agrees('vwap σ', computeVWAPDeviation(intraday), E.vwapBands.sd)
  })
  it('…and the definition draws vwap ± kσ only when bands are on', () => {
    const def = registry.getDefinition('vwap')
    const off = registry.computeFor(def, intraday, {})
    expect(registry.hasAnyFinite(off.upper1), 'bands drew with the option off').toBe(false)
    const on = registry.computeFor(def, intraday, { bands: '2' })
    const sd = E.vwapBands.sd
    const want = (k, sign) => E.vwapBands.vwap.map((v, i) => (v === null || sd[i] === null ? null : v + sign * k * sd[i]))
    agrees('upper1', nums(on.upper1), want(1, 1))
    agrees('lower2', nums(on.lower2), want(2, -1))
    expect(registry.hasAnyFinite(on.upper3), '±3σ drew with bands set to ±2σ').toBe(false)
  })
})

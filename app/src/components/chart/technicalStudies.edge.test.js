// app/src/components/chart/technicalStudies.edge.test.js
//
// ─── EDGE CASES FOR EVERY TIER 1 STUDY (2026-10-01) ─────────────────────────
//
// The oracle (`technicalStudies.oracle.test.js`) proves the maths on a realistic
// series with a flat run, zero volume and a gap. This file proves the RULES on
// the degenerate inputs a chart really receives: too little history, a frozen
// ticker, no volume, missing fields, extreme magnitudes. Two claims everywhere:
//   1. nothing throws, every output is input-length, nothing is ±Infinity;
//   2. each zero-denominator answer is the one documented for that study.

import { describe, it, expect } from 'vitest'
import * as S from './technicalStudies'
import { maSeries, MA_TYPE_IDS } from './movingAverages'

const day = (i) => new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10)
const walk = (n, { flat = false, vol = 1e6, scale = 1 } = {}) => Array.from({ length: n }, (_, i) => {
  const c = flat ? 50 * scale : (100 + Math.sin(i / 5) * 6 + i * 0.1) * scale
  return flat
    ? { t: day(i), o: c, h: c, l: c, c, v: vol }
    : { t: day(i), o: c - 0.4 * scale, h: c + 1 * scale, l: c - 1 * scale, c, v: vol }
})

/** Every study, called at its defaults, flattened to `{label: number[]}`. */
function everything(bars) {
  const c = bars.map((b) => b.c)
  const v = bars.map((b) => b.v)
  const out = {}
  const put = (name, r) => {
    if (Array.isArray(r)) { out[name] = r; return }
    for (const [k, col] of Object.entries(r)) if (Array.isArray(col)) out[`${name}.${k}`] = col
  }
  for (const t of MA_TYPE_IDS) put(`ma.${t}`, maSeries(t, c, 21, v))
  put('superTrend', S.superTrend(bars)); put('aroon', S.aroon(bars)); put('vortex', S.vortex(bars))
  put('choppiness', S.choppiness(bars)); put('stochRsi', S.stochRsi(c)); put('ppo', S.ppo(c))
  put('roc', S.rateOfChange(c)); put('momentum', S.momentum(c)); put('tsi', S.tsi(c))
  put('cmo', S.cmo(c)); put('trix', S.trix(c)); put('awesome', S.awesome(bars))
  put('ultimate', S.ultimate(bars)); put('bop', S.balanceOfPower(bars)); put('bbp', S.bullBearPower(bars))
  put('keltner', S.keltner(bars)); put('envelope', S.envelope(c)); put('bb', S.bollingerDerived(bars))
  put('atrPct', S.atrPercent(bars)); put('adrPct', S.adrPercent(bars)); put('stdev', S.standardDeviation(c))
  put('hv', S.historicalVolatility(bars)); put('squeeze', S.squeeze(bars))
  put('rvol', S.relativeVolume(bars)); put('ad', S.accumulationDistribution(bars))
  put('cmf', S.chaikinMoneyFlow(bars)); put('chaikinOsc', S.chaikinOscillator(bars))
  put('efi', S.forceIndex(bars)); put('pvt', S.priceVolumeTrend(bars)); put('udVol', S.upDownVolumeRatio(bars))
  put('pctFromMa', S.percentFromMa(c)); put('52w', S.fiftyTwoWeek(bars))
  return out
}

const finiteOrNaN = (label, col, n) => {
  expect(col.length, `${label} length`).toBe(n)
  for (let i = 0; i < col.length; i++) {
    expect(col[i] === Infinity || col[i] === -Infinity, `${label}[${i}] = ${col[i]}`).toBe(false)
    expect(typeof col[i], `${label}[${i}]`).toBe('number')
  }
}
const allNaN = (col) => col.every((x) => Number.isNaN(x))
const tail = (col) => col[col.length - 1]

describe('never throws, never Infinity, always input-length', () => {
  for (const [name, bars] of [
    ['empty', []],
    ['one bar', walk(1)],
    ['five bars', walk(5)],
    ['a normal year', walk(400)],
    ['a frozen ticker (flat)', walk(400, { flat: true })],
    ['no volume at all', walk(400, { vol: 0 })],
    ['tiny prices (1e-6)', walk(400, { scale: 1e-6 })],
    ['huge prices (1e9)', walk(400, { scale: 1e9 })],
  ]) {
    it(name, () => {
      let cols
      expect(() => { cols = everything(bars) }).not.toThrow()
      for (const [label, col] of Object.entries(cols)) finiteOrNaN(label, col, bars.length)
    })
  }

  it('missing / null fields are gaps, not crashes', () => {
    const bars = walk(400)
    bars[200] = { ...bars[200], c: null }
    bars[201] = { ...bars[201], h: undefined, l: undefined }
    bars[250] = { ...bars[250], v: null }
    let cols
    expect(() => { cols = everything(bars) }).not.toThrow()
    for (const [label, col] of Object.entries(cols)) finiteOrNaN(label, col, bars.length)
  })
})

describe('short history — nothing is computed until the window is full', () => {
  it('a series shorter than every warm-up yields nothing but gaps', () => {
    const cols = everything(walk(8))
    for (const [label, col] of Object.entries(cols)) {
      if (['ad', 'pvt', 'bop', 'bbp.bull', 'bbp.bear'].some((k) => label.startsWith(k))) continue
      expect(allNaN(col), `${label} computed on 8 bars`).toBe(true)
    }
  })
  it('the running totals start at the first bar (A/D, PVT), like OBV', () => {
    const cols = everything(walk(3))
    expect(cols.ad.every(Number.isFinite)).toBe(true)
    expect(cols.pvt[0]).toBe(0)
  })
})

describe('the documented zero-denominator answers, on a frozen ticker', () => {
  const flat = walk(400, { flat: true })
  const c = flat.map((b) => b.c)
  it('no movement: CMO, TSI, Choppiness, Vortex, %B, Ultimate are gaps (0/0 is not a value)', () => {
    expect(allNaN(S.cmo(c))).toBe(true)
    expect(allNaN(S.tsi(c).line)).toBe(true)
    expect(allNaN(S.choppiness(flat))).toBe(true)
    expect(allNaN(S.vortex(flat).plus)).toBe(true)
    expect(allNaN(S.bollingerDerived(flat).percentB)).toBe(true)
    expect(allNaN(S.ultimate(flat))).toBe(true)
  })
  it('a bar with no range is NEUTRAL where the study defines it: BOP 0, Stoch RSI 50, A/D adds 0', () => {
    expect(tail(S.balanceOfPower(flat))).toBe(0)
    expect(tail(S.stochRsi(c).k)).toBe(50)
    expect(tail(S.accumulationDistribution(flat))).toBe(0)
  })
  it('zero change is a real zero where it is a difference: ROC, Momentum, PPO, BBW, StdDev, ATR%', () => {
    expect(tail(S.rateOfChange(c))).toBe(0)
    expect(tail(S.momentum(c))).toBe(0)
    expect(tail(S.ppo(c).line)).toBe(0)
    expect(tail(S.bollingerDerived(flat).bandwidth)).toBe(0)
    expect(tail(S.standardDeviation(c))).toBe(0)
    expect(tail(S.atrPercent(flat))).toBe(0)
    expect(tail(S.historicalVolatility(flat))).toBe(0)
  })
  it('no down volume: the Up/Down ratio is a gap, never Infinity', () => {
    const rising = walk(200).map((b, i) => ({ ...b, c: 100 + i, o: 99 + i, h: 101 + i, l: 98 + i }))
    expect(allNaN(S.upDownVolumeRatio(rising))).toBe(true)
  })
  it('no volume: RVOL, CMF and VWMA are gaps; Force Index and PVT are zero', () => {
    const quiet = walk(200, { vol: 0 })
    expect(allNaN(S.relativeVolume(quiet))).toBe(true)
    expect(allNaN(S.chaikinMoneyFlow(quiet))).toBe(true)
    expect(allNaN(maSeries('vwma', quiet.map((b) => b.c), 21, quiet.map((b) => b.v)))).toBe(true)
    expect(tail(S.forceIndex(quiet))).toBe(0)
    expect(tail(S.priceVolumeTrend(quiet))).toBe(0)
  })
})

describe('SuperTrend is one line that changes side, never two at once', () => {
  it('on every bar exactly one of up/down carries the value once computable', () => {
    const r = S.superTrend(walk(400))
    let both = 0, seen = 0
    for (let i = 0; i < 400; i++) {
      const u = Number.isFinite(r.up[i]), d = Number.isFinite(r.down[i])
      if (u && d) both++
      if (u || d) seen++
    }
    expect(both).toBe(0)
    expect(seen).toBeGreaterThan(300)
    // …and it really does flip on this oscillating walk.
    expect(r.direction.includes(1) && r.direction.includes(-1)).toBe(true)
  })
})

describe('annualisation is read from the bars themselves', () => {
  const at = (stepDays, n = 60) => Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000 + i * stepDays * 86400 }))
  it('daily 252, weekly 52, monthly 12; intraday and too-short have no answer', () => {
    expect(S.periodsPerYearOf(at(1))).toBe(252)
    expect(S.periodsPerYearOf(walk(60))).toBe(252)              // ISO-date daily bars, weekends included
    expect(S.periodsPerYearOf(at(7))).toBe(52)
    expect(S.periodsPerYearOf(at(30))).toBe(12)
    expect(S.periodsPerYearOf(at(5 / 1440))).toBeNull()          // 5-minute bars
    expect(S.periodsPerYearOf(at(1, 2))).toBeNull()
  })
})

describe('52-Week High/Low needs a full calendar year', () => {
  it('gaps until 52 weeks of history are loaded, then answers every bar', () => {
    const r = S.fiftyTwoWeek(walk(400))
    expect(r.fromHigh.slice(0, 364).every(Number.isNaN)).toBe(true)
    expect(r.fromHigh.slice(364).every(Number.isFinite)).toBe(true)
    expect(r.fromHigh.slice(364).every((x) => x <= 0)).toBe(true)
    expect(r.fromLow.slice(364).every((x) => x >= 0)).toBe(true)
  })
})

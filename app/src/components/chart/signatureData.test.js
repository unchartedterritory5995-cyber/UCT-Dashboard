import { describe, it, expect } from 'vitest'
import {
  dpToPriceLines, dpToZones, gexToPriceLines, flowToMarkers, fmtNotional,
  toChartTime, GOLD, GAIN, LOSS, GRAY,
} from './signatureData'

describe('signatureData transforms', () => {
  it('fmtNotional compacts', () => {
    expect(fmtNotional(42_000_000)).toBe('$42M')
    expect(fmtNotional(1_200_000_000)).toBe('$1.2B')
  })

  it('dpToPriceLines tiers width by rank and suppresses secondary axis labels', () => {
    const lines = dpToPriceLines({ levels: [
      { price: 105, notional: 30e6, rank: 1 },
      { price: 100, notional: 12e6, rank: 3 },
    ]})
    expect(lines[0].lineWidth).toBe(2)
    expect(lines[0].axisLabelVisible).toBe(true)
    expect(lines[1].lineWidth).toBe(1)
    expect(lines[1].axisLabelVisible).toBe(false)
    expect(lines[0].title).toContain('$30M')
  })

  it('gexToPriceLines maps three kinds', () => {
    const lines = gexToPriceLines({ levels: [
      { kind: 'callWall', price: 510 }, { kind: 'putWall', price: 480 }, { kind: 'zeroGamma', price: 495 },
    ]})
    expect(lines.map(l => l.title)).toEqual(['Call Wall', 'Put Wall', 'Zero Γ'])
  })

  it('flowToMarkers maps direction to shape and side', () => {
    const m = flowToMarkers({ signals: [{ barTime: 1753900000, direction: 'bull', close: 182.5 }] })
    expect(m[0]).toMatchObject({ time: 1753900000, position: 'belowBar', shape: 'arrowUp', text: 'FCB' })
  })

  it('all transforms return [] on garbage', () => {
    for (const fn of [dpToPriceLines, dpToZones, gexToPriceLines, flowToMarkers]) {
      expect(fn(null)).toEqual([])
      expect(fn({})).toEqual([])
    }
  })
})

// ── Carry 3: the four hexes are the shared palette Task 11 imports ──────────
describe('signature palette', () => {
  it('exports the exact brief hexes', () => {
    expect([GOLD, GAIN, LOSS, GRAY]).toEqual(['#c9a84c', '#3cb868', '#e74c3c', '#8a8574'])
  })

  it('paints dark-pool gold, and the GEX trio gold / red / gray', () => {
    expect(dpToPriceLines({ levels: [{ price: 1, notional: 10e6, rank: 1 }] })[0].color).toBe(GOLD)
    const gex = gexToPriceLines({ levels: [
      { kind: 'callWall', price: 510 }, { kind: 'putWall', price: 480 }, { kind: 'zeroGamma', price: 495 },
    ]})
    expect(gex.map(l => l.color)).toEqual([GOLD, LOSS, GRAY])
    expect(gex.map(l => l.lineWidth)).toEqual([2, 2, 1])
    expect(gex.map(l => l.lineStyle)).toEqual([0, 0, 2])   // solid / solid / dashed
  })
})

// ── Carry 1: the REAL wire envelopes, including their error + empty states ──
describe('real /api/signature envelopes', () => {
  const DPL_OK = {
    sym: 'AAPL', version: 'dpl-v1', windowDays: 20, datesCovered: 18,
    levels: [
      { price: 212.44, notional: 42e6, printCount: 31, lastDate: '2026-07-30', rank: 1, lo: 212.18, hi: 212.71 },
      { price: 209.10, notional: 1.2e9, printCount: 12, lastDate: '2026-07-28', rank: 2, lo: 208.84, hi: 209.36 },
      { price: 205.00, notional: 11e6, printCount: 4, lastDate: '2026-07-21', rank: 5, lo: 204.74, hi: 205.26 },
    ],
    asOf: 1753900000.5,
  }

  it('dpToPriceLines titles a level "DP $42M" and dashes every line', () => {
    const lines = dpToPriceLines(DPL_OK)
    expect(lines.map(l => l.title)).toEqual(['DP $42M', 'DP $1.2B', 'DP $11M'])
    expect(lines.every(l => l.lineStyle === 2)).toBe(true)
    expect(lines.map(l => l.lineWidth)).toEqual([2, 2, 1])          // ranks 1-2 thick, 3-5 thin
    expect(lines.map(l => l.axisLabelVisible)).toEqual([true, false, false])
  })

  it('dpToZones carries lo/hi/rank straight through', () => {
    expect(dpToZones(DPL_OK)).toEqual([
      { lo: 212.18, hi: 212.71, rank: 1 },
      { lo: 208.84, hi: 209.36, rank: 2 },
      { lo: 204.74, hi: 205.26, rank: 5 },
    ])
  })

  it('an error-shaped DPL payload (levels: null) yields [] and never throws', () => {
    // fetch_dp_levels fails soft: the envelope keeps its metadata and drops
    // `levels` to null alongside an `error` string.
    const err = { sym: 'AAPL', version: 'dpl-v1', windowDays: 20, levels: null,
                  error: 'dark pool levels unavailable', asOf: 1753900000 }
    expect(() => dpToPriceLines(err)).not.toThrow()
    expect(dpToPriceLines(err)).toEqual([])
    expect(dpToZones(err)).toEqual([])
  })

  it('a HEALTHY GEX payload with zero walls is a normal state — [] quietly', () => {
    // Schwab auth down, or simply no wall inside the ±15% band. Not an error.
    const healthyEmpty = { levels: [], spot: 512.34, regime: 'positive', version: 'gxw-v1' }
    expect(() => gexToPriceLines(healthyEmpty)).not.toThrow()
    expect(gexToPriceLines(healthyEmpty)).toEqual([])
  })

  it('an error-shaped GEX payload yields [] and never throws', () => {
    const err = { levels: [], error: 'no data', version: 'gxw-v1' }
    expect(() => gexToPriceLines(err)).not.toThrow()
    expect(gexToPriceLines(err)).toEqual([])
  })

  it('gexToPriceLines drops unknown kinds and unusable prices', () => {
    const lines = gexToPriceLines({ levels: [
      { kind: 'callWall', price: 510 },
      { kind: 'gammaFlip', price: 500 },       // not one of the three
      { kind: 'putWall', price: null },        // unusable
      { kind: 'zeroGamma', price: 'nope' },
    ]})
    expect(lines).toEqual([{ price: 510, color: GOLD, lineWidth: 2, lineStyle: 0,
                             title: 'Call Wall', axisLabelVisible: true }])
  })

  it('an FCB error envelope has no signals key at all → []', () => {
    expect(flowToMarkers({ sym: 'AAPL', version: 'fcb-v1', error: 'flow unavailable' })).toEqual([])
  })
})

// ── Carry 2: barTime → the CHART's bar-time encoding ────────────────────────
// The wire's barTime is bars_sqlite's raw ts (daily = YYYYMMDD int), but the
// chart's daily bars come from /api/bars, which formats the same ts as an ISO
// "YYYY-MM-DD" string (_fmt_sqlite_bars) and StockChart's adjustTime leaves
// strings untouched. A marker whose time matches no bar is silently undrawn,
// so the conversion is the whole ballgame.
describe('FCB barTime encodings', () => {
  it('YYYYMMDD int → the ISO string the daily chart keys its bars by', () => {
    expect(toChartTime(20260730)).toBe('2026-07-30')
  })

  it('YYYYMMDD numeric string → the same ISO string', () => {
    expect(toChartTime('20260730')).toBe('2026-07-30')
  })

  it('ISO string passes through (and a datetime is truncated to the date)', () => {
    expect(toChartTime('2026-07-30')).toBe('2026-07-30')
    expect(toChartTime('2026-07-30T20:00:00Z')).toBe('2026-07-30')
  })

  it('epoch seconds pass through unchanged (the intraday bar encoding)', () => {
    expect(toChartTime(1753900000)).toBe(1753900000)
  })

  it('unusable times are null, never a guess', () => {
    for (const bad of [null, undefined, '', '   ', 'yesterday', NaN, Infinity, '2026-13-40', 20261340]) {
      expect(toChartTime(bad)).toBe(null)
    }
  })

  it('flowToMarkers converts a real YYYYMMDD payload to ISO marker times', () => {
    const m = flowToMarkers({ sym: 'AAPL', version: 'fcb-v1', asOf: 1753900000, signals: [
      { barTime: 20260730, direction: 'bull', close: 212.4, callPrem: 2.1e6, putPrem: 3e5, version: 'fcb-v1' },
      { barTime: 20260722, direction: 'bear', close: 198.2, callPrem: 1e5, putPrem: 4.4e6, version: 'fcb-v1' },
    ]})
    expect(m).toEqual([
      { time: '2026-07-22', position: 'aboveBar', color: LOSS, shape: 'arrowDown', text: 'FCB', size: 1 },
      { time: '2026-07-30', position: 'belowBar', color: GAIN, shape: 'arrowUp', text: 'FCB', size: 1 },
    ])
  })

  it('markers come out ascending — lightweight-charts rejects out-of-order markers', () => {
    const m = flowToMarkers({ signals: [
      { barTime: 20260730, direction: 'bull' },
      { barTime: 20260701, direction: 'bear' },
      { barTime: 20260715, direction: 'bull' },
    ]})
    expect(m.map(x => x.time)).toEqual(['2026-07-01', '2026-07-15', '2026-07-30'])
  })

  it('drops a signal with an unusable barTime or direction, keeps its siblings', () => {
    const m = flowToMarkers({ signals: [
      { barTime: 'garbage', direction: 'bull' },
      { barTime: 20260730, direction: 'sideways' },
      { barTime: 20260731, direction: 'bull' },
    ]})
    expect(m.map(x => x.time)).toEqual(['2026-07-31'])
  })
})

describe('bad rows inside an otherwise good payload', () => {
  it('dpToPriceLines drops a level with no usable price', () => {
    const lines = dpToPriceLines({ levels: [
      { price: null, notional: 30e6, rank: 1 },
      { price: 100, notional: 12e6, rank: 2 },
    ]})
    expect(lines).toHaveLength(1)
    expect(lines[0].price).toBe(100)
  })

  it('dpToZones drops a level with no usable band', () => {
    expect(dpToZones({ levels: [{ price: 100, rank: 1 }, { lo: 1, hi: 2, rank: 2 }] }))
      .toEqual([{ lo: 1, hi: 2, rank: 2 }])
  })

  it('fmtNotional refuses garbage rather than printing $NaNM', () => {
    for (const bad of [null, undefined, NaN, Infinity, -5, 0, 'lots']) {
      expect(fmtNotional(bad)).toBe('')
    }
    expect(dpToPriceLines({ levels: [{ price: 100, rank: 1 }] })[0].title).toBe('DP')
  })
})

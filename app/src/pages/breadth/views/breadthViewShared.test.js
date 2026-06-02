import { describe, it, expect } from 'vitest'
import {
  clamp, metricValue, percentileRank, normalizeMetric,
  metricColor, polarityOf, netPosture, PAIRS,
} from './breadthViewShared'

const M = (key, getTier = () => '') => ({ key, getTier })

describe('clamp', () => {
  it('bounds to 0..100', () => {
    expect(clamp(-5)).toBe(0)
    expect(clamp(140)).toBe(100)
    expect(clamp(42)).toBe(42)
  })
})

describe('metricValue', () => {
  it('reads a plain numeric field', () => {
    expect(metricValue(M('pct_above_50sma'), { pct_above_50sma: 57.8 })).toBe(57.8)
  })
  it('counts MA-stack checkmarks out of 4', () => {
    const row = { spy_above_10sma: 1, spy_above_20sma: 1, spy_above_50sma: 1, spy_above_200sma: 0 }
    expect(metricValue(M('spy_ma_stack'), row)).toBe(3)
  })
  it('maps is_ftd boolean to 1/0', () => {
    expect(metricValue(M('is_ftd'), { is_ftd: true })).toBe(1)
    expect(metricValue(M('is_ftd'), { is_ftd: false })).toBe(0)
  })
  it('returns null for missing/NaN', () => {
    expect(metricValue(M('vix'), {})).toBeNull()
    expect(metricValue(M('vix'), { vix: 'x' })).toBeNull()
  })
})

describe('percentileRank', () => {
  it('ranks a value within a sorted ascending array', () => {
    expect(percentileRank([1, 2, 3, 4], 3)).toBe(75)
    expect(percentileRank([1, 2, 3, 4], 4)).toBe(100)
  })
})

describe('normalizeMetric', () => {
  const pctile = { vix: [10, 12, 14, 16, 18, 20] }
  it('uses raw value for native percentages', () => {
    expect(normalizeMetric(M('pct_above_200sma'), { pct_above_200sma: 58.9 }, {})).toBe(58.9)
    expect(normalizeMetric(M('cnn_fear_greed'), { cnn_fear_greed: 59 }, {})).toBe(59)
  })
  it('scales MA stack to 0..100 out of 4', () => {
    const row = { spy_above_10sma: 1, spy_above_20sma: 1, spy_above_50sma: 1, spy_above_200sma: 1 }
    expect(normalizeMetric(M('spy_ma_stack'), row, {})).toBe(100)
  })
  it('scales mcclellan from -150..150 into 0..100', () => {
    expect(normalizeMetric(M('mcclellan_osc'), { mcclellan_osc: 0 }, {})).toBe(50)
  })
  it('falls back to percentile rank for counts', () => {
    expect(normalizeMetric(M('vix'), { vix: 16 }, pctile)).toBe(67)
  })
  it('returns null when no value and no percentile data', () => {
    expect(normalizeMetric(M('new_ath'), {}, {})).toBeNull()
  })
})

describe('metricColor', () => {
  it('maps the metric tier to a bright view color', () => {
    expect(metricColor(M('x', () => 'g3'), {})).toBe('#22c55e')
    expect(metricColor(M('x', () => 'r3'), {})).toBe('#ef4444')
    expect(metricColor(M('x', () => ''), {})).toBe('#475569')
  })
})

describe('polarityOf', () => {
  it('defaults to bull and overrides known bearish keys', () => {
    expect(polarityOf('pct_above_50sma')).toBe('bull')
    expect(polarityOf('vix')).toBe('bear')
    expect(polarityOf('new_52w_lows')).toBe('bear')
    expect(polarityOf('cnn_fear_greed')).toBe('bear')
  })
})

describe('netPosture', () => {
  const up = (key, partnerKey) => ({ key, pair: { partnerKey, side: 'up' } })
  const down = (key) => ({ key })
  const metrics = [
    up('up_4pct_today', 'down_4pct_today'), down('down_4pct_today'),
    up('new_52w_highs', 'new_52w_lows'), down('new_52w_lows'),
  ]
  it('returns a signed -100..100 net bull share', () => {
    const row = { up_4pct_today: 383, down_4pct_today: 208, new_52w_highs: 159, new_52w_lows: 48 }
    // pair1 share = (383-208)/591 = .296 ; pair2 = (159-48)/207 = .536 ; avg ≈ .416 → 42
    expect(netPosture(metrics, row)).toBe(42)
  })
  it('returns null when no usable pairs', () => {
    expect(netPosture(metrics, {})).toBeNull()
  })
})

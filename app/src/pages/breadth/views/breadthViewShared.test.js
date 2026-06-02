import { describe, it, expect } from 'vitest'
import {
  clamp, metricValue, percentileRank, normalizeMetric,
  metricColor, polarityOf, netPosture, PAIRS,
  bullishness, pickSignals, NOTABLE_MIN_DEV,
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
  it('returns null when is_ftd is absent', () => {
    expect(metricValue(M('is_ftd'), {})).toBeNull()
  })
  it('returns null when all MA-stack columns are absent', () => {
    expect(metricValue(M('spy_ma_stack'), {})).toBeNull()
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
  it('skips pairs whose values sum to zero', () => {
    const m = [up('up_4pct_today', 'down_4pct_today'), down('down_4pct_today')]
    expect(netPosture(m, { up_4pct_today: 0, down_4pct_today: 0 })).toBeNull()
  })
})

describe('bullishness', () => {
  const bull = { key: 'pct_above_50sma', polarity: 'bull' }
  const bear = { key: 'vix', polarity: 'bear' }
  it('passes through normalized value for bull metrics', () => {
    expect(bullishness(bull, { pct_above_50sma: 58 }, {})).toBe(58)
  })
  it('inverts for bear metrics (high reading = low bullishness)', () => {
    expect(bullishness(bear, { vix: 16 }, { vix: [10, 12, 14, 16, 18, 20] })).toBe(33) // 100 - 67
  })
  it('returns null when the metric has no value', () => {
    expect(bullishness(bull, {}, {})).toBeNull()
  })
})

describe('pickSignals', () => {
  // pct_above_* use raw value as bullishness directly (native pct, bull polarity)
  const mk = (key) => ({ key, polarity: 'bull' })
  const metrics = [mk('pct_above_5sma'), mk('pct_above_50sma'), mk('pct_above_200sma')]

  it('picks the biggest mover as the signal when something moved', () => {
    const cur = { pct_above_5sma: 45, pct_above_50sma: 58, pct_above_200sma: 60 }
    const prev = { pct_above_5sma: 70, pct_above_50sma: 57, pct_above_200sma: 59 } // 5sma moved 25
    const r = pickSignals(metrics, cur, prev, {})
    expect(r.signalKey).toBe('pct_above_5sma')
    expect(r.signalReason).toBe('biggest move')
  })

  it('falls back to most extreme when nothing moved', () => {
    const cur = { pct_above_5sma: 12, pct_above_50sma: 52, pct_above_200sma: 55 }
    const prev = { pct_above_5sma: 12, pct_above_50sma: 52, pct_above_200sma: 55 }
    const r = pickSignals(metrics, cur, prev, {})
    expect(r.signalKey).toBe('pct_above_5sma') // furthest from 50
    expect(r.signalReason).toBe('most extreme')
  })

  it('flags a metric diverging against a bullish board as notable', () => {
    // board mostly bullish (~75), one metric far below
    const cur = { pct_above_5sma: 30, pct_above_50sma: 78, pct_above_200sma: 80 }
    const prev = cur
    const r = pickSignals(metrics, cur, prev, {})
    expect(r.notableKey).toBe('pct_above_5sma')
    expect(r.notableReason).toBe('lagging the board')
  })

  it('returns no notable when the board is tightly clustered', () => {
    const cur = { pct_above_5sma: 52, pct_above_50sma: 54, pct_above_200sma: 53 }
    const r = pickSignals(metrics, cur, cur, {})
    expect(r.notableKey).toBeNull()
  })

  it('returns nulls when no metric has a value', () => {
    const r = pickSignals(metrics, {}, {}, {})
    expect(r.signalKey).toBeNull()
    expect(r.notableKey).toBeNull()
  })

  it('exposes a sane NOTABLE_MIN_DEV threshold', () => {
    expect(NOTABLE_MIN_DEV).toBeGreaterThanOrEqual(10)
  })
})

import { sortVisibleMetrics, PALETTES, resolveViewColors, metricColor as metricColorFn } from './breadthViewShared'

describe('sortVisibleMetrics', () => {
  const row = {}
  const metrics = [
    { key: 'a', polarity: 'bull', getTier: () => 'r3' },
    { key: 'b', polarity: 'bull', getTier: () => 'g3' },
    { key: 'c', polarity: 'bear', getTier: () => 'a' },
  ]
  const norm = (m) => ({ a: 20, b: 90, c: 40 }[m.key])

  it('group/board mode preserves original order', () => {
    expect(sortVisibleMetrics(metrics, 'group', norm, row).map(m => m.key)).toEqual(['a','b','c'])
    expect(sortVisibleMetrics(metrics, 'board', norm, row).map(m => m.key)).toEqual(['a','b','c'])
  })
  it('value mode sorts by normalized value desc', () => {
    expect(sortVisibleMetrics(metrics, 'value', norm, row).map(m => m.key)).toEqual(['b','c','a'])
  })
  it('bull mode inverts bearish metrics', () => {
    // bullishness: a=20, b=90, c=100-40=60 → b,c,a
    expect(sortVisibleMetrics(metrics, 'bull', norm, row).map(m => m.key)).toEqual(['b','c','a'])
  })
  it('tier mode ranks bullish tiers first', () => {
    expect(sortVisibleMetrics(metrics, 'tier', norm, row).map(m => m.key)).toEqual(['b','c','a'])
  })
})

describe('palettes + resolveViewColors', () => {
  it('exposes the four palettes each with a full tier map + accents', () => {
    for (const key of ['classic', 'colorblind', 'mono', 'ocean']) {
      const p = PALETTES[key]
      expect(p, key).toBeTruthy()
      for (const tier of ['g3','g2','g1','a','r1','r2','r3','']) expect(typeof p.tier[tier]).toBe('string')
      expect(typeof p.bull).toBe('string')
      expect(typeof p.bear).toBe('string')
    }
  })
  it('classic palette preserves the current look (bull #34d399 / bear #f87171)', () => {
    expect(PALETTES.classic.bull).toBe('#34d399')
    expect(PALETTES.classic.bear).toBe('#f87171')
  })
  it('resolveViewColors merges palette + intensity', () => {
    const subtle = resolveViewColors('ocean', 'subtle')
    expect(subtle.bull).toBe(PALETTES.ocean.bull)
    expect(subtle.fillOpacity).toBeLessThan(1)
    expect(subtle.dim).toBe(true)
    const bold = resolveViewColors('classic', 'bold')
    expect(bold.fillOpacity).toBe(1)
    expect(bold.glow).toBe(true)
    const normal = resolveViewColors()  // defaults
    expect(normal.tier).toBe(PALETTES.classic.tier)
    expect(normal.fillOpacity).toBe(1)
    expect(normal.glow).toBe(false)
  })
  it('metricColor honors a passed tier map', () => {
    const m = { getTier: () => 'g3' }
    expect(metricColorFn(m, {}, PALETTES.ocean.tier)).toBe(PALETTES.ocean.tier.g3)
    expect(metricColorFn(m, {})).toBe(PALETTES.classic.tier.g3)  // default
  })
})

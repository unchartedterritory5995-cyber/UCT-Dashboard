// app/src/pages/breadth/views/viewMetricConfig.test.js
import { describe, it, expect } from 'vitest'
import {
  VIEW_CONFIG, STYLES, isPairMetric, resolveDefaultVisible, optionDefaults, optionsSchema,
} from './viewMetricConfig'
import { PAIRS } from './breadthViewShared'

// Minimal stand-in metric universe covering keys the configs reference.
const ALL = [
  'breadth_score','uct_exposure','up_4pct_today','down_4pct_today','up_20pct_5d','down_20pct_5d','up_25pct_quarter',
  'down_25pct_quarter','up_50pct_month','down_50pct_month','magna_up','magna_down',
  'stage2_count','stage4_count','new_52w_highs','new_52w_lows','new_20d_highs','new_20d_lows',
  'pct_above_5sma','pct_above_10sma','pct_above_20ema','pct_above_40sma','pct_above_50sma',
  'pct_above_100sma','pct_above_200sma','sp500_close','qqq_close','vix','mcclellan_osc',
  'cnn_fear_greed','spy_ma_stack','qqq_ma_stack','new_ath','hvc_52w','ratio_5day','ratio_10day',
].map(k => ({ key: k, label: k, group: 'G', polarity: 'bull' }))

describe('viewMetricConfig', () => {
  it('defines a config for every style', () => {
    for (const s of STYLES) {
      expect(VIEW_CONFIG[s], `missing config for ${s}`).toBeTruthy()
      expect(typeof VIEW_CONFIG[s].label).toBe('string')
      expect(typeof VIEW_CONFIG[s].eligibleKeys).toBe('function')
      expect(Array.isArray(VIEW_CONFIG[s].defaultVisible)).toBe(true)
    }
  })

  it('every defaultVisible key is eligible for that view', () => {
    for (const s of STYLES) {
      const eligible = new Set(VIEW_CONFIG[s].eligibleKeys(ALL).map(m => m.key))
      for (const k of VIEW_CONFIG[s].defaultVisible) {
        expect(eligible.has(k), `${s} default ${k} not eligible`).toBe(true)
      }
    }
  })

  it('tug eligibility and default are limited to pair metrics', () => {
    const pairKeys = new Set(PAIRS.flat())
    const eligible = VIEW_CONFIG.tug.eligibleKeys(ALL).map(m => m.key)
    expect(eligible.every(k => pairKeys.has(k))).toBe(true)
    expect(VIEW_CONFIG.tug.defaultVisible.every(k => pairKeys.has(k))).toBe(true)
  })

  it('isPairMetric matches the PAIRS universe', () => {
    expect(isPairMetric('up_4pct_today')).toBe(true)
    expect(isPairMetric('vix')).toBe(false)
  })

  it('resolveDefaultVisible returns eligible default keys present in the universe', () => {
    const set = resolveDefaultVisible('radar', ALL)
    expect(set instanceof Set).toBe(true)
    expect(set.size).toBeGreaterThan(2)
  })

  it('optionDefaults merges schema defaults', () => {
    expect(optionDefaults('radar')).toEqual({ maxSpokes: 14, spokeSelect: 'auto', palette: 'classic', intensity: 'normal' })
    expect(optionDefaults('treemap')).toEqual({ weightBy: 'curated' })
  })
})

import { optionsSchema as optsSchema } from './viewMetricConfig'

describe('theming + treemap options', () => {
  const names = (style) => optsSchema(style).map(o => o.name)
  it('the 7 chart views expose palette + intensity', () => {
    for (const s of ['rings','tug','meters','timeline','radar','scoreboard','equalizer']) {
      expect(names(s), s).toEqual(expect.arrayContaining(['palette', 'intensity']))
    }
  })
  it('treemap exposes weightBy but not palette', () => {
    expect(names('treemap')).toContain('weightBy')
    expect(names('treemap')).not.toContain('palette')
  })
})

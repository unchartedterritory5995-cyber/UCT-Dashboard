import { describe, it, expect } from 'vitest'
import { legendModeOf, LEGEND_MODES, nextLegendMode } from './legendMode'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'

// ── ONE AUTHORITY OVER "IS THE LEGEND SHOWING" ───────────────────────────────
//
// `header.showLegend` (boolean) shipped first and is in every stored blob in
// production. `header.legendMode` supersedes it with a third state. These tests
// pin that the NEW key is the only writer and the OLD key is a read-only
// fallback — the alternative (keeping both writable and "syncing" them) is the
// second-authority-over-one-value defect this repo keeps paying for.
describe('legendModeOf — the single reader', () => {
  it('a blob that has never heard of either key reads as always-on (today"s behavior)', () => {
    expect(legendModeOf(mergeChartSettings(JSON.stringify({})))).toBe('always')
  })

  it('a LEGACY blob with showLegend:false still means off', () => {
    const cs = mergeChartSettings(JSON.stringify({ header: { showLegend: false } }))
    expect(legendModeOf(cs)).toBe('off')
  })

  it('a LEGACY blob with showLegend:true still means always', () => {
    const cs = mergeChartSettings(JSON.stringify({ header: { showLegend: true } }))
    expect(legendModeOf(cs)).toBe('always')
  })

  it('an explicit legendMode WINS over a contradicting legacy showLegend', () => {
    // The migration case that matters: the user picks "on click" in the new
    // control while an old `showLegend: true` is still sitting in the blob.
    // Reading the legacy key first would silently discard the choice.
    const cs = mergeChartSettings(JSON.stringify({
      header: { showLegend: true, legendMode: 'click' },
    }))
    expect(legendModeOf(cs)).toBe('click')
  })

  it('an explicit legendMode:off WINS over a legacy showLegend:true', () => {
    const cs = mergeChartSettings(JSON.stringify({
      header: { showLegend: true, legendMode: 'off' },
    }))
    expect(legendModeOf(cs)).toBe('off')
  })

  it('a junk legendMode falls back to the legacy answer rather than blanking the chart', () => {
    const cs = mergeChartSettings(JSON.stringify({
      header: { showLegend: false, legendMode: 'sometimes' },
    }))
    expect(legendModeOf(cs)).toBe('off')
  })

  it('survives a missing header / null settings without throwing', () => {
    expect(legendModeOf(null)).toBe('always')
    expect(legendModeOf({})).toBe('always')
    expect(legendModeOf({ header: null })).toBe('always')
  })

  it('mergeChartSettings PRESERVES legendMode — the allow-list must not destroy it', () => {
    // `mergeChartSettings` returns a hard allow-list; a key absent from it is
    // deleted on every read. `header` is spread wholesale, so this passes by
    // construction today — the test exists so a future tightening of the header
    // merge can't silently drop the user's choice.
    const cs = mergeChartSettings(JSON.stringify({ header: { legendMode: 'click' } }))
    expect(cs.header.legendMode).toBe('click')
  })

  it('the DEFAULT blob declares the mode, so the settings UI has something to read', () => {
    expect(CHART_DEFAULTS.header.legendMode).toBe('always')
  })
})

describe('nextLegendMode — what the toolbar button cycles through', () => {
  it('cycles always -> click -> off -> always', () => {
    expect(nextLegendMode('always')).toBe('click')
    expect(nextLegendMode('click')).toBe('off')
    expect(nextLegendMode('off')).toBe('always')
  })

  it('an unknown current mode lands on a real one rather than sticking', () => {
    expect(LEGEND_MODES).toContain(nextLegendMode('nonsense'))
  })

  it('LEGEND_MODES is the enumeration the cycle walks — no fourth state', () => {
    expect(LEGEND_MODES).toEqual(['always', 'click', 'off'])
  })
})

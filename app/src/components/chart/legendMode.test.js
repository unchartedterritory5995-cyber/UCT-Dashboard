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
  it('a blob that has never heard of either key reads as ON CLICK — the shipped default', () => {
    // ⭐ THE DEFAULT LIVES HERE, NOT IN `CHART_DEFAULTS`. `mergeChartSettings`
    // resolves `header.legendMode` by calling THIS function on the stored blob,
    // so the declaration in the schema is downstream of this line. Changing the
    // schema alone would have moved nothing — measured.
    expect(legendModeOf(mergeChartSettings(JSON.stringify({})))).toBe('click')
  })

  it('a LEGACY blob with showLegend:false still means off', () => {
    const cs = mergeChartSettings(JSON.stringify({ header: { showLegend: false } }))
    expect(legendModeOf(cs)).toBe('off')
  })

  it('a LEGACY blob with showLegend:true takes the NEW default, not always', () => {
    // ⚠️ A DELIBERATE, OWNER-APPROVED BEHAVIOUR CHANGE FOR EXISTING USERS.
    // `showLegend: true` only ever meant "not off" — it is the old checkbox's ON
    // state, and the old UI had no third option to distinguish "always" from
    // "on click". So it maps to the current default rather than pinning every
    // existing user to the old behaviour forever. `showLegend: false` is the one
    // legacy value that carries a real decision, and it is honoured below.
    const cs = mergeChartSettings(JSON.stringify({ header: { showLegend: true } }))
    expect(legendModeOf(cs)).toBe('click')
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

  it('an explicit legendMode:always WINS over the new default', () => {
    // The user who wants the old behaviour must be able to keep it.
    const cs = mergeChartSettings(JSON.stringify({ header: { legendMode: 'always' } }))
    expect(legendModeOf(cs)).toBe('always')
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

  it('⭐ showLegend:false is the ONE legacy value that survives the default flip', () => {
    // Everything else re-defaults; an explicit OFF is a decision someone made and
    // must not be quietly re-enabled by a change to what "unset" means.
    for (const blob of [{ header: { showLegend: false } },
                        { header: { showLegend: false, colors: {} } }]) {
      expect(legendModeOf(mergeChartSettings(JSON.stringify(blob)))).toBe('off')
    }
  })

  it('survives a missing header / null settings without throwing', () => {
    expect(legendModeOf(null)).toBe('click')
    expect(legendModeOf({})).toBe('click')
    expect(legendModeOf({ header: null })).toBe('click')
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
    // Kept in step with the resolver's fallback ON PURPOSE — they are two views
    // of one decision, and a schema that advertised a different default than the
    // one users actually get is the drift this file exists to prevent.
    expect(CHART_DEFAULTS.header.legendMode).toBe('click')
    expect(legendModeOf({}), 'the schema default and the resolver fallback disagree')
      .toBe(CHART_DEFAULTS.header.legendMode)
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

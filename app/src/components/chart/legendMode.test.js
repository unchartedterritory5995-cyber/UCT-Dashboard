import { describe, it, expect } from 'vitest'
import { legendModeOf, LEGEND_MODES, nextLegendMode, DEFAULT_LEGEND_MODE } from './legendMode'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'

// ── ONE AUTHORITY OVER "IS THE LEGEND SHOWING" ───────────────────────────────
//
// `header.showLegend` (boolean) shipped first and is in every stored blob in
// production. `header.legendMode` supersedes it with a third state. These tests
// pin that the NEW key is the only writer and the OLD key is a read-only
// fallback — the alternative (keeping both writable and "syncing" them) is the
// second-authority-over-one-value defect this repo keeps paying for.
describe('legendModeOf — the single reader', () => {
  it('⭐ THE ONE PLACE THE DEFAULT IS SPELLED OUT — changing it is deliberate', () => {
    // Every other default assertion in this file DERIVES from this constant, so a
    // future flip is a one-line change and cannot leave a stale literal behind
    // asserting the old answer. TradingView ships its legend always-on and users
    // expect that on arrival — owner call 2026-08-17.
    expect(DEFAULT_LEGEND_MODE).toBe('always')
  })

  it('a blob that has never heard of either key reads as the shipped default', () => {
    // ⭐ THE DEFAULT LIVES HERE, NOT IN `CHART_DEFAULTS`. `mergeChartSettings`
    // resolves `header.legendMode` by calling THIS function on the stored blob,
    // so the declaration in the schema is downstream of this line. Changing the
    // schema alone would have moved nothing — measured.
    expect(legendModeOf(mergeChartSettings(JSON.stringify({})))).toBe(DEFAULT_LEGEND_MODE)
  })

  it('a LEGACY blob with showLegend:false still means off', () => {
    const cs = mergeChartSettings(JSON.stringify({ header: { showLegend: false } }))
    expect(legendModeOf(cs)).toBe('off')
  })

  it('a LEGACY blob with showLegend:true takes the CURRENT default, whatever it is', () => {
    // ⚠️ A DELIBERATE, OWNER-APPROVED BEHAVIOUR CHANGE FOR EXISTING USERS.
    // `showLegend: true` only ever meant "not off" — it is the old checkbox's ON
    // state, and the old UI had no third option to distinguish "always" from
    // "on click". So it maps to the current default rather than pinning every
    // existing user to the old behaviour forever. `showLegend: false` is the one
    // legacy value that carries a real decision, and it is honoured below.
    const cs = mergeChartSettings(JSON.stringify({ header: { showLegend: true } }))
    expect(legendModeOf(cs)).toBe(DEFAULT_LEGEND_MODE)
  })

  it('an explicit legendMode WINS over a contradicting legacy showLegend', () => {
    // The migration case that matters: the user picks "on click" in the new
    // control while an old `showLegend: true` is still sitting in the blob.
    // Reading the legacy key first would silently discard the choice.
    const cs = mergeChartSettings(JSON.stringify({
      header: { showLegend: true, legendMode: 'hold' },
    }))
    expect(legendModeOf(cs)).toBe('hold')
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
    expect(legendModeOf(null)).toBe(DEFAULT_LEGEND_MODE)
    expect(legendModeOf({})).toBe(DEFAULT_LEGEND_MODE)
    expect(legendModeOf({ header: null })).toBe(DEFAULT_LEGEND_MODE)
  })

  it('mergeChartSettings PRESERVES legendMode — the allow-list must not destroy it', () => {
    // `mergeChartSettings` returns a hard allow-list; a key absent from it is
    // deleted on every read. `header` is spread wholesale, so this passes by
    // construction today — the test exists so a future tightening of the header
    // merge can't silently drop the user's choice.
    const cs = mergeChartSettings(JSON.stringify({ header: { legendMode: 'hold' } }))
    expect(cs.header.legendMode).toBe('hold')
  })

  it('⛔ the DEFAULT blob does NOT declare the mode — declaring it froze real users', () => {
    // A schema entry gets spread into every merged blob, and the merged blob is
    // what every settings write persists. Declaring the default therefore RECORDS
    // it as a user choice, after which no later default can outrank it — which is
    // exactly what happened to the owner on 2026-08-16. The default lives in
    // `DEFAULT_LEGEND_MODE` and is re-derived on every read.
    expect(Object.prototype.hasOwnProperty.call(CHART_DEFAULTS.header, 'legendMode')).toBe(false)
    expect(legendModeOf({})).toBe(DEFAULT_LEGEND_MODE)
  })

  it('a blob stored under the ONE-DAY name `click` still means hold', () => {
    // It shipped as click-to-pin for a day before becoming press-and-hold; anyone
    // who picked it then meant "not always, not off", which is what hold is.
    expect(legendModeOf({ header: { legendMode: 'click' } })).toBe('hold')
  })
})

describe('nextLegendMode — what the toolbar button cycles through', () => {
  it('cycles always -> hold -> off -> always', () => {
    expect(nextLegendMode('always')).toBe('hold')
    expect(nextLegendMode('hold')).toBe('off')
    expect(nextLegendMode('off')).toBe('always')
  })

  it('an unknown current mode lands on a real one rather than sticking', () => {
    expect(LEGEND_MODES).toContain(nextLegendMode('nonsense'))
  })

  it('LEGEND_MODES is the enumeration the cycle walks — no fourth state', () => {
    expect(LEGEND_MODES).toEqual(['always', 'hold', 'off'])
  })
})

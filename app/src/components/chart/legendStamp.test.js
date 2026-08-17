import { describe, it, expect } from 'vitest'
import { mergeChartSettings } from './chartDefaults'
import { legendModeOf, DEFAULT_LEGEND_MODE } from './legendMode'

// ─── 🔴 A RESOLVED DEFAULT MUST NOT BE WRITTEN BACK AS A CHOICE ──────────────
//
// `mergeChartSettings` is a READ. Every settings write site persists the
// fully-merged blob (`handleUpdateChartSettings` → `{...cs, ...change}`), so any
// key the merge INVENTS becomes a stored fact on the next save — and a stored
// value outranks a default forever after.
//
// ⚰️ MEASURED IN PRODUCTION 2026-08-16/17: v1 shipped with the default `'always'`
// and stamped it into the merged blob. Anyone who saved a chart setting in that
// window had `legendMode:'always'` frozen into their settings, so the next day's
// default flip could never reach them — the owner reported the legend still
// permanently on. Same shape as the NAAIM freeze: a SEEDED DEFAULT BECAME A
// RECORDED FACT.
describe('the legend default is never persisted as if the user chose it', () => {
  it('a blob with no legend keys gains none from a read', () => {
    const merged = mergeChartSettings(JSON.stringify({ header: { titleMode: 'both' } }))
    expect(Object.prototype.hasOwnProperty.call(merged.header, 'legendMode'),
      'the read INVENTED a legendMode — the next save freezes today\'s default forever',
    ).toBe(false)
  })

  it('…and a read-modify-write round trip STILL stores none', () => {
    // ⚠️ THE ASSERTION HAS TO BE ABOUT THE STORED KEY, NOT THE ANSWER. The first
    // draft asserted the round trip still resolves to DEFAULT_LEGEND_MODE — which
    // passed against the broken code, because the stamped value happened to equal
    // today's default. It could only have failed on the day someone changed the
    // default, i.e. exactly too late. What makes a user un-flippable is the
    // PRESENCE of the key, so that is what this measures.
    const stored = JSON.stringify({ header: { titleMode: 'both' } })
    const merged = mergeChartSettings(stored)
    const persisted = { ...merged, background: '#111' }          // a settings edit
    expect(Object.prototype.hasOwnProperty.call(persisted.header, 'legendMode'),
      'a user who never chose a legend mode just had one written into their settings',
    ).toBe(false)
    expect(legendModeOf(mergeChartSettings(JSON.stringify(persisted)))).toBe(DEFAULT_LEGEND_MODE)
  })

  it('an EXPLICIT choice survives the same round trip — this is not "drop it always"', () => {
    const merged = mergeChartSettings(JSON.stringify({ header: { legendMode: 'always' } }))
    expect(merged.header.legendMode).toBe('always')
    const persisted = JSON.stringify({ ...merged, background: '#111' })
    expect(legendModeOf(mergeChartSettings(persisted))).toBe('always')
  })

  it('an explicit legacy showLegend:false also survives it', () => {
    const merged = mergeChartSettings(JSON.stringify({ header: { showLegend: false } }))
    const persisted = JSON.stringify({ ...merged, background: '#111' })
    expect(legendModeOf(mergeChartSettings(persisted))).toBe('off')
  })
})

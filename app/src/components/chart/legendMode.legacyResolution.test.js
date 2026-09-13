import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { legendModeOf, DEFAULT_LEGEND_MODE } from './legendMode'
import { mergeChartSettings } from './chartDefaults'

// ─── WHAT THIS DEFENDS ───────────────────────────────────────────────────────
//
// A 2026-09 mobile research pass concluded that a member's phone could show NO
// OHLC crosshair legend at all, because the retired boolean `header.showLegend`
// "sits in every stored blob in production" and was thought to outrank the
// current default. The production-reality gate run on 2026-09-08 DID NOT
// REPRODUCE IT, and this file is the reason it can never quietly become true:
//
//   • the live production account stores `header: { showLegend: true }` with NO
//     `legendMode` key — which resolves to the 'always' default, legend ON;
//   • `chartDefaults.js` ships `showLegend: true`, and the UCT default workspace
//     blob carries `"showLegend":true`, so nothing DEFAULTS a member to false;
//   • `legendModeOf` treats ONLY an explicit `showLegend === false` as "off", and
//     that is a deliberate user choice made through a checkbox that has since
//     been removed — honouring it is correct, not a defect.
//
// ⚠️ The tests below therefore pin the SAFE direction of the fallback. If a future
// change makes an unset or `true` legacy blob resolve to anything but the current
// default, a silent population of members loses their legend and nothing else in
// the suite would notice. `legendStamp.test.js` guards the neighbouring rule (a
// resolved default must never be WRITTEN back); this guards what a READ returns.

/** The header shape actually observed in the live production `chart_settings`
 *  on 2026-09-08 — the legacy boolean present and TRUE, no mode key. */
const PRODUCTION_HEADER = {
  titleMode: 'both',
  showChange: true,
  timeframes: ['5', '15', '30', 'D', 'W', '1', 'M', '60'],
  showMarketCap: true,
  showNextEarnings: true,
  showUctRating: true,
  showLegend: true,
}

describe('legendModeOf — the legacy fallback resolves TOWARDS the legend, never away from it', () => {
  it('the REAL production blob (showLegend:true, no legendMode) resolves to the default', () => {
    expect(legendModeOf({ header: PRODUCTION_HEADER })).toBe(DEFAULT_LEGEND_MODE)
    expect(DEFAULT_LEGEND_MODE, 'the default itself must keep the legend visible').not.toBe('off')
  })

  it('…and still does through mergeChartSettings, which is the path a chart actually reads', () => {
    const stored = JSON.stringify({ header: PRODUCTION_HEADER })
    const merged = mergeChartSettings(stored)
    expect(legendModeOf(merged)).toBe(DEFAULT_LEGEND_MODE)
    // and the read must not have invented a stored choice (legendStamp's rule, restated
    // here only as a guard on THIS fixture — that file owns the rule itself).
    expect(Object.prototype.hasOwnProperty.call(merged.header, 'legendMode')).toBe(false)
  })

  it('a blob with no header, or an empty header, resolves to the default', () => {
    expect(legendModeOf({})).toBe(DEFAULT_LEGEND_MODE)
    expect(legendModeOf({ header: {} })).toBe(DEFAULT_LEGEND_MODE)
    expect(legendModeOf(null)).toBe(DEFAULT_LEGEND_MODE)
  })

  it('ONLY an explicit showLegend:false turns it off — and that is a user choice, not a bug', () => {
    expect(legendModeOf({ header: { showLegend: false } })).toBe('off')
    // Every other falsy-ish shape is NOT a decision and must not blank the legend.
    for (const v of [undefined, null, 0, '', 'false']) {
      expect(legendModeOf({ header: { showLegend: v } }),
        `showLegend:${JSON.stringify(v)} is not an explicit false and must keep the default`,
      ).toBe(DEFAULT_LEGEND_MODE)
    }
  })

  it('an explicit mode outranks the legacy boolean in both directions', () => {
    expect(legendModeOf({ header: { legendMode: 'off', showLegend: true } })).toBe('off')
    expect(legendModeOf({ header: { legendMode: 'always', showLegend: false } })).toBe('always')
    expect(legendModeOf({ header: { legendMode: 'hold', showLegend: false } })).toBe('hold')
  })

  it("the retired 'click' alias still means 'hold'", () => {
    expect(legendModeOf({ header: { legendMode: 'click' } })).toBe('hold')
  })

  it('an unrecognised stored mode degrades to the legacy answer rather than blanking', () => {
    expect(legendModeOf({ header: { legendMode: 'sideways', showLegend: true } })).toBe(DEFAULT_LEGEND_MODE)
    expect(legendModeOf({ header: { legendMode: 'sideways', showLegend: false } })).toBe('off')
  })
})

// ─── THE CLAIM THAT STARTED IT: "the legend is gated on the pointer" ─────────
//
// It is not, and this asserts that from the SOURCE rather than from memory —
// the research pass spent a device session on a branch that does not exist.
// Derived, never retyped: read the gate out of StockChart.jsx and look at it.
describe('the legend render gate is about state, not about the input device', () => {
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'StockChart.jsx'),
    'utf8',
  )
  // The one render gate, located by the tokens it must contain rather than by a line number.
  const gate = src.split('\n').find((l) => l.includes('legendMode !== ') && l.includes('crosshairData'))

  it('the gate exists and is found by content, not by a line number', () => {
    expect(gate, 'the legend render gate moved or changed shape — re-read it before trusting this file').toBeTruthy()
  })

  it('the gate names no pointer, coarse-pointer, touch or viewport condition', () => {
    for (const token of ['pointer', 'coarse', 'isTouch', 'isPhone', 'matchMedia', 'innerWidth']) {
      expect(gate.toLowerCase(), `the legend gate now depends on "${token}" — a mobile-only legend regression is possible`)
        .not.toContain(token.toLowerCase())
    }
  })

  it('the gate is crosshair-gated, which is why a chart with no crosshair shows no legend', () => {
    // ⭐ This is the actual explanation for the 2026-09 "no O/H/L/C on mobile" observation:
    // a synthetic pointer never produced a crosshair, and `.volLegend` is NOT crosshair-gated,
    // so the volume strip rendered beside an absent OHLC row and read as a missing feature.
    expect(gate).toContain('crosshairData')
  })
})

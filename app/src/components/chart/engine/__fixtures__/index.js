// app/src/components/chart/engine/__fixtures__/index.js
//
// ─── Golden `chart_settings` blobs the migrator is tested against ────────────
//
// Spec §5 safeguard 2: the legacy migrator is asserted against REAL stored
// blobs, not only against hand-built ones, because the shapes that actually
// live in `user_preferences` are older and rattier than anything a test author
// invents from the current schema.
//
// PROVENANCE IS RECORDED PER FIXTURE and it is not decoration — a reconstructed
// blob can only ever prove the migrator handles the shapes we already thought
// of, while a genuine one is the thing that surprises you. Each entry below
// declares `provenance: 'genuine' | 'reconstructed'`, and the tests print it.
//
//   * GENUINE — `owner-uct-default.json` is a byte-faithful parse of
//     `UCT_DEFAULT_CHART_SETTINGS_JSON` (`pages/charts/ChartsWorkspace.jsx:97`),
//     which that file documents as "captured from the owner's live workspace".
//     It IS a production `chart_settings` value: it carries a slider-dragged
//     `watermark.opacity` of 0.5176470588235295, a `header.colors.dayChange`
//     key the current schema no longer declares, a 4-slot `overlays` array from
//     before the SMA-5 slot was appended, a `vwap` section with none of the
//     three fields later added to it, and no `settingsVersion` /
//     `indicatorInstances` / `volumeOverlayIndicators` keys at all. Nobody
//     writing a fixture from today's `CHART_DEFAULTS` would produce that.
//
//   * RECONSTRUCTED — the other four. Three are `mergeChartSettings(PRESETS.x)`
//     with an indicator stack turned on (what a modern write persists: the full
//     merged blob, `preset: 'custom'`); one, `legacy-partial-v0.json`, is a
//     hand-written pre-schema subset modelled on the genuine blob's shape.
//
// A read-only production path for more genuine blobs EXISTS —
// `GET /api/r/chart-settings?token=…` (`api/routers/render_panels.py:364`)
// returns the owner's live blob and nothing else — but reaching it needs the
// token out of `morning-wire/.env` plus a call to prod, which is not something
// this task could take. If you ever have that in hand, drop the JSON in here
// with `provenance: 'genuine'` and add its expectation to the golden table; the
// table is data, so a new blob costs one entry.
//
// ⚠️ These files are INPUTS, never outputs. Nothing regenerates them, and a
// fixture edited to make a failing test pass has destroyed the only evidence
// the test had.

import ownerUctDefault from './owner-uct-default.json'
import presetOledMomentum from './preset-oled-momentum.json'
import presetTradingviewPriceOverlays from './preset-tradingview-price-overlays.json'
import presetLightPaneStack from './preset-light-pane-stack.json'
import legacyPartialV0 from './legacy-partial-v0.json'

export {
  ownerUctDefault,
  presetOledMomentum,
  presetTradingviewPriceOverlays,
  presetLightPaneStack,
  legacyPartialV0,
}

/** Every fixture, with its provenance. The golden test iterates this. */
export const BLOB_FIXTURES = [
  {
    name: 'owner-uct-default',
    provenance: 'genuine',
    note: 'captured from the owner\'s live workspace; pre-dates settingsVersion, indicatorInstances, the SMA-5 overlay slot and the three vwap fields',
    cs: ownerUctDefault,
  },
  {
    name: 'preset-oled-momentum',
    provenance: 'reconstructed',
    note: 'OLED preset + a momentum stack; MFI moved into the volume pane',
    cs: presetOledMomentum,
  },
  {
    name: 'preset-tradingview-price-overlays',
    provenance: 'reconstructed',
    note: 'TradingView preset + every price-target native on at once',
    cs: presetTradingviewPriceOverlays,
  },
  {
    name: 'preset-light-pane-stack',
    provenance: 'reconstructed',
    note: 'Light preset + the pane stack; OBV and ATR both volume-overlaid',
    cs: presetLightPaneStack,
  },
  {
    name: 'legacy-partial-v0',
    provenance: 'reconstructed',
    note: 'pre-schema subset: four indicator keys only, one of them volumeProfile, one carrying a field no definition declares',
    cs: legacyPartialV0,
  },
]

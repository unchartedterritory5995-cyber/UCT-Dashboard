/**
 * houseLook — the firm's exported-image look, in ONE place.
 *
 * Owner, 2026-10-02: hollow candles, volume in the candles' own green/red, and a
 * slim volume pane. It lands OVER the owner's saved chart_settings blob (whose
 * volume.upColor is white) and UNDER every per-render choice. Three readers:
 * the headless /r/chart page (Discord /chart, the Sunday Scans letter) and the
 * Study drills + their review screen — so a Study chart is the same picture a
 * member already knows from Discord. Restating any of this in a second file is
 * the two-authorities-over-one-value defect; import it.
 */
import { mergeSettingsOverride } from './chartDefaults'

export const RENDER_VOL_UP = '#2faf68'
export const RENDER_VOL_DOWN = '#df4646'
export const RENDER_VOL_PANE_PCT = 12

/**
 * applyHouseLook(base, presetDelta?) — base = the owner's chart_settings blob
 * (or {} when none is saved). The order is load-bearing: the look, then a
 * preset (which may recolour the candles), then volume takes the colours of the
 * candles ACTUALLY drawn unless the preset chose its own volume colours.
 */
export function applyHouseLook(base, presetDelta = null) {
  let out = mergeSettingsOverride(base || {}, {
    chartType: 'hollow',
    volume: { paneHeightPct: RENDER_VOL_PANE_PCT },
  })
  if (presetDelta) out = mergeSettingsOverride(out, presetDelta)
  const c = out.candles || {}
  const pv = (presetDelta && presetDelta.volume) || {}
  return mergeSettingsOverride(out, {
    volume: {
      upColor: pv.upColor || c.upColor || RENDER_VOL_UP,
      downColor: pv.downColor || c.downColor || RENDER_VOL_DOWN,
    },
  })
}

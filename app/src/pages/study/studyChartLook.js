/**
 * studyChartLook — what a Study chart looks like: the HOUSE look (the owner's
 * saved chart settings + the exported-image treatment every member knows from
 * Discord /chart), with every feed a drill must not leak switched off.
 *
 * Owner, 2026-10-20, on the first chart-word item: "this is not what our
 * charts look like." It was drawing the schema defaults with volume hidden.
 * Spec D6 ("volume and MAs off unless the item is about them") is superseded
 * by that ruling: the house averages and volume are ON by default, and an item
 * opts OUT through its prompt chart options (`overlays: false`, `volume: false`)
 * or names its own averages (`overlays: [...]`).
 */
import { CHART_DEFAULTS, mergeSettingsOverride } from '../../components/chart/chartDefaults'
import { applyHouseLook } from '../../components/chart/houseLook'

export const HOUSE_CHART_URL = '/api/study/house-chart'

const STUDY_GATES = Object.freeze({
  markers: { ...CHART_DEFAULTS.markers, earnings: false, splits: false, dividends: false, news: false, ipo: false, desk: false },
  showPatterns: false,
  darkPool: { ...(CHART_DEFAULTS.darkPool || {}), enabled: false },
  signature: { darkPoolLevels: false, gexWalls: false, flowSignals: false },
  comparisonSymbols: [],
  compareHideBase: false,
  countdown: false,
  prevDayLevels: {
    high: { ...(CHART_DEFAULTS.prevDayLevels?.high || {}), enabled: false },
    low: { ...(CHART_DEFAULTS.prevDayLevels?.low || {}), enabled: false },
    close: { ...(CHART_DEFAULTS.prevDayLevels?.close || {}), enabled: false },
  },
  showMaLabels: false,
})

/**
 * studySettingsOverride(chartOpts, houseSettings) — the StockChart
 * `settingsOverride` for one item. `houseSettings` is the owner's blob from
 * GET /api/study/house-chart (null while loading or when none is saved: the
 * look still applies over the schema defaults, so the chart never waits on it).
 */
export function studySettingsOverride(chartOpts, houseSettings = null) {
  const o = chartOpts || {}
  let out = mergeSettingsOverride(applyHouseLook(houseSettings || {}), STUDY_GATES)
  if (Array.isArray(o.overlays)) {
    out = { ...out, overlays: o.overlays }                       // the item names its own averages
  } else if (o.overlays === false) {
    const src = Array.isArray(out.overlays) && out.overlays.length ? out.overlays : CHART_DEFAULTS.overlays
    out = { ...out, overlays: src.map((ov) => ({ ...ov, enabled: false })) }
  }
  if (o.volume === false) out = mergeSettingsOverride(out, { volume: { visible: false } })
  else if (o.volume === true) out = mergeSettingsOverride(out, { volume: { visible: true } })
  return out
}

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
import { CHART_DEFAULTS, mergeChartSettings, mergeSettingsOverride } from '../../components/chart/chartDefaults'
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
 * instancesOff(...blobs) — tombstone patches (merged by id) for EVERY indicator
 * instance the chart would draw from these settings blobs, each read the way
 * StockChart reads a member's blob (mergeChartSettings: the defaults under it,
 * an older blob's overlay slots adopted into `ovl:<i>` instances). A member's
 * averages ARE instances since the fold (maAdoption.js), so `overlays: false`
 * alone left three of them drawing on the first Hard mode capture (2026-11-05):
 * the list it switched off was already empty. Pass the member's own blob too:
 * the chart merges it underneath the override, and its instances carry ids the
 * house blob never saw.
 */
export function instancesOff(...blobs) {
  const ids = new Set()
  for (const raw of blobs) {
    let b = raw
    if (typeof b === 'string') { try { b = JSON.parse(b) } catch { b = null } }
    const cs = mergeChartSettings(b && typeof b === 'object' ? b : {})
    for (const inst of (Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : [])) {
      if (inst && typeof inst.instanceId === 'string') ids.add(inst.instanceId)
    }
  }
  return [...ids].map((instanceId) => ({ instanceId, deleted: true }))
}

/**
 * studySettingsOverride(chartOpts, houseSettings, extras) — the StockChart
 * `settingsOverride` for one item. `houseSettings` is the owner's blob from
 * GET /api/study/house-chart (null while loading or when none is saved: the
 * look still applies over the schema defaults, so the chart never waits on it).
 * `extras.instances` are the item's OWN engine lines (the Slingshot E4H,
 * `slingshotOverlay.js`), merged by id beside the house averages.
 */
export function studySettingsOverride(chartOpts, houseSettings = null, extras = null) {
  const o = chartOpts || {}
  let out = mergeSettingsOverride(applyHouseLook(houseSettings || {}), STUDY_GATES)
  if (Array.isArray(o.overlays)) {
    out = { ...out, overlays: o.overlays }                       // the item names its own averages
  } else if (o.overlays === false) {
    const src = Array.isArray(out.overlays) && out.overlays.length ? out.overlays : CHART_DEFAULTS.overlays
    // `removed` as well as `enabled: false`: the override merge ADOPTS a live slot back into an `ovl:<i>`
    // instance (maAdoption.js) and would revive the very average this switches off; a removed slot reserves
    // its id with a tombstone instead. The member's own instances are tombstoned by id, whatever their ids.
    out = { ...out, overlays: src.map((ov) => ({ ...ov, enabled: false, removed: true })) }
    out = mergeSettingsOverride(out, { indicatorInstances: instancesOff(houseSettings, extras && extras.memberSettings) })
  }
  if (o.volume === false) out = mergeSettingsOverride(out, { volume: { visible: false } })
  else if (o.volume === true) out = mergeSettingsOverride(out, { volume: { visible: true } })
  const instances = extras && Array.isArray(extras.instances) ? extras.instances : null
  if (instances && instances.length) out = mergeSettingsOverride(out, { indicatorInstances: instances })
  return out
}

/**
 * memberSettingsOverride(chartOpts, extras) — round 17 (owner, batch 16: "not our complete and perfect UCT charts
 * that each user has in their settings in their widget in the charts tab?"): NO house look. StockChart merges the
 * member's own global chart_settings underneath, so the drill chart is the member's Charts-tab chart with the study
 * gates on top and the item's own averages / volume choice / engine lines, exactly as studySettingsOverride applies them.
 */
export function memberSettingsOverride(chartOpts, extras = null) {
  const o = chartOpts || {}
  let out = { ...STUDY_GATES }
  if (Array.isArray(o.overlays)) out = { ...out, overlays: o.overlays }
  else if (o.overlays === false) {
    out = { ...out, overlays: CHART_DEFAULTS.overlays.map((ov) => ({ ...ov, enabled: false, removed: true })) }
    out = mergeSettingsOverride(out, { indicatorInstances: instancesOff(extras && extras.memberSettings) })
  }
  if (o.volume === false) out = mergeSettingsOverride(out, { volume: { visible: false } })
  else if (o.volume === true) out = mergeSettingsOverride(out, { volume: { visible: true } })
  const instances = extras && Array.isArray(extras.instances) ? extras.instances : null
  if (instances && instances.length) out = mergeSettingsOverride(out, { indicatorInstances: instances })
  return out
}

/**
 * widgetSettingsOverride(chartOpts, ownChartSource, extras) — round 18 (owner, batch 18, on the Hard chart: "It should
 * look like the users chart widget from the charts tab"): the member's OWN Charts-tab widget look, not the house look
 * and not just their global seed. `ownChartSource` is the raw blob the widget resolution picked (useChartSurfaceSettings
 * → ownChartSource: the member's default chart widget's settings, else the first chart widget with saved settings, else
 * null = the seed alone), laid down first exactly as ChartPane hands it to StockChart, which merges it over the member's
 * global chart_settings; the study gates and the item's chart options go on top the way the other two overrides apply
 * them. `extras.memberSettings` may be ONE blob or a LIST of blobs (the global seed AND the widget blob): a bare chart
 * tombstones the instances of every blob the chart could draw from, whatever their ids.
 */
export function widgetSettingsOverride(chartOpts, ownChartSource = null, extras = null) {
  const o = chartOpts || {}
  const own = ownChartSource && typeof ownChartSource === 'object' && !Array.isArray(ownChartSource) ? ownChartSource : {}
  let out = mergeSettingsOverride(own, STUDY_GATES)
  if (Array.isArray(o.overlays)) {
    out = { ...out, overlays: o.overlays }
  } else if (o.overlays === false) {
    const src = Array.isArray(out.overlays) && out.overlays.length ? out.overlays : CHART_DEFAULTS.overlays
    out = { ...out, overlays: src.map((ov) => ({ ...ov, enabled: false, removed: true })) }
    const blobs = extras && extras.memberSettings != null ? [].concat(extras.memberSettings) : []
    out = mergeSettingsOverride(out, { indicatorInstances: instancesOff(own, ...blobs) })
  }
  if (o.volume === false) out = mergeSettingsOverride(out, { volume: { visible: false } })
  else if (o.volume === true) out = mergeSettingsOverride(out, { volume: { visible: true } })
  const instances = extras && Array.isArray(extras.instances) ? extras.instances : null
  if (instances && instances.length) out = mergeSettingsOverride(out, { indicatorInstances: instances })
  return out
}

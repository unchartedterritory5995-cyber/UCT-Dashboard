import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'
import { APPEARANCE_KEYS, APPEARANCE_SECTION_KEYS, PER_CHART_KEYS, appearanceOf, applyAppearance } from './chartAppearance'
import { settingDescriptor, ELIGIBLE_SETTINGS } from './chartSettingsDescriptors'

// "Apply to all charts" (owner 11-16): the look moves, the chart's own identity and state never do.

// A blob with every opt-in key switched on, so the merge emits its conditional keys too.
const everyKeyOn = () => mergeChartSettings({
  showChartIq: true,
  uctIntelligence: { enabled: true },
  indicatorDefaults: { rsi: { inputs: { length: 21 } } },
  scaleTime: { rightMargin: 12, priceDecimals: 3, timeFormat: '24' },
  sessionBreaks: true, preMarketLevels: true, nextEarningsMarker: true, priceAlertLines: true, myTradeMarkers: true,
  header: { legendMode: 'hold', barInfo: ['open', 'close'], infoValues: [{ instanceId: 'i1', plotKey: 'p', format: 'value' }] },
})

// The top-level keys the merge's RETURN can emit, read off its source (catches a conditional `...(x ? { k } : {})` key
// that no fixture switches on). Comment lines are stripped so a tombstone in a comment is not read as a key.
function mergeReturnKeys() {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'chartDefaults.js'), 'utf8')
  const start = src.indexOf('function mergeChartSettingsRaw')
  const body = src.slice(src.indexOf('  const out = {', start))
  const end = body.indexOf('\n  }\n')
  const block = body.slice(0, end).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  const keys = new Set()
  for (const m of block.matchAll(/^ {4}([A-Za-z_$][\w$]*):/gm)) keys.add(m[1])
  for (const m of block.matchAll(/^ {4}\.\.\.\(.*?\?\s*\{\s*([A-Za-z_$][\w$]*)\s*:/gm)) keys.add(m[1])
  return keys
}

describe('chartAppearance — the classification rail', () => {
  it('🔴 every top-level settings key is classified as appearance OR per-chart (a new key fails here until it is)', () => {
    const keys = new Set([...Object.keys(CHART_DEFAULTS), ...Object.keys(mergeChartSettings({})), ...Object.keys(everyKeyOn()), ...mergeReturnKeys()])
    expect(keys.size).toBeGreaterThan(40)                                // the source scan really read the allow-list
    const classified = new Set([...APPEARANCE_KEYS, ...PER_CHART_KEYS])
    const missing = [...keys].filter((k) => !classified.has(k))
    expect(missing, `Classify these in chartAppearance.js (APPEARANCE_SECTION_KEYS or PER_CHART_KEYS): ${missing.join(', ')}`).toEqual([])
  })

  it('no key is both, and neither list names a key the settings do not have', () => {
    expect(APPEARANCE_KEYS.filter((k) => PER_CHART_KEYS.includes(k))).toEqual([])
    const known = new Set([...Object.keys(CHART_DEFAULTS), ...Object.keys(everyKeyOn()), ...mergeReturnKeys()])
    expect([...APPEARANCE_KEYS, ...PER_CHART_KEYS].filter((k) => !known.has(k))).toEqual([])
  })

  it('the appearance keys are exactly the four look sections (the ones "Reset this section" resets) + theme + preset', () => {
    expect(Object.keys(APPEARANCE_SECTION_KEYS).sort()).toEqual(['canvas', 'header', 'markers', 'price'])
    expect([...APPEARANCE_KEYS].sort()).toEqual([...new Set([...Object.values(APPEARANCE_SECTION_KEYS).flat(), 'theme', 'preset'])].sort())
    // the new view options are look
    for (const k of ['candles', 'grid', 'scaleTime', 'sessionBreaks', 'preMarketLevels', 'nextEarningsMarker', 'priceAlertLines', 'myTradeMarkers']) expect(APPEARANCE_KEYS).toContain(k)
  })

  it('the chart\'s identity and state are per-chart: indicators, panes, compare symbols, scales, drawings', () => {
    for (const k of ['indicatorInstances', 'overlays', 'volume', 'indicators', 'volumeOverlayIndicators', 'uctIntelligence', 'showChartIq',
      'paneOrder', 'paneSizes', 'paneSeriesOrder', 'comparisonSymbols', 'compareHideBase', 'logScale', 'percentScale', 'invertScale',
      'hideDrawings', 'drawingDefaults', 'extendedHoursShading', 'sessionView']) expect(PER_CHART_KEYS, k).toContain(k)
  })
})

// The source chart: a distinctive look AND its own indicators / panes / compare symbols.
const SOURCE = () => mergeChartSettings({
  chartType: 'hollow', candleColorMode: 'openclose', countdown: true, showPriceLabels: false,
  candles: { upColor: '#112233', downColor: '#445566', showWick: false, priceLine: false },
  background: '#0a0b0c', bgMode: 'gradient', bgGradient: { top: '#101010', bottom: '#202020' }, textColor: '#abcdef', textSize: 14,
  grid: { color: '#333333', visible: true, lines: 'horizontal' }, crosshair: { color: '#ff00ff', magnet: true },
  watermark: { visible: false }, scaleTime: { rightMargin: 20, timeFormat: '24' }, sessionBreaks: true,
  header: { titleMode: 'both', legendMode: 'hold', timeframes: ['1', '5'], infoValues: [{ instanceId: 'src-rsi', plotKey: 'rsi', format: 'value' }] },
  swingLabels: { enabled: true, sensitivity: 'high' }, markers: { earnings: true, news: true },
  prevDayLevels: { high: { enabled: false } }, preMarketLevels: true, nextEarningsMarker: true,
  theme: 'dark', preset: 'custom',
  indicatorInstances: [{ instanceId: 'src-rsi', defId: 'rsi', inputs: {} }],
  comparisonSymbols: [{ sym: 'QQQ', color: '#fff', enabled: true }], paneOrder: ['price', 'src-rsi'], paneSizes: { 'src-rsi': 0.3 },
  logScale: true, hideDrawings: true, extendedHoursShading: false,
})

// A target with its own identity.
const TARGET = () => ({
  chartType: 'candles', background: '#ffffff', scaleTime: { priceDecimals: 4 }, sessionBreaks: false,
  header: { titleMode: 'ticker', timeframes: ['D', 'W'], customTimeframes: ['3D'], infoValues: [{ instanceId: 'tgt-macd', plotKey: 'macd', format: 'value' }] },
  crosshair: { color: '#000000', magnet: false },
  indicatorInstances: [{ instanceId: 'tgt-macd', defId: 'macd', inputs: { fast: 8 } }],
  overlays: [{ type: 'ema', period: 9, enabled: false }],
  volume: { visible: false }, volumeOverlayIndicators: ['obv'],
  comparisonSymbols: [{ sym: 'SPY', color: '#0f0', enabled: true }], compareHideBase: true,
  paneOrder: ['price', 'tgt-macd'], paneSizes: { 'tgt-macd': 0.4 }, paneSeriesOrder: { main: ['tgt-macd'] },
  logScale: false, percentScale: true, invertScale: true, heikinAshi: true, hideDrawings: false,
  drawingDefaults: { color: '#00ff00', width: 3 }, extendedHoursShading: true, sessionView: 'extended',
  positionCalc: { risk: 2 }, uctIntelligence: { enabled: true }, showChartIq: true,
})

describe('appearanceOf / applyAppearance', () => {
  it('appearanceOf keeps only the look, deep-copied, and never the per-chart sub-keys', () => {
    const src = SOURCE()
    const look = appearanceOf(src)
    for (const k of Object.keys(look)) expect(APPEARANCE_KEYS, k).toContain(k)
    for (const k of PER_CHART_KEYS) expect(look, k).not.toHaveProperty(k)
    expect(look.header).not.toHaveProperty('infoValues')
    expect(look.header).not.toHaveProperty('timeframes')
    expect(look.crosshair).not.toHaveProperty('magnet')
    look.candles.upColor = '#mutated'
    expect(src.candles.upColor).toBe('#112233')                           // a copy, not a reference
    expect(appearanceOf(null)).toEqual({})
  })

  it('the target wears the source look exactly as the source shows it', () => {
    const out = mergeChartSettings(applyAppearance(TARGET(), SOURCE()))
    const src = SOURCE()
    for (const k of APPEARANCE_KEYS) {
      if (k === 'header' || k === 'crosshair') continue
      expect(out[k], k).toEqual(src[k])
    }
    expect(out.header.titleMode).toBe('both')
    expect(out.header.legendMode).toBe('hold')
    expect(out.crosshair.color).toBe('#ff00ff')
  })

  it('NEVER copies identity: indicators, panes, compare symbols, scales, drawings and the per-chart header/crosshair parts stay the target\'s', () => {
    const t = TARGET()
    const out = applyAppearance(t, SOURCE())
    for (const k of PER_CHART_KEYS) {
      if (k in t) expect(out[k], k).toEqual(t[k])
      else expect(out, k).not.toHaveProperty(k)
    }
    expect(out.header.infoValues).toEqual(t.header.infoValues)
    expect(out.header.timeframes).toEqual(['D', 'W'])
    expect(out.header.customTimeframes).toEqual(['3D'])
    expect(out.crosshair.magnet).toBe(false)
  })

  it('an opt-in key the source does not hold is REMOVED from the target (absent = the default look)', () => {
    const plain = mergeChartSettings({})
    const t = { ...TARGET(), sessionBreaks: true, preMarketLevels: true, nextEarningsMarker: true, priceAlertLines: true, myTradeMarkers: true, scaleTime: { rightMargin: 3 } }
    const out = applyAppearance(t, plain)
    for (const k of ['sessionBreaks', 'preMarketLevels', 'nextEarningsMarker', 'priceAlertLines', 'myTradeMarkers', 'scaleTime']) expect(out, k).not.toHaveProperty(k)
    const merged = mergeChartSettings(out)
    expect(merged.background).toBe(CHART_DEFAULTS.background)
  })

  it('is pure: neither argument changes', () => {
    const t = TARGET(); const s = SOURCE()
    const tj = JSON.stringify(t); const sj = JSON.stringify(s)
    applyAppearance(t, s)
    expect(JSON.stringify(t)).toBe(tj)
    expect(JSON.stringify(s)).toBe(sj)
  })

  it('old blobs: an unmerged legacy source, a legacy target with no header, and empty / missing blobs never throw', () => {
    const legacySource = { background: '#123123', candles: { upColor: '#00ff00' }, indicators: { rsi: { enabled: true } } }
    const legacyTarget = { overlays: [{ enabled: true }], indicators: { macd: { enabled: true } }, settingsVersion: 1 }
    const out = applyAppearance(legacyTarget, legacySource)
    expect(out.background).toBe('#123123')
    expect(out.candles).toEqual({ upColor: '#00ff00' })
    expect(out.indicators).toEqual({ macd: { enabled: true } })          // the target's own legacy indicators survive
    expect(out.overlays).toEqual([{ enabled: true }])
    expect(out.settingsVersion).toBe(1)
    expect(out).not.toHaveProperty('header')
    expect(() => mergeChartSettings(out)).not.toThrow()
    expect(applyAppearance(null, null)).toEqual({})
    expect(applyAppearance(undefined, SOURCE()).chartType).toBe('hollow')
    // a source header made only of per-chart parts copies nothing over the target's
    expect(applyAppearance({ header: { timeframes: ['D'] } }, { header: { infoValues: [] } }).header).toEqual({ timeframes: ['D'] })
  })
})

describe('UCT Agent: known, not runnable', () => {
  it('"Apply to all charts" is a `known` descriptor the Agent can describe, never an eligible write', () => {
    const d = settingDescriptor('applyToAllCharts')
    expect(d?.agent).toBe('known')
    expect(d.ui).toMatch(/^Chart Settings → Apply to all charts/)
    expect(ELIGIBLE_SETTINGS.map((x) => x.id)).not.toContain('applyToAllCharts')
    expect(mergeChartSettings({ applyToAllCharts: true })).not.toHaveProperty('applyToAllCharts')   // an action, never a stored key
  })
})

// app/src/components/chart/chartDefaults.js — Chart settings schema, defaults, presets

export const CHART_DEFAULTS = {
  chartType: 'candles', // candles | hollow | bars | line | area
  invertScale: false,   // flip the price axis upside-down (Alt+I)

  candles: {
    // Defaults are the workspace "bold" palette (formerly hardcoded as MB_UP/MB_DOWN
    // in StockChart) so charts look identical by default now that the workspace
    // sources candle colors from settings (userCandleColors). oneColor = the single
    // color used by the "One Color" coloring mode.
    upColor: '#1ae51a',
    downColor: '#c41f2d',
    upBorder: '#1ae51a',
    downBorder: '#c41f2d',
    upWick: '#1ae51a',
    downWick: '#c41f2d',
    oneColor: '#1ae51a',
    // Bar thickness for the OHLC/HLC bar types ONLY. Lightweight Charts exposes a
    // single boolean here (`thinBars`) — true = 1px lines (the long-standing look,
    // and the library default), false = lines as wide as the bar slot. There is no
    // in-between, and CandlestickSeries has no width option at all, so candles and
    // hollow candles cannot be thickened. See the Type section of ChartSettingsModal.
    thinBars: true,
  },

  // How candles/bars are colored. 'netchange' = close-vs-previous-close (default,
  // matches the workspace's long-standing look); 'openclose' = close-vs-open
  // (LWC-native); 'onecolor' = every bar a single color.
  candleColorMode: 'netchange', // 'onecolor' | 'netchange' | 'openclose'

  // Canvas. background = the solid canvas color (defaults to the app --bg so the
  // workspace look is unchanged now that it reads this instead of a hardcoded value).
  // bgMode 'gradient' paints a top→bottom gradient across both panes (like Sunrise).
  background: '#0e0f0d',
  bgMode: 'solid',        // 'solid' | 'gradient'
  bgGradient: { top: '#16233b', bottom: '#0e0f0d' },
  textColor: '#706b5e',
  textSize: 11,           // price/time scale font size (px)
  grid: { color: 'rgba(46,49,39,0.25)', visible: true },

  crosshair: { color: '#706b5e', style: 1, width: 1, magnet: false }, // LineStyle: 0=solid, 1=dotted, 2=dashed, 3=large-dashed; width in px; magnet snaps to OHLC

  // Chart-widget header (workspace): the title/change row + timeframe bar + info
  // stats. Fully user-toggleable via Chart Settings → Header.
  header: {
    titleMode: 'company',   // 'company' | 'ticker' | 'both' (TICKER (Company Name))
    showChange: true,       // current-day $ + % change beside the title
    timeframes: ['1', '5', '15', '30', '60', 'D', 'W', 'M'], // favorites — which TF buttons show in the header
    customTimeframes: [],   // user-created custom interval codes (e.g. '45','120','3D') saved for reuse
    showMarketCap: true,
    showNextEarnings: true,
    showUctRating: true,
    showLegend: true,       // the on-chart OHLCV crosshair legend
    // Shape of that legend on the Charts workspace: 'vertical' = the stacked
    // label/value table down the left (the long-standing look); 'horizontal' =
    // a flat two-line strip (ticker · company · TF, then the values) with NO
    // background box. Surfaces that don't opt into the workspace legend
    // (Model Book, popups, …) keep their own inline row regardless.
    legendLayout: 'vertical', // 'vertical' | 'horizontal'
    // Per-item colors for the header/legend readouts. Each key is unset (absent) by
    // default = keep the item's built-in color; a hex here overrides that one item.
    // Day change is a pair (up-day / down-day). Keys: dayChangeUp, dayChangeDown,
    // marketCap, nextEarnings, uctRating, legend.
    colors: {},
  },

  // Moving-average overlays. `lineWidth`/`lineStyle` are per-overlay (the Indicators
  // tab edits them); when unset the renderer keeps its own defaults, so existing
  // stored blobs are unaffected. `offset` and `plotStyle` are declared here but NOT
  // yet honored by the renderer — both need series-level work in StockChart (offset
  // re-keys every point; plotStyle swaps the LWC series type). The Indicators tab
  // shows them disabled rather than pretending they work.
  overlays: [
    { enabled: true, type: 'EMA', period: 9,   color: '#4ade80', lineWidth: 1, lineStyle: 'solid', offset: 0, plotStyle: 'line' },
    { enabled: true, type: 'EMA', period: 20,  color: '#f472b6', lineWidth: 1, lineStyle: 'solid', offset: 0, plotStyle: 'line' },
    { enabled: true, type: 'SMA', period: 50,  color: '#60a5fa', lineWidth: 1, lineStyle: 'solid', offset: 0, plotStyle: 'line' },
    { enabled: true, type: 'SMA', period: 200, color: '#fb923c', lineWidth: 1, lineStyle: 'solid', offset: 0, plotStyle: 'line' },
    // APPENDED, never inserted: mergeChartSettings merges overlays POSITIONALLY, so
    // inserting a slot would shift every stored blob's overlays by one (a user's EMA 9
    // would silently become an SMA 5). New slots go on the end. This is the SMA 5 that
    // used to be the hardcoded `showSma5` prop, now a real editable overlay.
    { enabled: true, type: 'SMA', period: 5,   color: 'rgba(168,162,144,0.55)', lineWidth: 1, lineStyle: 'solid', offset: 0, plotStyle: 'line' },
  ],

  volume: {
    visible: true,
    // Match StockChart's MB_UP / MB_DOWN — the workspace renders volume from these
    // now, so the defaults must equal the previous hardcoded palette or the default
    // look would shift for every user.
    upColor: '#1ae51a',
    downColor: '#c41f2d',
    hvcEnabled: true,
    separatePane: false,
    paneHeightPct: 22,   // height of the separate volume pane, % of chart (8–45)
    // The "$ Vol … Avg 50D …" strip at the top-left of the volume pane.
    labelVisible: true,
    labelColor: '#9b9684',
    // The volume moving-average line. Was a prop (volumeMa) with a hardcoded color;
    // now a real editable indicator. period 0 = off.
    maPeriod: 50,
    maColor: 'rgba(168,162,144,0.55)',
    maLineWidth: 1,
    maLineStyle: 'solid',
    // Bar style: 'columns' = built-in full-slot HistogramSeries (the long-standing
    // look); 'histogram' = thin bars with a gap between each (ThinVolumeSeries
    // custom series, TC2000-style). Recreates the volume series on change.
    barStyle: 'columns',
    // Declared, not yet honored — swapping the volume pane between histogram/line/area
    // needs a series-type recreate in StockChart (same as overlays' plotStyle).
    plotStyle: 'histogram',
  },

  watermark: {
    visible: true,
    opacity: 0.07,
    color: '#a8a290',
    sizeScale: 1.0,
    lines: { ticker: true, company: true, sector: true, industry: true, theme: true },
    x: 0.5,
    y: 0.5,
  },

  drawingDefaults: { color: '#c9a84c', width: 1, style: 'solid', fontSize: 13 },

  indicators: {
    rsi:  { enabled: false, period: 14, color: '#7b68ee' },
    macd: {
      enabled: false, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      macdColor: '#2196F3', signalColor: '#FF9800',
    },
    bb:   { enabled: false, period: 20, stdDev: 2, color: 'rgba(156,39,176,0.85)' },
    // opacity is a percent (5-100), composed with `color` into an rgba() at apply
    // time — see VWAP_FIELDS in indicatorRegistry.js for why it isn't alpha-in-hex.
    vwap: { enabled: false, color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 },
    stoch: { enabled: false, kPeriod: 14, dPeriod: 3, kColor: '#FF6B6B', dColor: '#4ECDC4' },
    atr:   { enabled: false, period: 14, color: '#FFA726' },
    sar:   { enabled: false, step: 0.02, maxStep: 0.2, color: '#ffeb3b' },
    ichimoku: {
      enabled: false,
      tenkanColor: '#26C6DA',
      kijunColor: '#EF5350',
      spanAColor: 'rgba(76,175,80,0.2)',
      spanBColor: 'rgba(239,83,80,0.2)',
      chikouColor: 'rgba(255,235,59,0.7)',
    },
    volumeProfile: { enabled: false, bins: 24, color: 'rgba(120,160,100,0.25)', pocColor: 'rgba(200,160,40,0.65)' },
    mfi:       { enabled: false, period: 14, color: '#c084fc' },
    cci:       { enabled: false, period: 20, color: '#fbbf24' },
    williamsR: { enabled: false, period: 14, color: '#60a5fa' },
    adx:       { enabled: false, period: 14, adxColor: '#e5e7eb', plusDIColor: '#22c55e', minusDIColor: '#ef4444' },
    obv:       { enabled: false, color: '#9ca3af' },
    donchian:  { enabled: false, period: 20, color: 'rgba(96,165,250,0.5)' },
  },
  // MarketSurge-style swing high/low price labels (rendered by swingLabelsPrimitive)
  swingLabels: {
    enabled: false,
    sensitivity: 'medium', // low | medium | high
    color: '#d4d0c4',
    tintByType: false,     // tint swing-high labels up-color, swing-low down-color
    upColor: '#4ade80',
    downColor: '#f87171',
    bgEnabled: true,       // draw the label's background box at all
    bg: null,              // the box color; null = match the canvas background
  },
  heikinAshi: false,
  logScale:   false,
  percentScale: false,
  comparisonSymbols: [], // Array<{ sym: string, color: string, enabled: boolean }>
  // Event markers. earningsBeat/earningsMiss default to the candle up/down colors
  // (#1ae51a / #c41f2d) so the "E" badge matches the chart out of the box; both are
  // user-overridable (Markers tab) and also color the surprise rows in the popover.
  markers: {
    earnings: false, splits: false, dividends: false, news: false,
    earningsBeat: '#1ae51a', earningsMiss: '#c41f2d',
  },
  countdown: false,
  showPatterns: false,
  // The three UCT signature overlays (dark-pool price levels, GEX walls, options
  // flow signals). All OFF by default — they are opt-in, so an existing user's
  // chart is unchanged until they turn one on.
  signature: { darkPoolLevels: false, gexWalls: false, flowSignals: false },
  hideDrawings: false,  // hide all drawings without deleting them
  extendedHoursShading: true,  // "Extended hours" toggle — ON shows pre/post-market price data + shading on intraday; OFF = regular session only (9:30–4:00 ET) with overnight gaps
  volumeOverlayIndicators: [],   // oscillator keys rendered inside the volume pane (left axis)

  theme: 'dark', // 'dark' | 'light'

  positionCalc: {
    accountSize: 50000,   // user's account in $
    riskPct: 1,           // % of account to risk per trade (default 1%)
  },

  preset: 'classic',
}

// ─── Presets ─────────────────────────────────────────────────────────────────

export const PRESETS = {
  classic: {
    label: 'Classic Dark',
    desc: 'UCT signature dark theme',
    swatch: '#1a1c17',
    settings: { ...CHART_DEFAULTS, preset: 'classic' },
  },
  oled: {
    label: 'OLED Black',
    desc: 'Pure black for AMOLED screens',
    swatch: '#000000',
    settings: {
      ...CHART_DEFAULTS,
      preset: 'oled',
      background: '#000000',
      textColor: '#666666',
      grid: { color: 'rgba(255,255,255,0.06)', visible: true },
      crosshair: { color: '#555555', style: 3 },
      candles: {
        upColor: '#00c853',
        downColor: '#ff1744',
        upBorder: '#00c853',
        downBorder: '#ff1744',
        upWick: '#00c853',
        downWick: '#ff1744',
      },
      volume: {
        visible: true,
        upColor: 'rgba(0,200,83,0.3)',
        downColor: 'rgba(255,23,68,0.3)',
        hvcEnabled: true,
      },
    },
  },
  tradingview: {
    label: 'TradingView',
    desc: 'Standard TradingView dark',
    swatch: '#131722',
    settings: {
      ...CHART_DEFAULTS,
      preset: 'tradingview',
      background: '#131722',
      textColor: '#787b86',
      grid: { color: 'rgba(42,46,57,0.5)', visible: true },
      crosshair: { color: '#787b86', style: 0 },
      candles: {
        upColor: '#26a69a',
        downColor: '#ef5350',
        upBorder: '#26a69a',
        downBorder: '#ef5350',
        upWick: '#26a69a',
        downWick: '#ef5350',
      },
      overlays: [
        { enabled: true, type: 'EMA', period: 9,   color: '#2196f3' },
        { enabled: true, type: 'EMA', period: 20,  color: '#e040fb' },
        { enabled: true, type: 'SMA', period: 50,  color: '#ff9800' },
        { enabled: true, type: 'SMA', period: 200, color: '#f44336' },
      ],
      volume: {
        visible: true,
        upColor: 'rgba(38,166,154,0.35)',
        downColor: 'rgba(239,83,80,0.35)',
        hvcEnabled: true,
      },
    },
  },
  light: {
    label: 'Light',
    desc: 'Clean white light theme',
    swatch: '#ffffff',
    settings: {
      ...CHART_DEFAULTS,
      preset: 'light',
      background: '#ffffff',
      textColor: '#555555',
      grid: { color: 'rgba(0,0,0,0.08)', visible: true },
      crosshair: { color: '#999999', style: 3 },
      candles: {
        upColor: '#26a69a',
        downColor: '#ef5350',
        upBorder: '#26a69a',
        downBorder: '#ef5350',
        upWick: '#26a69a',
        downWick: '#ef5350',
      },
      overlays: [
        { enabled: true, type: 'EMA', period: 9,   color: '#2196f3' },
        { enabled: true, type: 'EMA', period: 20,  color: '#e040fb' },
        { enabled: true, type: 'SMA', period: 50,  color: '#ff9800' },
        { enabled: true, type: 'SMA', period: 200, color: '#f44336' },
      ],
      volume: {
        visible: true,
        upColor: 'rgba(38,166,154,0.3)',
        downColor: 'rgba(239,83,80,0.3)',
        hvcEnabled: true,
      },
    },
  },
}

// ─── Deep merge user settings over defaults ──────────────────────────────────

export function mergeChartSettings(userSettings) {
  if (!userSettings) return { ...CHART_DEFAULTS }

  let parsed = userSettings
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { return { ...CHART_DEFAULTS } }
  }

  // Heal the legacy DIM volume default. rgba(0,200,83,0.3) / rgba(255,23,68,0.3)
  // was a different hue from the candles AND only 30% opacity, so volume rendered
  // dim + mismatched over the black canvas. Snap it to the candle colors at full
  // opacity (the intended UCT-default look) so EVERY chart — new layouts and added
  // widgets included — matches out of the box, without the user re-applying "UCT
  // Default". Only the two exact legacy strings heal; a deliberate custom volume
  // color is never touched.
  const _candles = { ...CHART_DEFAULTS.candles, ...(parsed.candles || {}) }
  const _volume = { ...CHART_DEFAULTS.volume, ...(parsed.volume || {}) }
  const _norm = (c) => (c || '').replace(/\s+/g, '').toLowerCase()
  if (_norm(_volume.upColor) === 'rgba(0,200,83,0.3)') _volume.upColor = _candles.upColor
  if (_norm(_volume.downColor) === 'rgba(255,23,68,0.3)') _volume.downColor = _candles.downColor

  return {
    chartType: parsed.chartType || CHART_DEFAULTS.chartType,
    invertScale: parsed.invertScale ?? CHART_DEFAULTS.invertScale,
    candles: _candles,
    candleColorMode: parsed.candleColorMode || CHART_DEFAULTS.candleColorMode,
    background: parsed.background || CHART_DEFAULTS.background,
    bgMode: parsed.bgMode || CHART_DEFAULTS.bgMode,
    bgGradient: { ...CHART_DEFAULTS.bgGradient, ...(parsed.bgGradient || {}) },
    textColor: parsed.textColor || CHART_DEFAULTS.textColor,
    textSize: parsed.textSize ?? CHART_DEFAULTS.textSize,
    grid: { ...CHART_DEFAULTS.grid, ...(parsed.grid || {}) },
    crosshair: { ...CHART_DEFAULTS.crosshair, ...(parsed.crosshair || {}) },
    header: {
      ...CHART_DEFAULTS.header,
      ...(parsed.header || {}),
      timeframes: Array.isArray(parsed.header?.timeframes) ? parsed.header.timeframes : CHART_DEFAULTS.header.timeframes,
      customTimeframes: Array.isArray(parsed.header?.customTimeframes) ? parsed.header.customTimeframes : CHART_DEFAULTS.header.customTimeframes,
      // Deep-merge colors: the spread above replaces the whole `header` object, so a
      // stored partial `colors` (e.g. only marketCap set) would drop the others'
      // defaults. Same trap `timeframes` guards against — merge, never wholesale-swap.
      colors: { ...CHART_DEFAULTS.header.colors, ...(parsed.header?.colors || {}) },
    },
    // Positional merge, PADDED to the defaults' length: a stored blob written before a
    // slot was added is shorter, and .map alone would drop the new slot forever.
    overlays: Array.isArray(parsed.overlays)
      ? CHART_DEFAULTS.overlays.map((d, i) => ({ ...d, ...(parsed.overlays[i] || {}) }))
        .concat(parsed.overlays.slice(CHART_DEFAULTS.overlays.length))
      : CHART_DEFAULTS.overlays.map(o => ({ ...o })),
    volume: _volume,
    watermark: {
      ...CHART_DEFAULTS.watermark,
      ...(parsed.watermark || {}),
      lines: { ...CHART_DEFAULTS.watermark.lines, ...((parsed.watermark || {}).lines || {}) },
    },
    drawingDefaults: { ...CHART_DEFAULTS.drawingDefaults, ...(parsed.drawingDefaults || {}) },
    indicators: {
      rsi:  { ...CHART_DEFAULTS.indicators.rsi,  ...(parsed.indicators?.rsi  || {}) },
      macd: { ...CHART_DEFAULTS.indicators.macd, ...(parsed.indicators?.macd || {}) },
      bb:   { ...CHART_DEFAULTS.indicators.bb,   ...(parsed.indicators?.bb   || {}) },
      vwap: { ...CHART_DEFAULTS.indicators.vwap, ...(parsed.indicators?.vwap || {}) },
      stoch: { ...CHART_DEFAULTS.indicators.stoch, ...(parsed.indicators?.stoch || {}) },
      atr:   { ...CHART_DEFAULTS.indicators.atr,   ...(parsed.indicators?.atr   || {}) },
      sar:           { ...CHART_DEFAULTS.indicators.sar,           ...(parsed.indicators?.sar           || {}) },
      ichimoku:      { ...CHART_DEFAULTS.indicators.ichimoku,      ...(parsed.indicators?.ichimoku      || {}) },
      volumeProfile: { ...CHART_DEFAULTS.indicators.volumeProfile, ...(parsed.indicators?.volumeProfile || {}) },
      mfi:           { ...CHART_DEFAULTS.indicators.mfi,           ...(parsed.indicators?.mfi           || {}) },
      cci:           { ...CHART_DEFAULTS.indicators.cci,           ...(parsed.indicators?.cci           || {}) },
      williamsR:     { ...CHART_DEFAULTS.indicators.williamsR,     ...(parsed.indicators?.williamsR     || {}) },
      adx:           { ...CHART_DEFAULTS.indicators.adx,           ...(parsed.indicators?.adx           || {}) },
      obv:           { ...CHART_DEFAULTS.indicators.obv,           ...(parsed.indicators?.obv           || {}) },
      donchian:      { ...CHART_DEFAULTS.indicators.donchian,      ...(parsed.indicators?.donchian      || {}) },
    },
    swingLabels: { ...CHART_DEFAULTS.swingLabels, ...(parsed.swingLabels || {}) },
    heikinAshi: parsed.heikinAshi ?? CHART_DEFAULTS.heikinAshi,
    logScale:   parsed.logScale   ?? CHART_DEFAULTS.logScale,
    percentScale: parsed.percentScale ?? CHART_DEFAULTS.percentScale,
    comparisonSymbols: Array.isArray(parsed?.comparisonSymbols)
      ? parsed.comparisonSymbols
      : CHART_DEFAULTS.comparisonSymbols,
    markers: { ...CHART_DEFAULTS.markers, ...(parsed.markers || {}) },
    countdown: parsed.countdown ?? CHART_DEFAULTS.countdown,
    showPatterns: parsed.showPatterns ?? CHART_DEFAULTS.showPatterns,
    signature: { ...CHART_DEFAULTS.signature, ...(parsed.signature || {}) },
    hideDrawings: parsed.hideDrawings ?? CHART_DEFAULTS.hideDrawings,
    extendedHoursShading: parsed.extendedHoursShading ?? CHART_DEFAULTS.extendedHoursShading,
    volumeOverlayIndicators: Array.isArray(parsed.volumeOverlayIndicators)
      ? parsed.volumeOverlayIndicators
      : CHART_DEFAULTS.volumeOverlayIndicators,
    theme: parsed?.theme === 'light' ? 'light' : 'dark',
    positionCalc: { ...CHART_DEFAULTS.positionCalc, ...(parsed.positionCalc || {}) },
    preset: parsed.preset || 'classic',
  }
}

// Canonical per-cell chart style options (multi-chart grid): [value, label].
// gridLayouts derives its persisted-state whitelist from this list so the
// picker and the sanitizer can never drift apart. 'hlc' is rendered via
// OHLC_TYPES in StockChart; the older toolbar/settings pickers predate it.
export const CHART_TYPE_OPTIONS = [
  ['candles', 'Candles'], ['hollow', 'Hollow'], ['bars', 'Bars'],
  ['hlc', 'HLC'], ['line', 'Line'], ['area', 'Area'],
]

// ─── Per-instance settings override (multi-chart grid cells) ─────────────────
// Deep-merges a PARTIAL settings blob over an already-merged base (the user's
// global chart_settings). Primitives replace; the section objects
// mergeChartSettings treats as objects merge one level (watermark.lines and
// per-indicator two); arrays replace wholesale. Precedence: CHART_DEFAULTS <
// global blob < override. Callers must pass a STABLE object (useMemo) — it is
// a memo dependency inside StockChart.
const _OVERRIDE_SECTION_KEYS = [
  'candles', 'bgGradient', 'grid', 'crosshair', 'volume',
  'drawingDefaults', 'swingLabels', 'markers', 'positionCalc', 'header',
  'signature',
]
export function mergeSettingsOverride(base, partial) {
  if (!partial) return base
  const out = { ...base }
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined) continue
    if (k === 'watermark' && v && typeof v === 'object') {
      out.watermark = { ...base.watermark, ...v, lines: { ...base.watermark?.lines, ...(v.lines || {}) } }
    } else if (k === 'indicators' && v && typeof v === 'object') {
      const ind = { ...base.indicators }
      for (const [ik, iv] of Object.entries(v)) ind[ik] = { ...(base.indicators?.[ik] || {}), ...(iv || {}) }
      out.indicators = ind
    } else if (_OVERRIDE_SECTION_KEYS.includes(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = { ...(base[k] || {}), ...v }
    } else {
      out[k] = v
    }
  }
  return out
}

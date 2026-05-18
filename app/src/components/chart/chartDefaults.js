// app/src/components/chart/chartDefaults.js — Chart settings schema, defaults, presets

export const CHART_DEFAULTS = {
  chartType: 'candles', // candles | hollow | bars | line | area

  candles: {
    upColor: '#3cb868',
    downColor: '#e74c3c',
    upBorder: '#3cb868',
    downBorder: '#e74c3c',
    upWick: '#3cb868',
    downWick: '#e74c3c',
  },

  background: '#1a1c17',
  textColor: '#706b5e',
  grid: { color: 'rgba(46,49,39,0.25)', visible: true },

  crosshair: { color: '#706b5e', style: 3 }, // 0=solid, 2=dashed, 3=dotted

  overlays: [
    { enabled: true, type: 'EMA', period: 9,   color: '#4ade80' },
    { enabled: true, type: 'EMA', period: 20,  color: '#f472b6' },
    { enabled: true, type: 'SMA', period: 50,  color: '#60a5fa' },
    { enabled: true, type: 'SMA', period: 200, color: '#fb923c' },
  ],

  volume: {
    visible: true,
    upColor: 'rgba(60,184,104,0.35)',
    downColor: 'rgba(231,76,60,0.35)',
    hvcEnabled: true,
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

  drawingDefaults: { color: '#c9a84c', width: 1 },

  indicators: {
    rsi:  { enabled: false, period: 14, color: '#7b68ee' },
    macd: {
      enabled: false, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      macdColor: '#2196F3', signalColor: '#FF9800',
    },
    bb:   { enabled: false, period: 20, stdDev: 2, color: 'rgba(156,39,176,0.85)' },
    vwap: { enabled: false, color: '#26C6DA' },
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
  heikinAshi: false,
  logScale:   false,
  comparisonSymbols: [], // Array<{ sym: string, color: string, enabled: boolean }>
  markers: { earnings: false, splits: false, dividends: false, news: false },
  countdown: false,
  showPatterns: false,

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

  return {
    chartType: parsed.chartType || CHART_DEFAULTS.chartType,
    candles: { ...CHART_DEFAULTS.candles, ...(parsed.candles || {}) },
    background: parsed.background || CHART_DEFAULTS.background,
    textColor: parsed.textColor || CHART_DEFAULTS.textColor,
    grid: { ...CHART_DEFAULTS.grid, ...(parsed.grid || {}) },
    crosshair: { ...CHART_DEFAULTS.crosshair, ...(parsed.crosshair || {}) },
    overlays: Array.isArray(parsed.overlays)
      ? parsed.overlays.map((o, i) => ({ ...CHART_DEFAULTS.overlays[i], ...o }))
      : CHART_DEFAULTS.overlays.map(o => ({ ...o })),
    volume: { ...CHART_DEFAULTS.volume, ...(parsed.volume || {}) },
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
    heikinAshi: parsed.heikinAshi ?? CHART_DEFAULTS.heikinAshi,
    logScale:   parsed.logScale   ?? CHART_DEFAULTS.logScale,
    comparisonSymbols: Array.isArray(parsed?.comparisonSymbols)
      ? parsed.comparisonSymbols
      : CHART_DEFAULTS.comparisonSymbols,
    markers: { ...CHART_DEFAULTS.markers, ...(parsed.markers || {}) },
    countdown: parsed.countdown ?? CHART_DEFAULTS.countdown,
    showPatterns: parsed.showPatterns ?? CHART_DEFAULTS.showPatterns,
    theme: parsed?.theme === 'light' ? 'light' : 'dark',
    positionCalc: { ...CHART_DEFAULTS.positionCalc, ...(parsed.positionCalc || {}) },
    preset: parsed.preset || 'classic',
  }
}

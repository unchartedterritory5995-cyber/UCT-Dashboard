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

  watermark: { visible: true, opacity: 0.07 },

  drawingDefaults: { color: '#c9a84c', width: 1 },

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
    watermark: { ...CHART_DEFAULTS.watermark, ...(parsed.watermark || {}) },
    drawingDefaults: { ...CHART_DEFAULTS.drawingDefaults, ...(parsed.drawingDefaults || {}) },
    preset: parsed.preset || 'classic',
  }
}

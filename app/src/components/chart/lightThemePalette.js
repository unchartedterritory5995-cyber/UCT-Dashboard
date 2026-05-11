// app/src/components/chart/lightThemePalette.js
// Light + dark theme color overrides applied on top of user chart settings.
// Used by StockChart when cs.theme === 'light' (or explicitly 'dark') to swap
// chart background, text, grid, crosshair, and candle colors without touching
// the user's persisted chart_settings.


export const LIGHT_THEME_OVERRIDES = {
  candles: {
    upColor: '#10b981',     // emerald
    downColor: '#ef4444',   // red
    upBorderColor: '#10b981',
    downBorderColor: '#ef4444',
    upWickColor: '#10b981',
    downWickColor: '#ef4444',
  },
  volume: {
    upColor: 'rgba(16, 185, 129, 0.35)',
    downColor: 'rgba(239, 68, 68, 0.35)',
  },
  background: '#ffffff',
  textColor: '#1f2937',
  gridColor: '#e5e7eb',
  borderColor: '#d1d5db',
  crosshairColor: '#6b7280',
  watermarkColor: 'rgba(0,0,0,0.05)',
}


export const DARK_THEME_OVERRIDES = {
  // Inherits from CHART_DEFAULTS — used when explicitly switching back to dark
  background: '#0a0a0a',
  textColor: '#e5e5e5',
  gridColor: '#1f1f1f',
  borderColor: '#2a2a2a',
  crosshairColor: '#888888',
  watermarkColor: 'rgba(201, 168, 76, 0.04)',
}


/**
 * Merge theme overrides into a base chart-settings object. Returns a new
 * object — never mutates `baseSettings`. The returned object includes a
 * `_themeColors` field that the chart layer reads to apply layout, grid,
 * and crosshair colors via `chart.applyOptions(...)`.
 */
export function applyTheme(baseSettings, theme) {
  if (theme === 'light') {
    return {
      ...baseSettings,
      candles: { ...baseSettings.candles, ...LIGHT_THEME_OVERRIDES.candles },
      volume: { ...baseSettings.volume, ...LIGHT_THEME_OVERRIDES.volume },
      _themeColors: {
        background: LIGHT_THEME_OVERRIDES.background,
        textColor: LIGHT_THEME_OVERRIDES.textColor,
        gridColor: LIGHT_THEME_OVERRIDES.gridColor,
        borderColor: LIGHT_THEME_OVERRIDES.borderColor,
        crosshairColor: LIGHT_THEME_OVERRIDES.crosshairColor,
        watermarkColor: LIGHT_THEME_OVERRIDES.watermarkColor,
      },
    }
  }
  return {
    ...baseSettings,
    _themeColors: {
      background: DARK_THEME_OVERRIDES.background,
      textColor: DARK_THEME_OVERRIDES.textColor,
      gridColor: DARK_THEME_OVERRIDES.gridColor,
      borderColor: DARK_THEME_OVERRIDES.borderColor,
      crosshairColor: DARK_THEME_OVERRIDES.crosshairColor,
      watermarkColor: DARK_THEME_OVERRIDES.watermarkColor,
    },
  }
}

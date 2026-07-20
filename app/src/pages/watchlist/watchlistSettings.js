// Watchlist appearance settings — the model behind the ⚙ Watchlist Settings panel.
// Mirrors the chart-settings idea (usePreferences-backed, deep-merged over defaults,
// applied as CSS variables) but is its own thing: canvas/background (solid or the
// same top→bottom gradient the charts use), per-column text colors, % up/down colors,
// the tick-flash tint (on/off + up/down colors), and company logos on/off.
//
// Stored server-side under the `watchlist_settings` preference so it follows the user
// across devices, exactly like `chart_settings`.

export const WATCHLIST_SETTINGS_KEY = 'watchlist_settings'

export const WATCHLIST_DEFAULTS = {
  // Canvas — solid or a top→bottom gradient (like the chart's). Default = solid at the
  // current watchlist surface color, so the default look is unchanged.
  bgMode: 'solid',         // 'solid' | 'gradient'
  bg: '#1a1c17',           // solid canvas = --bg-surface = the black behind the Theme Tracker symbols/% (its .leftPanel)
  bgGradient: { top: '#16233b', bottom: '#0e0f0d' },  // matches CHART_DEFAULTS.bgGradient

  // Column text colors (default to --text-bright #e0dac8, the current look).
  symColor: '#e0dac8',
  priceColor: '#e0dac8',
  volColor: '#e0dac8',

  // % change colors (default = the current green/red).
  upColor: '#1ae51a',
  downColor: '#ff3b47',

  // Tick-flash background tint on the % column (the little box that pulses on each
  // update). Stored as 8-digit hex (#rrggbbaa) so the ColorPanel's opacity slider
  // controls the tint strength; the CSS uses the value directly. Defaults ≈ 28%.
  tintEnabled: true,
  tintUp: '#1ae51a47',
  tintDown: '#c41f2d47',

  // Company logos before the ticker in the Symbol column.
  showLogos: true,
}

// Prior default canvas colors that shipped WRONG — #22251e read green/grey and #0e0f0d
// read too dark (darker than the Theme Tracker). A stored blob equal to one of these was
// never a deliberate user choice (it's an old default baked in), so migrate it to the
// CURRENT default (#1a1c17 = the Theme Tracker ticker background). Corrects testers
// without making them hit Reset. Do NOT list #1a1c17 here — it IS the current default.
const LEGACY_DEFAULT_BG = new Set(['#22251e', '#0e0f0d'])

/** Deep-merge saved settings over the defaults (tolerates partial/older blobs). */
export function mergeWatchlistSettings(saved) {
  const s = (saved && typeof saved === 'object') ? { ...saved } : {}
  if (typeof s.bg === 'string' && LEGACY_DEFAULT_BG.has(s.bg.toLowerCase())) delete s.bg  // → new default
  return {
    ...WATCHLIST_DEFAULTS,
    ...s,
    bgGradient: { ...WATCHLIST_DEFAULTS.bgGradient, ...(s.bgGradient || {}) },
  }
}

/** Build the inline CSS-variable style object applied to the watchlist root.
 *  Cells/rows read these with fallbacks, so an unset var keeps today's look. */
export function watchlistStyleVars(s) {
  const vars = {
    '--wl-sym': s.symColor,
    '--wl-price': s.priceColor,
    '--wl-vol': s.volColor,
    '--wl-up': s.upColor,
    '--wl-down': s.downColor,
    '--wl-tint-up': s.tintUp,
    '--wl-tint-down': s.tintDown,
  }
  if (s.bgMode === 'solid') {
    vars['--wl-bg'] = s.bg
  } else if (s.bgMode === 'gradient') {
    vars['--wl-bg'] = `linear-gradient(to bottom, ${s.bgGradient.top} 0%, ${s.bgGradient.bottom} 100%)`
  }
  return vars
}

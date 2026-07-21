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
  bg: '#0e0f0d',           // solid canvas = --bg = the main chart canvas (the dark near-black); #1a1c17/#22251e read grey/green
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

  // Text size for the whole watchlist surface, in px, as shown in the settings
  // dropdown. This is the ROW text size (ticker/price/volume); every other element
  // on the surface (group headers, column labels, badges) sits at its own base size
  // and is scaled proportionally from this one, so the visual hierarchy is preserved
  // instead of everything flattening to a single size.
  fontSize: 11,
}

// The row text size that the CSS bases are authored against. fontSize === this = the
// default look (scale 1). Changing this without re-authoring the CSS shifts everything.
export const WATCHLIST_BASE_FONT_PX = 11

// Selectable row text sizes (px). Deliberately narrower than the chart settings
// picker (which runs to 40px): the watchlist scales proportionally off this row
// size, so anything much past 16 overflows the columns in a narrow /charts widget.
export const WATCHLIST_FONT_SIZES = [9, 10, 11, 12, 13, 14, 15, 16]

// Prior default canvas colors that shipped WRONG — both #22251e and #1a1c17 read
// grey/green (too light). A stored blob equal to one of these was never a deliberate
// user choice (it's an old default baked in), so migrate it to the CURRENT default
// (#0e0f0d = the main chart canvas). Corrects testers without making them hit Reset.
// Do NOT list #0e0f0d here — it IS the current default.
const LEGACY_DEFAULT_BG = new Set(['#22251e', '#1a1c17'])

/** Deep-merge saved settings over the defaults (tolerates partial/older blobs). */
export function mergeWatchlistSettings(saved) {
  const s = (saved && typeof saved === 'object') ? { ...saved } : {}
  if (typeof s.bg === 'string' && LEGACY_DEFAULT_BG.has(s.bg.toLowerCase())) delete s.bg  // → new default
  // Text size briefly shipped as a `fontScale` multiplier before becoming a px
  // `fontSize`. Convert any stored blob so an early tester doesn't snap back to default.
  if (s.fontSize == null && Number.isFinite(Number(s.fontScale))) {
    s.fontSize = Math.round(Number(s.fontScale) * WATCHLIST_BASE_FONT_PX)
  }
  delete s.fontScale
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
    // The chosen row size becomes a ratio against the size the CSS is authored at, and
    // is multiplied into every font-size on the surface (see Watchlists.module.css).
    '--wl-font-scale': String(
      (Number(s.fontSize) > 0 ? Number(s.fontSize) : WATCHLIST_BASE_FONT_PX) / WATCHLIST_BASE_FONT_PX
    ),
  }
  if (s.bgMode === 'solid') {
    vars['--wl-bg'] = s.bg
    vars['--wl-bg-solid'] = s.bg
  } else if (s.bgMode === 'gradient') {
    vars['--wl-bg'] = `linear-gradient(to bottom, ${s.bgGradient.top} 0%, ${s.bgGradient.bottom} 100%)`
    // A SOLID stand-in for surfaces that can't take a gradient without repeating it
    // (the header strip). The TOP stop is the edge the header meets, so it blends.
    vars['--wl-bg-solid'] = s.bgGradient.top
  }
  return vars
}

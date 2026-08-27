import { dividerFor, chromeFor, toolbarFor } from '../../utils/dividerColor'

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

  // One text color for ALL row text (symbol, price, volume, and every other data
  // column) EXCEPT the up/down % change, which keeps its own green/red below. Defaults
  // to --text-bright #e0dac8 (the current look).
  textColor: '#e0dac8',

  // % change colors (default = the current green/red).
  upColor: '#34d17c',
  downColor: '#f24b42',

  // Tick-flash background tint on the % column (the little box that pulses on each
  // update). Stored as 8-digit hex (#rrggbbaa) so the ColorPanel's opacity slider
  // controls the tint strength; the CSS uses the value directly. Defaults ≈ 28%.
  tintEnabled: true,
  tintUp: '#34d17c47',
  tintDown: '#f24b4247',

  // Company logos before the ticker in the Symbol column.
  showLogos: true,

  // Gridline color for ALL watchlist gridlines (column + row hairlines + the
  // scrollbar thumb, which is drawn from the same divider var). Empty string =
  // AUTO: derive a contrast-matched line from the canvas (the long-standing
  // behavior). An 8-digit hex keeps its alpha (the ColorPanel opacity slider).
  gridColor: '',

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

// Seed values for an UNCUSTOMIZED watchlist on the LIGHT app theme: white canvas +
// near-black text, dark green/red, so the ⚙ swatches AND the surface follow the site
// theme until the user picks colors.
export const WATCHLIST_LIGHT_OVERRIDES = {
  bg: '#ffffff',
  textColor: '#1f2328',
  upColor: '#17a917',
  downColor: '#db000b',
  tintUp: '#17a91726',
  tintDown: '#db000b26',
}
/** The default settings blob for the current app theme ('light' → white canvas). */
export function watchlistDefaultsForTheme(theme) {
  return theme === 'light'
    ? { ...WATCHLIST_DEFAULTS, ...WATCHLIST_LIGHT_OVERRIDES }
    : WATCHLIST_DEFAULTS
}

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
  // Text color was three separate pickers (symColor/priceColor/volColor); it's now ONE
  // `textColor`. Migrate an older blob to its symbol color so the look is preserved, then
  // drop the legacy keys so they don't get re-persisted.
  if (s.textColor == null && typeof s.symColor === 'string') s.textColor = s.symColor
  delete s.symColor; delete s.priceColor; delete s.volColor
  return {
    ...WATCHLIST_DEFAULTS,
    ...s,
    bgGradient: { ...WATCHLIST_DEFAULTS.bgGradient, ...(s.bgGradient || {}) },
  }
}

/** Build the inline CSS-variable style object applied to the watchlist root.
 *  Cells/rows read these with fallbacks, so an unset var keeps today's look. */
export function watchlistStyleVars(s) {
  // One text color drives every row-text column (symbol/price/volume + meta/text cells
  // all read these three vars); the % change is the only text left on its own up/down colors.
  const text = s.textColor || WATCHLIST_DEFAULTS.textColor
  const vars = {
    '--wl-sym': text,
    '--wl-price': text,
    '--wl-vol': text,
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
  // Gridlines/hairlines were authored as fixed near-white and vanish on a light
  // canvas — derive the contrasting side from whatever canvas the user picked.
  // Inside the /charts workspace --widget-divider takes precedence (same value,
  // published per widget); this covers the standalone page.
  const solid = s.bgMode === 'gradient' ? s.bgGradient?.top : s.bg
  const div = dividerFor(solid)
  const divStrong = dividerFor(solid, { strong: true })
  if (div) vars['--wl-divider'] = div
  if (divStrong) vars['--wl-divider-strong'] = divStrong
  // Explicit gridline color overrides the canvas-derived lines (both weights —
  // the user picked ONE color for "all gridlines"). NB: inside the /charts
  // workspace --widget-divider* wins over these vars, so ChartsWorkspace's
  // widgetCanvasByType must mirror this override (it does — keep in sync).
  if (s.gridColor) {
    vars['--wl-divider'] = s.gridColor
    vars['--wl-divider-strong'] = s.gridColor
  }

  // Header text + gold accent, contrast-matched to the canvas (gold on white is barely
  // legible), and the row-hover fill — one small step AWAY from the canvas, so it's a
  // faint grey on a white list instead of the dark-theme --bg-hover.
  const chrome = chromeFor(solid)
  if (chrome) {
    vars['--wl-text'] = chrome.text
    vars['--wl-text-strong'] = chrome.textStrong
    vars['--wl-accent'] = chrome.accent
    vars['--wl-accent-bg'] = chrome.accentBg
  }
  // The Text Color also drives the column-header labels (Symbol/Price/Vol/% Change), so the
  // headers stay in sync with the row text below them. The gold sort accent stays from chrome.
  vars['--wl-text-strong'] = text
  const hover = toolbarFor(solid)
  if (hover) vars['--wl-row-hover'] = hover.bg

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

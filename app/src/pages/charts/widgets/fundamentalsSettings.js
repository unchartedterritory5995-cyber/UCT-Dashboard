import { dividerFor, chromeFor, toolbarFor } from '../../../utils/dividerColor'

// Fundamentals-widget appearance settings — the model behind its ⚙ Settings panel.
// Sibling of watchlistSettings.js / themeTrackerSettings.js: usePreferences-backed,
// merged over defaults, applied as CSS variables on the widget root.
// Options (v1, per owner): canvas (solid or top→bottom gradient), text color,
// % up/down colors.
//
// Stored server-side under the `fundamentals_settings` preference so it follows
// the user across devices, exactly like the watchlist/theme-tracker settings.

export const FUNDAMENTALS_SETTINGS_KEY = 'fundamentals_settings'

export const FUNDAMENTALS_DEFAULTS = {
  // Canvas — solid or a top→bottom gradient. Default = the main chart canvas
  // color (matches the watchlist/theme-tracker default).
  bgMode: 'solid',         // 'solid' | 'gradient'
  bg: '#0e0f0d',
  bgGradient: { top: '#16233b', bottom: '#0e0f0d' },

  // Primary text (values + labels). Default = --text-bright, the current look.
  textColor: '#e0dac8',

  // % change colors (default = the widget's current candle-matched green/red).
  upColor: '#1ae51a',
  downColor: '#c41f2d',
}

// Seed values for an UNCUSTOMIZED widget on the LIGHT app theme (white canvas +
// dark text) so the ⚙ swatches AND the surface follow the site theme until edited.
export const FUNDAMENTALS_LIGHT_OVERRIDES = {
  bg: '#ffffff',
  textColor: '#1f2328',
  upColor: '#0a5c22',
  downColor: '#7d1620',
}
/** The default settings blob for the current app theme ('light' → white canvas). */
export function fundamentalsDefaultsForTheme(theme) {
  return theme === 'light'
    ? { ...FUNDAMENTALS_DEFAULTS, ...FUNDAMENTALS_LIGHT_OVERRIDES }
    : FUNDAMENTALS_DEFAULTS
}

/** Deep-merge saved settings over the defaults (tolerates partial/older blobs). */
export function mergeFundamentalsSettings(saved) {
  const s = (saved && typeof saved === 'object') ? { ...saved } : {}
  return {
    ...FUNDAMENTALS_DEFAULTS,
    ...s,
    bgGradient: { ...FUNDAMENTALS_DEFAULTS.bgGradient, ...(s.bgGradient || {}) },
  }
}

/** Build the inline CSS-variable style object applied to the widget root.
 *  Each var is emitted ONLY when the user deviates from the default, so the
 *  untouched default look stays byte-identical — including the /charts theme
 *  overrides (e.g. Sunset's darker up/down text, which reads
 *  `var(--fw-up, <sunset-color>)` and keeps winning until the user deliberately
 *  changes the color). */
export function fundamentalsStyleVars(s) {
  const D = FUNDAMENTALS_DEFAULTS
  const vars = {}

  if (s.textColor !== D.textColor) vars['--fw-text'] = s.textColor
  if (s.upColor !== D.upColor) vars['--fw-up'] = s.upColor
  if (s.downColor !== D.downColor) vars['--fw-down'] = s.downColor

  const customBg = s.bgMode === 'gradient'
    || (typeof s.bg === 'string' && s.bg.toLowerCase() !== D.bg)
  if (customBg) {
    const solid = s.bgMode === 'gradient' ? (s.bgGradient?.top || s.bg) : s.bg
    vars['--fw-bg'] = s.bgMode === 'gradient'
      ? `linear-gradient(to bottom, ${s.bgGradient.top} 0%, ${s.bgGradient.bottom} 100%)`
      : s.bg
    // Quarter cards / the segmented toggle sit one small step AWAY from the
    // canvas (mirrors the --bg-elevated relationship on the default look).
    const tb = toolbarFor(solid)
    if (tb) {
      vars['--fw-elev'] = tb.bg
      vars['--fw-hover'] = tb.bgHover
    }
    // Hairlines + secondary text contrast-matched to the chosen canvas.
    const div = dividerFor(solid)
    if (div) vars['--fw-divider'] = div
    const chrome = chromeFor(solid)
    if (chrome) {
      vars['--fw-text-dim'] = chrome.text
      vars['--fw-heading'] = chrome.textStrong
      vars['--fw-accent'] = chrome.accent
      vars['--fw-accent-bg'] = chrome.accentBg
    }
  }
  return vars
}

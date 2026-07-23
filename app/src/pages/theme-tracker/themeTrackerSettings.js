import { dividerFor, chromeFor, toolbarFor, parseColor, luminance } from '../../utils/dividerColor'

// Theme Tracker appearance settings — the model behind the ⚙ Theme Tracker Settings
// panel. A direct sibling of the watchlist's `watchlistSettings.js`: usePreferences-
// backed, deep-merged over defaults, applied as CSS variables on the page root.
// Options: canvas (solid or top→bottom gradient), text size, symbol text color,
// % up/down colors, the tick-flash tint (on/off + up/down colors), company logos.
//
// Stored server-side under the `theme_tracker_settings` preference so it follows
// the user across devices, exactly like `watchlist_settings` / `chart_settings`.

export const THEME_TRACKER_SETTINGS_KEY = 'theme_tracker_settings'

export const THEME_TRACKER_DEFAULTS = {
  // Canvas — solid or a top→bottom gradient (like the chart's). Default = solid at
  // the main chart canvas color (matches the watchlist default).
  bgMode: 'solid',         // 'solid' | 'gradient'
  bg: '#0e0f0d',
  bgGradient: { top: '#16233b', bottom: '#0e0f0d' },

  // Symbol text color (default = --text-bright, the current look).
  symColor: '#e0dac8',

  // % change colors (default = the tracker's current green/red).
  upColor: '#1ae51a',
  downColor: '#ff3b47',

  // Tick-flash background tint behind the % cell (pulses on each update). Stored
  // as 8-digit hex (#rrggbbaa) so the ColorPanel's opacity slider controls the
  // tint strength. 0x47 ≈ 28% — matches the hardcoded keyframe defaults.
  tintEnabled: true,
  tintUp: '#1ae51a47',
  tintDown: '#c41f2d47',

  // Company logos before each holding ticker.
  showLogos: true,

  // Row text size in px (ticker + %). Everything else on the surface scales
  // proportionally from this, preserving the visual hierarchy.
  fontSize: 11,
}

// The row text size the CSS is authored against. fontSize === this = scale 1.
export const THEME_TRACKER_BASE_FONT_PX = 11

// Selectable row text sizes (px) — same narrow range as the watchlist picker,
// for the same reason: the tracker scales proportionally off this row size and
// anything much past 16 overflows a narrow /charts widget.
export const THEME_TRACKER_FONT_SIZES = [9, 10, 11, 12, 13, 14, 15, 16]

/** Deep-merge saved settings over the defaults (tolerates partial/older blobs). */
export function mergeThemeTrackerSettings(saved) {
  const s = (saved && typeof saved === 'object') ? { ...saved } : {}
  return {
    ...THEME_TRACKER_DEFAULTS,
    ...s,
    bgGradient: { ...THEME_TRACKER_DEFAULTS.bgGradient, ...(s.bgGradient || {}) },
  }
}

/** Build the inline CSS-variable style object applied to the tracker's page root.
 *
 *  Unlike the watchlist (which always emits its vars), each var here is emitted
 *  ONLY when it differs from the default. That keeps the untouched default look
 *  byte-identical — including the /charts theme overrides (e.g. Sunset's darker
 *  up/down text, which reads `var(--tt-up, <sunset-color>)` and must keep winning
 *  until the user deliberately changes the color). */
export function themeTrackerStyleVars(s) {
  const D = THEME_TRACKER_DEFAULTS
  const vars = {}

  if (s.symColor !== D.symColor) vars['--tt-sym'] = s.symColor
  if (s.upColor !== D.upColor) vars['--tt-up'] = s.upColor
  if (s.downColor !== D.downColor) vars['--tt-down'] = s.downColor
  // The flash keyframes already read these two vars (with hardcoded fallbacks).
  if (s.tintUp !== D.tintUp) vars['--tick-up-bg'] = s.tintUp
  if (s.tintDown !== D.tintDown) vars['--tick-down-bg'] = s.tintDown

  const scale = (Number(s.fontSize) > 0 ? Number(s.fontSize) : THEME_TRACKER_BASE_FONT_PX) / THEME_TRACKER_BASE_FONT_PX
  if (scale !== 1) vars['--tt-font-scale'] = String(scale)

  const customBg = s.bgMode === 'gradient'
    || (typeof s.bg === 'string' && s.bg.toLowerCase() !== D.bg)
  if (customBg) {
    const solid = s.bgMode === 'gradient' ? (s.bgGradient?.top || s.bg) : s.bg
    vars['--tt-bg'] = s.bgMode === 'gradient'
      ? `linear-gradient(to bottom, ${s.bgGradient.top} 0%, ${s.bgGradient.bottom} 100%)`
      : s.bg
    // A SOLID stand-in for surfaces that can't take a gradient without repeating
    // it (the header strips). The TOP stop is the edge the headers meet.
    vars['--tt-bg-solid'] = solid

    // Header strips / group rows go TRANSPARENT on a custom canvas so the chosen
    // color (or gradient) runs unbroken through the whole widget — owner feedback:
    // a stepped "elevated" tone read as a darker band across the tabs/header.
    // Separation comes from the contrast-matched dividers instead.
    vars['--tt-elev'] = 'transparent'
    const tb = toolbarFor(solid)
    if (tb) vars['--tt-row-hover'] = tb.bgHover
    // Hairlines + chrome text contrast-matched to the chosen canvas — fixed
    // near-white lines/gold text vanish on a light canvas.
    const div = dividerFor(solid)
    if (div) vars['--tt-divider'] = div
    // Scrollbar thumb (strong divider) — the OS-dark bar sticks out on a light canvas.
    const divStrong = dividerFor(solid, { strong: true })
    if (divStrong) vars['--tt-divider-strong'] = divStrong
    const chrome = chromeFor(solid)
    if (chrome) {
      vars['--tt-text'] = chrome.text
      vars['--tt-text-strong'] = chrome.textStrong
      vars['--tt-accent'] = chrome.accent
      vars['--tt-accent-bg'] = chrome.accentBg
    }
    const rgb = parseColor(solid)
    if (rgb) {
      // Faint per-row separator (much lighter than a full divider).
      vars['--tt-row-divider'] = luminance(rgb) > 0.5 ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.05)'
    }
  }
  return vars
}

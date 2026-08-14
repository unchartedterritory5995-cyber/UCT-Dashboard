// ⚙ Calendar widget appearance — canvas (solid / gradient) + text color + text size.
// A sibling of alertsWidgetSettings.js / newsWidgetSettings.js: usePreferences-backed,
// deep-merged over defaults, applied as CSS variables on the widget root. Emit-when-
// off-default keeps the untouched default byte-identical.
import { dividerFor, chromeFor, toolbarFor, parseColor, luminance } from '../../../utils/dividerColor'

export const CALENDAR_WIDGET_SETTINGS_KEY = 'calendar_widget_settings'

// Base font-size (px) per text-size step; interior elements size in em off --cal-fs.
export const CALENDAR_TEXT_SIZES = { s: 12, m: 13.5, l: 15.5 }

export const CALENDAR_WIDGET_DEFAULTS = {
  bgMode: 'solid',                                  // 'solid' | 'gradient'
  bg: '#0e0f0d',
  bgGradient: { top: '#16233b', bottom: '#0e0f0d' },
  textColor: '#e0dac8',                             // primary text (event names + company names + est/EPS labels)
  symbolColor: '#c9a84c',                           // earnings tickers
  posColor: '#1ae51a',                              // upside surprise (EPS% / Rev% beat)
  negColor: '#ff5b5b',                              // downside surprise (EPS% / Rev% miss)
  highBoxColor: '#ce000a',                          // high-impact (3★) econ time box (red default)
  textSize: 'm',                                    // 's' | 'm' | 'l'
}

// Seed values for an UNCUSTOMIZED widget on the LIGHT app theme: white canvas +
// near-black text, so the settings swatches AND the rendered widget follow the site
// theme until the user picks explicit colors.
export const CALENDAR_WIDGET_LIGHT_OVERRIDES = {
  bg: '#ffffff',
  textColor: '#1f2328',
  symbolColor: '#7a5c16',
  posColor: '#0a5c22',
  negColor: '#7d1620',
}

/** The default settings blob for the current app theme ('light' → white canvas). */
export function calendarDefaultsForTheme(theme) {
  return theme === 'light'
    ? { ...CALENDAR_WIDGET_DEFAULTS, ...CALENDAR_WIDGET_LIGHT_OVERRIDES }
    : CALENDAR_WIDGET_DEFAULTS
}

/** Deep-merge saved settings over defaults (tolerates partial/older blobs). */
export function mergeCalendarWidgetSettings(saved) {
  const s = (saved && typeof saved === 'object') ? { ...saved } : {}
  return {
    ...CALENDAR_WIDGET_DEFAULTS,
    ...s,
    bgGradient: { ...CALENDAR_WIDGET_DEFAULTS.bgGradient, ...(s.bgGradient || {}) },
  }
}

/** True when the canvas diverges from the default (drives widget chrome + templates). */
export function isCustomCanvas(s) {
  return s.bgMode === 'gradient'
    || (typeof s.bg === 'string' && s.bg.toLowerCase() !== CALENDAR_WIDGET_DEFAULTS.bg)
}

/** Inline CSS-variable style object for the widget root. Each var is emitted ONLY
 *  when it differs from the default, so the default look stays byte-identical. */
export function calendarWidgetStyleVars(s) {
  const D = CALENDAR_WIDGET_DEFAULTS
  const vars = {}

  if (s.textColor && s.textColor !== D.textColor) vars['--cal-text'] = s.textColor
  if (s.symbolColor && s.symbolColor !== D.symbolColor) vars['--cal-symbol'] = s.symbolColor
  if (s.posColor && s.posColor !== D.posColor) vars['--cal-pos'] = s.posColor
  if (s.negColor && s.negColor !== D.negColor) vars['--cal-neg'] = s.negColor
  // High-impact time box: emit the color + a contrasting text color (only when the
  // user changes it; the default red (#ce000a) + white text come from the CSS
  // fallbacks — keep those in sync with D.highBoxColor above).
  if (s.highBoxColor && s.highBoxColor !== D.highBoxColor) {
    vars['--cal-highbox'] = s.highBoxColor
    const rgb = parseColor(s.highBoxColor)
    vars['--cal-highbox-text'] = (rgb && luminance(rgb) > 0.5) ? '#161616' : '#ffffff'
  }
  if (s.textSize && s.textSize !== D.textSize) {
    vars['--cal-fs'] = `${CALENDAR_TEXT_SIZES[s.textSize] || CALENDAR_TEXT_SIZES.m}px`
  }

  // Canvas-aware bold gold for section headers + high-impact accents: dark gold on a
  // light canvas, bright on a dark one (the chart's 1D-pill gold per theme). Emitted
  // ALWAYS so the default themes get it too.
  const solidBg = s.bgMode === 'gradient' ? (s.bgGradient?.top || s.bg) : s.bg
  const bgRgb = parseColor(solidBg)
  if (bgRgb) vars['--cal-gold-strong'] = luminance(bgRgb) > 0.5 ? '#7a5c16' : '#c9a84c'

  if (isCustomCanvas(s)) {
    vars['--cal-bg'] = s.bgMode === 'gradient'
      ? `linear-gradient(to bottom, ${s.bgGradient.top} 0%, ${s.bgGradient.bottom} 100%)`
      : s.bg
    vars['--cal-bg-solid'] = solidBg

    const tb = toolbarFor(solidBg)
    if (tb) vars['--cal-row-hover'] = tb.bgHover
    const div = dividerFor(solidBg)
    if (div) vars['--cal-divider'] = div
    const chrome = chromeFor(solidBg)
    if (chrome) {
      vars['--cal-chrome'] = chrome.text
      vars['--cal-chrome-strong'] = chrome.textStrong
      vars['--cal-accent'] = chrome.accent
    }
    if (bgRgb) {
      vars['--cal-row-divider'] = luminance(bgRgb) > 0.5 ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.05)'
      vars['--cal-tint'] = luminance(bgRgb) > 0.5 ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.04)'
    }
  }
  return vars
}

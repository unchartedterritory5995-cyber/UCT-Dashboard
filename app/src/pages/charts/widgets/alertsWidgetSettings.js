// ⚙ Alerts widget appearance — canvas (solid / gradient) + text color + text size.
// A sibling of newsWidgetSettings.js: usePreferences-backed, deep-merged over
// defaults, applied as CSS variables on the widget root. Emit-when-off-default
// keeps the untouched default byte-identical.
import { dividerFor, chromeFor, toolbarFor, parseColor, luminance } from '../../../utils/dividerColor'

export const ALERTS_WIDGET_SETTINGS_KEY = 'alerts_widget_settings'

// Base font-size (px) for each text-size step. Every interior element sizes in
// em off --alerts-fs, so one variable scales the whole widget's type.
export const ALERTS_TEXT_SIZES = { s: 12, m: 13.5, l: 15.5 }

export const ALERTS_WIDGET_DEFAULTS = {
  bgMode: 'solid',                                  // 'solid' | 'gradient'
  bg: '#0e0f0d',
  bgGradient: { top: '#1c130a', bottom: '#0e0f0d' },
  textColor: '#e0dac8',                             // primary text (ticker / condition)
  textSize: 'm',                                    // 's' | 'm' | 'l'
  aboveColor: '#1ae51a',                            // "cross above" accent + meter
  belowColor: '#ff5b5b',                            // "cross below" accent + meter
}

// Seed values for an UNCUSTOMIZED widget on the LIGHT app theme: white canvas +
// near-black text/accents, so the settings swatches AND the rendered widget both
// follow the site theme until the user picks explicit colors.
export const ALERTS_WIDGET_LIGHT_OVERRIDES = {
  bg: '#ffffff',
  textColor: '#1f2328',
  aboveColor: '#17a917',
  belowColor: '#db000b',
}

/** The default settings blob for the current app theme ('light' → white canvas). */
export function alertsDefaultsForTheme(theme) {
  return theme === 'light'
    ? { ...ALERTS_WIDGET_DEFAULTS, ...ALERTS_WIDGET_LIGHT_OVERRIDES }
    : ALERTS_WIDGET_DEFAULTS
}

/** Deep-merge saved settings over defaults (tolerates partial/older blobs). */
export function mergeAlertsWidgetSettings(saved) {
  const s = (saved && typeof saved === 'object') ? { ...saved } : {}
  return {
    ...ALERTS_WIDGET_DEFAULTS,
    ...s,
    bgGradient: { ...ALERTS_WIDGET_DEFAULTS.bgGradient, ...(s.bgGradient || {}) },
  }
}

/** True when the canvas diverges from the default (drives widget chrome + templates). */
export function isCustomCanvas(s) {
  return s.bgMode === 'gradient'
    || (typeof s.bg === 'string' && s.bg.toLowerCase() !== ALERTS_WIDGET_DEFAULTS.bg)
}

/** Inline CSS-variable style object for the widget root. Each var is emitted ONLY
 *  when it differs from the default, so the default look stays byte-identical. */
export function alertsWidgetStyleVars(s) {
  const D = ALERTS_WIDGET_DEFAULTS
  const vars = {}

  if (s.textColor && s.textColor !== D.textColor) vars['--alerts-text'] = s.textColor
  if (s.aboveColor && s.aboveColor !== D.aboveColor) vars['--alerts-above'] = s.aboveColor
  if (s.belowColor && s.belowColor !== D.belowColor) vars['--alerts-below'] = s.belowColor
  if (s.textSize && s.textSize !== D.textSize) {
    vars['--alerts-fs'] = `${ALERTS_TEXT_SIZES[s.textSize] || ALERTS_TEXT_SIZES.m}px`
  }

  // Bold gold for the Set button + delete "×" that STAYS readable on the widget's
  // canvas: a dark gold on a light canvas, bright gold on a dark one — the chart's
  // 1D-pill gold per theme. Emitted ALWAYS (not just custom canvases) so the default
  // light/OLED themes get it too. (Computed here, not left to a CSS var cascade,
  // because the charts theme can otherwise pin the widget to the bright gold.)
  {
    const solidBg = s.bgMode === 'gradient' ? (s.bgGradient?.top || s.bg) : s.bg
    const bgRgb = parseColor(solidBg)
    if (bgRgb) vars['--alerts-gold-strong'] = luminance(bgRgb) > 0.5 ? '#7a5c16' : '#c9a84c'
  }

  if (isCustomCanvas(s)) {
    const solid = s.bgMode === 'gradient' ? (s.bgGradient?.top || s.bg) : s.bg
    vars['--alerts-bg'] = s.bgMode === 'gradient'
      ? `linear-gradient(to bottom, ${s.bgGradient.top} 0%, ${s.bgGradient.bottom} 100%)`
      : s.bg
    vars['--alerts-bg-solid'] = solid

    const tb = toolbarFor(solid)
    if (tb) vars['--alerts-row-hover'] = tb.bgHover
    const div = dividerFor(solid)
    if (div) vars['--alerts-divider'] = div
    const chrome = chromeFor(solid)
    if (chrome) {
      vars['--alerts-chrome'] = chrome.text
      vars['--alerts-chrome-strong'] = chrome.textStrong
      vars['--alerts-accent'] = chrome.accent
    }
    const rgb = parseColor(solid)
    if (rgb) {
      vars['--alerts-row-divider'] = luminance(rgb) > 0.5 ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.05)'
      // Faint track for the proximity meter, tuned to the canvas luminance.
      vars['--alerts-track'] = luminance(rgb) > 0.5 ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.07)'
    }
  }
  return vars
}

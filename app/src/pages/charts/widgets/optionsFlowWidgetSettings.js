// ⚙ Options Flow widget appearance — canvas (solid / gradient) + text color +
// text size + bull/bear (up/down) accent colors. A sibling of
// alertsWidgetSettings.js: usePreferences-backed, deep-merged over defaults,
// applied as CSS variables on the widget root. Emit-when-off-default keeps the
// untouched default byte-identical.
import { dividerFor, chromeFor, toolbarFor, parseColor, luminance } from '../../../utils/dividerColor'

export const OPTIONS_FLOW_WIDGET_SETTINGS_KEY = 'options_flow_widget_settings'

// Base font-size (px) per text-size step. Every interior element sizes in em off
// --flow-fs, so one variable scales the whole widget's type.
export const OPTIONS_FLOW_TEXT_SIZES = { s: 12, m: 13.5, l: 15.5 }

export const OPTIONS_FLOW_WIDGET_DEFAULTS = {
  bgMode: 'solid',                                  // 'solid' | 'gradient'
  bg: '#0e0f0d',
  bgGradient: { top: '#1c130a', bottom: '#0e0f0d' },
  textColor: '#e0dac8',                             // primary text (ticker / contract)
  textSize: 'm',                                    // 's' | 'm' | 'l'
  upColor: '#1ae51a',                               // bullish flow / calls
  downColor: '#ff5b5b',                             // bearish flow / puts
}

// Seed values for an UNCUSTOMIZED widget on the LIGHT app theme: white canvas +
// near-black text/accents, so the settings swatches AND the rendered widget both
// follow the site theme until the user picks explicit colors.
export const OPTIONS_FLOW_WIDGET_LIGHT_OVERRIDES = {
  bg: '#ffffff',
  textColor: '#1f2328',
  upColor: '#17a917',
  downColor: '#db000b',
}

/** The default settings blob for the current app theme ('light' → white canvas). */
export function optionsFlowDefaultsForTheme(theme) {
  return theme === 'light'
    ? { ...OPTIONS_FLOW_WIDGET_DEFAULTS, ...OPTIONS_FLOW_WIDGET_LIGHT_OVERRIDES }
    : OPTIONS_FLOW_WIDGET_DEFAULTS
}

/** Deep-merge saved settings over defaults (tolerates partial/older blobs). */
export function mergeOptionsFlowWidgetSettings(saved) {
  const s = (saved && typeof saved === 'object') ? { ...saved } : {}
  return {
    ...OPTIONS_FLOW_WIDGET_DEFAULTS,
    ...s,
    bgGradient: { ...OPTIONS_FLOW_WIDGET_DEFAULTS.bgGradient, ...(s.bgGradient || {}) },
  }
}

/** True when the canvas diverges from the default (drives widget chrome + templates). */
export function isCustomCanvas(s) {
  return s.bgMode === 'gradient'
    || (typeof s.bg === 'string' && s.bg.toLowerCase() !== OPTIONS_FLOW_WIDGET_DEFAULTS.bg)
}

/** Inline CSS-variable style object for the widget root. Each var is emitted ONLY
 *  when it differs from the default, so the default look stays byte-identical. */
export function optionsFlowWidgetStyleVars(s) {
  const D = OPTIONS_FLOW_WIDGET_DEFAULTS
  const vars = {}

  if (s.textColor && s.textColor !== D.textColor) vars['--flow-text'] = s.textColor
  if (s.upColor && s.upColor !== D.upColor) vars['--flow-up'] = s.upColor
  if (s.downColor && s.downColor !== D.downColor) vars['--flow-down'] = s.downColor
  if (s.textSize && s.textSize !== D.textSize) {
    vars['--flow-fs'] = `${OPTIONS_FLOW_TEXT_SIZES[s.textSize] || OPTIONS_FLOW_TEXT_SIZES.m}px`
  }

  // Bold gold for buttons / accents that STAYS readable on the widget's canvas: a
  // dark gold on a light canvas, bright gold on a dark one (the chart's 1D-pill gold
  // per theme). Emitted ALWAYS so the default light/OLED themes get it too.
  {
    const solidBg = s.bgMode === 'gradient' ? (s.bgGradient?.top || s.bg) : s.bg
    const bgRgb = parseColor(solidBg)
    if (bgRgb) vars['--flow-gold-strong'] = luminance(bgRgb) > 0.5 ? '#7a5c16' : '#c9a84c'
  }

  if (isCustomCanvas(s)) {
    const solid = s.bgMode === 'gradient' ? (s.bgGradient?.top || s.bg) : s.bg
    vars['--flow-bg'] = s.bgMode === 'gradient'
      ? `linear-gradient(to bottom, ${s.bgGradient.top} 0%, ${s.bgGradient.bottom} 100%)`
      : s.bg
    vars['--flow-bg-solid'] = solid

    const tb = toolbarFor(solid)
    if (tb) vars['--flow-row-hover'] = tb.bgHover
    const div = dividerFor(solid)
    if (div) vars['--flow-divider'] = div
    const chrome = chromeFor(solid)
    if (chrome) {
      vars['--flow-chrome'] = chrome.text
      vars['--flow-chrome-strong'] = chrome.textStrong
      vars['--flow-accent'] = chrome.accent
    }
    const rgb = parseColor(solid)
    if (rgb) {
      vars['--flow-row-divider'] = luminance(rgb) > 0.5 ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.05)'
      vars['--flow-track'] = luminance(rgb) > 0.5 ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.07)'
    }
  }
  return vars
}

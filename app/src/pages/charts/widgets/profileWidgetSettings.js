// ⚙ Stock Profile widget appearance — canvas (solid / gradient) + text color +
// up/down accent. A sibling of newsWidgetSettings.js: usePreferences-backed,
// deep-merged over defaults, applied as CSS variables (--prof-*) on the widget
// root. Emit-when-off-default keeps the untouched default byte-identical.
import { dividerFor, chromeFor, toolbarFor, parseColor, luminance } from '../../../utils/dividerColor'

export const PROFILE_WIDGET_SETTINGS_KEY = 'profile_widget_settings'

export const PROFILE_WIDGET_DEFAULTS = {
  bgMode: 'solid',                                  // 'solid' | 'gradient'
  bg: '#0e0f0d',
  bgGradient: { top: '#16233b', bottom: '#0e0f0d' },
  textColor: '#e0dac8',                             // headings / body text color
  upColor: '#1ae51a',                               // positive performance (YTD gain / range)
  downColor: '#ff5b5b',                             // negative performance
  surpUpColor: '#6a7bff',                           // positive earnings surprise %
  surpDownColor: '#ff5b5b',                         // negative earnings surprise %
  headerColor: '#e0dac8',                           // ticker + company NAME text color (default = text-bright)
  headerShow: 'both',                               // 'both' | 'ticker' | 'company'
}

// Seed values for an UNCUSTOMIZED widget on the LIGHT app theme: white canvas +
// near-black text/accents, so the settings swatches AND the rendered widget both
// follow the site theme until the user picks explicit colors.
export const PROFILE_WIDGET_LIGHT_OVERRIDES = {
  bg: '#ffffff',
  textColor: '#1f2328',
  headerColor: '#1f2328',
  upColor: '#17a917',
  downColor: '#db000b',
}
/** The default settings blob for the current app theme ('light' → white canvas). */
export function profileDefaultsForTheme(theme) {
  return theme === 'light'
    ? { ...PROFILE_WIDGET_DEFAULTS, ...PROFILE_WIDGET_LIGHT_OVERRIDES }
    : PROFILE_WIDGET_DEFAULTS
}

/** Deep-merge saved settings over defaults (tolerates partial/older blobs). */
export function mergeProfileWidgetSettings(saved) {
  const s = (saved && typeof saved === 'object') ? { ...saved } : {}
  return {
    ...PROFILE_WIDGET_DEFAULTS,
    ...s,
    bgGradient: { ...PROFILE_WIDGET_DEFAULTS.bgGradient, ...(s.bgGradient || {}) },
  }
}

/** True when the canvas diverges from the default (drives widget chrome + templates). */
export function isCustomCanvas(s) {
  return s.bgMode === 'gradient'
    || (typeof s.bg === 'string' && s.bg.toLowerCase() !== PROFILE_WIDGET_DEFAULTS.bg)
}

/** Inline CSS-variable style object for the widget root. Each var is emitted ONLY
 *  when it differs from the default, so the default look stays byte-identical. */
export function profileWidgetStyleVars(s) {
  const D = PROFILE_WIDGET_DEFAULTS
  const vars = {}

  if (s.textColor && s.textColor !== D.textColor) vars['--prof-text'] = s.textColor
  if (s.headerColor && s.headerColor !== D.headerColor) vars['--prof-header-text'] = s.headerColor
  if (s.upColor && s.upColor !== D.upColor) vars['--prof-up'] = s.upColor
  if (s.downColor && s.downColor !== D.downColor) vars['--prof-down'] = s.downColor
  if (s.surpUpColor && s.surpUpColor !== D.surpUpColor) vars['--prof-surp-up'] = s.surpUpColor
  if (s.surpDownColor && s.surpDownColor !== D.surpDownColor) vars['--prof-surp-down'] = s.surpDownColor

  if (isCustomCanvas(s)) {
    const solid = s.bgMode === 'gradient' ? (s.bgGradient?.top || s.bg) : s.bg
    vars['--prof-bg'] = s.bgMode === 'gradient'
      ? `linear-gradient(to bottom, ${s.bgGradient.top} 0%, ${s.bgGradient.bottom} 100%)`
      : s.bg
    vars['--prof-bg-solid'] = solid

    const tb = toolbarFor(solid)
    if (tb) vars['--prof-row-hover'] = tb.bgHover
    const div = dividerFor(solid)
    if (div) vars['--prof-divider'] = div
    const chrome = chromeFor(solid)
    if (chrome) {
      vars['--prof-chrome'] = chrome.text
      vars['--prof-chrome-strong'] = chrome.textStrong
      vars['--prof-accent'] = chrome.accent
    }
    const rgb = parseColor(solid)
    if (rgb) {
      vars['--prof-row-divider'] = luminance(rgb) > 0.5 ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.05)'
    }
  }
  return vars
}

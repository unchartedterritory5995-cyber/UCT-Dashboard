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
  headerBg: '#0e0f0d',                              // header bar fill (default = canvas → inherits/transparent)
  headerShow: 'both',                               // 'both' | 'ticker' | 'company'
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
  if (s.headerBg && s.headerBg !== D.headerBg) vars['--prof-header-bg'] = s.headerBg
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

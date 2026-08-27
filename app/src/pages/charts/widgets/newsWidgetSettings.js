// ⚙ News & Catalysts widget appearance — canvas (solid / gradient) + text color.
// A minimal sibling of themeTrackerSettings.js / breadthWidgetSettings.js:
// usePreferences-backed, deep-merged over defaults, applied as CSS variables on
// the widget root. Emit-when-off-default keeps the untouched default byte-identical.
import { dividerFor, chromeFor, toolbarFor, parseColor, luminance } from '../../../utils/dividerColor'

export const NEWS_WIDGET_SETTINGS_KEY = 'news_widget_settings'

export const NEWS_WIDGET_DEFAULTS = {
  bgMode: 'solid',                                  // 'solid' | 'gradient'
  bg: '#0e0f0d',
  bgGradient: { top: '#16233b', bottom: '#0e0f0d' },
  textColor: '#e0dac8',                             // event title / ticker text color
  upColor: '#34d17c',                               // up % / up-direction accent
  downColor: '#f24b42',                             // down % / down-direction accent
  headerColor: '#e0dac8',                           // ticker + company NAME text color (default = text-bright)
  headerShow: 'both',                               // 'both' | 'ticker' | 'company'
}

// Seed values for an UNCUSTOMIZED widget on the LIGHT app theme: white canvas +
// near-black text/accents, so the settings swatches AND the rendered widget both
// follow the site theme until the user picks explicit colors.
export const NEWS_WIDGET_LIGHT_OVERRIDES = {
  bg: '#ffffff',
  textColor: '#1f2328',
  headerColor: '#1f2328',
  upColor: '#17a917',
  downColor: '#db000b',
}
/** The default settings blob for the current app theme ('light' → white canvas). */
export function newsDefaultsForTheme(theme) {
  return theme === 'light'
    ? { ...NEWS_WIDGET_DEFAULTS, ...NEWS_WIDGET_LIGHT_OVERRIDES }
    : NEWS_WIDGET_DEFAULTS
}

/** Deep-merge saved settings over defaults (tolerates partial/older blobs). */
export function mergeNewsWidgetSettings(saved) {
  const s = (saved && typeof saved === 'object') ? { ...saved } : {}
  return {
    ...NEWS_WIDGET_DEFAULTS,
    ...s,
    bgGradient: { ...NEWS_WIDGET_DEFAULTS.bgGradient, ...(s.bgGradient || {}) },
  }
}

/** True when the canvas diverges from the default (drives widget chrome + templates). */
export function isCustomCanvas(s) {
  return s.bgMode === 'gradient'
    || (typeof s.bg === 'string' && s.bg.toLowerCase() !== NEWS_WIDGET_DEFAULTS.bg)
}

/** Inline CSS-variable style object for the widget root. Each var is emitted ONLY
 *  when it differs from the default, so the default look stays byte-identical. */
export function newsWidgetStyleVars(s) {
  const D = NEWS_WIDGET_DEFAULTS
  const vars = {}

  if (s.textColor && s.textColor !== D.textColor) vars['--news-text'] = s.textColor
  if (s.headerColor && s.headerColor !== D.headerColor) vars['--news-header-text'] = s.headerColor
  if (s.upColor && s.upColor !== D.upColor) vars['--news-up'] = s.upColor
  if (s.downColor && s.downColor !== D.downColor) vars['--news-down'] = s.downColor

  if (isCustomCanvas(s)) {
    const solid = s.bgMode === 'gradient' ? (s.bgGradient?.top || s.bg) : s.bg
    vars['--news-bg'] = s.bgMode === 'gradient'
      ? `linear-gradient(to bottom, ${s.bgGradient.top} 0%, ${s.bgGradient.bottom} 100%)`
      : s.bg
    vars['--news-bg-solid'] = solid

    const tb = toolbarFor(solid)
    if (tb) vars['--news-row-hover'] = tb.bgHover
    const div = dividerFor(solid)
    if (div) vars['--news-divider'] = div
    const chrome = chromeFor(solid)
    if (chrome) {
      vars['--news-chrome'] = chrome.text
      vars['--news-chrome-strong'] = chrome.textStrong
      vars['--news-accent'] = chrome.accent
    }
    const rgb = parseColor(solid)
    if (rgb) {
      // Per-row separator — faint against whatever canvas was chosen.
      vars['--news-row-divider'] = luminance(rgb) > 0.5 ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.05)'
    }
  }
  return vars
}

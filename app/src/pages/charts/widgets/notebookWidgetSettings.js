// ⚙ Notebook widget appearance — canvas (solid / gradient) + text colors. A minimal
// per-widget settings model mirroring newsWidgetSettings.js: deep-merged over
// defaults, applied as CSS variables on the widget root, emit-when-off-default so an
// untouched widget stays byte-identical (and follows the app theme).
import { dividerFor, chromeFor, toolbarFor, parseColor, luminance } from '../../../utils/dividerColor'

export const NOTEBOOK_WIDGET_SETTINGS_KEY = 'notebook_widget_settings'

export const NOTEBOOK_WIDGET_DEFAULTS = {
  bgMode: 'solid',                                  // 'solid' | 'gradient'
  bg: '#0e0f0d',
  bgGradient: { top: '#16233b', bottom: '#0e0f0d' },
  textColor: '#e0dac8',                             // note title / body text color
  headerColor: '#e0dac8',                           // header (folder / title) text color
}

// Seed values for an UNCUSTOMIZED widget on the LIGHT app theme.
export const NOTEBOOK_WIDGET_LIGHT_OVERRIDES = {
  bg: '#ffffff',
  textColor: '#1f2328',
  headerColor: '#1f2328',
}
/** The default settings blob for the current app theme ('light' → white canvas). */
export function notebookDefaultsForTheme(theme) {
  return theme === 'light'
    ? { ...NOTEBOOK_WIDGET_DEFAULTS, ...NOTEBOOK_WIDGET_LIGHT_OVERRIDES }
    : NOTEBOOK_WIDGET_DEFAULTS
}

/** Deep-merge saved settings over defaults (tolerates partial/older blobs). */
export function mergeNotebookWidgetSettings(saved) {
  const s = (saved && typeof saved === 'object') ? { ...saved } : {}
  return {
    ...NOTEBOOK_WIDGET_DEFAULTS,
    ...s,
    bgGradient: { ...NOTEBOOK_WIDGET_DEFAULTS.bgGradient, ...(s.bgGradient || {}) },
  }
}

/** True when the canvas diverges from the default (drives widget chrome). */
export function isCustomCanvas(s) {
  return s.bgMode === 'gradient'
    || (typeof s.bg === 'string' && s.bg.toLowerCase() !== NOTEBOOK_WIDGET_DEFAULTS.bg)
}

/** Inline CSS-variable style object for the widget root — each var emitted ONLY when
 *  it differs from the default, so the default look stays byte-identical. */
export function notebookWidgetStyleVars(s) {
  const D = NOTEBOOK_WIDGET_DEFAULTS
  const vars = {}
  if (s.textColor && s.textColor !== D.textColor) vars['--nb-text'] = s.textColor
  if (s.headerColor && s.headerColor !== D.headerColor) vars['--nb-header-text'] = s.headerColor

  if (isCustomCanvas(s)) {
    const solid = s.bgMode === 'gradient' ? (s.bgGradient?.top || s.bg) : s.bg
    vars['--nb-bg'] = s.bgMode === 'gradient'
      ? `linear-gradient(to bottom, ${s.bgGradient.top} 0%, ${s.bgGradient.bottom} 100%)`
      : s.bg
    vars['--nb-bg-solid'] = solid
    const tb = toolbarFor(solid)
    if (tb) vars['--nb-row-hover'] = tb.bgHover
    const div = dividerFor(solid)
    if (div) vars['--nb-divider'] = div
    const chrome = chromeFor(solid)
    if (chrome) {
      vars['--nb-chrome'] = chrome.text
      vars['--nb-chrome-strong'] = chrome.textStrong
      vars['--nb-accent'] = chrome.accent
    }
    const rgb = parseColor(solid)
    if (rgb) vars['--nb-row-divider'] = luminance(rgb) > 0.5 ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.05)'
  }
  return vars
}

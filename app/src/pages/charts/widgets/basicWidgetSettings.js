import { dividerFor, chromeFor, toolbarFor } from '../../../utils/dividerColor'

// A minimal appearance model (canvas + text color) shared by the widgets that have
// NO rich settings of their own — Scanner and AI Search. Rather than invent a new
// set of --scan-*/--ais-* variables and re-wire those components, this overrides the
// shared THEME TOKENS (--bg family, --text family, --border) on the widget root from
// ONE canvas + text choice, so every token-driven element inside recolors together.
// usePreferences-backed, deep-merged over defaults, emit-when-off-default.

export const BASIC_WIDGET_DEFAULTS = {
  bgMode: 'solid',                                   // 'solid' | 'gradient'
  bg: '#0e0f0d',                                     // matches the other widgets' default canvas
  bgGradient: { top: '#16233b', bottom: '#0e0f0d' },
  textColor: '#e0dac8',                              // --text-bright, the default look
}

// Seed values for an uncustomized widget on the LIGHT app theme (white canvas +
// dark text) so the ⚙ swatches AND the surface follow the site theme until edited.
export const BASIC_WIDGET_LIGHT_OVERRIDES = { bg: '#ffffff', textColor: '#1f2328' }

/** The default settings blob for the current app theme ('light' → white canvas). */
export function basicDefaultsForTheme(theme) {
  return theme === 'light'
    ? { ...BASIC_WIDGET_DEFAULTS, ...BASIC_WIDGET_LIGHT_OVERRIDES }
    : BASIC_WIDGET_DEFAULTS
}

/** Deep-merge saved settings over the defaults (tolerates partial/older blobs). */
export function mergeBasicWidgetSettings(saved) {
  const s = (saved && typeof saved === 'object') ? { ...saved } : {}
  return {
    ...BASIC_WIDGET_DEFAULTS,
    ...s,
    bgGradient: { ...BASIC_WIDGET_DEFAULTS.bgGradient, ...(s.bgGradient || {}) },
  }
}

/** Inline CSS-variable style object for the widget root. Overrides the shared theme
 *  tokens from the chosen canvas + text. Each var is emitted ONLY when it differs
 *  from the default, so the untouched look (and the theme tokens) stay byte-identical. */
export function basicWidgetStyleVars(s) {
  const D = BASIC_WIDGET_DEFAULTS
  const vars = {}
  const solid = s.bgMode === 'gradient' ? (s.bgGradient?.top || s.bg) : s.bg
  const customBg = s.bgMode === 'gradient' || (typeof s.bg === 'string' && s.bg.toLowerCase() !== D.bg)
  if (customBg) {
    // The gradient (or solid) painted on the widget root itself.
    vars['--basic-canvas'] = s.bgMode === 'gradient'
      ? `linear-gradient(to bottom, ${s.bgGradient.top} 0%, ${s.bgGradient.bottom} 100%)`
      : s.bg
    // Solid token family derived from the canvas so nested surfaces/borders match.
    vars['--bg'] = solid
    const tb = toolbarFor(solid)
    if (tb) { vars['--bg-surface'] = tb.bg; vars['--bg-elevated'] = tb.bg; vars['--bg-hover'] = tb.bgHover }
    const div = dividerFor(solid)
    if (div) { vars['--border'] = div; vars['--border-accent'] = dividerFor(solid, { strong: true }) }
    const chrome = chromeFor(solid)
    if (chrome) { vars['--text-muted'] = chrome.text; vars['--accent'] = chrome.accent }
  }
  if (s.textColor && s.textColor !== D.textColor) {
    vars['--text'] = s.textColor
    vars['--text-bright'] = s.textColor
  }
  return vars
}

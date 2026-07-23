import { dividerFor, chromeFor, toolbarFor } from '../../../utils/dividerColor'

// Breadth-widget appearance settings — the model behind its ⚙ Settings panel.
// Sibling of fundamentalsSettings.js: usePreferences-backed, merged over
// defaults, applied as CSS variables on the widget root. Options: canvas (solid
// or top→bottom gradient), text color, and the VIEW color system (palette +
// intensity — consumed by the breadth views as render props, not CSS).
//
// Stored server-side under the `breadth_widget_settings` preference so it
// follows the user across devices, exactly like the other widget settings.

export const BREADTH_WIDGET_SETTINGS_KEY = 'breadth_widget_settings'

export const BREADTH_WIDGET_DEFAULTS = {
  // Canvas — default = the main chart canvas color (the UCT Default look, same
  // as the watchlist / theme-tracker / fundamentals widgets).
  bgMode: 'solid',         // 'solid' | 'gradient'
  bg: '#0e0f0d',
  bgGradient: { top: '#16233b', bottom: '#0e0f0d' },

  // Primary text (metric labels/values on the widget chrome).
  textColor: '#e0dac8',

  // View color system — passed into the breadth views' options (they already
  // support these; same choices as the Breadth page's per-view Customize).
  palette: 'classic',      // 'classic' | 'colorblind' | 'mono' | 'ocean'
  intensity: 'normal',     // 'subtle' | 'normal' | 'bold'
}

/** Deep-merge saved settings over the defaults (tolerates partial/older blobs). */
export function mergeBreadthWidgetSettings(saved) {
  const s = (saved && typeof saved === 'object') ? { ...saved } : {}
  return {
    ...BREADTH_WIDGET_DEFAULTS,
    ...s,
    bgGradient: { ...BREADTH_WIDGET_DEFAULTS.bgGradient, ...(s.bgGradient || {}) },
  }
}

/** Inline CSS-variable style for the widget root. Emit-when-off-default (same
 *  contract as themeTrackerSettings/fundamentalsSettings): the untouched default
 *  look — the UCT Default dark chrome — stays byte-identical. */
export function breadthWidgetStyleVars(s) {
  const D = BREADTH_WIDGET_DEFAULTS
  const vars = {}

  if (s.textColor !== D.textColor) vars['--bw-text'] = s.textColor

  const customBg = s.bgMode === 'gradient'
    || (typeof s.bg === 'string' && s.bg.toLowerCase() !== D.bg)
  if (customBg) {
    const solid = s.bgMode === 'gradient' ? (s.bgGradient?.top || s.bg) : s.bg
    vars['--bw-bg'] = s.bgMode === 'gradient'
      ? `linear-gradient(to bottom, ${s.bgGradient.top} 0%, ${s.bgGradient.bottom} 100%)`
      : s.bg
    // Header strip transparent so the canvas/gradient runs unbroken (the
    // theme-tracker lesson: a stepped "elevated" band reads wrong on a custom
    // canvas); dividers + secondary text contrast-derived.
    vars['--bw-elev'] = 'transparent'
    const tb = toolbarFor(solid)
    if (tb) vars['--bw-hover'] = tb.bgHover
    const div = dividerFor(solid)
    if (div) vars['--bw-divider'] = div
    const chrome = chromeFor(solid)
    if (chrome) {
      vars['--bw-text-dim'] = chrome.text
      vars['--bw-text-strong'] = chrome.textStrong
      vars['--bw-accent'] = chrome.accent
      vars['--bw-accent-bg'] = chrome.accentBg
    }
  }
  return vars
}

import { dividerFor, chromeFor, toolbarFor } from '../../../utils/dividerColor'

// New-Highs/New-Lows widget appearance settings — the model behind its ⚙ panel.
// Sibling of breadthWidgetSettings / newsWidgetSettings: stored PER-WIDGET in
// `opts.settings` (so two NH/NL widgets are independent AND the "Apply to: All
// widgets" chart-theme flow can patch them, via chartThemes._PER_WIDGET_TYPES),
// merged over defaults, applied as CSS vars on the widget root.
//
// Emit-when-off-default contract: an untouched widget emits NO vars, so it follows
// the theme layer (WidgetHost's --widget-* from widgetChrome) / the UCT default.

export const NHNL_DEFAULTS = {
  bgMode: 'solid',                 // 'solid' | 'gradient'
  bg: '#0e0f0d',                   // the UCT default chart canvas
  bgGradient: { top: '#16233b', bottom: '#0e0f0d' },
  textColor: '',                   // ticker/ink; '' = default look
  upColor: '',                     // NEW HIGHS side (arrows, counts, title); '' = default green
  downColor: '',                   // NEW LOWS side; '' = default red
  fontSize: 11,                    // row text size in px (11 = watchlist parity)
}

// Uncustomized-on-light seed (white canvas + dark ink) so the surface + swatches
// follow the app theme until edited.
export const NHNL_LIGHT_OVERRIDES = {
  bg: '#ffffff', textColor: '#1f2328', upColor: '#17a917', downColor: '#db000b',
}
export function nhnlDefaultsForTheme(theme) {
  return theme === 'light' ? { ...NHNL_DEFAULTS, ...NHNL_LIGHT_OVERRIDES } : NHNL_DEFAULTS
}

/** Deep-merge a saved (possibly partial/older) blob over the defaults. */
export function mergeNhnlSettings(saved) {
  const s = (saved && typeof saved === 'object') ? { ...saved } : {}
  return {
    ...NHNL_DEFAULTS,
    ...s,
    bgGradient: { ...NHNL_DEFAULTS.bgGradient, ...(s.bgGradient || {}) },
  }
}

/** Inline CSS-variable style for the widget root. Emit only what diverges from the
 *  default so the UCT-default look stays byte-identical (matches breadth/fundamentals). */
export function nhnlWidgetStyleVars(s) {
  const D = NHNL_DEFAULTS
  const vars = {}
  if (s.textColor) vars['--nh-sym'] = s.textColor
  if (s.upColor) vars['--nh-up'] = s.upColor
  if (s.downColor) vars['--nh-down'] = s.downColor
  const size = Number(s.fontSize)
  if (Number.isFinite(size) && size !== 11) vars['--nh-font-scale'] = (size / 11).toFixed(4)

  const customBg = s.bgMode === 'gradient'
    || (typeof s.bg === 'string' && s.bg.toLowerCase() !== D.bg)
  if (customBg) {
    const solid = s.bgMode === 'gradient' ? (s.bgGradient?.top || s.bg) : s.bg
    vars['--nh-bg'] = s.bgMode === 'gradient'
      ? `linear-gradient(to bottom, ${s.bgGradient.top} 0%, ${s.bgGradient.bottom} 100%)`
      : s.bg
    // Toolbar + panel-header strips go transparent so the canvas/gradient runs
    // unbroken (the theme-tracker lesson); chrome derived from the canvas color.
    vars['--nh-elev'] = 'transparent'
    const tb = toolbarFor(solid)
    if (tb) vars['--nh-hover'] = tb.bgHover
    const div = dividerFor(solid)
    if (div) {
      vars['--nh-divider'] = div
      vars['--nh-divider-strong'] = dividerFor(solid, { strong: true })
    }
    const chrome = chromeFor(solid)
    if (chrome) {
      vars['--nh-text'] = chrome.text
      vars['--nh-text-strong'] = chrome.textStrong
    }
  }
  return vars
}

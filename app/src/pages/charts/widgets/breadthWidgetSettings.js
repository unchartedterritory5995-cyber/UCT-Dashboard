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

  // Custom up/down direction colors. Empty = follow the palette above. When BOTH
  // are set, every breadth reading recolors from these two hues instead — the
  // 8-tier system derives darker/lighter shades per severity (heatmap tile fills,
  // tile values, and the SVG views' tier colors all rebuild from them).
  upColor: '',
  downColor: '',
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

// ── Custom up/down tier derivation ─────────────────────────────────────────
// Mix `hex` toward `target` ([r,g,b]) by `amt` (0..1). 8-digit hex loses its
// alpha here on purpose — tier shades must stay opaque.
function mixHex(hex, target, amt) {
  const m = /^#([0-9a-f]{6})/i.exec(String(hex).trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const ch = (v, t) => Math.round(v + (t - v) * amt)
  const r = ch((n >> 16) & 255, target[0]), g = ch((n >> 8) & 255, target[1]), b = ch(n & 255, target[2])
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}
const W = [255, 255, 255], K = [0, 0, 0]

/** Build the three tier color systems from user up/down colors, or null when
 *  either is unset (→ follow the named palette / classic maps).
 *  Shade logic mirrors the classic maps' pattern:
 *  - views (bright): extreme = the pure hue, milder = lighter tints.
 *  - heatmap tile FILLS (dark): mid tier brightest, extremes darkest.
 *  - heatmap tile VALUES (bright text): pure hue at extreme, tints milder. */
export function customBreadthColors(s) {
  const up = (s.upColor || '').trim()
  const down = (s.downColor || '').trim()
  if (!up || !down) return null
  return {
    // → resolveViewColors palette object (rings/meters/radar/…)
    viewPalette: {
      tier: {
        g3: mixHex(up, W, 0), g2: mixHex(up, W, 0.28), g1: mixHex(up, W, 0.55),
        a: '#fbbf24',
        r1: mixHex(down, W, 0.55), r2: mixHex(down, W, 0.28), r3: mixHex(down, W, 0),
        '': '#475569',
      },
      bull: mixHex(up, W, 0.1),
      bear: mixHex(down, W, 0.1),
    },
    // → heatmap tile fills (dark, mirrors TIER_CELL_COLORS' weighting)
    cellColors: {
      g3: mixHex(up, K, 0.78), g2: mixHex(up, K, 0.5), g1: mixHex(up, K, 0.68),
      a: '#5a4510',
      r1: mixHex(down, K, 0.68), r2: mixHex(down, K, 0.5), r3: mixHex(down, K, 0.78),
      '': '#181818',
    },
    // → heatmap tile value text, keyed by TIER_SCORES (mirrors TIER_TIP_COLORS)
    tipColors: {
      6: mixHex(up, W, 0.25), 5: mixHex(up, W, 0), 4: mixHex(up, W, 0.5),
      3: '#f59e0b',
      2: mixHex(down, W, 0.5), 1: mixHex(down, W, 0.25), 0: mixHex(down, W, 0),
    },
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

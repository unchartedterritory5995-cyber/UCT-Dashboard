import { dividerFor, chromeFor, toolbarFor, parseColor, luminance } from '../../../utils/dividerColor'

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

  // Two independent text colors (owner: one color for both fails on a light
  // canvas — headers sit ON the canvas, readings sit ON the dark tiles).
  // Empty = the default look (gold section headers; white-ish tile text).
  headerColor: '',   // section names ("SCORE", "PRIMARY BREADTH") + the as-of date
  valueColor: '',    // the readings on the tiles (values + their captions)

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
// Seed values for an uncustomized widget on the LIGHT app theme: white canvas +
// dark header/value text (the heat-map tiles keep their own colors). So the ⚙
// swatches AND the surface follow the site theme until edited.
export const BREADTH_WIDGET_LIGHT_OVERRIDES = {
  bg: '#ffffff',
  headerColor: '#1f2328',
  valueColor: '#1f2328',
}
/** The default settings blob for the current app theme ('light' → white canvas). */
export function breadthDefaultsForTheme(theme) {
  return theme === 'light'
    ? { ...BREADTH_WIDGET_DEFAULTS, ...BREADTH_WIDGET_LIGHT_OVERRIDES }
    : BREADTH_WIDGET_DEFAULTS
}

export function mergeBreadthWidgetSettings(saved) {
  const s = (saved && typeof saved === 'object') ? { ...saved } : {}
  // The single `textColor` briefly shipped (2026-07-22) before splitting into
  // headerColor + valueColor — seed both from a stored custom value so an early
  // tester's pick carries forward.
  if (s.textColor && s.textColor !== '#e0dac8' && !s.headerColor && !s.valueColor) {
    s.headerColor = s.textColor
    s.valueColor = s.textColor
  }
  delete s.textColor
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

/** True when the chosen canvas reads light (drives the light tile treatment). */
export function isLightCanvas(s) {
  const solid = s.bgMode === 'gradient' ? (s.bgGradient?.top || s.bg) : s.bg
  const rgb = parseColor(solid)
  return rgb ? luminance(rgb) > 0.5 : false
}

// Light-canvas defaults for the heatmap tiles: soft tints of the classic
// green/red (extreme = most saturated tint) with dark ink values — the dark
// near-black tiles read as heavy ink blocks on a white canvas (owner: "sticks
// out like a sore thumb"). Derived once from the classic direction hues.
const LU = '#16a34a', LD = '#dc2626'
export const LIGHT_TIER_CELL_COLORS = {
  g3: mixHex(LU, W, 0.5), g2: mixHex(LU, W, 0.64), g1: mixHex(LU, W, 0.78),
  a:  mixHex('#b45309', W, 0.7),
  r1: mixHex(LD, W, 0.78), r2: mixHex(LD, W, 0.64), r3: mixHex(LD, W, 0.5),
  '': '#ececec',
}
export const LIGHT_TIER_TIP_COLORS = {
  6: mixHex(LU, K, 0.45), 5: mixHex(LU, K, 0.3), 4: mixHex(LU, K, 0.15),
  3: '#92400e',
  2: mixHex(LD, K, 0.15), 1: mixHex(LD, K, 0.3), 0: mixHex(LD, K, 0.45),
}

/** Build the three tier color systems from user up/down colors, or null when
 *  either is unset (→ follow the named palette / classic maps).
 *  Shade logic mirrors the classic maps' pattern:
 *  - views (bright): extreme = the pure hue, milder = lighter tints.
 *  - heatmap tile FILLS (dark): mid tier brightest, extremes darkest.
 *  - heatmap tile VALUES (bright text): pure hue at extreme, tints milder. */
export function customBreadthColors(s, light = false) {
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
    // → heatmap tile fills. Dark canvas: dark shades (mirrors TIER_CELL_COLORS'
    // weighting). Light canvas: soft tints, extreme = most saturated.
    cellColors: light
      ? {
          g3: mixHex(up, W, 0.5), g2: mixHex(up, W, 0.64), g1: mixHex(up, W, 0.78),
          a: mixHex('#b45309', W, 0.7),
          r1: mixHex(down, W, 0.78), r2: mixHex(down, W, 0.64), r3: mixHex(down, W, 0.5),
          '': '#ececec',
        }
      : {
          g3: mixHex(up, K, 0.78), g2: mixHex(up, K, 0.5), g1: mixHex(up, K, 0.68),
          a: '#5a4510',
          r1: mixHex(down, K, 0.68), r2: mixHex(down, K, 0.5), r3: mixHex(down, K, 0.78),
          '': '#181818',
        },
    // → heatmap tile value text, keyed by TIER_SCORES (mirrors TIER_TIP_COLORS).
    // Light canvas: dark ink shades of the hues for contrast on the tints.
    tipColors: light
      ? {
          6: mixHex(up, K, 0.45), 5: mixHex(up, K, 0.3), 4: mixHex(up, K, 0.15),
          3: '#92400e',
          2: mixHex(down, K, 0.15), 1: mixHex(down, K, 0.3), 0: mixHex(down, K, 0.45),
        }
      : {
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

  if (s.headerColor) vars['--bw-header'] = s.headerColor
  if (s.valueColor) vars['--bw-value'] = s.valueColor

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
    // Light canvas: tile hairlines flip dark, and tile captions default to dark
    // ink (the tiles themselves become soft tints — see LIGHT_TIER_CELL_COLORS).
    const rgb = parseColor(solid)
    if (rgb && luminance(rgb) > 0.5) {
      vars['--bw-tile-border'] = 'rgba(0, 0, 0, 0.10)'
      vars['--bw-tile-label'] = 'rgba(0, 0, 0, 0.62)'
    }
  }
  return vars
}

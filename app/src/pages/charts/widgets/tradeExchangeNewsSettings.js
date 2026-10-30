// ⚙ Trade Exchange News widget — per-widget appearance + behaviour (opts.settings).
// The same shape and rules as newsWidgetSettings.js (the News & Catalysts sibling):
// deep-merged over defaults, applied as CSS variables on the widget root, and each
// variable emitted ONLY when it differs from the default so the default look stays
// byte-identical. Colour keys are the ones chartThemes._WIDGET_THEME_MAP patches
// (textColor, headerColor, upColor, downColor), so the widget theme gallery and
// "Apply to all widgets" recolour it exactly as they recolour every other widget.
import { dividerFor, chromeFor, toolbarFor } from '../../../utils/dividerColor'
import { ensureContrast } from '../../../lib/theme'
import { ALERT_SOUNDS } from '../../../utils/alertSound'
import { NEWS_WIDGET_DEFAULTS, NEWS_WIDGET_LIGHT_OVERRIDES } from './newsWidgetSettings'

// ⭐ The palette IS News & Catalysts' (newsWidgetSettings.js) — imported, not restated,
// so the two news widgets can never drift apart and no colour literal lives here.
export const TXN_WIDGET_DEFAULTS = {
  bgMode: NEWS_WIDGET_DEFAULTS.bgMode,              // 'solid' | 'gradient'
  bg: NEWS_WIDGET_DEFAULTS.bg,
  bgGradient: { ...NEWS_WIDGET_DEFAULTS.bgGradient },
  textColor: NEWS_WIDGET_DEFAULTS.textColor,        // headline text
  headerColor: NEWS_WIDGET_DEFAULTS.headerColor,    // ticker symbols in headlines
  upColor: NEWS_WIDGET_DEFAULTS.upColor,            // live status / new-headline accent
  downColor: NEWS_WIDGET_DEFAULTS.downColor,        // offline / coverage-gap accent
  density: 'comfortable',                           // 'compact' | 'comfortable'
  highlightNew: 'on',                               // 'on' | 'off'
  showCategory: 'on',                               // 'on' | 'off' — label under each time
  tickerColorMode: 'performance',                   // 'performance' (theme up/down candles) | 'accent' | 'neutral'
  graphicPlaceholders: 'hide',                      // 'hide' | 'show' — label-only posts whose graphic we never receive
  longHeadlines: '3',                               // '3' | '5' | 'all' — lines before "Show more"
  impactMarks: 'on',                                // 'on' | 'off' — Breaking / High impact labels
  groupRelated: 'off',                              // 'off' | 'on' — the same story re-sent, grouped
  sound: 'off',                                     // ⛔ muted by default (owner rule)
  soundKey: 'ding',                                 // one of utils/alertSound ALERT_SOUNDS
}

export const TXN_WIDGET_LIGHT_OVERRIDES = { ...NEWS_WIDGET_LIGHT_OVERRIDES }

/** Sounds offered in ⚙ — a short list of the shared alert tones. */
export const TXN_SOUND_OPTIONS = ['ding', 'chime', 'soft', 'pulse']
  .filter((k) => ALERT_SOUNDS.some((s) => s.key === k))
  .map((k) => ({ key: k, label: ALERT_SOUNDS.find((s) => s.key === k).label }))

export function txnDefaultsForTheme(theme) {
  return theme === 'light'
    ? { ...TXN_WIDGET_DEFAULTS, ...TXN_WIDGET_LIGHT_OVERRIDES }
    : TXN_WIDGET_DEFAULTS
}

const ENUMS = {
  density: ['compact', 'comfortable'],
  highlightNew: ['on', 'off'],
  showCategory: ['on', 'off'],
  tickerColorMode: ['performance', 'accent', 'neutral'],
  graphicPlaceholders: ['hide', 'show'],
  longHeadlines: ['3', '5', 'all'],
  impactMarks: ['on', 'off'],
  groupRelated: ['off', 'on'],
  sound: ['off', 'on'],
  bgMode: ['solid', 'gradient'],
}

/** Deep-merge saved settings over defaults (tolerates partial/older/garbled blobs). */
export function mergeTxnWidgetSettings(saved) {
  const s = (saved && typeof saved === 'object') ? { ...saved } : {}
  const out = {
    ...TXN_WIDGET_DEFAULTS,
    ...s,
    bgGradient: { ...TXN_WIDGET_DEFAULTS.bgGradient, ...(s.bgGradient || {}) },
  }
  for (const [k, vals] of Object.entries(ENUMS)) if (!vals.includes(out[k])) out[k] = TXN_WIDGET_DEFAULTS[k]
  if (!TXN_SOUND_OPTIONS.some((o) => o.key === out.soundKey)) out.soundKey = TXN_WIDGET_DEFAULTS.soundKey
  delete out.showPct                     // retired: the inline % beside tickers was removed
  return out
}

/** A placed widget's effective settings: its own blob, or the placed theme's defaults. */
export const txnSettingsFor = (saved, theme) => mergeTxnWidgetSettings(saved ?? txnDefaultsForTheme(theme))

/** Lines a long headline shows before "Show more" (0 = always expanded). */
export const txnClampLines = (s) => (s.longHeadlines === 'all' ? 0 : s.longHeadlines === '5' ? 5 : 3)


export function isCustomCanvas(s) {
  return s.bgMode === 'gradient'
    || (typeof s.bg === 'string' && s.bg.toLowerCase() !== TXN_WIDGET_DEFAULTS.bg)
}

/** Inline CSS-variable style object for the widget root.
 *
 * ⭐ The Watchlist rule (watchlistSettings.watchlistStyleVars), measured against it in
 * the comparison harness: the canvas, row text, ticker text, dividers, row hover and
 * header chrome are ALWAYS emitted from the widget's own settings — which, for an
 * uncustomised widget, are the defaults of the theme it was PLACED under
 * (txnSettingsFor + usePlacedTheme). So a News widget draws the same canvas, #e0dac8
 * rows and hairlines a Watchlist beside it draws, and an app-theme switch never
 * recolours it (text and canvas can never come from two different themes). */
export function txnWidgetStyleVars(s) {
  const D = TXN_WIDGET_DEFAULTS
  const text = s.textColor || D.textColor
  const solid = s.bgMode === 'gradient' ? (s.bgGradient?.top || s.bg) : (s.bg || D.bg)
  const vars = {
    '--txn-text': text,
    '--txn-sym': s.headerColor || text,
    '--txn-up': s.upColor || D.upColor,
    '--txn-down': s.downColor || D.downColor,
  }
  // Ticker TEXT in the daily-performance colours: the theme's candle hues, nudged
  // (same hue) until 11px text clears WCAG AA on this widget's own canvas. The
  // status dot and highlight keep the theme's raw colour.
  const surfaces = s.bgMode === 'gradient' ? [solid, s.bgGradient?.bottom] : [solid]
  const readable = (c) => surfaces.reduce((acc, bg) => (bg ? ensureContrast(acc, bg, 4.5) : acc), c)
  vars['--txn-sym-up'] = readable(vars['--txn-up'])
  vars['--txn-sym-down'] = readable(vars['--txn-down'])
  const div = dividerFor(solid)
  const divStrong = dividerFor(solid, { strong: true })
  if (div) vars['--txn-divider'] = div
  if (divStrong) vars['--txn-row-divider'] = divStrong
  const chrome = chromeFor(solid)
  if (chrome) {
    vars['--txn-chrome'] = chrome.text
    vars['--txn-chrome-strong'] = chrome.textStrong
    vars['--txn-accent'] = chrome.accent
  }
  const hover = toolbarFor(solid)
  if (hover) vars['--txn-row-hover'] = hover.bg
  vars['--txn-bg'] = s.bgMode === 'gradient'
    ? `linear-gradient(to bottom, ${s.bgGradient.top} 0%, ${s.bgGradient.bottom} 100%)`
    : solid
  vars['--txn-bg-solid'] = solid
  return vars
}

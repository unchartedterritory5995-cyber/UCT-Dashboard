// app/src/components/chart/engine/placement.js
//
// ─── WHERE AN INDICATOR GOES, AND WHAT ITS AXIS IS ──────────────────────────
//
// Pure. No lightweight-charts, no React, no settings writes. `binder.js` REQUIRES
// this module's `resolvePlacement` (it makes zero renderer calls without one and
// says why) precisely so that "which pane / which price scale / which margins"
// has exactly ONE answer instead of two that can drift.
//
// ─── FLIP A: THE ENGINE RENDERS INTO THE LEGACY BANDS ───────────────────────
//
// Phase B migrates fifteen indicators, and every one of them ships under Flip A:
// same stacked bands at the bottom of pane 0, same named price scales, same
// margins — pixel-identical to the version it replaces, or the parity gate goes
// red. So this file is not a design; it is a TRANSCRIPTION of `indTarget` and
// `applyIndScale` (`StockChart.jsx:5457-5480`) into something testable:
//
//     indTarget(key)    = volSeparatePane && volOverlaySet.has(key)
//                           ? { pane: VOL_PANE_INDEX, scaleId: 'left' }
//                           : { pane: 0,              scaleId: key      }
//
//     applyIndScale     left  → { borderVisible:false, visible:true, autoScale:true,
//                                 scaleMargins:{top:0.12, bottom:0.04} }
//                       else  → { borderVisible:false,
//                                 scaleMargins: paneMargins[key] || {top:0.82, bottom:0},
//                                 ...bandExtra }
//
// Real panes are B5's job. Until then a "pane" is a band inside pane 0, and the
// band geometry comes from `computePaneMargins` — which this module CONSUMES and
// must never extend. Adding an engine key to that module's `PANES` list would
// reserve vertical space for something rendering nothing, which in B2 (flag off,
// zero instances) is every user's chart shrinking for no reason.
//
// ─── TRAP #2: THE FULL SCALE OPTION SET, EVERY RESOLVE ──────────────────────
//
// `StockChart` passes the fixed-range extras — `{autoScale:false, minimum:0,
// maximum:100}` — on the CREATE branch ONLY (`:5773`, `:5806`, `:5953`, `:6002`,
// `:6039`); the update branch calls `applyIndScale` with no `bandExtra` at all.
// That is safe today only because a series and its scale are born and destroyed
// together. Pooling breaks it: price scales are CHART-LEVEL and keyed by id, so a
// pooled series that inherits RSI's `rsi` scale and never asserts its own keeps
// 0-100 — and an ATR of 2.7 renders as a flat line on the floor.
//
// So `scaleOptions` is the COMPLETE object every single time, and the fixed range
// is read from the definition's own `placement.scale` (declared in Task 2) rather
// than from a lookup table here. One source of truth, and a new indicator gets
// its range right by declaring it.
//
// ─── TRAP #5: THE PRESET COMES FROM THE CANVAS, NEVER FROM `cs.preset` ──────
//
// `designTokens.resolveToken` falls back to the `classic` palette for a preset it
// does not recognise, and EVERY settings write in the app stamps
// `preset: 'custom'` (the Style panel, the toolbar, the per-cell overrides — the
// stored value is a label for the picker, not a description of the canvas). Read
// naively, an OLED user who nudges one colour silently gets classic's `ink`
// (#706b5e) on pure black, with nothing to tell them. `resolvePreset` therefore
// looks at what is actually PAINTED and picks the palette whose surface is
// nearest, because each palette's contrast was measured against its own surface.

import { IND_TOKENS } from '../designTokens'

/**
 * Each preset's canvas colour. Taken from `designTokens.IND_TOKENS[p].surface`,
 * which `designTokens.test.js` already pins equal to
 * `chartDefaults.PRESETS[p].settings.background` — so this cannot drift from the
 * presets without that suite failing, and there is no third copy to maintain.
 */
export const PRESET_SURFACES = Object.freeze(
  Object.fromEntries(Object.keys(IND_TOKENS).map((name) => [name, IND_TOKENS[name].surface])),
)

/** What an unreadable/absent canvas resolves to. Matches `designTokens`'
 *  DEFAULT_PRESET: a palette that paints is better than a null that doesn't. */
const DEFAULT_PRESET = 'classic'

/** The shipped left-axis options for an oscillator overlaid onto the volume
 *  pane (`applyIndScale`'s `scaleId === 'left'` branch). Frozen, and rebuilt per
 *  call below so a caller can never mutate the shared object. */
const LEFT_AXIS_OPTIONS = Object.freeze({
  borderVisible: false, visible: true, autoScale: true,
  scaleMargins: Object.freeze({ top: 0.12, bottom: 0.04 }),
})

/** `applyIndScale`'s `|| { top: 0.82, bottom: 0 }`. Reached when the layout
 *  reserved no band for this key — i.e. the legacy toggle is off while an engine
 *  instance exists, which is exactly the B3 crossover state. */
const FALLBACK_BAND = Object.freeze({ top: 0.82, bottom: 0 })

// ─── colour ──────────────────────────────────────────────────────────────────

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i
const RGBFN = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*[0-9.]+\s*)?\)$/i

/**
 * The four canvas colours a settings blob can hold, as bytes.
 *
 * Alpha is deliberately DISCARDED: the canvas is composited over the page and
 * the visible surface is its RGB. Anything unparseable returns null and the
 * caller falls back rather than guessing — a wrong palette is worse than the
 * default one.
 */
function parseCanvasColor(value) {
  if (typeof value !== 'string') return null
  const s = value.trim()

  const m3 = HEX3.exec(s)
  if (m3) return { r: parseInt(m3[1] + m3[1], 16), g: parseInt(m3[2] + m3[2], 16), b: parseInt(m3[3] + m3[3], 16) }

  const m6 = HEX6.exec(s)
  if (m6) return { r: parseInt(m6[1], 16), g: parseInt(m6[2], 16), b: parseInt(m6[3], 16) }

  const mf = RGBFN.exec(s)
  if (mf) {
    const [r, g, b] = [mf[1], mf[2], mf[3]].map((n) => Math.round(Number(n)))
    if ([r, g, b].every((n) => Number.isFinite(n))) return { r, g, b }
  }
  return null
}

/**
 * Which palette is this canvas closest to?
 *
 * Squared Euclidean distance in RGB — not luminance. Luminance alone would put a
 * TradingView navy (#131722) and an OLED black (#000000) within a few units of
 * each other while their `bull`/`bear`/`info` roles differ substantially, and a
 * light-vs-dark test alone throws away the choice between the three dark
 * palettes entirely. Distance-to-surface is also the metric the palettes were
 * BUILT against (every contrast figure in `designTokens.js` is measured on that
 * preset's own surface), so "nearest surface" is the same question as "whose
 * contrast measurements still apply here".
 */
function nearestPreset(rgb) {
  let best = DEFAULT_PRESET
  let bestDistance = Infinity
  for (const name of Object.keys(PRESET_SURFACES)) {
    const s = parseCanvasColor(PRESET_SURFACES[name])
    if (!s) continue
    const d = (rgb.r - s.r) ** 2 + (rgb.g - s.g) ** 2 + (rgb.b - s.b) ** 2
    if (d < bestDistance) { bestDistance = d; best = name }
  }
  return best
}

/**
 * The design-token preset to draw this chart's indicators with.
 *
 * TRAP #5. Never reads `cs.preset` — see the module header. The order below
 * mirrors how `StockChart` actually decides what colour the canvas is
 * (`StockChart.jsx:1084-1149`):
 *
 *   1. an explicit `opts.canvas` — the caller knows something the blob cannot.
 *      `canvasTheme="sunrise"` (a light sky gradient) and the Model Book navy are
 *      PROPS; no settings blob mentions either, so a caller on one of those
 *      surfaces passes the canvas it is actually painting.
 *   2. `cs.theme === 'light'` — that branch hard-forces `#ffffff` regardless of
 *      the stored background, so the stored background is not what is painted.
 *   3. a gradient canvas — sampled at the TOP, where the chart chrome and most
 *      indicator ink sit.
 *   4. `cs.background`.
 *
 * @param {object|null|undefined} cs merged chart settings
 * @param {{canvas?: string}} [opts]
 * @returns {'classic'|'oled'|'tradingview'|'light'}
 */
export function resolvePreset(cs, opts) {
  let canvas = opts && typeof opts.canvas === 'string' ? opts.canvas : null

  if (canvas === null) {
    if (!cs || typeof cs !== 'object') return DEFAULT_PRESET
    if (cs.theme === 'light') return 'light'
    const gradientTop = cs.bgMode === 'gradient' && cs.bgGradient ? cs.bgGradient.top : null
    canvas = typeof gradientTop === 'string' ? gradientTop : cs.background
  }

  const rgb = parseCanvasColor(canvas)
  return rgb ? nearestPreset(rgb) : DEFAULT_PRESET
}

// ─── placement ───────────────────────────────────────────────────────────────

/** `ctx.volOverlaySet` as a Set, whatever shape the caller had it in. */
function asSet(value) {
  if (value instanceof Set) return value
  return new Set(Array.isArray(value) ? value : [])
}

/**
 * Where one instance's series go, and what to assert on their price scale.
 *
 * @param {object} instance a normalised instance (`instances.js`)
 * @param {object} def      its definition (`nativeRegistry`)
 * @param {object} ctx      `{ paneMargins, volOverlaySet, volSeparatePane, VOL_PANE_INDEX }`
 * @returns {{paneIndex: number, scaleId: string|null, scaleOptions: object|null}|null}
 *
 * `scaleOptions === null` means **assert nothing** — the scale belongs to
 * somebody else. Returning `null` for the whole thing means **bind nothing**:
 * `binder.sync` skips a binding whose placement does not resolve, which is the
 * fail-closed posture the rest of the engine uses (an indicator nobody can place
 * renders nothing rather than landing somewhere plausible-looking).
 *
 * KNOWN FLIP-A LIMIT, stated rather than discovered: the band and the scale id
 * are keyed by DEFINITION id, because `computePaneMargins` is. Two instances of
 * the same definition therefore share one band and one scale — correct for two
 * RSIs (both are 0-100) and a real constraint for two ATRs (they autoscale
 * together). Per-instance bands need real panes; that is B5, and it is the same
 * boundary `instances.js` notes about stacking ORDER not being user data.
 */
export function resolvePlacement(instance, def, ctx) {
  if (!def || typeof def !== 'object') return null
  const c = ctx || {}

  // The instance's stored target wins over the definition's — that is what makes
  // "move this one to the price pane" expressible per instance rather than per
  // indicator. `normalizeInstances` has already validated it against
  // `PLACEMENT_TARGETS`; an unknown value here is data that bypassed that, and
  // it resolves to nothing rather than to a guess.
  const instTarget = instance && instance.placement && instance.placement.target
  const defTarget = def.placement && def.placement.target
  const target = (typeof instTarget === 'string' && instTarget)
    || (typeof defTarget === 'string' && defTarget)
    || 'pane'

  // ── A price overlay (BB, VWAP, SAR, Ichimoku, Donchian) ──
  //
  // These get NO `priceScaleId` in the shipped code (`:5714`, `:5744`), so they
  // land on the chart's default price scale — the one the CANDLES own. Its
  // margins come from `_mainMargins` and, when the user has dragged the axis,
  // from the remembered `vertMarginsRef` placement. An indicator writing
  // scaleMargins there would move the candles, so this path asserts nothing.
  if (target === 'price') return { paneIndex: 0, scaleId: null, scaleOptions: null }

  // 'volume' is the migrator's record of "this oscillator is in
  // `cs.volumeOverlayIndicators`" (`instances.js:250-255`). It is still a pane
  // oscillator; whether it is overlaid THIS pass is decided below from the LIVE
  // list, because that toolbar control is what users actually toggle and a
  // snapshot taken at migration must not outrank it. B4 flips that authority when
  // the engine owns its own placement UI.
  if (target !== 'pane' && target !== 'volume') return null
  if (typeof def.id !== 'string' || !def.id) return null
  const key = def.id

  // ── Overlaid into the volume pane, on its left axis ──
  if (c.volSeparatePane && asSet(c.volOverlaySet).has(key)) {
    return {
      paneIndex: Number.isInteger(c.VOL_PANE_INDEX) ? c.VOL_PANE_INDEX : 1,
      scaleId: 'left',
      // Rebuilt, not shared: a caller that mutated the returned object would
      // otherwise poison every later resolve. No fixed range here even for RSI —
      // the left axis is shared with everything else overlaid onto it, which is
      // exactly why the shipped branch autoscales it.
      scaleOptions: { ...LEFT_AXIS_OPTIONS, scaleMargins: { ...LEFT_AXIS_OPTIONS.scaleMargins } },
    }
  }

  // ── Its own stacked band in pane 0, on a scale named after the definition ──
  const band = (c.paneMargins && c.paneMargins[key]) || FALLBACK_BAND
  const scale = def.placement && def.placement.scale
  const range = (scale && Number.isFinite(scale.min) && Number.isFinite(scale.max))
    ? { autoScale: false, minimum: scale.min, maximum: scale.max }
    : { autoScale: true }

  return {
    paneIndex: 0,
    scaleId: key,
    scaleOptions: { borderVisible: false, scaleMargins: { ...band }, ...range },
  }
}

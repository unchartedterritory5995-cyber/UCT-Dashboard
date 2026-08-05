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
// ─── FLIP C: BOTH ANSWERS LIVE HERE NOW, AND ONE CONSTANT PICKS ─────────────
//
// B5 Task 10 built the real-pane answer and landed it DARK. `paneMode()` is
// `'bands'`, so the transcription above is still what every user gets, byte for
// byte, and the 46-case zero-changed-pixel gate says so. Under `'panes'` the
// band becomes a real lightweight-charts pane (`paneLayout.computePaneLayout`
// says which index and how tall) and the margins go to zero because the drawable
// rectangle is the whole pane.
//
// In `'bands'` mode the band geometry still comes from `computePaneMargins` —
// which this module CONSUMES and must never extend. Adding an engine key to that
// module's `PANES` list would reserve vertical space for something rendering
// nothing, which in B2 (flag off, zero instances) is every user's chart shrinking
// for no reason.
//
// ─── TRAP #2: THE FULL SCALE OPTION SET, EVERY RESOLVE ──────────────────────
//
// `StockChart` passes the fixed-range extras — `{autoScale:false, minimum:0,
// maximum:100}` — on the CREATE branch ONLY (`:5773`, `:5806`, `:5953`, `:6002`,
// `:6039`); the update branch calls `applyIndScale` with no `bandExtra` at all.
// That is safe today only because a series and its scale are born and destroyed
// together. Pooling breaks it: price scales are CHART-LEVEL and keyed by id, so a
// pooled series that inherits RSI's `rsi` scale and never asserts its own is
// stuck with whatever that scale was left holding — and an ATR of 2.7 draws as a
// flat line on the floor of a band framed for an oscillator.
//
// ⚠️ THE INHERITED HAZARD IS `autoScale: false`, NOT A PINNED RANGE. This block
// used to say the pooled series "keeps 0-100". It does not, because
// `minimum`/`maximum` ARE NOT lightweight-charts 5.2.0 price-scale options —
// `merge` copies them into the options bag and nothing ever reads them
// (`dist/typings.d.ts:3706+`; measured in
// `__tests__/autoscaleOnARealScale.test.js`, where RSI's band comes back
// 30.0002..69.9957 rather than 0..100). What `autoScale: false` really does is
// stop `_internal_recalculatePriceScale` re-invalidating the range on the routine
// update (`:5455-5459`), so the scale stays FROZEN at the previous tenant's
// extent. Same trap, same fix, honest mechanism.
//
// So `scaleOptions` is the COMPLETE object every single time, and the fixed range
// is read from the definition's own `placement.scale` (declared in Task 2) rather
// than from a lookup table here. One source of truth, and a new indicator gets
// its range right by declaring it — as far as the renderer allows, which for the
// `minimum`/`maximum` half is currently not at all. Pinning a band for real needs
// `priceScale().setVisibleRange({from, to})` (the only caller of
// `_internal_setCustomPriceRange`, `:12445-12447`); doing that is a PIXEL CHANGE
// against legacy and therefore not a Flip A decision.
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
import { paneMode } from './paneLayout'

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

/**
 * The id of the scale the CANDLES own — what a price overlay must bind to.
 *
 * ⚠️ THIS USED TO BE `null`, MEANING "the main price scale", AND THE BINDER READ
 * IT AS "don't mention `priceScaleId`". On a CREATED series those two agree, because
 * LWC resolves an absent `priceScaleId` to its default. On a POOLED one they do
 * not: `applyOptions` without the key leaves the series wherever its previous
 * tenant was, and `scaleOptions: null` (correct — a price overlay must assert
 * nothing on the candles' axis) means nothing corrects it afterwards. Measured on
 * the exact B3 pilot pair: RSI off + BB on in one settings write left BB's upper
 * band on the `rsi` scale, still `{autoScale:false, min:0, max:100}`, clipped off
 * the top of the RSI band and invisible, with no error anywhere.
 *
 * WHY `'right'` IS THE RIGHT CONSTANT, verified in the installed 5.2.0 bundle:
 * `_private__addSeriesToPane` resolves an absent id with
 * `_internal_defaultVisiblePriceScaleId()`, which returns the visible one when
 * exactly one of left/right is visible. `StockChart` configures `rightPriceScale`
 * (visible, LWC's default) and never touches `leftPriceScale` (hidden, LWC's
 * default) — so the candles resolve to `'right'`, and naming it explicitly is
 * byte-identical to omitting it on a create while being the FIX on a re-purpose.
 *
 * ⛔ If a surface ever hides the right price scale, the candles move to `'left'`
 * and this constant strands every engine price overlay on an empty axis. Nothing
 * in the app does that today (one `rightPriceScale` block, no `visible` key); a
 * surface that wants to would have to teach placement which scale it painted.
 */
export const MAIN_PRICE_SCALE_ID = 'right'

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

/**
 * Whether a series bound at this placement may drive its price scale's autoscale.
 *
 *   'exclude' — the series is a GUEST on somebody else's axis. Every price
 *               overlay is: `StockChart` creates BB (`:5888`), VWAP (`:5918`),
 *               SAR (`:6074`), Ichimoku (`:6096`) and Donchian (`:6267`) with
 *               `autoscaleInfoProvider: () => null` so a band running off the top
 *               of the window cannot stretch the CANDLES' range.
 *   'default' — the series OWNS its scale (its own stacked band, or the volume
 *               pane's shared autoscaled left axis) and the shipped code passes
 *               no provider at all.
 *
 * ⚠️ A STRING, NOT A FUNCTION. This module is pure and its return value is
 * compared with `toEqual` in tests and (later) between passes; a fresh closure
 * would make two identical resolves unequal. `pool.seriesOptionsForPlot` owns the
 * two function singletons, which is also where the complete-key-set rule lives.
 */
export const AUTOSCALE_MODES = Object.freeze(['exclude', 'default'])

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
 * @param {object} ctx      `{ paneMargins, paneLayout, volOverlaySet, volSeparatePane,
 *                          VOL_PANE_INDEX }` — `paneLayout` is read ONLY when
 *                          `paneMode()` is `'panes'`, and in `'bands'` mode the
 *                          returned object is deep-equal to the one this function
 *                          returned before Flip C existed, asserted for every
 *                          pane oscillator in `__tests__/flipCGeometry.test.jsx`.
 * @returns {{paneIndex: number, scaleId: string|null, scaleOptions: object|null,
 *            autoscale: 'exclude'|'default'}|null}
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
  //
  // `scaleId` is the CONCRETE id, never null — see `MAIN_PRICE_SCALE_ID`. "Assert
  // nothing" is `scaleOptions`, and only `scaleOptions`; a null scale ID was read
  // one layer down as "leave `priceScaleId` alone", which is how a pooled overlay
  // kept its previous tenant's named scale.
  //
  // `autoscale: 'exclude'` is the SERIES half of the same "assert nothing on the
  // candles" rule, and it is the reason this field exists: `scaleOptions: null`
  // stops the overlay writing the candles' MARGINS, but nothing stopped it
  // stretching their RANGE — a Bollinger band that runs off the top of the window
  // would reframe the candles the engine is supposed to be pixel-identical to.
  if (target === 'price') {
    return { paneIndex: 0, scaleId: MAIN_PRICE_SCALE_ID, scaleOptions: null, autoscale: 'exclude' }
  }

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
      // The left axis is autoscaled BY the things overlaid onto it — that branch
      // sets `autoScale: true` precisely so they drive it — and the shipped code
      // passes no provider at all. Excluding here would leave the shared axis
      // with nothing to size itself from.
      autoscale: 'default',
    }
  }

  const scale = def.placement && def.placement.scale
  const range = (scale && Number.isFinite(scale.min) && Number.isFinite(scale.max))
    ? { autoScale: false, minimum: scale.min, maximum: scale.max }
    : { autoScale: true }

  // ── FLIP C: its own REAL PANE ───────────────────────────────────────────────
  //
  // The band becomes a PANE. The scale keeps the definition's id — an OVERLAY
  // scale, so no axis labels appear; whether it should get its own visible axis
  // is `FLIP_C_PANE_GEOMETRY (b)`, the owner's call at Task 11 and not this
  // branch's. The drawable rectangle is now the WHOLE pane, so the margins are
  // zero where they used to be a slice of pane 0.
  //
  // ⚠️ `scaleMargins: {top: 0, bottom: 0}` IS SPELLED OUT AND MUST STAY SPELLED
  // OUT. `applyOptions` MERGES and lightweight-charts' `merge()` SKIPS
  // `undefined`, so omitting the key does not reset the margins — it leaves the
  // previous band standing on a re-purposed scale, i.e. a pooled series drawing
  // into a 15%-tall slice of a pane it now owns outright, with nothing to say so.
  //
  // ⛔ `autoscale: 'default'`, in BOTH modes and for the same reason: `'exclude'`
  // collapses the band to the library's empty default of -0.5..0.5 and moves a
  // price of 30 from y=371 to y=-1640.78 (MEASURED, B3 Task 1 fix round —
  // `__tests__/autoscaleOnARealScale.test.js` holds the numbers).
  //
  // A definition the layout did NOT give a pane binds NOTHING, which is the same
  // fail-closed posture the rest of this module takes: an oscillator that is on
  // but has no pane would otherwise land in pane 0 on a zero-margin scale and
  // paint straight over the candles.
  if (paneMode() === 'panes') {
    const panes = c.paneLayout && Array.isArray(c.paneLayout.panes) ? c.paneLayout.panes : null
    const pane = panes ? panes.find((p) => p && p.key === key) : null
    if (!pane || !Number.isInteger(pane.index)) return null
    return {
      paneIndex: pane.index,
      scaleId: key,
      scaleOptions: { borderVisible: false, scaleMargins: { top: 0, bottom: 0 }, ...range },
      autoscale: 'default',
    }
  }

  // ── Its own stacked band in pane 0, on a scale named after the definition ──
  const band = (c.paneMargins && c.paneMargins[key]) || FALLBACK_BAND

  return {
    paneIndex: 0,
    scaleId: key,
    scaleOptions: { borderVisible: false, scaleMargins: { ...band }, ...range },
    // Its own band, its own scale: it is the only thing on that axis, so it has
    // to be what sizes it.
    //
    // ⛔ AND A FIXED-RANGE DEFINITION IS NO EXCEPTION — this used to say the
    // provider was "inert" there because `autoScale: false` pins 0-100. IT DOES
    // NOT. `minimum`/`maximum` are not 5.2.0 price-scale options at all (see
    // `range` above), and MEASURED on a real chart in production's call order,
    // RSI's band comes back 30.0002..69.9957 — the COLUMN's own extent, taken
    // from the autoscale walk — not 0..100. Put `'exclude'` here and that same
    // band collapses to the library's empty default of -0.5..0.5, moving a price
    // of 30 from y=371 to y=-1640.78: two thousand pixels off the pane.
    // `__tests__/autoscaleOnARealScale.test.js` holds those numbers.
    //
    // So the reason is PARITY, which needs no claim about inertness: the legacy
    // block passes no provider, the identity provider is byte-identical to
    // passing none, and that is what Flip A has to reproduce.
    autoscale: 'default',
  }
}

// app/src/components/chart/engine/hlineLevels.js
//
// ─── ⭐⭐ e96 — A PINE `hline` IS DRAWN AS THE LEVEL IT IS, ON BOTH DOORS (one authority) ─────────────────────
//
// The host translation reads every `hline` call once (`pine.js::resolveHlineLevels`): its price (a fixed number,
// or ONE setting carried as that setting) and what its author wrote about how it looks. This module turns those
// reads into the document's guide plots (`style: 'hlines'`, drawn by `binder.js::guideSpecs` as one price line
// each, hung on the instance's first visible series), for the host document AND the runtime document
// (`memberPaneDefinition.js`), so the two doors can never draw one level two ways.
//
// ⭐ THE PRICE IS THE PAYLOAD, AND IT IS EXACT, SO THE LINE IS DRAWN ON EVERY VERSION (coordinator ruling R2,
// 2026-11-22, the engine-58 rule). A level bound to a setting is written `levels: ['$<key>']`, so the member's
// own value reaches it through the bind path every setting already takes (`defSchema` substitutes the default,
// `pool.resolvePlotForInstance` the instance's value): changing the setting moves the line.
//
// ⛔ A STYLE FIELD TRADINGVIEW'S DEFAULT FOR WHICH IS NOT WITNESSED IS NEVER GUESSED. What is captured, field by
// field (`HLINE_DEFAULTS`):
//   · v6 (`vw-hline-written-rddt-1d-2026-11-20`, H5): colour #808080, line style 2 = dashed, width 1;
//   · v1-v3 (`transparency-defaults-by-version-rddt-1d-2026-11-14`, the S1 probes `vw-cs1-transp-v{1,2,3}`): a WRITTEN
//     colour is kept opaque (`bands` carry no transparency key), line style dashed, width 1. The default COLOUR of an
//     unstyled v1-v3 hline is not captured (each S1 hline names one).
//   · v4, v5: nothing yet.
// Where the author wrote no colour, style or width and the version's default for it is not in `HLINE_DEFAULTS`, or
// wrote one in a form the translation could not read (`level.unread`), the line is drawn in the chart's NEUTRAL INK
// (solid, width 1) and that is NAMED (`notReproduced`). When the version-default captures land (Q-HLINE-3), each
// becomes one field of `HLINE_DEFAULTS` and nothing else changes.

const S1 = 'transparency-defaults-by-version-rddt-1d-2026-11-14'
/** TradingView's `hline` defaults, by Pine version and field, each with the capture that witnesses it. A field that
 *  is absent is not witnessed for that version. */
export const HLINE_DEFAULTS = Object.freeze({
  1: Object.freeze({ lineStyle: 'dashed', width: 1, witness: S1 }),
  2: Object.freeze({ lineStyle: 'dashed', width: 1, witness: S1 }),
  3: Object.freeze({ lineStyle: 'dashed', width: 1, witness: S1 }),
  6: Object.freeze({ color: '#808080', lineStyle: 'dashed', width: 1, witness: 'vw-hline-written-rddt-1d-2026-11-20' }),
})

/** The neutral presentation of a level whose style is not reproduced (the colour is the caller's neutral ink). */
export const HLINE_NEUTRAL = Object.freeze({ lineStyle: 'solid', width: 1 })

/** TradingView's own codes for an hline's line style (`bandState.linestyle`, witnessed by H1-H3). */
export const HLINE_STYLE_CODE = Object.freeze({ solid: 0, dotted: 1, dashed: 2 })

/** The plot key of the n-th `hline` call (0-based ordinal): `hline1`, `hline2`, ... A data row is `value` or
 *  `out<N>`, so the two can never collide; the ordinal is readable back from the key (`hlineOrdinalOf`). */
export const hlineKeyOf = (ordinal) => `hline${ordinal + 1}`
export function hlineOrdinalOf(key) {
  const m = /^hline([1-9][0-9]*)$/.exec(String(key || ''))
  return m ? Number(m[1]) - 1 : null
}

const FIELD_WORDS = Object.freeze({ color: 'colour', lineStyle: 'line style', width: 'line width' })

/** The witnessed defaults of a version (`null`: no `//@version`, which TradingView compiles as v1). */
function defaultsFor(version) {
  const v = version === null ? 1 : version
  return Number.isInteger(v) && Object.prototype.hasOwnProperty.call(HLINE_DEFAULTS, v) ? HLINE_DEFAULTS[v] : {}
}

/** `#RRGGBB` and an opacity → the colour the chart draws (`#RRGGBBAA` below opaque). */
function drawnColour(color, opacity, withAlphaByte) {
  if (Number.isFinite(opacity) && opacity < 1 && typeof withAlphaByte === 'function') {
    return withAlphaByte(color, opacity) || color
  }
  return color
}

/**
 * The guide plots a document draws for a translation's levels.
 *
 * @param {object[]} levels                the translation's `presentation.levels`
 * @param {object} o
 * @param {number|null} o.version          the script's Pine version (null: none declared, v1)
 * @param {string} o.neutralInk            the chart's neutral ink (`WITHHELD_COLOUR_INK`)
 * @param {(c: string, a: number) => string} o.withAlphaByte
 * @param {(entry: object) => (string|null|{withheld: string})} o.bindInput
 *        the document's input key for a level's setting (its folded entry), or `{withheld}` when the
 *        document cannot carry that setting as one value
 * @returns {{guides: object[], withheld: object[], notReproduced: object[]}}
 */
export function hlineGuides(levels, { version, neutralInk, withAlphaByte, bindInput }) {
  const guides = []
  const withheld = []
  const notReproduced = []
  const defaults = defaultsFor(version)
  for (const lv of Array.isArray(levels) ? levels : []) {
    if (!lv || !Number.isFinite(lv.value) || !Number.isInteger(lv.ordinal)) continue
    // TradingView draws nothing for `display = display.none`; neither does this.
    if (lv.hidden === true) continue
    const label = typeof lv.title === 'string' && lv.title ? lv.title : `hline ${lv.ordinal + 1}`
    let level = lv.value
    if (lv.input) {
      const bound = typeof bindInput === 'function' ? bindInput(lv.input) : null
      if (bound && typeof bound === 'object' && bound.withheld) {
        withheld.push({ ordinal: lv.ordinal, line: lv.line, title: label, reason: bound.withheld })
        continue
      }
      if (typeof bound === 'string' && bound) level = `$${bound}`
      else {
        withheld.push({ ordinal: lv.ordinal, line: lv.line, title: label,
          reason: `its price is the setting \`${lv.input.name}\`, which this chart cannot offer as one value` })
        continue
      }
    }
    const unread = new Set(Array.isArray(lv.unread) ? lv.unread : [])
    const missing = []
    // ── colour ──
    let color
    if (typeof lv.color === 'string' && !unread.has('color')) color = drawnColour(lv.color, lv.opacity, withAlphaByte)
    else if (!unread.has('color') && typeof defaults.color === 'string') color = defaults.color
    else missing.push('color')
    // ── line style ──
    let lineStyle
    if (typeof lv.lineStyle === 'string' && !unread.has('lineStyle')) lineStyle = lv.lineStyle
    else if (!unread.has('lineStyle') && typeof defaults.lineStyle === 'string') lineStyle = defaults.lineStyle
    else missing.push('lineStyle')
    // ── width ──
    let width
    if (Number.isFinite(lv.width) && !unread.has('width')) width = lv.width
    else if (!unread.has('width') && Number.isFinite(defaults.width)) width = defaults.width
    else missing.push('width')
    const neutral = missing.length > 0
    const guide = {
      key: hlineKeyOf(lv.ordinal),
      label,
      style: 'hlines',
      levels: [level],
      // ⛔ A level any of whose style fields is not reproduced is drawn WHOLE in the neutral presentation, never
      // half the author's and half a guess: the member reads one fact ("its style is not reproduced").
      color: neutral ? neutralInk : color,
      width: neutral ? HLINE_NEUTRAL.width : width,
      lineStyle: neutral ? HLINE_NEUTRAL.lineStyle : lineStyle,
    }
    guides.push(guide)
    if (neutral) {
      const why = missing.map((f) => (unread.has(f)
        ? `its ${FIELD_WORDS[f]} is written in a form this door cannot read`
        : `TradingView's default ${FIELD_WORDS[f]} for a v${version === null ? 1 : version} \`hline\` is not captured`))
      notReproduced.push({ ordinal: lv.ordinal, line: lv.line, title: label, key: guide.key, fields: missing,
        reason: [...new Set(why)].join('; ') })
    }
  }
  return { guides, withheld, notReproduced }
}

/** The member's sentence for a level drawn in the neutral presentation. */
export function hlineNotReproducedNote(n) {
  return `\`${n.title}\`: style not reproduced: ${n.reason}. The level is drawn at its exact price, in the chart's `
    + 'text colour, solid and 1 px wide, rather than in a style the script does not choose.'
}

/** The member's sentence for a level the document does not draw. */
export function hlineWithheldNote(w) {
  return `\`${w.title}\` is not drawn: ${w.reason}.`
}

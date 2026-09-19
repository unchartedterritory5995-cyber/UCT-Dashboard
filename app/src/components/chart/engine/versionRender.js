// app/src/components/chart/engine/versionRender.js
//
// ─── R0.3 — THE RENDERER IS VERSION-DEPENDENT, NOT JUST THE PARSER ──────────
//
// ⛔⛔ THIS IS THE PART THAT IS EASY TO UNDER-PLAN. Six Pine dialects are live at
// once — no version was ever sunset and there is no v7 — and the same source text
// DRAWS DIFFERENTLY depending on its `//@version=` tag. Not "parses differently":
// draws differently. Three examples, all documented, all silent:
//
//   · `color.red` is `#FF5252` in v5 and `#F23645` in v6. Same identifier, same
//     script, different pixels.
//   · `label.new()`'s default text colour flipped from BLACK to WHITE at v6, so a
//     v5 script rendered under v6 rules has invisible labels on a dark chart.
//   · `bgcolor()` and `fill()` applied an implicit transparency of 90 up to v4 and
//     stopped at v5. Identical code, wildly different opacity.
//
// A renderer that ignores the tag is not "mostly right" — it is confidently wrong
// on a whole dialect, and the failure looks like a styling bug rather than a
// version bug, which is why it survives review.
//
// ─── WHAT THIS MODULE IS AND IS NOT ─────────────────────────────────────────
//
// It answers "what does this construct LOOK like at version V". It does not own
// how many objects may exist — that is `objectPool.js`, which already holds the
// version each drawing type arrived in — and the tests assert the two agree
// rather than restating the table here.
//
// Provenance: docs/pine/pine-presentation-spec.md §4.2.5 (the 17-colour table,
// hexes verified against TradingView's own reference payload) and
// docs/pine/pine-version-evolution.md rows 27, 49, 50, 63.

export const MIN_VERSION = 1
export const MAX_VERSION = 6

/**
 * The 17 `color.*` constants, at the CURRENT (v6) values.
 *
 * ⚠️ `color.blue` is `#2962ff`, lowercase, and it is `#2962ff` — NOT the
 * `#2196F3` (Material Blue 500) that appears in the user manual's prose table.
 * Both the v5 and v6 payloads carry `#2962ff`. The payload's lowercase hex for
 * this one constant is why every comparison here is case-insensitive.
 */
export const COLOR_V6 = Object.freeze({
  aqua: '#00BCD4', black: '#363A45', blue: '#2962ff', fuchsia: '#E040FB',
  gray: '#787B86', green: '#4CAF50', lime: '#00E676', maroon: '#880E4F',
  navy: '#311B92', olive: '#808000', orange: '#FF9800', purple: '#9C27B0',
  red: '#F23645', silver: '#B2B5BE', teal: '#089981', white: '#FFFFFF',
  yellow: '#FDD835',
})

/**
 * ⭐ THE THREE CONSTANTS THAT CHANGED VALUE AT v6, and only these three.
 *
 * Values here are the **pre-v6** hexes. Everything else in `COLOR_V6` is stable
 * across every version that had `color.*` at all.
 *
 * ⚠️ v1–v3 spell these as BARE IDENTIFIERS (`red`, not `color.red`) — the move to
 * the `color.*` namespace happened at v4. That is a parser concern; the pixels are
 * the same, so this table is keyed on the colour name and the caller resolves the
 * spelling.
 */
export const COLOR_PRE_V6 = Object.freeze({
  red: '#FF5252',
  teal: '#00897B',
  yellow: '#FFEB3B',
})

/** The version each renderer-affecting change landed in. Keyed by the evolution
 *  doc's own row numbers so the two can be diffed rather than compared by eye. */
export const RENDER_CHANGES = Object.freeze({
  row27: Object.freeze({ since: 5, what: 'bgcolor()/fill() implicit transparency 90 no longer applied' }),
  row49: Object.freeze({ since: 6, what: 'color.red, color.teal and color.yellow changed value' }),
  row50: Object.freeze({ since: 6, what: 'label.new() default text colour black -> white' }),
  row63: Object.freeze({ since: 6, what: 'linewidth minimum is 1; below that is a compilation error' }),
})

function requireVersion(v) {
  if (!Number.isInteger(v) || v < MIN_VERSION || v > MAX_VERSION) {
    throw new Error(`unsupported Pine version: ${v} (v${MIN_VERSION}-v${MAX_VERSION} are live; there is no v7)`)
  }
  return v
}

/**
 * A `color.*` constant's hex at a given version.
 *
 * @param {string} name  e.g. 'red' — without the `color.` prefix
 * @param {number} pineVersion
 * @returns {string} a `#rrggbb` hex
 */
export function colorConstant(name, pineVersion) {
  const v = requireVersion(pineVersion)
  // ⚠️ LOWERCASE FIRST, THEN STRIP. Stripping with a case-sensitive `^color\.`
  // before lowercasing leaves `COLOR.BLUE` as `color.blue` — a key that does not
  // exist — so a perfectly valid uppercase spelling throws "unknown constant".
  const key = String(name || '').toLowerCase().replace(/^color\./, '')
  if (!(key in COLOR_V6)) throw new Error(`unknown colour constant: color.${key}`)
  if (v < RENDER_CHANGES.row49.since && key in COLOR_PRE_V6) return COLOR_PRE_V6[key]
  return COLOR_V6[key]
}

/**
 * `label.new()`'s default text colour.
 *
 * ⛔ THIS ONE IS INVISIBLE WHEN WRONG, WHICH IS WHY IT MATTERS. A v5 script whose
 * labels are rendered with v6's default draws white text — on TradingView's light
 * default chart that is a blank label, and the script looks like it silently
 * stopped emitting them.
 */
export function labelDefaultTextColor(pineVersion) {
  return requireVersion(pineVersion) >= RENDER_CHANGES.row50.since ? '#FFFFFF' : '#000000'
}

/**
 * The implicit transparency `bgcolor()` and `fill()` add to a colour that does
 * not carry its own alpha.
 *
 * Up to v4: **90**. From v5: **0** — transparency has to be carried in the colour
 * via `color.new()` / `color.rgb()`.
 *
 * ⚠️ This is a straight alpha-compositing difference between v4 and v5 for
 * IDENTICAL code, and it is the highest-value version regression test we have: a
 * v4 script rendered under v5 rules paints its background at full opacity and
 * hides the chart underneath it.
 *
 * @param {'bgcolor'|'fill'} fn
 * @param {number} pineVersion
 * @returns {number} 0-100
 */
export function implicitTransparency(fn, pineVersion) {
  const v = requireVersion(pineVersion)
  if (fn !== 'bgcolor' && fn !== 'fill') {
    throw new Error(`implicit transparency applies to bgcolor and fill only, not ${fn}`)
  }
  return v < RENDER_CHANGES.row27.since ? 90 : 0
}

/**
 * What a `linewidth` argument actually draws.
 *
 * v6 rejects `linewidth < 1` at compile time, so a v6 script cannot ask for 0.
 * Older scripts DO carry `linewidth = 0` and must keep rendering as they did.
 *
 * ⚠️ UNVERIFIED — WHAT v≤5 ACTUALLY DREW FOR `linewidth = 0`. The evolution doc
 * records that the minimum became 1 at v6; it does not say whether v5 drew a
 * hairline, drew nothing, or clamped. We clamp to 1 and FLAG it, because the two
 * plausible readings (hairline vs invisible) are visually opposite and guessing
 * between them silently is worse than carrying the debt. `flagged` is the caller's
 * cue to record it, not to hide it.
 *
 * @returns {{width: number, flagged: null|string}}
 */
export function resolveLinewidth(width, pineVersion) {
  const v = requireVersion(pineVersion)
  const n = Number(width)
  if (!Number.isFinite(n)) return { width: 1, flagged: `linewidth ${width} is not a number` }
  if (n >= 1) return { width: Math.trunc(n), flagged: null }
  if (v >= RENDER_CHANGES.row63.since) {
    // v6 rejects this at compile time, so reaching here means our own parser let
    // it through — say so rather than quietly drawing something.
    return { width: 1, flagged: `linewidth ${n} is a compilation error in v${v}; our parser admitted it` }
  }
  return {
    width: 1,
    flagged: `UNVERIFIED: what v${v} drew for linewidth ${n} is not documented (hairline vs nothing); clamped to 1`,
  }
}

/**
 * Are colour constants spelled `color.red` or bare `red` at this version?
 * The namespace arrived at v4 (evolution row 5). Pixels are identical either way.
 */
export function colorSpelling(pineVersion) {
  return requireVersion(pineVersion) >= 4 ? 'namespaced' : 'bare'
}

/**
 * Every version-keyed rendering default in one call, for a script's tag.
 *
 * ⭐ ONE CALL SITE PER SCRIPT, NOT ONE PER PRIMITIVE. Threading a version through
 * every draw path is how half of them end up defaulting to 6 — which is silently
 * correct for the newest dialect and silently wrong for the other five.
 */
export function renderDefaults(pineVersion) {
  const v = requireVersion(pineVersion)
  return {
    pineVersion: v,
    colors: Object.fromEntries(Object.keys(COLOR_V6).map((k) => [k, colorConstant(k, v)])),
    colorSpelling: colorSpelling(v),
    labelTextColor: labelDefaultTextColor(v),
    implicitTransparency: {
      bgcolor: implicitTransparency('bgcolor', v),
      fill: implicitTransparency('fill', v),
    },
    linewidthMinimum: v >= RENDER_CHANGES.row63.since ? 1 : 0,
  }
}

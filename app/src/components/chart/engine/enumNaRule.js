// app/src/components/chart/engine/enumNaRule.js
//
// ⛔⛔ HONESTY-SWEEP item 1 (2026-11-07) — ONE SENTENCE, TWO LANES.
//
// An enum slot of a drawing (`style`, `size`, `position`, `text_halign`, `xloc`, …)
// whose value is `na`: an `if` with no `else`, a `switch` with no default arm,
// `c ? line.style_dashed : na`, or `na` itself. The Pine reference states only the
// named constants for these slots (e.g. `line.new`'s `style`: "Possible values:
// line.style_solid, line.style_dotted, …"); what TradingView draws for `na` there is
// neither stated nor captured. Both drawing lanes WITHHOLD such a drawing by this
// name until capture Q-HS1 (`tools/visual_conformance/probes/vw-hs1-enum-na.pine`)
// says what TradingView draws:
//   · the host object program (`ast/pine.js`, drop reason `enum:na`);
//   · the runtime lane's own drawings (`runtime/objectStore.js`, the family withheld).
// Before this, both drew it with the renderer's own default (a solid line).
export const ENUM_NA_SENTENCE = 'the style, size or position of this drawing can be `na` (an `if` with no '
  + '`else`, a `switch` with no default arm, or `na` itself); the Pine reference lists only the named '
  + 'constants there, and what TradingView draws for `na` is not yet captured (Q-HS1)'

// ⛔⛔ HONESTY-SWEEP r1 (review N1) — a helper that computes the enum, called with a NAMED
// argument (`style = st(m = mode)`). The host object program does not inline that call, and it
// used to DROP the prop, so the renderer drew its default (a solid line). The Pine REFERENCE states
// no default for `line.new`'s `style`; `line.style_solid` is the User Manual's (`[UM]`), per
// `docs/pine/pine-presentation-spec.md` section 4.4.1 ("Provenance note, verified against the
// payload"). Any documented default is the value of an OMITTED argument, never of a value the
// script passed and this door could not read: withheld, capture row Q-HS7
// (`tools/visual_conformance/probes/vw-hs7-enum-named-call.pine`).
export const ENUM_NAMED_CALL_SENTENCE = 'the style, size or position of this drawing is computed by a helper '
  + 'called with a named argument, which this door does not read; a documented default applies only '
  + 'when the argument is omitted, so the drawing is withheld rather than drawn with a default (Q-HS7)'

// ⛔⛔ ENGINE 51 — an enum slot whose value this door cannot read at all: a constant the
// vocabulary does not hold (`objectEnums.js`), or a computed word the reader cannot follow.
// It used to DROP the prop, so the renderer drew its default (a table in the wrong corner, a
// cell at the wrong size: ict-killzones-pivots-tfo before engine 51). Withheld by name.
export const ENUM_UNREADABLE_SENTENCE = 'the style, size or position of this drawing is a value this door '
  + 'cannot read (a constant it does not know, or a computation it cannot follow); the drawing is '
  + 'withheld rather than drawn with a default style, size or position'

/** The three ways an enum slot withholds its drawing — guard, drop reason, sentence — ONE table,
 *  read by every converter in `ast/pine.js` (create, setter, cell). */
export const ENUM_DROPS = Object.freeze({
  na: Object.freeze({ guard: 'pine:enum-na', drop: 'enum:na', sentence: ENUM_NA_SENTENCE }),
  named: Object.freeze({ guard: 'pine:enum-named-call', drop: 'enum:named-call', sentence: ENUM_NAMED_CALL_SENTENCE }),
  unreadable: Object.freeze({ guard: 'pine:enum-unreadable', drop: 'enum:unreadable', sentence: ENUM_UNREADABLE_SENTENCE }),
})

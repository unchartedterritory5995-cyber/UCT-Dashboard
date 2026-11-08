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

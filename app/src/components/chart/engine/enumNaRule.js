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

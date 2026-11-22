# Capture queue: HONESTY-SWEEP, behaviour master served unbacked (2026-11-07)

Branch `fix/pine-honesty-sweep-2026-11-07`. Source: PR #938's "Unbacked served behaviour" list (W34-I6b N2,
W34-I6c N2, W6-T7 N1, W6-T8 N2, W6-T9 N3, W34-I6a N2). Evidence: `docs/pine/evidence/2026-11-07-honesty-sweep/EVIDENCE.md`.
Rails: `app/src/components/chart/engine/runtime/__tests__/honestySweep.test.js`.
Procedure: `docs/pine/capture-queue-2026-09-28.md`. The owner runs every capture; no builder opens TradingView.
The probes were not compiled on TradingView when they were written. A runtime or compile error is itself a reading:
record its text and the line or bar it names, comment that row out, and capture the rest.

Each row below is REFUSED BY NAME today on every lane that served it; the capture turns the refusal into a
served value (or confirms the refusal is Pine's own error).

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| Q-HS1 | `tools/visual_conformance/probes/vw-hs1-enum-na.pine` rows L01-L05, B01, T01, S01 | AMEX:SPY 1D | what TradingView draws for a drawing whose `style` / `size` / `text_size` is `na` (`na` itself, an `na` ternary arm, a default-less `switch` that misses, an `if` with no `else`), and `line.set_style(l, na)` | the host object program withholds the drawing (drop reason `enum:na`, `ENUM_NA_SENTENCE`); the runtime lane's store withholds the family by the same sentence. A default-less switch whose arms cover every `options` value of an `input.string` cannot miss and is served |
| Q-HS2 | `tools/visual_conformance/probes/vw-hs2-v3-highestbars.pine` rows P01-P04 (and its v2 / v1 variants) | AMEX:SPY 1D | the sign of a v1-v3 bare `highestbars` / `lowestbars` offset | `pine:builtin` / `runtime:statement` with `LEGACY_BARS_SIGN_SENTENCE` (v4 and later unchanged; no `//@version` is the formula box, unchanged) |
| Q-HS3 | `tools/visual_conformance/probes/vw-hs3-matrix-degenerate.pine` rows R01, C01, F01, F02 | AMEX:SPY 1D | a zero-length `matrix.row` of a k×0 matrix, `matrix.col` of a 0×k one, and `matrix.fill` of an empty area (the twins of W6-M1 D01-D04 and E09-E10) | each stops the run by name (`… (W6-M1)`) on the runtime pane; the object door refuses the matrix family as before |
| Q-HS4 | `tools/visual_conformance/probes/vw-hs4-map-color-key.pine` rows K01-K04 | AMEX:SPY 1D | when two colours are the same map key (transparency, `color.rgb` against a named colour) | `map.new<color, …>` stops the run by name (`… (Q-HS4)`) on the runtime pane |
| Q-HS5 | `tools/visual_conformance/probes/vw-hs5-int-array-float-param.pine` rows A01-A05 | AMEX:SPY 1D | whether Pine compiles an `array<int>` / `matrix<int>` / `map<string, int>` handed to a parameter declared with `float` elements (a function, a method, the method's name form) | `runtime:function` / `runtime:udt-method` "… (Q-HS5)" when both number words are written; an untyped initialiser (`array.new_int(0)` with no declared type) keeps its binding |
| Q-HS6 | `tools/visual_conformance/probes/vw-hs6-wrap-comment.pine` rows W01-W03 | AMEX:SPY 1D | whether a wrapped line continues across a comment-only line (a `switch` arm, and an ordinary expression) | a wrapped `switch` arm across a comment-only line refuses `runtime:block-value` "… (Q-HS6)" on the runtime pane; the ordinary-expression wrap (W03) is the shared lexer's reading on every lane and is unchanged (recorded, not refused here) |
| Q-HS7 | `tools/visual_conformance/probes/vw-hs7-enum-named-call.pine` rows N01-N04 (r1, review N1) | AMEX:SPY 1D | what a line draws when a helper computing its `style` is called with a NAMED argument (`st(m = pick)`), with and without a default arm | the host object program withholds the drawing (drop reason `enum:named-call`, `ENUM_NAMED_CALL_SENTENCE`); it used to drop the prop and draw the renderer's default (solid). The Pine reference states no `line.new` `style` default; `line.style_solid` is the User Manual's (`[UM]`, `docs/pine/pine-presentation-spec.md` section 4.4.1 provenance note), and either way it is an omitted argument's value. The runtime lane runs the helper and is unchanged |

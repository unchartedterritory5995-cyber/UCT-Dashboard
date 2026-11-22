# Capture queue: 2026-11-19, the version island's one boundary (a v5 library's `na` bool read by v6 code)

Same procedure as `docs/pine/capture-queue-2026-09-28.md`. Capture on NYSE:RDDT 1D from the listing, and keep
the plotted values as full float64 text.

The version island (design `LIBRARY-VERSION-ISLAND-DESIGN`, coordinator ruling 2026-11-19) judges a v5 library's
code under v5 rules inside a v6 script, as LB1 showed TradingView does. Values cross a call unchanged, with one
exception no source settles. A Pine v5 `bool` can be `na` (a comparison with an `na` operand is `na`); a Pine v6
`bool` never is ("Boolean values cannot be na", the "To Pine Script version 6" migration guide). So when a v5
library function hands its result to v6 code, the v6 caller receives either `false` or the `na` kept. Neither the
Pine v6 reference (`import`, `library`, `export`), the User Manual's Libraries page nor the migration guide says
which.

Until this row is captured, the engine refuses that call BY NAME on both lanes (`pine:library-version`, "hands
this v6 script a ... that can be `na` in Pine v5 ... (LV6)"): `pineRuntimeFrontend.js::islandNaBoolResult` at the
run's own call, `pine.js::islandBoolMayBeNa` where the columnar resolver inlines it. `and` / `or` / `not` results
are never `na` at v5 (F2, Q-NL) and cross today.

Island PR 2 (bool `na` judged per token inside the island) refuses the same question when the bool travels in a
collection or record: one the v5 function hands back, an element or field read out of one, or one the v6 script shares
with it as an argument (`islandNaBoolResult`, the same LV6 sentence). Row LV6b asks it.

| row | probe | symbol / tf | what it settles |
|---|---|---|---|
| LV6 | a v6 script importing a published v5 library (MPL-2.0, imported, never copied) whose export returns a comparison with an operand that is `na` on the first bars (`x > ta.sma(x, 20)`) | NYSE:RDDT 1D | Plot `lib.f(close) ? 1 : 0` and `na(lib.f(close)) ? 1 : 0`, and `lib.f(close) == false ? 1 : 0`. On the bars where the comparison is `na` at v5: `false` crossing reads 0, 0, 1; `na` kept reads 0, 1, and the third shows how a v6 comparison treats it. |
| LV6b | the same v6 script, importing a published v5 library whose export pushes `x > ta.sma(x, 20)` into an `array<bool>` the script passes in, and another whose export returns `map.get` of a `map<string, bool>` for a missing key | NYSE:RDDT 1D | Plot `array.get(a, 0) ? 1 : 0` and `na(array.get(a, 0)) ? 1 : 0` on the warm-up bars, and `lib.g() ? 1 : 0` / `na(lib.g()) ? 1 : 0` for the map: whether a v5 `na` bool held in a collection reaches v6 code as `false` or as `na`. |

When LV6 is graded, the refusal is lifted for the answer it shows (`false`: the run reads the `na` as `false` at
the call; `na` kept: the value crosses as it is), with a rail that the v6 caller draws TradingView's three rows.

# Capture queue: 2026-11-06, W6 collections (T5 `array.*`)

Branch `feat/pine-w6-t5-arrays`. Spec: `docs/pine/W6-BREAKDOWN.md` (branch `docs/pine-w6-breakdown`), T5 and section 6.
This is the one W6 queue doc the breakdown names; later W6 tasks (W6-F1, W6-M1, W6-K1, W6-U1, W6-E1) add their rows here.
Procedure: `docs/pine/capture-queue-2026-09-28.md`. The owner runs every capture; no builder opens TradingView.
The probes were not compiled on TradingView when they were written. A runtime error is itself a reading: record its
text and the bar it names, comment that row out, and capture the rest.

## Authorities the T5 rows rest on

- Pine user manual, *Arrays* page (`https://www.tradingview.com/pine-script-docs/language/arrays/`), read 2026-10-04 by
  W19-R2 (`capture-queue-2026-10-05-w19-r2.md` on `pine/w19-r2-collections-drawings`, never merged; its Q-W19R2a/b rows
  and probe are ported here by W6-T5). It settles `array.fill` with an exclusive `index_to` (its example
  `a.fill(close, 1, 3)` fills indices 1 and 2) and `array.insert` at `0 <= index < size`.
- Pine v6 reference (`https://www.tradingview.com/pine-script-reference/v6/`), read 2026-11-06 through
  `tools/pine_survey/pine_reference_extract.js`. Each served member's rail in
  `app/src/components/chart/engine/runtime/__tests__/w6ArrayMembers.test.js` cites the entry it rests on.

What W6-T5 serves (`runtime/collections.js` `W19R2_MEMBERS`, `W6T5_MEMBERS`): `fill`, `insert` (as above), `reverse`,
`lastindexof`, `range` (max minus min over the real elements), `abs`, `join` (text elements, an explicit separator),
`variance` / `stdev` / `covariance` (`biased` default true, the population form), `median`, `percentile_nearest_rank`
(0 < p <= 100), `sort` over real numbers, and v6 `every` / `some`. Everything below stops the run by name until its row
is captured. All of it is the runtime pane only: the C18 object door keeps master's answer.

## W6-K1: the `map.*` rules the reference and the manual do not state (W6-T8)

Branch `feat/pine-w6-t8-map`. Authorities: the Pine v6 reference entries `map.new<type,type>` and siblings, read
2026-11-06 through `tools/pine_survey/pine_reference_extract.js`, and the Pine user manual *Maps* page
(`https://www.tradingview.com/pine-script-docs/language/maps/`, read 2026-11-06). Each served member's rail in
`app/src/components/chart/engine/runtime/__tests__/w6Map.test.js` quotes the sentence it rests on.
What W6-T8 serves (`runtime/maps.js`, in `collections.js`'s one table): `new` (keys int, float, bool, string, color),
`put` (the previous value, or `na` for a new key), `get` (the value, or `na` for a missing key: the manual), `contains`,
`remove` (the removed value, or `na`), `size`, `keys` / `values` (new arrays in insertion order), `copy` (shallow),
`clear`, `put_all` (`id2`'s insertion order; a shared key keeps its place: the manual), and the method form. A re-put of
a present key keeps its place (the reference: "the order does not change"); a key removed and then put again is a new
key, at the end (the reference calls it new; the manual names removal as "the only exception"). A map holds at most
50,000 pairs (the manual); the 50,001st stops by name. Runtime pane only: the C18 object door refuses the whole family
as master did. `for [k, v] in` a map stays refused (W6-F1, T6).

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| W6-K1 | `tools/visual_conformance/probes/vw-w6-map.pine` rows K01-K10 (confirming), then N01-N04 one at a time | AMEX:SPY 1D | CONFIRM: `keys()` insertion order, after a re-put of a present key, after `remove` then `put`, after `put_all`; `put` / `get` / `remove` answers for new, present and missing keys. ASK: an `na` key in a `map<float, …>` on `put` (and the size after), `get`, `contains`, `remove`; N05 (review B1): a v6 `map<string, bool>` `get` of a missing key, a READ `put` of a new key, a READ `remove` of a missing key (the manual says na, a v6 bool is never na: `false`, or a runtime error?) | K01-K10 are served as above; an `na` key stops the run by name (`… with an \`na\` key (W6-K1)`, guard `runtime:CollectionError`); so does N05 on a v6 bool-valued map (`` `map.get` answers `na` for a missing key, and a v6 `map<string, bool>` value cannot be `na` … (W6-K1)``; a statement `put` / `remove` drops its answer and is served; v5 answers na); an enum key waits for W6-T10. Moves `supply-demand-mtf-flux-charts`, `support-resistance-mtf-flux-charts`, `divergence-screener-trendoscope` (the last also needs W6-T10: its keys are an enum) |

## Q-W19R2a: `array.insert` / `array.fill` at the indices the manual does not settle (ported from W19-R2)

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| Q-W19R2a | `tools/visual_conformance/probes/vw-w19r2-collections.pine` rows I01-I03, F01-F02 | NYSE:RDDT 1D from the listing | `insert` at `size` (an append, or the out-of-range stop?), `insert` at 0 into an EMPTY array, v6 `insert(a, -1, x)` (before the last element, or after it?), a `fill` range past the end, a negative `fill` start | each stops the run by name (`array.insert: index … Q-W19R2a`, `array.fill: the range … Q-W19R2a`), guard `runtime:array`. Reached by `initial-balance-…`, `session-tpo-profile`, `auto-trendlines-tradingfinder-…` (`insert(…, 0, …)` into arrays that start empty), `bollinger-band-width-percentile` (inserts at the upper bound, which can equal `size`) |

## Q-W19R2b: the three binary searches (ported from W19-R2)

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| Q-W19R2b | `tools/visual_conformance/probes/vw-w19r2-collections.pine` rows B01-B05, L01-L05, R01-R05, E01-E03 | NYSE:RDDT 1D from the listing | over `(1, 3, 3, 3, 7)`: a value present three times (3), below all (0), between (5), above all (9), the last (7); and an EMPTY array | refused at build, `runtime:array` (`array.binary_search`, `array.binary_search_leftmost`, `array.binary_search_rightmost`). Unblocks `bollinger-band-width-percentile`, `rsi-kernel-optimized-flux-charts` |

## W6-A1: the conventions the v6 reference does not state

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| W6-A1 | `tools/visual_conformance/probes/vw-w6-array-members.pine` rows S01-S04, T01-T08, P01-P06, Z01, R01, J01-J04, M01, N01-N08, U01-U02, E01-E03, V01-V03, Q01-Q02, L01, H01-H02, I01-I04 | AMEX:SPY 1D | where `array.sort` puts `na` (both orders); `array.sort` / `sort_indices` on text with mixed case and non-ASCII; `percentile_linear_interpolation` at 25/50/90 over an even and an odd count; `standardize` over `(1, 2, 3, 4)` (biased or unbiased); `percentrank` with ties; `join` of floats and ints, and with no separator; `mode` ties; `variance` / `stdev` / `median` / `percentrank` / `percentile_nearest_rank` / `abs` / `every` with an `na` element; `new_bool(3)` / `new_string(3)` fill read; `every` / `some` of an empty array; an unbiased estimate over one element; `covariance` of different sizes; `percentile_nearest_rank` at 0 and 101; `lastindexof(a, na)`; `median` over an EVEN count (no rule in the entry); `median` / `stdev` / `variance` / `avg` over `array<int>` (each entry gives a `series int` form; how the fraction becomes an int is unstated) | each stops the run by name (`… (W6-A1)`, guard `runtime:CollectionError`) or, for `percentile_linear_interpolation`, `standardize`, `percentrank` and `mode`, is refused at build (`runtime:array`). Unblocks `machine-learning-moving-average-backquant`, `footprint`, `supertrend-relative-volume-kernel-optimized-flux-charts` |

Review B1 (r1): `median` over an even count, and `median` / `stdev` / `variance` over an array the run cannot prove is
float (no fractional element), now stop by name until H01-H02 / I01-I03 are captured. `array.avg` has the same
`array<int>` -> `series int` form; it is a master member (measured on floats, RT7) served at the live C18 door, so W6-T5
does not change it; I04 measures it for the coordinator.

Note for the reviewer: `array.mode`'s reference entry does state a tie rule ("it returns the smallest value"); the
breakdown keeps it refused until W6-A1 (review B3), so M01 confirms the sentence before it is served.
`array.sort_indices` on text, and its `na` ordering, are served on master (a pre-W6 choice: JavaScript string order,
`na` sinks); T01-T08 and S03-S04 measure them, and W6-T5 does not change them (it would move the live C18 door).

## W6-M1: the `matrix.*` conventions the v6 reference does not state (W6-T7)

Branch `feat/pine-w6-t7-matrix`. Authority: the Pine v6 reference entries `matrix.new<type>` and siblings, read 2026-11-06
through `tools/pine_survey/pine_reference_extract.js`; each served member's rail in
`app/src/components/chart/engine/runtime/__tests__/w6Matrix.test.js` quotes the sentence it rests on.
What W6-T7 serves (`runtime/matrices.js`, in `collections.js`'s one table): `new` (defaults 0 rows, 0 columns, `na` for
float/int), `get`, `set`, `rows`, `columns`, `elements_count`, `row` / `col` (new arrays), `add_row` / `add_col` (index 0 to
size, array of the stated size, default `na` line), `remove_row` / `remove_col` (an explicit index), `fill` / `submatrix`
(ends exclusive, stated defaults), `copy`, `min` / `max` / `avg` (real cells; `avg` of a possibly-int matrix only when the
mean is whole), `sum` (a matrix plus a scalar or a same-size matrix). The linear-algebra members and the rest of the family
stay refused at build (`runtime:array`). Runtime pane only: the C18 object door refuses the whole family as master did.

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| W6-M1 | `tools/visual_conformance/probes/vw-w6-matrix-members.pine` rows V01-V04, S01-S02, A01-A04, R01-R04, B01, D01-D04, then E01-E08 one at a time | AMEX:SPY 1D | `min` / `max` / `avg` over an `na` cell; `avg` of `matrix<int>` (1, 2) (the `series int` form); `matrix<int>` 2 + 0.5; `na` + 1 in `sum`; `add_row` of 5 into a 0x3 matrix (is it "empty"?); the default `add_row` on 0x0; rows / columns after removing the last row or column; `matrix.new<bool>(1, 1)`'s fill; (review N1) the degenerate shapes: the default `add_row` on a 2x0 matrix, the default `add_col` on a 0x3 one, `submatrix` with an empty row range and with an empty column range (shape after, or an error); and the error text (or value) for `matrix.new` with `na` rows, `get` at `rows` and at -1, `add_row` of the wrong length, `remove_row` with no index (its stated default is `matrix.rows()`), `min` of an empty matrix, `sum` of two sizes, `fill` with an `na` end | each stops the run by name (`… (W6-M1)`, guard `runtime:CollectionError`). Unblocks `candlestick-patterns-on-backtest` (`matrix.new<float>(na, n, na)`) |

## W6-U1: receiver types (W6-T9)

Branch `feat/pine-w6-t9-receivers`. Authority: the Pine manual, *Methods* and *Objects*, read 2026-11-06 (quoted in
`app/src/components/chart/engine/runtime/__tests__/w6ReceiverTypes.test.js`). W6-T9 serves overloads chosen by a
receiver type this lane can tell apart, chains, members on typed receivers and a record's shallow `copy`, on the runtime
pane only; the C18 object door keeps master's answer. The rows below stay refused by name until captured.

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| W6-U1 | `tools/visual_conformance/probes/vw-w6-receivers.pine` rows U01-U09 | AMEX:SPY 1D | U01-U02 two overloads by receiver type (confirms what is served); U03-U04 a user `get(array<float>, int)` beside the built-in, on `array<float>` and on `array<int>` (which one Pine runs, and whether the `array<int>` call compiles); U05 a chain off an element (confirms); U06 `copy` aliasing (confirms the shallow copy); U07 a field read off an `na` record (the runtime error's text and bar); U08 overloads on `array<float>` / `array<string>` called on an `array<int>` (does an `array<int>` receiver convert to `array<float>` in overload choice, or not compile?); U09 overloads `m(float)` / `m(string)` on an `int` | U03-U04: `runtime:udt-method` "... AND a built-in member ... (W6-U1)" on every shape W6-T9 adds (master's single-declaration binding on a slot is unchanged); U07: stops by name ("is `na` - Pine stops the script here"); U08-U09: `runtime:udt-method` "... this lane has one number type (W6-U1)" (review N2: this lane cannot tell an `int` receiver from a `float` one, so no overload whose receiver holds numbers is chosen). Reached by `fx-market-sessions` (`clear` on `array<float>`), `ipda-standard-deviations-...` |

## W6-E1: enum value and text rules (W6-T10, branch `feat/pine-w6-t10-enum`)

Authorities read 2026-11-06: Pine manual *Enums* (`https://www.tradingview.com/pine-script-docs/language/enums/`) and the
v6 reference entries for the keyword `enum` and `input.enum` (through `tools/pine_survey/pine_reference_extract.js`).
They state the served shapes (rail `app/src/components/chart/engine/runtime/__tests__/w6Enum.test.js`): fields with an
optional `const string` title (a missing title is the field's name), each field a unique member, `E.field` bound,
compared with `==` / `!=`, used in `switch`; `input.enum(defval, ...)` with an `options` tuple that must hold `defval`.
The manual also says `str.tostring()` returns a field's title and that an enum variable accepts `na`; the breakdown
keeps both refused until this row is read, so the sentences are confirmed before they serve.

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| W6-E1 | `tools/visual_conformance/probes/vw-w6-enum.pine` rows T01-T03, E01, N01-N04, I01, K01 | AMEX:SPY 1D | `str.tostring` of a titled field, an untitled field, and two fields sharing a title (title or name?); two same-title fields compared with `==`; an `na` enum value: `na(m)`, `m == E.a`, the arm a `switch` on it takes, `str.tostring(m)`; `input.enum` at its default; an enum as a `map` key | `str.tostring(e)`, every `na` enum shape and a member-set `input.enum` stop at build by name (`runtime:enum`, "... kept refused until capture W6-E1"); the `input.enum` default serves; a `map` key refuses by name (`runtime:enum`, an enum as a call argument; `map.*` is T8's). No census script reaches an enum today (breakdown section 0, finding 5) |

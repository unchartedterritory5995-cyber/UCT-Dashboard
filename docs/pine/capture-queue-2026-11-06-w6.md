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

# Capture queue: the FORM and SIZE of Pine's comparison tolerance (2026-11-18)

Filed for coordinator patrick-2b by the tolerant-compare engine work (`feat/pine-tolerant-compare`), after Q-FCMP
([`capture-queue-2026-11-18-float-compare.md`](capture-queue-2026-11-18-float-compare.md), run `fcmp-2026-11-18`)
ruled TOLERANCE. No engine change is built until these captures rule.

## Why

Q-FCMP's readings (AMEX:SPY 1D from the listing and NYSE:RDDT 1D, graded at engine 76): `(0.1 + 0.2) == 0.3` is 1 and
`(0.1 + 0.2) > 0.3` is 0; `1.0 + 3e-14 == 1.0` is 1; on SPY bars 5,333 and 5,453 the DMI's up and down moves differ by
2.842e-14 (TradingView's own raw doubles, F08-F10) and `up == down` is 1, `up > down` 0, `up < down` 0. The smallest
nonzero difference that compared NOT equal on SPY was 2.0e-05. Those readings bound the tolerance but do not fix its
form: an absolute epsilon, a relative one, an ulp count and a rounding all fit them.

What TradingView documents, read 2026-11-18 from each reference's own data (`tools/pine_survey/pine_reference_extract.js
--version 6`, `5`, `4`):

- v6, `==` and `!=`, remarks: "This operator rounds "float" operands to nine fractional digits."
- v6, `<`, `<=`, `>`, `>=`: no remark. Yet Q-FCMP's F05 / F06 show `>` and `<` tolerant on the tie bar.
- v5 and v4: no remark on any comparison operator. adx-and-di-for-v4, the script Q-FCMP was about, is a v4 script.
- The v6 `ta.stdev` example spells TradingView's own summation with `EPS = 1e-10` and `isZero(val, eps) => math.abs(val)
  <= eps`: an epsilon form exists in TradingView's own code, so the form is measured here, not assumed.
- The User Manual's operators page and the variables-and-operators FAQ state no comparison tolerance.

The engine change needs, exactly: the form (rounding to 9 fractional digits, or an epsilon), how a half-way value
rounds, whether `<` `<=` `>` `>=` use the same rule as `==` `!=`, whether an int operand is affected, what an `na`
operand gives, whether the rule is absolute across magnitudes 1e-12 to 1e9, whether v4 and v6 agree, and which
built-ins compare with it inside.

## The request

| id | probe | chart | what to record | unblocks |
|---|---|---|---|---|
| Q-FCMP2-1 | `tools/visual_conformance/probes/vw-fcmp-form.pine` | AMEX:SPY 1D | from the listing (`history.startsAtBar0` asserted); every plot on every bar | the form, the half-way rule, the operators, int, na |
| Q-FCMP2-2 | `tools/visual_conformance/probes/vw-fcmp-form-v4.pine` | AMEX:SPY 1D | from the listing; every plot on every bar | whether v4 runs the same rule (adx-and-di-for-v4) |
| Q-FCMP2-3 | `tools/visual_conformance/probes/vw-fcmp-magnitude.pine` | AMEX:SPY 1D | from the listing; every plot on every bar (bar 5,333 is the tie bar) | absolute vs relative, 1e-12 to 1e9 |
| Q-FCMP2-4 | `tools/visual_conformance/probes/vw-fcmp-builtins.pine` | AMEX:SPY 1D | from the listing; every plot on every bar | which built-ins compare tolerantly inside |
| Q-FCMP2-5 | `tools/visual_conformance/probes/vw-fcmp-form.pine` | NYSE:RDDT 1D | from the listing; every plot on every bar | the same rows on a second symbol |
| Q-FCMP2-6 | `tools/visual_conformance/probes/vw-fcmp-form-v4.pine` | NYSE:RDDT 1D | from the listing; every plot on every bar | the same |
| Q-FCMP2-7 | `tools/visual_conformance/probes/vw-fcmp-magnitude.pine` | NYSE:RDDT 1D | from the listing; every plot on every bar | the same |
| Q-FCMP2-8 | `tools/visual_conformance/probes/vw-fcmp-builtins.pine` | NYSE:RDDT 1D | from the listing; every plot on every bar | the same |

Inputs at defaults (no probe has an input). A line that does not compile is a reading: record the error text and
the line. Rows 1-4 first: the literal rows (every T row, M01-M31) read the same on every bar of every symbol, so SPY
alone rules them; RDDT is the second-symbol control.

### Built probes (record each sha256 with its capture)

| probe | plots | sha256 |
|---|---:|---|
| `vw-fcmp-form.pine` | 51 | `666aef94fde54f7e6bb1ce93e97d67feec8d2c7a47faa8e24c9ffd0cd7db5edd` |
| `vw-fcmp-form-v4.pine` | 51 | `d9ebddab6e4a6cad5e6a68c05b29b429ad351796803ea1b81659d9318b69bc6d` |
| `vw-fcmp-magnitude.pine` | 35 | `2f008984fa08fa538f7c170521b34f2a5021b1f71280d5fe64988b55966148a4` |
| `vw-fcmp-builtins.pine` | 35 | `12dee08684f92076653b363e76fde1cf3a152093034ef214c13560d65b01b7ba` |

## The rerun and the version rows (filed after rows 1-8 were read)

### Readings of rows 1-8 (as the coordinator relayed them, 2026-11-18)

The form is an ABSOLUTE EPSILON of about 1e-10, NOT rounding to nine fractional digits, against the v6 reference's
remark. The straddles T20-T23 and T25 read 41 and T08 / T09 read 14, so every rounding form is refuted. Equal at 1e-11,
1.1e-11 and 2e-11; unequal at 1.0000000827e-10 (T07). All six operators share the rule, and an ordering is true only
when the operands are not equal. Half-way rows read 0. The rule is absolute (M rows, and M33 reads 50 on SPY bars 5,333
and 5,453). `na` makes every comparison false, `!=` included. v6 const folding matches series. The v4 twin equals v6 on
every row except T50: v4 compares two literals inline EXACTLY. `math.sign(3e-14)` = 1. The B probe's near tie (3e-10)
lies outside the epsilon, so its built-in rows cannot rule. Hence the rows below.

### The rerun rows

| id | probe | chart | what to record | unblocks |
|---|---|---|---|---|
| Q-FCMP2-9 | `tools/visual_conformance/probes/vw-fcmp-builtins-v2.pine` | AMEX:SPY 1D | from the listing (`history.startsAtBar0` asserted); every plot on every bar | which built-ins use the epsilon (e = 3e-14 and 9e-11); the epsilon's edge, `<` or `<=` (E rows) |
| Q-FCMP2-10 | `tools/visual_conformance/probes/vw-fcmp-builtins-v2.pine` | NYSE:RDDT 1D | from the listing; every plot on every bar | the same, on a second symbol |
| Q-FCMP2-11 | `tools/visual_conformance/probes/vw-fcmp-const-v4.pine` | AMEX:SPY 1D | from the listing; every plot on every bar | which v4 operands are compile-time constants, compared exactly (T50) |
| Q-FCMP2-12 | `tools/visual_conformance/probes/vw-fcmp-const-v5.pine` | AMEX:SPY 1D | from the listing; every plot on every bar | the same under v5 |
| Q-FCMP2-13 | `tools/visual_conformance/probes/vw-fcmp-form-v5.pine` | AMEX:SPY 1D | from the listing; every plot on every bar | whether v5 runs the v4 / v6 rule (rows 1-8 read v4 and v6 only) |
| Q-FCMP2-14 | `tools/visual_conformance/probes/vw-fcmp-form-v3.pine` | AMEX:SPY 1D | from the listing; every plot on every bar | whether v3 runs the v4 / v6 rule (ruling D4: no version assumed) |
| Q-FCMP2-15 | `tools/visual_conformance/probes/vw-fcmp-form-v2.pine` | AMEX:SPY 1D | from the listing; every plot on every bar | the same for v2 |
| Q-FCMP2-16 | `tools/visual_conformance/probes/vw-fcmp-form-v1.pine` | AMEX:SPY 1D | from the listing (no version pragma: TradingView reads it as v1); every plot on every bar | the same for v1 |

Rows 9-13 are approved (coordinator rulings 2026-11-18). Rows 14-16 are ruling D4: until a version is measured,
the engine serves its comparisons only where exact and tolerant agree and refuses the rest by name
(`pine:compare-version-unpinned`). v1-v3 grammar: `n` is the bar counter, the functions are untyped, `one` is
`close * 0 + 1.0`; v1 / v2 have no int type, so T40-T44 read as float rows there.

### Built probes (rerun; record each sha256 with its capture)

| probe | plots | sha256 |
|---|---:|---|
| `vw-fcmp-builtins-v2.pine` | 63 | `9c675e98f407965ee17f580d09a8b76bcd97684f494d2a038cb35af71a82183b` |
| `vw-fcmp-const-v4.pine` | 15 | `86d69d0ddec8fffbe9926f38f8898e4e401019f72ebeeee0d3a971f0d0441b8d` |
| `vw-fcmp-const-v5.pine` | 15 | `f1a561bb66e03c45ccbed1d7cd0cd776c920ef07bb330ea4310c1fd1fb960dfa` |
| `vw-fcmp-form-v5.pine` | 51 | `cb2d146b6cf0398e317ca3f69c5ffaea63340450fd238f4fe8b36b5114ebb94b` |
| `vw-fcmp-form-v3.pine` | 51 | `9d78f19d69744578ec58cdfca9c6704e481c7f64e4556e1cf16f147fe41bcd42` |
| `vw-fcmp-form-v2.pine` | 51 | `3c5799d7a9b270e4cb94fdd25dc3f1c642713130a5b091e1138d81e5259b5b06` |
| `vw-fcmp-form-v1.pine` | 51 | `d7e1ed59d2aeb11db8abc8faf0e5f83a90fbb30d095171bdf1a6bdc5778c5a22` |

What each answers:

- `vw-fcmp-builtins-v2.pine`:
  - B01-B31 are B01-B31 of `vw-fcmp-builtins.pine` with the near tie e = 3e-14, read against that probe's table
    below ("exact reads" / "a tolerant built-in reads"). B21-B23 are `math.sign` of 3e-14, -3e-14 and 9e-11.
  - Z01-Z17 repeat the main built-ins with e = 9e-11. Exact at 9e-11 but tolerant at 3e-14 means the built-in has a
    smaller epsilon of its own.
  - E01-E14 are the operators' edge, on exact differences: 0 vs 2.5e-11, 4e-11, 5e-11, 6e-11, 7e-11, 8e-11, 9e-11,
    9.5e-11 and 9.9e-11, then the double just below 1e-10 (E10), 1e-10 (E11) and the double just above (E12); E13 is
    -5e-11 vs 5e-11 (1e-10 apart); E14 is 1e-10 vs 0. `|a - b| < 1e-10` reads 41 for E01-E10 and 14 / 14 / 14 / 50
    for E11-E14. `<= 1e-10` reads 41 for E11 and E13, and 32 + 8 + 1 = 41 for E14. A smaller epsilon turns the code
    to 14 from the first row it lies under.
- `vw-fcmp-const-v4.pine` / `-v5.pine`: C01-C14 are pairs 3e-14 apart, each written inline so the operands keep their
  own qualifier. They cover literals, named literals, literal sums, inputs, a const against a series, a series
  control, a reassigned name, a function's literal, a `?:` of consts, int against float, and Q-FCMP's literal tie.
  An exact compare reads 50 (or 14 for C12) and the epsilon reads 41. C08 (series) is the control and must read 41.
- `vw-fcmp-form-v5.pine` is `vw-fcmp-form.pine` under v5, read against the same T table.

## Q-FCMP3: the array searches (filed with the engine build, for the next capture batch)

The engine build of rows 1-16 (branch `feat/pine-tolerant-compare-engine`) compares `array.indexof` /
`array.includes` within the epsilon, as rows 9-10 read them. `array.lastindexof` and the three binary searches were
not measured, so they stay EXACT (no change from today) until these rows are read. Coordinator ruling, 2026-11-18.

| id | probe | chart | what to record | unblocks |
|---|---|---|---|---|
| Q-FCMP3-1 | `tools/visual_conformance/probes/vw-fcmp-arrays.pine` | AMEX:SPY 1D | from the listing (`history.startsAtBar0` asserted); every plot on every bar | whether `array.lastindexof` and `array.binary_search` / `_leftmost` / `_rightmost` find a value within the epsilon |
| Q-FCMP3-2 | `tools/visual_conformance/probes/vw-fcmp-arrays.pine` | NYSE:RDDT 1D | from the listing; every plot on every bar | the same, on a second symbol |

| probe | plots | sha256 |
|---|---:|---|
| `vw-fcmp-arrays.pine` | 17 | `58219b5343ba17799e8fe8fd50cad5565420cdb72a80f138419176e7ca79bc40` |

Each row's line in the probe names its two readings, tolerant / exact. A01, A05, A06, A10, A15 and A16 are
controls that read the same under both rules. Every array is sorted ascending with no value repeated (inside the
epsilon or out), so every binary-search row has one answer under each rule. A reading that matches neither column
is a finding: record it as read.

### Readings of Q-FCMP3 (run `fcmp3b-2026-11-18`, packet sha256 `b400024aa71d2d2c895f04bf449f4cb310dd28e49d25f988cd002d2a9f0ad0ef`)

Both captures are committed: `tests/fixtures/vendor/harness/vw-fcmp-arrays-{spy,rddt}-1d-2026-11-18.json`, from the
listing (`history.startsAtBar0`), AMEX:SPY 8,510 bars and NYSE:RDDT 669 bars, captured 22:05Z.

- The source is master's `vw-fcmp-arrays.pine` as committed (sha256 `180b5093...`, 3,469 bytes). The engine-78 entry
  rewrote one comment line of the `58219b53...` text filed above.
- This RE-CAPTURE supersedes run `fcmp3-2026-11-18` (packet `c82872f0c9fe`, licence-held, never committed). That run
  read the same 16 values.
- Every row reads the same on every bar of both symbols.

| row | site | tolerant / exact predicted | TradingView | reads |
|---|---|---|---:|---|
| A01 | lastindexof, exact control | 2 / 2 | 2 | control |
| A02 | lastindexof, the last element 1 + 3e-14 | 2 / 0 | 2 | TOLERANT |
| A03 | lastindexof, target 1 + 3e-14 | 0 / -1 | 0 | TOLERANT |
| A04 | lastindexof, target 1 + 9e-11 | 0 / -1 | 0 | TOLERANT |
| A05 | lastindexof, 3e-10 control | -1 / -1 | -1 | control |
| A06 | binary_search, exact control | 1 / 1 | 1 | control |
| A07 | binary_search 2 + 3e-14 | 1 / -1 | -1 | EXACT |
| A08 | binary_search 2 - 3e-14 | 1 / -1 | -1 | EXACT |
| A09 | binary_search 2 + 9e-11 | 1 / -1 | -1 | EXACT |
| A10 | binary_search, 3e-10 control | -1 / -1 | -1 | control |
| A11 | binary_search_leftmost 2 - 3e-14 | 1 / 0 | 0 | EXACT |
| A12 | binary_search_leftmost 2 - 9e-11 | 1 / 0 | 0 | EXACT |
| A13 | binary_search_rightmost 2 + 3e-14 | 1 / 2 | 2 | EXACT |
| A14 | binary_search_rightmost 2 + 9e-11 | 1 / 2 | 2 | EXACT |
| A15 | binary_search_leftmost, 3e-10 control | 0 / 0 | 0 | control |
| A16 | binary_search_rightmost, 3e-10 control | 2 / 2 | 2 | control |

Results:

- `array.lastindexof` compares a number within the operators' epsilon, as `array.indexof` / `array.includes` do
  (Q-FCMP2 B27 / B28 / Z12).
- The three binary searches compare exactly.
- No reading falls outside the two predicted columns.
- The engine change follows these readings (engine 81, `feat/pine-tolerant-lastindexof`).

## Readings each model predicts (what each plot answers)

**The code.** Every `cmp(a, b)` plot packs the six operators into one integer: 1·(a == b) + 2·(a != b) + 4·(a < b) +
8·(a <= b) + 16·(a > b) + 32·(a >= b). The six agree only as 41 (equal), 14 (a < b) or 50 (a > b). Any other number
means the operators disagree with each other; read its bits (13 = `==`, `<` and `<=` true: `==` rounds while `<`
compares exactly). Every operand is a literal times the series `one` (1.0 on every bar), so nothing folds at compile
time, except T49 / T50, the same two pairs as T08 / T20 written inline.

**The models** in the tables below, each computed in IEEE doubles from the same literals:

- exact: the IEEE comparison (what our engine does today, on both lanes).
- R9 `Math.round(x*1e9)/1e9`: round each float operand to 9 fractional digits by multiplying, rounding half toward
  +infinity, dividing. R9 exact decimal: the double's exact decimal value rounded half away from zero (JavaScript's
  `toFixed(9)`, Java's `new BigDecimal(x).setScale(9, HALF_UP)`). R9 shortest decimal: the double's shortest decimal
  spelling rounded half away from zero (Java's `BigDecimal.valueOf(x)`). The three differ only at half-way values
  (T32-T39) and where a product above 1e16 loses digits (M29-M31).
- ε 1e-10 / ε 5e-10: equal when |a - b| < ε (the `ta.stdev` example's `EPS`, and rounding the DIFFERENCE to 9 digits);
  `<` / `>` true only when not equal.
- rel 1e-12: equal when |a - b| <= 1e-12 · max(|a|, |b|) (a relative tolerance; Q-FCMP needs one of at least 3.2e-13).

### `vw-fcmp-form.pine` and `vw-fcmp-form-v4.pine` (T rows)

T00 is `bar_index` (the control). T32-T39 are not codes: each reads 1 when the half-way value compares equal to the
bucket below it, 2 when equal to the bucket above, 0 when neither (3 = both).

| plot | compares | exact | R9 `Math.round(x*1e9)/1e9` | R9 exact decimal (`toFixed(9)`) | R9 shortest decimal | ε 1e-10 | ε 5e-10 | rel 1e-12 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| T01 | control, equal | 41 | 41 | 41 | 41 | 41 | 41 | 41 |
| T02 | control, a < b | 14 | 14 | 14 | 14 | 14 | 14 | 14 |
| T03 | control, a > b | 50 | 50 | 50 | 50 | 50 | 50 | 50 |
| T04 | 1 vs 1 + 1e-13 (base at a 9-digit bucket centre) | 14 | 41 | 41 | 41 | 41 | 41 | 41 |
| T05 | 1 vs 1 + 1e-12 (base at a 9-digit bucket centre) | 14 | 41 | 41 | 41 | 41 | 41 | 14 |
| T06 | 1 vs 1 + 1e-11 (base at a 9-digit bucket centre) | 14 | 41 | 41 | 41 | 41 | 41 | 14 |
| T07 | 1 vs 1 + 1e-10 (base at a 9-digit bucket centre) | 14 | 41 | 41 | 41 | 14 | 41 | 14 |
| T08 | 1 vs 1 + 3e-10 (base at a 9-digit bucket centre) | 14 | 41 | 41 | 41 | 14 | 41 | 14 |
| T09 | 1 vs 1 + 4.9e-10 (base at a 9-digit bucket centre) | 14 | 41 | 41 | 41 | 14 | 41 | 14 |
| T10 | 1 vs 1 + 5.1e-10 (base at a 9-digit bucket centre) | 14 | 14 | 14 | 14 | 14 | 14 | 14 |
| T11 | 1 vs 1 + 9e-10 (base at a 9-digit bucket centre) | 14 | 14 | 14 | 14 | 14 | 14 | 14 |
| T12 | 1 vs 1 + 1.4e-9 (base at a 9-digit bucket centre) | 14 | 14 | 14 | 14 | 14 | 14 | 14 |
| T13 | 1 vs 1 + 1e-8 (base at a 9-digit bucket centre) | 14 | 14 | 14 | 14 | 14 | 14 | 14 |
| T14 | 1.00000000049 vs 1.000000000491 (base 1e-11 below the 1.0000000005 boundary) | 14 | 41 | 41 | 41 | 41 | 41 | 41 |
| T15 | 1.00000000049 vs 1.000000000495 (base 1e-11 below the 1.0000000005 boundary) | 14 | 41 | 41 | 41 | 41 | 41 | 14 |
| T16 | 1.00000000049 vs 1.000000000499 (base 1e-11 below the 1.0000000005 boundary) | 14 | 41 | 41 | 41 | 41 | 41 | 14 |
| T17 | 1.00000000049 vs 1.000000000501 (base 1e-11 below the 1.0000000005 boundary) | 14 | 14 | 14 | 14 | 41 | 41 | 14 |
| T18 | 1.00000000049 vs 1.00000000051 (base 1e-11 below the 1.0000000005 boundary) | 14 | 14 | 14 | 14 | 41 | 41 | 14 |
| T19 | 1.00000000049 vs 1.00000000059 (base 1e-11 below the 1.0000000005 boundary) | 14 | 14 | 14 | 14 | 14 | 41 | 14 |
| T20 | 2e-14 apart, either side of 1.0000000005 | 14 | 14 | 14 | 14 | 41 | 41 | 41 |
| T21 | the same, operands swapped | 50 | 50 | 50 | 50 | 41 | 41 | 41 |
| T22 | 2e-14 apart, either side of 0.0900000005 (the magnitude of the Q-FCMP tie) | 14 | 14 | 14 | 14 | 41 | 41 | 41 |
| T23 | 2e-13 apart, either side of 100.0000000005 | 14 | 14 | 14 | 14 | 41 | 41 | 41 |
| T24 | -1 vs -1.0000000003 (one bucket) | 50 | 41 | 41 | 41 | 50 | 41 | 50 |
| T25 | 2e-14 apart, either side of -1.0000000005 | 50 | 50 | 50 | 50 | 41 | 41 | 41 |
| T26 | -1.0000000003 vs -0.9999999997 (one bucket, either side of -1) | 14 | 41 | 41 | 41 | 14 | 14 | 14 |
| T27 | 0 vs 4e-10 | 14 | 41 | 41 | 41 | 14 | 41 | 14 |
| T28 | 0 vs -4e-10 | 50 | 41 | 41 | 41 | 50 | 41 | 50 |
| T29 | -4e-10 vs 4e-10 (both in the bucket of 0) | 14 | 41 | 41 | 41 | 14 | 14 | 14 |
| T30 | 0 vs 6e-10 | 14 | 14 | 14 | 14 | 14 | 14 | 14 |
| T31 | 1e-300 vs 0 | 50 | 41 | 41 | 41 | 41 | 41 | 50 |
| T32 | 1.0000000025: 1 if == 1.000000002, 2 if == 1.000000003 | 0 | 2 | 1 | 2 | 0 | 0 | 0 |
| T33 | 1.0000000075: 1 if == 1.000000007, 2 if == 1.000000008 | 0 | 2 | 1 | 2 | 0 | 0 | 0 |
| T34 | 1.0000000015: 1 if == 1.000000001, 2 if == 1.000000002 | 0 | 1 | 1 | 2 | 0 | 1 | 0 |
| T35 | 1.0000000005: 1 if == 1.0, 2 if == 1.000000001 | 0 | 2 | 2 | 2 | 0 | 0 | 0 |
| T36 | -1.0000000005: 1 if == -1.0, 2 if == -1.000000001 | 0 | 1 | 2 | 2 | 0 | 0 | 0 |
| T37 | 0.0000000005: 1 if == 0.0, 2 if == 0.000000001 | 0 | 2 | 2 | 2 | 0 | 0 | 0 |
| T38 | -0.0000000005: 1 if == 0.0, 2 if == -0.000000001 | 0 | 1 | 2 | 2 | 0 | 0 | 0 |
| T39 | 2.0000000035: 1 if == 2.000000003, 2 if == 2.000000004 | 0 | 1 | 1 | 2 | 0 | 0 | 0 |
| T40 | int 1 vs float 1.0000000003 | 14 | 41 | 41 | 41 | 14 | 41 | 14 |
| T41 | int 1 vs float 0.9999999997 | 50 | 41 | 41 | 41 | 50 | 41 | 50 |
| T42 | int 1 vs float 1.0000000006 | 14 | 14 | 14 | 14 | 14 | 14 | 14 |
| T43 | float 1.0000000003 vs int 1 | 50 | 41 | 41 | 41 | 50 | 41 | 50 |
| T44 | int 7 vs int 7 | 41 | 41 | 41 | 41 | 41 | 41 | 41 |
| T49 | const twin of 1 vs 1.0000000003 (literals inline) | 14 | 41 | 41 | 41 | 14 | 41 | 14 |
| T50 | const twin of the 2e-14 straddle | 14 | 14 | 14 | 14 | 41 | 41 | 41 |

T45-T48 (an `na` operand: `na` float with `na` float, with 1.0, 1.0 with `na`, `na` int with `na` int) have no model:
the reading IS the rule. 0 = every comparison with `na` is false; 2 = `!=` is true while the rest are false (the
two are distinct shapes our engine must match).

The v4 twin (`vw-fcmp-form-v4.pine`) is the same rows, T01-T50, under `//@version=4` with untyped functions; it rules
whether v4 shares v6's rule. The same table applies to it.

### `vw-fcmp-magnitude.pine` (M rows)

M01-M23: M vs M + 16 ulp / 3e-10 / 7e-10, for M = 1e-12, 1e-10, 1e-9, 1e-6, 0.001, 1000, 1e6, 1e7, 1e9 (an offset
below one ulp of M is omitted). Rounding to 9 fractional digits is ABSOLUTE: below 5e-10 every value is 0 (M02, M05,
M08 read 41), and above 1e7 the 1e-9 grid is finer than the doubles, so the compare is exact there (M22-M28 read 14).
A relative tolerance reads the opposite at both ends.

| plot | compares | exact | R9 `Math.round(x*1e9)/1e9` | R9 exact decimal (`toFixed(9)`) | R9 shortest decimal | ε 1e-10 | ε 5e-10 | rel 1e-12 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| M01 | 1e-12 vs 1e-12 + 16ulp (1.0000000000000032e-12) | 14 | 41 | 41 | 41 | 41 | 41 | 41 |
| M02 | 1e-12 vs 1e-12 + 3e-10 (3.01e-10) | 14 | 41 | 41 | 41 | 14 | 41 | 14 |
| M03 | 1e-12 vs 1e-12 + 7e-10 (7.01e-10) | 14 | 14 | 14 | 14 | 14 | 14 | 14 |
| M04 | 1e-10 vs 1e-10 + 16ulp (1.0000000000000021e-10) | 14 | 41 | 41 | 41 | 41 | 41 | 41 |
| M05 | 1e-10 vs 1e-10 + 3e-10 (4e-10) | 14 | 41 | 41 | 41 | 14 | 41 | 14 |
| M06 | 1e-10 vs 1e-10 + 7e-10 (8e-10) | 14 | 14 | 14 | 14 | 14 | 14 | 14 |
| M07 | 1e-9 vs 1e-9 + 16ulp (1.0000000000000034e-09) | 14 | 41 | 41 | 41 | 41 | 41 | 41 |
| M08 | 1e-9 vs 1e-9 + 3e-10 (1.3e-09) | 14 | 41 | 41 | 41 | 14 | 41 | 14 |
| M09 | 1e-9 vs 1e-9 + 7e-10 (1.7e-09) | 14 | 14 | 14 | 14 | 14 | 14 | 14 |
| M10 | 1e-6 vs 1e-6 + 16ulp (1.0000000000000033e-06) | 14 | 41 | 41 | 41 | 41 | 41 | 41 |
| M11 | 1e-6 vs 1e-6 + 3e-10 (1.0003e-06) | 14 | 41 | 41 | 41 | 14 | 41 | 14 |
| M12 | 1e-6 vs 1e-6 + 7e-10 (1.0007e-06) | 14 | 14 | 14 | 14 | 14 | 14 | 14 |
| M13 | 0.001 vs 0.001 + 16ulp (0.0010000000000000035) | 14 | 41 | 41 | 41 | 41 | 41 | 41 |
| M14 | 0.001 vs 0.001 + 3e-10 (0.0010000003) | 14 | 41 | 41 | 41 | 14 | 41 | 14 |
| M15 | 0.001 vs 0.001 + 7e-10 (0.0010000007) | 14 | 14 | 14 | 14 | 14 | 14 | 14 |
| M16 | 1000.0 vs 1000.0 + 16ulp (1000.0000000000018) | 14 | 41 | 41 | 41 | 41 | 41 | 41 |
| M17 | 1000.0 vs 1000.0 + 3e-10 (1000.0000000003) | 14 | 41 | 41 | 41 | 14 | 41 | 41 |
| M18 | 1000.0 vs 1000.0 + 7e-10 (1000.0000000007) | 14 | 14 | 14 | 14 | 14 | 14 | 41 |
| M19 | 1000000.0 vs 1000000.0 + 16ulp (1000000.0000000019) | 14 | 14 | 14 | 14 | 14 | 14 | 41 |
| M20 | 1000000.0 vs 1000000.0 + 3e-10 (1000000.0000000003) | 14 | 41 | 41 | 41 | 14 | 41 | 41 |
| M21 | 1000000.0 vs 1000000.0 + 7e-10 (1000000.0000000007) | 14 | 14 | 14 | 14 | 14 | 14 | 41 |
| M22 | 10000000.0 vs 10000000.0 + 16ulp (10000000.00000003) | 14 | 14 | 14 | 14 | 14 | 14 | 41 |
| M23 | 1000000000.0 vs 1000000000.0 + 16ulp (1000000000.0000019) | 14 | 14 | 14 | 14 | 14 | 14 | 41 |
| M24 | 10000000.0 vs 10000000.0 + 1e-6 (10000000.000001) | 14 | 14 | 14 | 14 | 14 | 14 | 41 |
| M25 | 1000000000.0 vs 1000000000.0 + 1e-6 (1000000000.000001) | 14 | 14 | 14 | 14 | 14 | 14 | 41 |
| M26 | 10000000.0 vs the next double (10000000.000000002) | 14 | 14 | 14 | 14 | 14 | 14 | 41 |
| M27 | 123456789.123 vs the next double (123456789.12300001) | 14 | 14 | 14 | 14 | 14 | 14 | 41 |
| M28 | 1000000000.0 vs the next double (1000000000.0000001) | 14 | 14 | 14 | 14 | 14 | 14 | 41 |
| M29 | 10000000.000000013 vs 10000000.000000015 (adjacent doubles) | 14 | 41 | 14 | 14 | 14 | 14 | 41 |
| M30 | 123456789.12300004 vs 123456789.12300006 (adjacent doubles) | 14 | 41 | 14 | 14 | 14 | 14 | 41 |
| M31 | 1000000000.0000008 vs 1000000000.000001 (adjacent doubles) | 14 | 41 | 14 | 14 | 14 | 14 | 41 |

M32-M34, the DMI's moves on every bar (`up = high - high[1]`, `down = low[1] - low`), raw and scaled. On AMEX:SPY 1D,
from the Q-FCMP capture's bars:

| plot | pair | exact | R9 (either form) | ε 1e-10 | rel 1e-12 |
|---|---|---|---|---|---|
| M32 | up vs down | 50 on bars 5,333 and 5,453 | 41 on both (Q-FCMP's reading) | 41 on both | 41 on both |
| M33 | up · 1e6 vs down · 1e6 (2.84e-8 apart on the tie bars) | 50 on both | 50 on both | 50 on both | 41 on both |
| M34 | up · 1e-8 vs down · 1e-8 | exact everywhere | a tie (41) on 174 more bars than exact (exact decimal) or 176 (`Math.round` form), from bar 47 | 21 more bars, from bar 2,218 | 2 more bars |

On NYSE:RDDT 1D, M34 differs from exact on 4 bars (exact decimal: 126, 153, 321, 494) or 3 (`Math.round`: 153, 321,
494); M32 and M33 read exactly.

### `vw-fcmp-builtins.pine` (B rows)

Every near tie is e = 3e-10 at magnitude 1 (1.0000000003 rounds to 1.0); `(1 + e) - 1` is 3.000000248221113e-10.
p3 = bar_index % 3, p4 = bar_index % 4.

| plot | built-in | exact reads | a tolerant built-in reads |
|---|---|---|---|
| B01 | `ta.crossover(0.5 -> 1 + e -> 2.0, 1.0)` | 1 on p3 = 1 | 1 on p3 = 2 |
| B02 | `ta.crossunder(1.5 -> 1 - e -> 0.0, 1.0)` | 1 on p3 = 1 | 1 on p3 = 2 |
| B03 | `ta.cross` of B01's series | 1 on p3 = 1 and p3 = 0 | 1 on p3 = 2 and p3 = 0 |
| B04 | `ta.crossover(0.5 -> 1.0 -> 2.0, 1.0)`, the exact-tie control | 1 on p3 = 2 | 1 on p3 = 2 |
| B05 | `ta.highest(1, 1 + e, 1; 2) - 1` | e on p3 = 1 and 2, 0 on p3 = 0 | e on only one of p3 = 1 / 2 (which one is the tie rule) |
| B06 | `ta.highestbars` of the same | 0 on p3 = 1, -1 on p3 = 2; p3 = 0 is an exact tie (the tie rule) | p3 = 1 and 2 read what p3 = 0 reads |
| B07-B08 | `ta.lowest` / `ta.lowestbars` of 1, 1 - e, 1 | as B05-B06, with -e | as B05-B06 |
| B09 | `ta.pivothigh(1, 1, 0, 0 cycle; 1, 1)`, exact ties (control) | the tie rule: p4 = 1 reads the centre with an equal RIGHT neighbour, p4 = 2 with an equal LEFT one | the same |
| B10 | pivothigh of 1 + e, 1, 0, 0 | 1 + e on p4 = 1 (strictly above both), na on p4 = 2 | B09's pattern |
| B11 | pivothigh of 1, 1 + e, 0, 0 | na on p4 = 1, 1 + e on p4 = 2 | B09's pattern |
| B12-B14 | `ta.pivotlow`, mirrored (1, 1, 2, 2 / 1 - e, 1 / 1, 1 - e) | as B09-B11 | as B09-B11 |
| B15-B18 | `math.max(1, 1 + e)`, `math.max(1 + e, 1)`, `math.min(1, 1 - e)`, `math.min(1 - e, 1)`, each minus 1 | e, e, -e, -e | 0 for one argument order |
| B19-B20 | `array.max([1, 1 + e])`, `array.min([1, 1 - e])`, minus 1 | e, -e | 0 |
| B21-B23 | `math.sign(3e-10)`, `math.sign(-3e-10)`, `math.sign(3e-14)` | 1, -1, 1 | 0, 0, 0 |
| B24 | `ta.rising(1, 1 + e, 1; 1)` | 1 on p3 = 1 | 0 everywhere |
| B25 | `ta.falling` of the same | 1 on p3 = 2 | 0 everywhere |
| B26 | `switch 1 + e` with a `1.0` arm | 0 | 1 |
| B27-B28 | `array.indexof` / `array.includes` of 1 + e in [1.0, 2.0] | -1, 0 | 0, 1 |
| B29 | `array.sort` ascending of [1 + e, 1.0], first element minus 1 | 0 | e (kept order; 0 can also be an unstable sort) |
| B30 | `ta.percentrank(1, 1 + e, 1; 1)` | 0 on p3 = 2 | 100 on p3 = 2 |
| B31 | `ta.mode(1 + e, 1.0, 0.5; 3)` | 0.5 (no value repeats: the smallest) | 1.0 or 1 + e (one value, twice) |
| B32-B34 | `ta.dmi(14, 14)`: DI+, DI-, ADX | our built-in today: exact `up > down` | TradingView's built-in, graded against ours bar by bar from 5,333 |

## How it rules

1. **Rounding or an epsilon.** T20, T21, T22 and T25 (2e-14 straddles of a bucket edge) read 14 / 50 / 14 / 50 and
   T08, T09 (3e-10 and 4.9e-10 inside one bucket) read 41: ROUNDING TO 9 FRACTIONAL DIGITS, every epsilon form
   refuted (an epsilon wide enough for Q-FCMP's F04 makes the straddles equal; one that keeps them apart cannot make
   T08 equal). If instead the straddles read 41 and T08 reads 14: an epsilon, its size between the first unequal and
   the last equal rows of T04-T13, cross-checked by the edge grid T14-T19, which must then read like T04-T13 (an
   epsilon does not move with the bucket phase; rounding does).
2. **Which operators.** A rounding `==` with exact ordering operators reads 13 on T08 (49 on a pair where a > b, such as
   T24); 41 means all six round. Q-FCMP's F05 / F06 already say `>` and `<` are not exact on a 2.8e-14 tie.
3. **The half-way rule.** T32-T39 fingerprint the rounding: `Math.round` form 2, 2, 1, 2, 1, 2, 1, 1; exact decimal
   1, 1, 1, 2, 2, 2, 2, 1; shortest decimal 2 on every row. Any other pattern is a form not listed here, and is
   recorded as found.
4. **Absolute or relative.** M02 / M05 / M08 / M11 read 41 and M24 / M25 read 14: absolute (rounding is absolute).
   The reverse: relative. M33 on SPY bar 5,333: 50 absolute, 41 relative. M34 shows the absolute rule on real bars.
5. **The two R9 forms at large magnitude.** M29-M31 read 41: the multiply form (`x * 1e9` above 2^53 merges
   neighbours); 14: an exact decimal rounding. With rule 3 this pins the implementation.
6. **int operands.** T40-T43 read 41: an int compared with a float sees the float rounded. 14 / 50: an int operand
   makes the compare exact.
7. **na operands.** T45-T48: the reading is the rule (see above).
8. **Compile-time folding.** T49 = T08 and T50 = T20: the folded compare uses the same rule.
9. **Versions.** The v4 twin equal to the v6 probe row for row: one rule for every version. A difference: the rule
   is per version, and adx-and-di-for-v4's fix follows the v4 reading.
10. **Built-ins.** Each B row, per the table above. A built-in that reads "exact" keeps its IEEE compare in the engine;
    one that reads "tolerant" moves onto the same comparison authority as the operators.

The engine change is designed only from these readings plus Q-FCMP's: a reading this page did not predict is a
finding, recorded as read, and stops the design until it is explained.

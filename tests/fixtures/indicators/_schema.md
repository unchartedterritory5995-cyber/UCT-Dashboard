# Indicator golden fixtures — the contract

These JSON files are the **single shared oracle** for the two independent
implementations of the same indicator math:

| lane | code | test |
|---|---|---|
| Python | `api/services/indicator_compute.py` (the `compute_*_raw` core) | `tests/test_indicator_golden.py` |
| JS | `app/src/components/chart/indicators.js` | `app/src/components/chart/goldenFixtures.test.js` |

Both lanes read *these exact files*. If one lane's math drifts, its fixture test
goes red — which is the entire point. Before these existed, RSI (and six
friends) had two implementations that could disagree silently and forever.

---

## File shape

```jsonc
{
  "case": "rsi_ramp_14",         // == the filename stem
  "kind": "rsi",                 // dispatch key: which indicator to run
  "note": "why this case exists",
  "params": { "period": 14 },    // snake_case; each lane maps to its own arg names
  "relTol": 1e-9,
  "bars": [
    { "t": 1780000000, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 1000 }
  ],
  "expected": {                  // one array per output column, ALIGNED to bars
    "rsi": [null, null, 55.123456789012345]
  }
}
```

* **`t` is unix seconds**, always. (Parts of this repo store daily bars as
  `YYYYMMDD` ints; fixtures do not, because the VWAP session cases need real
  wall-clock instants and one convention beats two.)
* **`bars` or `barsFrom`, exactly one.** `barsFrom` is a repo-root-relative
  path (POSIX separators) to a JSON file with a `bars` array. It exists for one
  case — see "The case that owns no bars" below — and both lanes resolve it
  (`case_bars` in pytest, `caseBars` in vitest).
* **`kind`** is the dispatch key, not a substring of `case`. `compute_case(kind,
  bars, params)` in `indicator_compute.py` maps it to the precise core and names
  the columns; `case_columns(kind)` lists them. An unknown kind raises.
* **`params` uses snake_case** (`k_period`, `d_period`, `stddev`). The JS test
  translates to that lane's camelCase argument order explicitly, per case — that
  translation is part of what the fixture pins.

## Alignment rule of record

**Every `expected` column is the length of `bars`,** `null`-padded at every
position before the first computable bar. `null` means *not computable here*,
and each lane asserts it in its own vocabulary:

| lane | padding value | assertion |
|---|---|---|
| Python | `None` | `got[i] is None` |
| JS | `NaN` | `Number.isNaN(got[i])` |

### The two columns that break the "pad, then values to the end" shape

Both are **preserved quirks**, and both are pinned as NUMBERS rather than waived:

* **`ichimoku_9_26_52.chikou` pads at BOTH ends.** Chikou is plotted
  `kijunPeriod` bars *back* — bar `i`'s close is written to index `i − 26` — so
  the last 26 slots are pad. `TRAILING_PAD` in `test_indicator_golden.py` (and
  the mirrored block in `goldenFixtures.test.js`) declares that length and
  asserts it in **both** directions: the last 26 are null *and* the slot before
  them is not. Relaxing the alignment test to "holes allowed" instead would stop
  it noticing if the back-shift changed, vanished or grew.
* **`obv_basic.obv` has no pad at all.** B1 pinned bar 0 at `0` rather than "not
  computable yet". A padded bar 0 satisfies "nulls first, then values" perfectly,
  so the seed carries its own assertion in each lane.

Ichimoku's *other* quirk — `spanA`/`spanB` are **not** forward-displaced, where
standard Ichimoku pushes the cloud 26 bars into the future — shows up as the
mirror image: their last bar carries a value, and both lanes assert it.

This is the Python convention, adopted as the rule for both. The JS lane used to
*trim* — it returned a short array starting at the first computable bar — which
is why nothing could be compared position-by-position until Phase B1 Task 5
padded it.

**Degenerate inputs are outside this contract.** When a series is too short to
compute anything at all, Python returns an all-`None` array of input length and
JS returns `[]` (the renderer's "no pane" signal, preserved deliberately). No
fixture covers that case; unifying it belongs to the B2 binding layer, which is
where pane creation moves.

**The fixtures pin COMPUTE, and for MACD the picture now agrees with them.**
`macd_default`'s `macd` column is finite from bar 25 in both lanes at 1e-9. Until
2026-08-02 the chart rendered bars 25-32 as whitespace — it held the line's head
back to the signal's first bar — and that gap was the one named exception to the
rel-tol rule. The owner **dropped the mask on 2026-08-02** (decision
`MACD_HEAD_MASK`, `docs/decisions/2026-08-02-macd-head-mask.md`, status ACCEPTED,
measured cost **88 px**), so those 8 bars are drawn at the values this fixture
publishes and the exception is CLOSED. The fixture was always the correct side —
it never moved, the picture did. Still do NOT "fix" a fixture to match a picture.

## Tolerance rule

`relTol` is **1e-9**, compared as `|got − exp| <= relTol * max(1, |exp|)` — a
relative tolerance with an absolute floor, so a column that legitimately passes
through zero (MACD histogram, CCI) is not held to an impossible relative bar.

1e-9 is only achievable because **neither lane rounds inside compute**. Both
used to: JS with `parseFloat(x.toFixed(n))` (half-away-from-zero), Python with
`round(x, n)` (banker's). Different tie-breaking on the same value, so agreement
at 1e-9 was arithmetically impossible. Rounding is presentation now — and on the
Python side, *delivery*: the public `compute_*` wrappers still round for the two
live consumers that compare against user thresholds. Fixtures are generated from
and asserted against the `compute_*_raw` core. See the module docstring.

## Regeneration is banned

`_generate.py` ran **once**. Its output is committed and is the oracle.

> **A regenerated fixture cannot fail.** Re-running the generator after a code
> change simply re-records whatever the code now does, converting a red test
> into a green one without anyone reading a diff.

If a fixture genuinely must change (a new case, a corrected input series), that
is a deliberate, reviewed commit whose diff shows every changed number — never a
"just re-run the generator" step, and never something CI does.

The generator writes with `allow_nan=False`, so a NaN or infinity leaking into a
column fails generation instead of being written as invalid JSON.

## The two VWAP cases have no `expected`

`vwap_extended_hours_utc_midnight` and `vwap_dst_transition` carry `"expected":
null` and a `"session"` block instead. They were written to pin a **bug class**,
not a value: `computeVWAP` used to bucket sessions by **UTC calendar day**, and a
US extended-hours session runs past UTC midnight, so the 8 PM ET bar started a
"new day" and the cumulative VWAP reset in the middle of a live session. Regular
trading hours never hit it (09:30–16:00 ET is always one UTC day), which is
exactly why unit tests never caught it.

```jsonc
"session": {
  "etDate":  ["2026-06-10", ...],   // ET calendar day per bar — the bucket in use
  "etHour":  [4, 5, ...],           // ET wall-clock hour per bar
  "utcDate": ["2026-06-10", ...],   // UTC calendar day per bar — the retired bucket
  "utcResetIndices": [0, 16],       // where the RETIRED code restarted the accumulator
  "etResetIndices":  [0],           // where the SHIPPED code restarts it
  "etSessionVwap":   [ ... ]        // the series the SHIPPED code produces, exactly
}
```

### ⚠️ THE BUG WAS FIXED, AND THE FIXTURES DID NOT CHANGE

`VWAP_SESSION_ANCHOR` was **accepted 2026-08-03** at a measured 2,590 changed
pixels (`docs/decisions/2026-08-02-vwap-utc-day-bucketing.md`), and `computeVWAP`
now buckets by the ET calendar day. **These fixtures were not reseeded — not one
byte.** They already carried both series side by side, so the JS lane's
assertions were re-pointed from `utcResetIndices` onto `etResetIndices` and
`etSessionVwap` and nothing was re-baselined.

That is the property to preserve. **`etSessionVwap` went from "the reference" to
"the expectation": the shipped `computeVWAP` matches it with a worst absolute
difference of ZERO.** `utcResetIndices` is now the historical record of the
defect, and every JS case keeps a local re-implementation of the retired
bucketing as its non-vacuity control — so "the shipped function is ET-anchored"
is still measured against a series that can disagree with it.

The Python lane guards their shape (that UTC bucketing really does split the tape
more often than ET bucketing would). That shape claim is about the FIXTURE, not
the code, so it was unaffected by the fix — and it is the reason a reseed here
would have had to redden both lanes at rel-tol 1e-9.

> **Superseded 2026-08-05 (B5): "Python has no VWAP" is no longer true.**
> `compute_vwap_raw` exists, and it took the **corrected** ET-session anchoring —
> so both lanes now assert the BEHAVIOURAL half of these two cases against
> `session.etSessionVwap`, each with its own re-implementation of the retired
> UTC bucketing as the non-vacuity control. **These two files still were not
> reseeded — not one byte.** `expected` stays `null` on both, because
> `compute_case` deliberately has no `vwap` kind: an entry for it would let a
> future edit quietly regenerate the two fixtures whose entire value is that they
> never were. The new case below carries VWAP's `expected` column instead.

## `vwap_session_expected` — VWAP's `expected` column (B5)

A **new** case, on the parity gate's bars via `barsFrom`, with
`kind: "vwap_series"` (not `"vwap"` — see above). It pins the ET-anchored series
on the exact 579 five-minute extended-hours bars the chart renders, spanning a
DST change. Measured on those bars the retired UTC-day bucketing differs by up to
**$14.45** and stays more than $0.50 wrong for 134 positions, so a lane that
ported the old logic cannot satisfy this column at 1e-9 — which is what makes it
a port proof rather than a snapshot.

## The seven that used to be JS-only (B5)

`vwap`, `atr`, `sar`, `ichimoku`, `adx`, `obv` and `donchian` were engine
definitions with **no Python lane at all**. That is why an indicator alert naming
one could be stored and could never fire: `_evaluate_one` returns `(None, False)`
on an `INDICATOR_FUNCS` miss. Their cases — `atr_14`, `adx_14`, `obv_basic`,
`donchian_20`, `ichimoku_9_26_52`, `sar_default`, `vwap_session_expected` — are
the proof that the port agrees with the shipped chart, and each one carries the
quirk its indicator had to preserve.

`sar` needs a note: its JS lane rides an `isUptrend` **boolean** alongside each
price. The fixture carries it as a numeric `trend` column (`+1` / `−1`) because
the fixture compare is numeric, and a flag no fixture reads is a behaviour with
no oracle at all.

## SAR's two EVENT columns — `sar_events_default` + `sar_events_outside_bar` (Phase C)

Spec §3.1: **events are columns**, valued `{0, 1, null}`. `sar` is the first
indicator in the platform to declare any, and the reason is the one thing it
cannot do: it cannot be addressed by a fixed threshold, because its value jumps
to the other side of price at every flip. So it is addressed by event instead —
`priceCrossedSar` (the close moved to the other side of the stop) and
`trendFlipped` (the SAR itself jumped sides).

**⭐ THEY COST NO RESEED, AND THAT IS WHY THEY ARE SAFE.** `sar_default` has
carried an `expected.trend` column — pinned by both lanes at rel-tol 1e-9 —
since B5. `trendFlipped` is `trend[i] != trend[i-1]`; `priceCrossedSar` is
`(close > sar)` changing over the `sar` column beside it. So:

* `sar_events_default` carries **`barsFrom: tests/fixtures/indicators/sar_default.json`** —
  the second case in the directory to own no bars, and the first whose referent
  is another fixture. Both lanes recompute both columns from `sar_default`'s
  **already-pinned** `sar` and `trend` and require the fixture to equal them, so
  the oracle is older than either implementation and a reseed of `sar_default`
  turns this case red.
* **`null` is the warmup pad, not "no event".** Bar 0 has no SAR at all (the
  trend seed consumes it). Bar 1 is `0` in both columns: computable, with no
  prior side or trend to have moved away from. `0` is "computed, did not happen".
* The `relTol` compare cannot make the domain claim (`0.9999999999` would pass),
  so `{0, 1, null}` and "the column is not constant" are separate assertions in
  both lanes.

**⚠️ Why there are TWO cases.** Measured: on `sar_default`'s 140 real bars the
two columns are **element-for-element equal**. A side change without a trend
change is only reachable around an *outside reversal bar* — on reversal the new
SAR is the prior leg's extreme point, which a bar making a new high can close
beyond — and that series has none. So `sar_events_default` alone could not tell
`priceCrossedSar` from `trendFlipped`: a lane returning the same column twice, or
the two the wrong way round, would be invisible.

`sar_events_outside_bar` is seven **hand-built** bars that contain exactly that
shape, and every number in it is derivable on paper (`test_hand_computed_sar_
events_on_the_outside_bar`): bar 5 flips the trend without flipping the side
(`trendFlipped=1, priceCrossedSar=0`) and bar 6 flips the side without flipping
the trend (`0, 1`).

**Neither case came from `_generate.py`.** That script ran once and is not being
re-run — see "Regeneration is banned" above. These two were written by a one-off
script that asserted the domain, the pad, the non-constancy, the hand derivation
from `sar_default`'s pinned columns and the two cases' relationship to each other
*before* writing anything; the guarantee that matters afterwards is that both
lanes reproduce every number from an oracle that is not the code under test.

---

## The case that owns no bars — `intraday5m_sessions`

The two cases above are 17 and 10 **hourly** bars. They are long enough to show a
session being *split* and short enough to be read by hand, and they are not the
series any chart draws. `intraday5m_sessions` is the other end of that: it is the
**chart parity gate's own bar fixture**, `app/src/pages/parityBars/intraday5m.json`
— 579 five-minute extended-hours bars over Fri 2025-10-31 (EDT), Mon 2025-11-03
and Tue 2025-11-04 (EST) — asserted by both lanes.

It carries `barsFrom` instead of `bars`, and that indirection is the whole design:

* the compute oracle and the rendered picture are provably **one series**, not
  two copies that drift;
* **regenerating the parity fixture turns this case red in both lanes.** That is
  the correct outcome, not an inconvenience: every pixel number ever measured
  against those bars expired the moment they changed.

It also carries **both** an `expected` block and a `session` block, which no other
case does:

| block | what it pins | lane |
|---|---|---|
| `expected.mfi` (MFI 14) | the two lanes agree at 1e-9 on **typical price × volume** over these bars — the exact arithmetic VWAP is built from | both |
| `session` | UTC-day vs ET-session bucketing **disagree** on these bars, in both directions | both (shape); vitest asserts `computeVWAP` itself |

MFI is the column because it is the only indicator both lanes implement that is
volume-weighted off the typical price. A `kind: "vwap"` case could not have an
`expected` at all — `compute_case` would raise.

**Why extended hours, and why three sessions.** Regular trading hours
(09:30–16:00 ET) are always inside one UTC day, so on an RTH fixture UTC-day and
ET-session bucketing are *identical* and a VWAP parity number would be the same
whether the bug survived a migration or was silently corrected. On this window
they differ in both directions — which is what made the 2,590-pixel correction
measurable, and what still keeps every re-pointed assertion non-vacuous. The two
bullets below describe the RETIRED bucketing; they are why this window was
chosen, and they remain the reason it must not be regenerated:

* EDT is UTC-4 → the day flips at **20:00 ET**; EST is UTC-5 → it flips at
  **19:00 ET**. Three mid-session splits, each of which collapses the running
  VWAP to one bar's typical price and lands $2.71–$4.91 away from the
  session-correct value.
* And because Monday's 19:00–20:00 ET bars have already opened UTC day
  2025-11-04, **Tuesday's 04:00 ET open is not a UTC-day boundary at all.** It
  never resets: the whole session accumulates on top of Monday evening's
  post-market volume, and opens **$14.45** away from the session-correct VWAP,
  staying more than $0.50 wrong for 120 of its 193 bars. Neither hourly case is
  long enough to contain that.


---

## Phase C Task 14 — AVWAP · ATR bands · the RS line

Three cases, and **none of them owns a number that was not derivable from an
oracle already in this directory before the code under test existed.** That is
the same rule the SAR event columns were held to, applied to a task whose three
indicators are new rather than migrated.

### `avwap_session` — the anchor, and the UNIT it is measured in

`kind: "avwap"`, `params: {anchor: "session"}`, and **`barsFrom`
`vwap_extended_hours_utc_midnight.json`** — the third case in this directory to
own no bars, and the second whose referent is another fixture.

The referent already carries `session.etSessionVwap`: the ET-anchored VWAP,
written before this repo's Python lane had a VWAP at all and **never reseeded**.
AVWAP's `session` anchor is required to equal it **exactly**, in both lanes. So
the case is a derivation from something older, not a snapshot — and because
those same 17 bars are one ET session that the *retired* UTC-day bucketing splits
in two at the 20:00 ET bar, a lane that anchored on the UTC day could not satisfy
the column at 1e-9.

> ⚠️ **MEASURED LIMIT, DECLARED RATHER THAN WISHED AWAY.** On these bars
> `swingLow` is element-for-element EQUAL to `session` — they make their low on
> bar 0 and never re-make it, so the low anchor never moves off the session open.
> `swingHigh` differs, which is what makes "the `anchor` parameter is read" a
> measurement here. Both lanes assert the equality *and* the difference.

**The unit guard is separate from the anchor, and the distinction is the whole
point.** The anchor is resolved per instant from the IANA database — never from
how big the number is, and never from a module-load `_ET_OFFSET` that is an hour
wrong for half the year. What `AVWAP_MIN_INSTANT` (1990-01-01) decides is whether
a bar carries an *instant at all*:

* `_fetch_bars_for_alert` passes the store's `YYYYMMDD` integer where unix
  seconds are expected. `20250101` read as unix seconds is **1970-08-23**, two
  years of daily bars span 11,130 seconds, and 56 bars of "daily VWAP" produce
  exactly ONE reset — at index 0. Nothing raises. The line is plausible and wrong.
* **The refusal is an all-`null` column, never a one-bucket answer.** A
  one-bucket fallback and the 1970 defect are the *same output*, so a control
  could not tell them apart. Both lanes assert the all-null refusal against a
  positive control on the same calendar days in real unix seconds.
* The two **swing** anchors are pure price and are deliberately untouched by the
  guard — a guard that fired on them would refuse a column it has no reason to
  doubt.

### `atr_bands_14_2` — derived from a column both lanes already pinned

`kind: "atr_bands"`, `params: {period: 14, multiplier: 2}`, **`barsFrom`
`atr_14.json`**. Every number is `close ± 2 × <that fixture's committed `atr`>`,
which both lanes have asserted at rel-tol 1e-9 since B5 — so it cost no reseed
and a reseed of `atr_14` turns this case red.

All three columns share **one** head pad (index 14, where ATR starts): a middle
that existed where its edges did not would be a band with nothing to draw
between, which is the unrenderable shape `defSchema.validateBandEdges` refuses one
level up.

> ⚠️ **THE FIXTURE ALONE CANNOT SAY `multiplier` IS READ.** It is written at 2, so
> a compute that hardcoded 2.0 would keep it perfectly green while every user who
> moved the control got the same band. Both lanes therefore recompute at 1, 2.5
> and 3 and assert the edges move and the middle does not.

### `rs_line_spy` — the case with TWO series, and the field that carries the second

`kind: "rs_line"`. It owns `bars` **and a new sibling key, `benchmarkBars`** —
the only extension this task makes to the file shape:

```jsonc
"bars":          [ … the symbol … ],
"benchmarkBars": [ … the benchmark … ],
"expected": { "rsLine": [ … close / benchmarkClose … ] }
```

**⛔ THERE IS NO `rs_line` ROW IN `_CASE_COLUMNS`, AND THE ABSENCE IS
STRUCTURAL.** `compute_case(kind, bars, params)` carries ONE series, and spec §4's
`compute({bars, inputs, prevState, barstate})` carries one too — which is exactly
why decision A3 makes the definition `compute.kind: 'server'`. A row here would
have to smuggle the benchmark through `params`, and the dispatch would be lying
about its own shape at one row. So the case is read by a **dedicated test in each
lane** instead, at the same rel-tol: `test_rs_line_matches_the_golden_column_and_
JOINS_BY_TIME` in pytest, `rs_line_spy` in vitest. (Same shape as `vwap`'s
deliberate absence, for a different reason.)

Two claims only a two-series indicator can make, and both are in the fixture:

* **The join is BY TIME.** Bar 6's `t` is *absent* from `benchmarkBars` — a halt.
  So bar 6 is the ONE null and bars 7-11 are unmoved. Under an index join every
  ratio from bar 6 on would shift by one and the line would be plausible and
  wrong for the whole history rather than absent for one bar. That is also why
  this case's `expected` column has a hole in the MIDDLE, which no other case in
  this directory does: it is outside the "nulls first, then values" alignment
  rule, and it is asserted explicitly in both lanes rather than waived.
* **A single-symbol RS line is `1.0` on every bar.** `close / close`. That is the
  silent failure a native implementation would ship — a flat line that looks
  exactly like an indicator that is working — so both lanes name the number:
  `computeRSLine(bars, bars)` is all ones, and the fixture's own column is not.

> ⚠️ **Its delivery wrapper rounds at SIX decimals, not four.** Every other
> price-scale wrapper delivers a PRICE; this delivers a ratio near 0.10, where a
> 1e-4 quantum is ~1e-3 of the value against ~1e-6 for a price near 100. The
> wrappers are the boundary user thresholds are compared at (decision A4), so the
> precision has to suit the scale of the number rather than the habit of the
> module. Measured in `test_the_rs_line_wrapper_rounds_at_SIX_because_it_
> delivers_a_RATIO`.

### Regeneration is still banned

None of these three came from `_generate.py`. They were written by a one-off
script that asserted, **before writing a byte**: the AVWAP column equals the
referent's `etSessionVwap`; the UTC split is still measurable on those bars;
`anchor` changes the column; the ATR band columns equal `close ± mult × atr_14`'s
pinned column; the pads line up; a different multiplier moves the edges and not
the middle; the RS ratios equal a directly-computed list; the hole is exactly one
and not at the head; and `close/close` is all ones. The script is not committed —
same treatment as the SAR event cases, and for the same reason.

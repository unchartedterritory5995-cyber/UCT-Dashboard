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

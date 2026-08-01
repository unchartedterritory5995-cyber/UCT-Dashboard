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

This is the Python convention, adopted as the rule for both. The JS lane used to
*trim* — it returned a short array starting at the first computable bar — which
is why nothing could be compared position-by-position until Phase B1 Task 5
padded it.

**Degenerate inputs are outside this contract.** When a series is too short to
compute anything at all, Python returns an all-`None` array of input length and
JS returns `[]` (the renderer's "no pane" signal, preserved deliberately). No
fixture covers that case; unifying it belongs to the B2 binding layer, which is
where pane creation moves.

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
null` and a `"session"` block instead. They exist to pin a **bug class**, not a
value: `computeVWAP` buckets sessions by **UTC calendar day**, and a US
extended-hours session runs past UTC midnight, so the 8 PM ET bar starts a "new
day" and the cumulative VWAP resets in the middle of a live session. Regular
trading hours never hit it (09:30–16:00 ET is always one UTC day), which is
exactly why unit tests never caught it.

```jsonc
"session": {
  "etDate":  ["2026-06-10", ...],   // ET calendar day per bar (the correct bucket)
  "etHour":  [4, 5, ...],           // ET wall-clock hour per bar
  "utcDate": ["2026-06-10", ...],   // UTC calendar day per bar (what the code uses)
  "utcResetIndices": [0, 16],       // where TODAY's code restarts the accumulator
  "etResetIndices":  [0],           // where a correct ET-session bucketing would
  "etSessionVwap":   [ ... ]        // the series ET bucketing would have produced
}
```

The JS test asserts **today's** behaviour (so it is green now) and, alongside it,
that today's answer *materially differs* from `etSessionVwap` — so the case can
never quietly become vacuous. Fixing the bucketing (B3, with the session-aware
adapter) will turn the first assertion red on purpose: that red is the fix's
acceptance test, and the new expectation is already sitting in the fixture.

`Python has no VWAP`, so these two cases are asserted by the JS lane only.

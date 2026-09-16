# Provider control plan — the gate before the grind

> ⛔ **DESIGNED, NOT RUN.** Phase 8 is an audit. This is the exact validation to
> perform ONCE provider access is convenient, and nothing here may be executed
> before that. It replaces the Phase-6 "US 2015 full year" placeholder with a plan
> shaped by what the audit actually measured.

## Why it is not just "US 2015"

Phase 6 proposed one year of US. The audit changed two inputs:

1. **US is immune to the exchange-attribution defect** (measured: `no_venue` = 0, and
   a venue wrong between XNAS and XNYS is still inside `US_VENUES`). So a US control
   proves the PIPELINE but says nothing about whether NASDAQ/NYSE are trustworthy at
   their floor.
2. **NASDAQ/NYSE misattribution is an ERA effect** (2008 split 889/1,653; 2015 split
   1,240/1,719). The 2011 floor is the mitigation, so the thing to validate is that
   **the split is stable from 2011 onward** — a question no 2015-only window answers.

So the control is three windows, not one, and the extra two are cheap: their frames
are a subset of the US range and are already fetched.

## The windows

| # | universe | window | sessions | what it is for |
|---|---|---|---|---|
| A | US | 2015-01-02 → 2015-12-31 | ~252 | the full-year pipeline proof Phase 6 asked for |
| B | US | 2008-01-02 → 2008-06-30 | ~124 | the FLOOR window — the oldest data we would publish |
| C | NASDAQ + NYSE | 2011-01-03 → 2011-06-30 | ~124 ea. | the FLOOR window for the exchange universes |
| D | NASDAQ + NYSE | 2015-01-02 → 2015-06-30 | ~124 ea. | the same universes four years later, for the continuity check |

Total ≈ 872 swept sessions. Frames: ~1,000 adjusted (incl. warm-up) + ~872 raw. Every
one of them is reused by the grind, so the control costs nothing that the grind would
not have paid anyway.

## Invariants — each one PASS/FAIL, none tuned to a prior number

⛔ **Phase 1's values are comparison REFERENCES, not golden targets.** A control that
moves an output toward an old number has stopped testing anything.

| # | check | tolerance |
|---|---|---|
| 1 | **missing-frame policy** — every sweep date has BOTH an adjusted and a raw frame | zero missing; `build_frame` must refuse the chunk otherwise (this is the Phase-6 defect, so the control must also PROVE the refusal by deleting one cached raw frame and confirming the chunk is rejected) |
| 2 | **coverage** — `resolved / frame` per session | ≥ 0.95 every session; report min/mean. Measured ~0.977-0.980 |
| 3 | **denominator** — `universe_count` equals the eligible-member count `build_frame` reported | exact, every session |
| 4 | **denominator continuity** — day-over-day change in `universe_count` | no single-session jump > 10 % except the first session of the window |
| 5 | **percent domain** — every `pct_above_*`, `hi_ratio`, `lo_ratio` | 0 ≤ v ≤ 100, no exceptions |
| 6 | **count ≤ universe** — every count metric ≤ `universe_count` | no exceptions |
| 7 | **NETHL identity** — `net_new_high_low == new_52w_highs − new_52w_lows` | exact, every session |
| 8 | **A/D identity** — `adv_decline == advancing − declining` | exact, every session |
| 9 | **ratio identity** — `ratio_5day` reproduces the 5-day U4/D4 quotient | to stored precision |
| 10 | **finite + non-duplicate** — no NaN, no infinity, no duplicate `(universe, date, metric)` | zero |
| 11 | **source** — every written row is `close_recon` | zero others |
| 12 | **OHLC geometry** — `l ≤ o,c ≤ h` and the body is close-to-close | zero violations |
| 13 | **UCT untouched** — UCT row fingerprint before/after | identical |
| 14 | **applicability** — nothing in `PIT_UNPRODUCIBLE` or the non-portable set was written | zero rows |
| 15 | **resume equivalence** — interrupt mid-window, resume, compare row-by-row against an uninterrupted run | canonically identical |
| 16 | **idempotency** — re-run the same window | same row count, same values, other universes untouched |
| 17 | **exchange continuity (C vs D)** — NASDAQ share of `universe_count` (NASDAQ + NYSE) at 2011 vs 2015 | within 5 pp. Measured at 2015: 1,240 / (1,240+1,719) = 41.9 %. ⛔ A 2011 reading materially below that says the attribution cliff extends past the floor and the floor must move |
| 18 | **US floor sanity (B)** — US `universe_count` at 2008-01 vs the 2,607 measured at 2008-03-10 | within 10 % |
| 19 | **cross-universe coherence** — `US.universe_count ≥ NASDAQ.universe_count + NYSE.universe_count` on the same date | every overlapping session (US is a superset, not a union) |

## Anchor comparisons (reported, never asserted)

Phase 1/2 measured US A50 = 47.23 at 2015-03-10, and the Phase-6 control reproduced
47.20. Report the new number beside it. A drift of more than ~0.5 pp is a question to
answer, not a test to fail — the pipeline has legitimately changed since (the raw
frame guard, the applicability filter).

## Exit criteria

The grind is authorised when checks 1-19 pass on every window, check 17 in
particular, and the anchor comparisons are explained. Anything else stops and reports.

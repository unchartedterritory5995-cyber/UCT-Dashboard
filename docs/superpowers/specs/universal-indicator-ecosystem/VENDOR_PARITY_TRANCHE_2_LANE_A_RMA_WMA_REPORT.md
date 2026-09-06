# Vendor Parity Tranche 2 — Lane A, Third Batch (RMA + WMA)

Per explicit owner authorization following the SMA/EMA batch's acceptance: "Proceed with the next
bounded Lane A parity batch: RMA + WMA ONLY." Real TradingView capture → UCT comparison →
classification → mutation/non-vacuity → documentation, for exactly two functions. No other Lane A
function was touched. No product code was changed.

**Standing instruction from the prior review, preserved and applied here without exception**: EMA's
"INITIALIZATION CANDIDATE-VERIFIED" label was explicitly NOT upgraded to an unqualified "VERIFIED" —
the capture cannot expose TradingView's true historical initialization origin, and a small residual
delta remains. RMA's initialization label below is held to the identical, explicit standard.

---

## 1. RMA parity result

**VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR + INITIALIZATION CANDIDATE-VERIFIED.** 1,881 real
steady-state bars (index 150–2030 of a 2,031-bar SPY Daily capture, 2018-08-07..2026-09-04) agree with
the real vendor's `ta.rma(close,14)` to float precision, 0 disagreements, after excluding the true
13-bar period-warmup plus a measured 137-bar seed-convergence-lag region (index 13-149). This is the
**first standalone real-vendor confirmation** of the `_smooth_col` primitive `rma` shares with `ema` —
RMA underlies `rsi`, `atr`, and the ADX-family directly, and until this batch its own real-vendor
behavior had only ever been inferred through those composites (RISK-031's RSI/ATR batch) or a
spec-derived probe (`divergences.json::smoother-seeds-with-sma-of-first-window`, refuted at the spec
level in a prior session — agreement to 9.9e-14 against TradingView's published prose, never against a
real capture until now).

## 2. RMA initialization result

**Held to the identical evidentiary standard the prior review set for EMA — NOT upgraded to an
unqualified VERIFIED.** The same structural finding as EMA, measured independently on RMA's own real
data: a steady-state-only comparison cannot discriminate a wrong seeding convention. A "seed with the
first value instead of SMA(14)" mutation was run against the real steady-state check (`warmup_bars=150`)
and **it still passed** (0/1,881 disagreements) — the wrong seed's bounded error decays at the SAME
fixed rate (`1 - 1/14` per bar) a correct seed's error does, so by bar 150 either has already decayed
below tolerance. Kept as a permanent, intentionally-passing regression
(`tests/test_vendor_parity_rma_wma.py::test_MUTATION_rma_wrong_seed_is_NOT_caught_by_the_steady_state_check_alone`).

The real initialization evidence is the separate, targeted check on the 137 excluded early bars: UCT's
actual seeding convention (SMA of the first 14 closes) was compared against the wrong-seed alternative,
both evaluated on the SAME real captured bars against the SAME real vendor values —

| Bar index | Vendor | UCT (real seed) | \|Δ\| real | Wrong-seed candidate | \|Δ\| wrong-seed |
|---|---|---|---|---|---|
| 13 | 283.188808 | 284.832143 | 1.643335 | 285.263616 | 2.074808 |
| 20 | 285.964503 | 286.942716 | 0.978213 | 287.199555 | 1.235052 |
| 30 | 287.948049 | 288.414264 | 0.466215 | 288.536673 | 0.588624 |
| 40 | 289.714346 | 289.936544 | 0.222198 | 289.994884 | 0.280538 |

**UCT's real seeding convention was closer to the real vendor value on 137 of 137 (100%) of the early
bars this capture holds.** Permanent regression:
`tests/test_vendor_parity_rma_wma.py::test_rma_initialization_the_real_seeding_convention_matches_early_vendor_bars`.

**Why this is CANDIDATE-VERIFIED and not unqualified VERIFIED, stated explicitly per the standing
instruction**: this capture's window starts in 2018, decades after SPY's real ~1993 inception. It
cannot expose what TradingView's `ta.rma` actually does at a symbol's TRUE first-ever bar, and a small
residual delta (the 1.64-magnitude gap at bar 13 above) remains between UCT's real seed and the real
vendor value — consistent with, but not conclusive proof of, the exact SMA-of-window convention, only
that it is a MUCH closer match than a plausible wrong alternative. "Candidate-verified" names precisely
that: one specific alternative was discriminated against on real data; the full space of alternatives,
and the true historical origin, were not and cannot be from this capture.

## 3. WMA parity result

**VENDOR-PARITY VERIFIED — MULTI-BAR.** 2,012 real bars (index 19–2030) agree with the real vendor's
`ta.wma(close,20)` to **exact** float equality (max absolute delta: **0**, the tightest result of any
function this program has vendor-verified) — **zero exclusion beyond the function's own true 19-bar
period-warmup**, matching SMA's own structural finding: WMA is a memoryless, finite-impulse filter with
no capture-window seed-convergence lag, confirmed empirically rather than assumed.

## 4. Rows compared / excluded

| | Total bars | Vendor values recorded | True period-warmup | Additional excluded (seed-lag) | Genuine comparison |
|---|---|---|---|---|---|
| RMA | 2,031 | 2,018 (index 13+) | 13 (index 0-12) | 137 (index 13-149) | **1,881** (index 150-2030) |
| WMA | 2,031 | 2,012 (index 19+) | 19 (index 0-18) | **0** | **2,012** (index 19-2030) |

Both classes reported explicitly, never silently dropped — same discipline as every prior batch.

## 5. Max deltas

| | Compared (steady-state) | Disagreements | Max absolute delta |
|---|---|---|---|
| RMA | 1,881 | **0** | 6.4036e-05 (at the boundary bar; ~2e-7 relative) |
| WMA | 2,012 | **0** | **0** (exact) |

## 6. Mutation / non-vacuity results

Per the explicit instruction ("test at least: correct Wilder alpha=1/n, wrong EMA-style alpha=2/(n+1),
wrong seed convention" for RMA; "explicitly test a reversed-weight mutation... an incorrect denominator
mutation" for WMA):

1. **RMA wrong alpha (EMA-style `2/(n+1)` instead of Wilder's `1/n`)** — `_rma_col` monkeypatched.
   Result: **verdict flips to PARTIAL, 1,880/1,881 (99.9%) disagree** (one isolated bar coincided by
   chance — the overwhelming majority is the proof, not a literal 100%). Restored; unmutated
   re-verified clean immediately after.
2. **RMA wrong seed (first-value instead of SMA(14))** — see §2. **Confirmed NOT caught by the
   steady-state check alone** (0/1,881 disagree) — a deliberate, documented, intentionally-passing
   control, not a defect.
3. **WMA reversed weight orientation** (oldest bar weighted highest instead of newest) — `_window_
   weighted_mean` monkeypatched. Result: **verdict flips to PARTIAL, 2,012/2,012 (100%) disagree.**
4. **WMA wrong denominator** (divide by window size `n` instead of the true weight sum `n(n+1)/2`).
   Result: **verdict flips to PARTIAL, 2,012/2,012 (100%) disagree.**
5. **Vendor-source-refusal controls** — four poisoned-provenance tokens × two functions, all correctly
   raised `VendorSourceRefused`.

Permanent regression: `tests/test_vendor_parity_rma_wma.py` (18 tests, all passing, including the two
intentionally-passing controls per §2's own documented boundary).

## 7. Implications for already-verified RSI/ATR evidence

**None invalidated; this batch corroborates and explains, rather than changes, the RSI/ATR batch's own
findings — checked directly, not assumed.** RSI and ATR are composites built on RMA (RSI:
`rma(gain,n)/rma(loss,n)`; ATR: `rma(true_range,n)`). This batch's standalone RMA capture:

- **Confirms the shared mechanism**: RMA's own seed-convergence-lag pattern (measured boundary: bar 130
  of 2,031) is the SAME general phenomenon RISK-031 documented for RSI/ATR, now demonstrated on the
  primitive itself rather than only inferred through the composites.
- **Explains a previously-unexplained asymmetry**: standalone RMA converges FASTER (bar 130) than the
  RSI/ATR composites built on it (bar ~169-172, per `VENDOR_PARITY_TRANCHE_2_LANE_A_RSI_ATR_REPORT.md`).
  This is now understood rather than left as an unexamined gap: RSI/ATR each compound TWO independent
  RMA seed errors (avg-gain and avg-loss for RSI; the additional bar-0/true-range question for ATR),
  while a standalone `rma(close,14)` carries only its own single seed error — a longer composite decay
  tail is the expected consequence, not a new concern.
- **No semantic discrepancy was found** between RMA's real-vendor behavior and what RSI/ATR's own
  evidence already implied. No downgrade, re-classification, or re-capture of RSI/ATR is warranted or
  performed.

## 8. Exact vendor capture setup

- **Symbol/timeframe**: `AMEX:SPY`, Daily — same chart, same ~8-year window strategy as the SMA/EMA
  batch (RMA's own decay curve needed comparable runway to EMA's).
- **Oracle script** (Pine v5):
  ```
  //@version=5
  indicator("uct-rma-wma-parity-v1", overlay=false)
  rma14 = ta.rma(close, 14)
  wma20 = ta.wma(close, 20)
  plot(rma14, title="rma14")
  plot(wma20, title="wma20")
  ```
- **Source-entry mechanism**: the hardened OS-clipboard paste, verified byte-exact pre- and post-paste
  (`Ctrl+End` landed at line 7, matching the 6-line source's trailing newline) — no clipboard-collision
  hazard recurred this batch (verified length-matched immediately before every paste and export, per
  the prior batch's disclosed discipline; per explicit instruction, this is not re-elaborated as a
  finding since it did not recur or interfere with evidence capture).
- **Capture window**: **2,031 real trading-day bars, 2018-08-07 through 2026-09-04** — identical window
  to the SMA/EMA batch, chronologically sorted, no duplicate timestamps (verified directly).
- **Export mechanism**: identical to every prior batch — Table view → Download data, intercepted
  client-side, moved out via a real trusted-gesture click into the clipboard, read locally. No
  OS-level file download occurred.

## 9. Raw artifact paths

- `tests/fixtures/vendor/raw_captures/2026-09-06-tv_rma_wma_capture_spy.csv` (363,907 bytes).
- `tests/fixtures/vendor/observations/rma-close14-2026-09-06.json`,
  `tests/fixtures/vendor/observations/wma-close20-2026-09-06.json`.
- `tests/fixtures/vendor/parity/rma-close14-2026-09-06.json`,
  `tests/fixtures/vendor/parity/wma-close20-2026-09-06.json`.

## 10. `divergences.json` / `vendor_truth.py` — reused, not duplicated

RMA's seed-convergence-lag reuses the EXISTING general divergence row
(`recursive-smoother-cold-start-in-a-finite-capture`) via `expect.explains`, confirmed general and
function-agnostic. `python tools/vendor_truth.py --check` now reports 10 held observations, 10
parity-comparable, exits 0 with every delta EXPLAINED or matched.

## 11. Final qualified statuses

- **RMA → VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR + INITIALIZATION CANDIDATE-VERIFIED**
- **WMA → VENDOR-PARITY VERIFIED — MULTI-BAR**

## 12. Unresolved boundaries (explicitly disclosed)

- Same as EMA's: the initialization check used ONE alternative candidate (first-value seeding), not an
  exhaustive search; the true historical origin at SPY's actual inception remains unreachable from any
  capture this program holds.
- Per the explicit instruction, HMA, MACD, Stoch, and the ADX-family were NOT begun after this batch.

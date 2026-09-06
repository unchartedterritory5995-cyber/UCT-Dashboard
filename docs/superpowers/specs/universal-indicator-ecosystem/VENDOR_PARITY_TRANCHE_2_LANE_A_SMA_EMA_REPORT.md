# Vendor Parity Tranche 2 — Lane A, Second Batch (SMA + EMA)

Per explicit owner authorization following RISK-032's closure: "Proceed with the next bounded Lane A
parity batch: SMA + EMA ONLY." Real TradingView capture → UCT comparison → classification →
mutation/non-vacuity → documentation, for exactly two functions. No other Lane A function was touched.
No product code was changed.

Governing distinction, maintained throughout (unchanged from the RSI/ATR batch): **UCT TRANSLATOR
SUPPORTED ≠ CURRENT TRADINGVIEW COMPILES ≠ VENDOR VISUAL/SEMANTIC PARITY**, and — the finding this
batch adds — **STEADY-STATE AGREEMENT ≠ CORRECT INITIALIZATION.** A recursive smoother that eventually
converges to the right value proves nothing about whether its *seed* is the right one; §6 below is a
direct, measured demonstration of that gap, not a caveat added after the fact.

---

## 1. Exact vendor capture setup

- **Symbol/timeframe**: `AMEX:SPY`, Daily — same chart, same choice as the RSI/ATR batch, for
  continuity and because both are Wilder/RMA-adjacent capture-window questions.
- **Oracle script** (Pine v5):
  ```
  //@version=5
  indicator("uct-sma-ema-parity-v1", overlay=false)
  sma20 = ta.sma(close, 20)
  ema20 = ta.ema(close, 20)
  plot(sma20, title="sma20")
  plot(ema20, title="ema20")
  ```
- **Source-entry mechanism**: the same hardened OS-clipboard paste. **One real hazard hit and handled
  this session, disclosed rather than smoothed over**: this machine runs more than one active session,
  and the OS clipboard is a single, shared, machine-wide resource. Mid-paste, an unrelated concurrent
  session (a different program's Notebook/Wave-4 sandbox-safety discussion) overwrote the clipboard
  between this tool's `Set-Clipboard` and the browser's `Ctrl+V`, silently producing a paste that landed
  as a no-op (verified: the editor still showed the OLD script, not corrupted, not the intruding text
  either — Monaco simply didn't receive a paste event that round). Recovered by re-verifying clipboard
  content immediately before every paste attempt (already-standing discipline) and — the part that
  actually fixed it — running the click/select/paste sequence as **separate, non-batched tool calls**
  rather than one batched sequence; the batched form intermittently failed to register the paste even
  with correct clipboard content, while separate calls succeeded cleanly every time. Verified byte-exact
  the same way as every prior capture: `Ctrl+End` landed at line 7 (matching the 6-line source's
  trailing newline) before any export was attempted.
- **Capture window**: chart history scrolled back before export to get a long enough runway (see §9).
  Final capture: **2,031 real trading-day bars, 2018-08-07 through 2026-09-04** (~8 years) — the widest
  capture this program has taken, chronologically sorted, no duplicate timestamps (verified directly).
- **Export mechanism**: identical to the RSI/ATR batch — Table view → Download data, intercepted
  client-side via a hooked `URL.createObjectURL`, moved out via a real trusted-gesture click into
  `navigator.clipboard.writeText`, read locally via `Get-Clipboard`. No OS-level file download occurred.
  This export ALSO cleanly avoided the clipboard-collision hazard (verified length-matched immediately).
- **Cross-check for free**: the chart's own pre-existing "Uncharted Clouds" indicator plots `EMA(close,
  9)`/`EMA(close,20)` as its "Fast MA"/"Slow MA" columns. Its `EMA(close,20)` ("Slow MA") column is
  numerically **identical** to this capture's own `ema20` column at every row checked — an independent,
  incidental confirmation that TradingView itself computes `ta.ema(close,20)` consistently across two
  different indicators on the same chart.

## 2. Raw artifact paths

- `tests/fixtures/vendor/raw_captures/2026-09-06-tv_sma_ema_capture_spy.csv` (362,279 bytes).
- `tests/fixtures/vendor/observations/sma-close20-2026-09-06.json`,
  `tests/fixtures/vendor/observations/ema-close20-2026-09-06.json`.
- `tests/fixtures/vendor/parity/sma-close20-2026-09-06.json`,
  `tests/fixtures/vendor/parity/ema-close20-2026-09-06.json`.

## 3. Exact row counts

| | Total bars | Vendor values recorded | True period-warmup | Additional excluded (seed-lag) | Genuine comparison |
|---|---|---|---|---|---|
| SMA | 2,031 | 2,012 (index 19+) | 19 (index 0-18) | **0** | **2,012** (index 19-2030) |
| EMA | 2,031 | 2,012 (index 19+) | 19 (index 0-18) | 81 (index 19-99) | **1,931** (index 100-2030) |

**SMA needs zero additional margin beyond its true period-warmup** — the structural claim proven in §5.

## 4. Usable/excluded rows, with exact exclusion reasons

Two classes, both reported explicitly, never silently dropped — same discipline as the RSI/ATR batch:
1. **True period-warmup (indices 0-18, 19 bars each)** — `sma(close,20)`/`ema(close,20)` are structurally
   incapable of a value before 20 bars exist. No `vendor.values` entry recorded for these bars.
2. **Seed-convergence-lag region — EMA ONLY (indices 19-99, 81 bars)** — genuinely computable, carries a
   real vendor value, marked `is_warmup=True`. SMA has **no such region** (see §5/§9).

## 5. Max deltas

| | Compared (steady-state) | Disagreements | Max absolute delta | Evidence-qualified label |
|---|---|---|---|---|
| SMA | 2,012 | **0** | 1.47793e-12 | **VENDOR-PARITY VERIFIED — MULTI-BAR** |
| EMA | 1,931 | **0** | 0.000121761 (at the boundary bar; ~1e-7 relative) | **VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR + INITIALIZATION CANDIDATE-VERIFIED** |

SMA's max delta (1.48e-12) is pure float-precision noise at 2,012 bars with **zero exclusion margin
beyond the true period-warmup** — the strongest, least-qualified result of any function this program
has vendor-verified to date. EMA's label is explained fully in §6.

## 6. The initialization finding — why EMA's label carries a third qualifier

**The steady-state check alone cannot discriminate a wrong seeding convention — measured directly, not
assumed.** A mutation that seeds EMA with the single first finite value (instead of the real convention,
SMA of the first window) was run against the SAME steady-state comparison used for §5's real result,
at `warmup_bars=100`:

```
EMA wrong-seed verdict: VENDOR-PARITY VERIFIED   disagreements: 0 / 1931
```

**It still passed.** This is not a bug in the check — it is a real, structural fact about exponential
smoothers: a *bounded* seed error decays at the filter's own fixed rate regardless of which bounded seed
produced it, so by bar 100 the wrong-seed error has decayed below 1e-6 relative *exactly as the correct
seed's error does*. A steady-state check that only looks past the excluded region is, by construction,
blind to which seed was used — it can only ever prove "the recursion eventually converges," never
"the recursion started from the right place." Per the explicit instruction not to assume the steady-state
formula is enough, this was checked directly rather than assumed away, and the result is now a permanent,
intentionally-passing regression
(`tests/test_vendor_parity_sma_ema.py::test_MUTATION_wrong_seed_is_NOT_caught_by_the_steady_state_check_alone`)
— a documented boundary, not a fixed defect.

**The actual initialization proof is a separate, targeted check**, using the excluded early region
directly instead of discarding it: for each of the 81 real early bars (index 19-99), UCT's REAL seeding
convention (`_ema_col`'s SMA-of-first-window seed) and the wrong-seed alternative were both evaluated
against the SAME real captured bars, and each was compared to the real vendor's own value at that bar:

| Bar index | Vendor | UCT (real seed) | \|Δ\| real | Wrong-seed candidate | \|Δ\| wrong-seed |
|---|---|---|---|---|---|
| 19 | 286.866358 | 286.462500 | 0.403858 | 287.533560 | 0.667203 |
| 25 | 287.624564 | 287.403033 | 0.221531 | 287.990549 | 0.365985 |
| 30 | 288.818016 | 288.683707 | 0.134309 | 289.039905 | 0.221889 |
| 40 | 290.397543 | 290.348175 | 0.049368 | 290.479103 | 0.081560 |

**UCT's real seeding convention was closer to the real vendor value on 81 of 81 (100%) of the early bars
this capture holds** — not merely "eventually the same," but demonstrably tracking the real vendor's
own early trajectory more tightly than a plausible, structurally-identical alternative would, at every
single early bar checked. This is what makes the initialization claim non-vacuous: it uses real vendor
data specifically in the region a steady-state check would discard, exactly mirroring this program's own
established "real vendor data for the rejected candidate" methodology (RISK-018b's multibar audit).
Permanent regression:
`tests/test_vendor_parity_sma_ema.py::test_ema_initialization_the_real_seeding_convention_matches_early_vendor_bars`.

**Why SMA needed none of this**: SMA is a finite-impulse (memoryless) filter — its value at any bar
depends ONLY on the trailing 20 bars, with no persisted state from before the window. There is no "seed"
to get right or wrong, and therefore no initialization question to investigate — confirmed, not assumed,
by §5's own zero-exclusion, zero-disagreement result.

## 7. SMA final parity status

**VENDOR-PARITY VERIFIED — MULTI-BAR.** 2,012 real, current-market bars agree with the real vendor's
`ta.sma(close,20)` to float precision, with **zero exclusion beyond the function's own true 20-bar
period-warmup** — no seed-convergence-lag qualifier is needed or applied, unlike every other function
this program has vendor-verified so far (rsi, atr, ema).

## 8. EMA final parity status

**VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR + INITIALIZATION CANDIDATE-VERIFIED.** The
steady-state half (1,931 bars, 0 disagreements past the measured seed-convergence boundary) matches the
RSI/ATR batch's own label shape. The "INITIALIZATION CANDIDATE-VERIFIED" qualifier names, precisely,
what §6 actually proved: UCT's real SMA-of-window seeding convention was directly checked against a
real alternative on real early-vendor-bar data (not merely assumed to be fine because the steady state
matches) and found to track the real vendor's early trajectory on 81/81 bars — while ALSO disclosing,
in the same breath, that the steady-state check alone could not have told the two conventions apart.

## 9. Capture-window sizing — why this batch used a much larger window than RSI/ATR

The RSI/ATR batch's own decay curve (last disagreement at bar ~170 of 1,328) informed this batch's
capture strategy directly: the chart history was scrolled back further BEFORE export (2018 vs. 2021),
anticipating that EMA's own seed-convergence tail — while measured smaller than RSI/ATR's — would still
need a comparable multiple of genuinely clean steady-state bars afterward to be a meaningful multi-bar
claim. This produced 2,031 bars (vs. 1,328), giving EMA a full 1,931-bar clean tail even after excluding
its own 81-bar lag region, and (incidentally) let SMA's own zero-lag claim rest on the largest bar count
of any function this program has vendor-verified.

## 10. Mutation / non-vacuity results

Per the explicit instruction (#7: "SMA wrong denominator/window must fail"; "EMA wrong alpha or wrong
seeding must fail"), four checks plus the provenance-refusal controls, all against the real observations
via `tools/vendor_parity_compare.py::compare`:

1. **SMA wrong denominator** — `_window_mean` monkeypatched to divide by `(window size + 1)` instead of
   the true window size. Result: **verdict flips to PARTIAL, 2,012/2,012 (100%) disagree.** Restored;
   unmutated re-verified clean immediately after.
2. **EMA wrong alpha** — `_ema_col` monkeypatched to use `3×` the real smoothing constant. Result:
   **verdict flips to PARTIAL, 1,931/1,931 (100%) disagree.** Same restore-and-reverify discipline.
3. **EMA wrong seeding — the confirmed-vacuous control, §6.** Does NOT flip the steady-state verdict
   (0/1,931 disagree) — kept and asserted as a PASSING test on purpose, documenting the real boundary of
   what a steady-state-only check can prove, per explicit instruction not to assume the formula check is
   enough.
4. **EMA wrong seeding — the real initialization check, §6.** Discriminates 81/81 (100%) on real early
   vendor bars, using the SAME two candidates as check 3 — proving the initialization claim the
   steady-state check alone cannot.
5. **Vendor-source-refusal controls** — four poisoned-provenance tokens × two functions, all correctly
   raised `VendorSourceRefused`.

All behaviors matched what each check was designed to prove or disprove — including the one designed to
FAIL to discriminate, which is as important a result as the ones that succeed. Permanent regression:
`tests/test_vendor_parity_sma_ema.py` (17 tests, all passing).

## 11. `divergences.json` — reused, not duplicated

EMA's seed-convergence-lag reuses the EXISTING general divergence row from the RSI/ATR batch
(`recursive-smoother-cold-start-in-a-finite-capture`) via the same `expect.explains` mechanism —
confirmed by direct code read to be a general, function-agnostic finding (any Wilder/RMA/EMA-style
recursive smoother captured over a finite window shows the same shape), not something requiring a new
row. `python tools/vendor_truth.py --check` now reports 8 held observations, 8 parity-comparable, exits
0 with all deltas EXPLAINED or matched.

## 12. Unresolved boundaries (explicitly disclosed)

- The initialization check (§6) used ONE alternative candidate (first-value seeding) — a plausible,
  structurally-identical wrong convention, not an exhaustive search of every possible seeding scheme. A
  different wrong candidate might behave differently; not tested.
- SMA's "zero seed-convergence-lag" claim is specific to a plain, unconditional `sma(close,20)` — it does
  not generalize to a COMPOSED argument (e.g. `sma(ema(close,9), 20)`), which was not captured or tested
  here.
- Per the explicit instruction, no further Lane A function was captured — `sma`/`ema` alone.

## 13. Housekeeping (RISK-033, no scope reopened)

The owner asked that the incidentally-discovered stale dual-kernel conformance snapshot (RISK-033) be
recorded as a documentation/evidence housekeeping item if it could be done without reopening scope. It
remains exactly as filed in `RISK_REGISTER.md` — **not actioned** (`ast_conformance.py --record` was not
run; doing so would touch a shared, human-provenance-gated artifact outside this batch's 2-function
scope). No new information changes its status; this section exists only to confirm it was re-checked, not
forgotten, and remains open for a future, separately-authorized pass.

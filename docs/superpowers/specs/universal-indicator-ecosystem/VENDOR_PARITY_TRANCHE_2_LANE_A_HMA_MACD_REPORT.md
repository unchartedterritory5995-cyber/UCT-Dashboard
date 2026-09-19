# Vendor Parity Tranche 2 — Lane A, Fourth Batch (HMA + MACD)

Per explicit owner authorization following the RMA/WMA batch's acceptance: "Proceed with the next
bounded Lane A parity batch: HMA + MACD ONLY. Do not begin Stoch or ADX-family yet." Real TradingView
capture → UCT comparison → classification → mutation/non-vacuity → documentation, for exactly two
functions (MACD treated as its three separate outputs). No other Lane A function was touched. No
product code was changed.

**Standing instructions from prior reviews, preserved and applied here without exception**: qualified
statuses are never overclaimed (per the EMA/RMA "candidate-verified, not unqualified verified"
precedent); MACD's three outputs are captured and compared as fully separate observations so that no
output's agreement can mask another's disagreement, per the explicit authorization.

---

## 1. HMA parity result

**VENDOR-PARITY VERIFIED — MULTI-BAR.** 2,009 real steady-state bars (index 22–2030 of a 2,031-bar SPY
Daily capture, 2018-08-07..2026-09-04) agree with the real vendor's `ta.hma(close,20)` to **exact**
float equality (max absolute delta: **0**) — **zero exclusion beyond the function's own true 22-bar
structural period-warmup**, matching sma/wma's own structural finding: HMA is a memoryless,
finite-impulse construction (composed entirely of `wma` calls, with no recursive/leaky state) with no
capture-window seed-convergence lag, confirmed empirically rather than assumed. This **ties WMA** for
the tightest result this program has vendor-verified.

## 2. HMA rounding findings

Verified directly against the real Pine construction, not assumed:
- **Half-window**: `half = max(1, int(20)//2) = 10` — floor division, confirmed correct (a
  reversed-weighting mutation and an off-by-one half-length mutation both flip the verdict to PARTIAL,
  proving the real value depends on getting this exactly right).
- **Sqrt-window (root)**: `root = max(1, floor(sqrt(20) + 0.5)) = floor(4.9721) = 4` — round-half-up,
  NOT Python's banker's-rounding `round()` and NOT `ceil()`. A `ceil()` mutation (root=5 instead of 4)
  flips the verdict to PARTIAL (2,007/2,008 disagree) — confirming Pine's real rounding convention is
  round-half-up, not ceiling, exactly as `_hma_col`'s own already-existing code comment states.
- This exact half/root construction was **already** spec-confirmed to agree with Pine's published
  definition via `divergences.json::hull-half-window-floors` (status: `confirmed`, from a 2026-08-29
  session). This batch is the **first real-vendor-runtime confirmation** of that same spec-derived
  finding — not a new claim, but a genuine upgrade in evidentiary strength (spec prose → real TradingView
  output on 2,009 real bars).
- **Arithmetic coefficient**: `raw = 2.0*near - full` — a `1.5*near - 0.5*full` mutation flips the
  verdict to PARTIAL (2,009/2,009 disagree), confirming the coefficient must be exactly 2/-1, not merely
  "some weighted blend of the two WMAs."

## 3. MACD line result

**VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR.** 1,821 real steady-state bars (index 210–2030)
agree with the real vendor's `ta.macd(close,12,26,9)`'s line output to float precision (max absolute
delta 4.6e-08), after excluding the true 25-bar period-warmup (`max(fast,slow)-1`) plus a measured
185-bar seed-convergence-lag region (index 25-209). UCT's shipped `macd(source,fastPeriod,slowPeriod)`
builtin exposes only this output; internally it is `fast_ema(12) - slow_ema(26)`, each an SMA-of-
first-window-seeded exponential smoother (`indicator_compute._ema_core`) — recursive/leaky, carrying
the same general capture-window cold-start lag already documented for ema/rma/rsi/atr, and compounding
TWO independent EMA seed errors (fast and slow) rather than one.

## 4. Signal line result

**VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR.** 1,821 real steady-state bars (index 210–2030)
agree with the real vendor's signal output to float precision (max absolute delta 6.8e-08), after
excluding the true 33-bar period-warmup (`max(fast,slow)-1+signal-1`) plus a measured 191-bar
seed-convergence-lag region (index 33-209). UCT has no native signal-line builtin — per
`closedTable.json::_functions_excluded.macdSignal`'s own documented convention, a member composes it as
`ema(macd(close,12,26), 9)`, using `ast_interpret._ema_col` — an EMA applied to the (already-lagging)
macd LINE. This composition is twice-recursive: its own SMA-of-window seed compounds on top of the
line's own seed error, and (as expected, since it is a longer/deeper composite) its own last-disagreement
index (197) is later than the line's own (191).

## 5. Histogram result

**VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR.** 1,821 real steady-state bars (index 210–2030)
agree with the real vendor's histogram output to float precision (max absolute delta 2.2e-08), after
excluding the same 33-bar true period-warmup (undefined until both line and signal are) plus a measured
183-bar seed-convergence-lag region. UCT composes it as `macd(close,12,26) - ema(macd(close,12,26), 9)`,
per the same documented convention. Its own measured last-disagreement index (183) is **earlier** than
either component's own (191 for the line, 197 for the signal) — the line's and signal's seed errors
partially offset in the subtraction rather than simply summing; measured directly, not assumed from
"the later of the two components'."

## 6. Warm-up / convergence boundaries

| | True structural period-warmup | Measured last-disagreement index | Chosen `_vendor_parity_warmup_bars` |
|---|---|---|---|
| HMA | 22 | **none (−1)** — zero disagreements found anywhere past the structural warmup | **22** (exact, no margin) |
| MACD line | 25 | 191 | 210 |
| MACD signal | 33 | 197 | 210 |
| MACD histogram | 33 | 183 | 210 |

Per the established convention (RSI/ATR/EMA/RMA reports), the chosen `_vendor_parity_warmup_bars` for
each recursive MACD output is a conservative ROUND NUMBER past its own empirically-measured
last-disagreement index — never the semantic period-warmup, and never silently equated with it. All
three MACD outputs share the round number 210 for simplicity; each carries its own separately-measured
last-disagreement index in its own observation's `_vendor_parity_warmup_bars_note`. HMA needed no such
margin at all — its own measured last-disagreement index is `-1` (none found), so its
`_vendor_parity_warmup_bars` is set to the exact structural value (22).

## 7. Rows compared / excluded

| | Total bars | Vendor values recorded | True period-warmup (no vendor value) | Additional excluded (seed-lag, real vendor value, `is_warmup`) | Genuine comparison |
|---|---|---|---|---|---|
| HMA | 2,031 | 2,009 (index 22+) | 22 (index 0-21) | **0** | **2,009** (index 22-2030) |
| MACD line | 2,031 | 2,006 (index 25+) | 25 (index 0-24) | 185 (index 25-209) | **1,821** (index 210-2030) |
| MACD signal | 2,031 | 1,998 (index 33+) | 33 (index 0-32) | 177 (index 33-209) | **1,821** (index 210-2030) |
| MACD histogram | 2,031 | 1,998 (index 33+) | 33 (index 0-32) | 177 (index 33-209) | **1,821** (index 210-2030) |

All four classes reported explicitly, never silently dropped — same discipline as every prior batch.
The true period-warmup bars carry **no** `vendor.values` entry at all (per the RSI/ATR batch's own
established fix for `vendor_truth.py --check`'s unconditional "blank" failure — a bar UCT cannot compute
must never be recorded as a comparable vendor value, or the check reports a false "blank" defect); the
seed-lag region bars DO carry a real vendor value and are reported as `WARMUP_DELTA`/`AGREE`, never
silently dropped, and never counted toward the verdict.

## 8. Max deltas

| | Compared (steady-state) | Disagreements | Max absolute delta |
|---|---|---|---|
| HMA | 2,009 | **0** | **0** (exact — ties WMA) |
| MACD line | 1,821 | **0** | 4.60137e-08 |
| MACD signal | 1,821 | **0** | 6.76673e-08 |
| MACD histogram | 1,821 | **0** | 2.16535e-08 |

## 9. Mutation / non-vacuity results

Per the explicit instruction (HMA: "reversed/incorrect WMA weighting, wrong half-length rounding, wrong
sqrt-length rounding, wrong arithmetic coefficient"; MACD: "swapped fast/slow lengths, wrong EMA alpha,
wrong signal smoothing, histogram sign inversion"), all run against the real observations via
`tools/vendor_parity_compare.py::compare`:

1. **HMA reversed WMA weighting** — `_window_weighted_mean` monkeypatched (oldest bar weighted highest).
   Result: **verdict flips to PARTIAL, 2,009/2,009 (100%) disagree.**
2. **HMA wrong half-length rounding** — `_hma_col` monkeypatched with `half+1` (off-by-one). Result:
   **verdict flips to PARTIAL, 2,009/2,009 (100%) disagree.**
3. **HMA wrong sqrt-length rounding** — `_hma_col` monkeypatched with `ceil(sqrt(n))` (root=5 instead of
   4). Result: **verdict flips to PARTIAL, 2,007/2,008 (~100%) disagree.**
4. **HMA wrong arithmetic coefficient** — `_hma_col` monkeypatched with `1.5*near - 0.5*full`. Result:
   **verdict flips to PARTIAL, 2,009/2,009 (100%) disagree.**
5. **MACD swapped fast/slow lengths** — an AST with `fast=26, slow=12` (reversed) raises `TableRefusal`
   at the table/budget level (`ast_budget._assert_arg_domain`, "a period reaches past the window its own
   entry declares") **before any computation is attempted** — a STRONGER protection than a silently
   wrong number or even a DATA_BLOCKED result. Not previously exercised by any Lane A batch; a genuine
   new finding about UCT's own robustness, not a gap.
6. **MACD wrong EMA alpha, isolated to the LINE** (`indicator_compute._ema_core` monkeypatched to
   Wilder's `1/period` instead of `2/(period+1)`) — **all three outputs flip to PARTIAL** (line, signal,
   AND histogram, each 1,821/1,821 disagree). This is the EXPECTED, NOT-masked propagation direction: the
   signal and histogram are built on the line's own (now-wrong) output, so their disagreement is a
   correct consequence, not evidence they are separately broken.
7. **MACD wrong signal smoothing, isolated to the SIGNAL** (`ast_interpret._ema_col` monkeypatched to
   Wilder's `1/n`) — **⭐⭐ the isolation proof**: the LINE stays VENDOR-PARITY VERIFIED (0/1,821
   disagree, completely unaffected), while the signal AND histogram both flip to PARTIAL (1,821/1,821
   each). This directly demonstrates the architectural separation the authorization asked to be verified:
   the composed signal formula's own smoother (`ast_interpret._ema_col`) is NOT the same code path as
   the line's own internal fast/slow EMAs (`indicator_compute._ema_core`) — mutating one cannot corrupt
   the other, and the parity check correctly reflects that isolation rather than masking it.
8. **MACD histogram sign inversion** (`signal - line` instead of `line - signal`) — **verdict flips to
   PARTIAL, 1,821/1,821 (100%) disagree**; the line and signal observations, evaluated separately, remain
   VENDOR-PARITY VERIFIED and are unaffected by a mutation applied only to the histogram's own AST.
9. **Vendor-source-refusal controls** — four poisoned-provenance tokens × four observations (16 total),
   all correctly raised `VendorSourceRefused`.

Every mutation was followed immediately by an unmutated control re-verifying clean, confirming the
mutation (not some persistent monkeypatch leak) caused the flip. Permanent regression:
`tests/test_vendor_parity_hma_macd.py` (33 tests, all passing).

## 10. Implications for WMA/EMA confidence

**None invalidated; this batch corroborates and extends, rather than changes, the WMA and EMA batches'
own findings — checked directly, not assumed.**
- **WMA**: HMA's own zero-lag, exact-0-delta result is a SECOND independent confirmation (after WMA
  itself) that a purely finite-impulse, `wma`-composed construction carries no capture-window
  seed-convergence lag on this exact capture window. HMA is built ENTIRELY from `wma` calls (never `sma`,
  `ema`, or `rma`), so this is also indirect corroboration that `_window_weighted_mean` (WMA's own core
  primitive) behaves correctly across three different window sizes (10, 20, and 4-bar-of-raw) in the
  same real capture, not merely at `wma(close,20)`'s own single window size.
- **EMA**: MACD line's internal fast(12)/slow(26) EMAs are a THIRD and FOURTH independent real-vendor
  confirmation of the shared `indicator_compute._ema_core` primitive's correctness (distinct from
  `ast_interpret._ema_col`, which the EMA batch itself vendor-verified, and from RMA's own confirmation of
  the sibling `_smooth_col`-based primitive) — at two DIFFERENT periods (12 and 26) neither previously
  tested standalone. No semantic discrepancy was found between either EMA implementation's real-vendor
  behavior and what the EMA batch's own evidence already implied. No downgrade, re-classification, or
  re-capture of EMA (or SMA, RMA, WMA, RSI, ATR) is warranted or performed.

## 11. Final qualified statuses

- **HMA → VENDOR-PARITY VERIFIED — MULTI-BAR**
- **MACD LINE → VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR**
- **MACD SIGNAL → VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR**
- **MACD HISTOGRAM → VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR**

None of the four outputs required an "INITIALIZATION CANDIDATE-VERIFIED" qualifier or a
"PARTIAL — ROUNDING BEHAVIOR UNVERIFIED" qualifier: HMA's rounding behavior was directly, mutation-
confirmed correct (§2), and MACD's three outputs each achieved a clean steady-state-only verdict without
any initialization-discrimination question being raised by the authorization for this batch (unlike
EMA/RMA, MACD's own seeding convention was not asked to be separately proven against a real-early-bar
candidate check — only its steady-state agreement and its cross-output isolation were).

## 12. Exact vendor capture setup

- **Symbol/timeframe**: `AMEX:SPY`, Daily — same chart, same ~8-year window as the SMA/EMA and RMA/WMA
  batches.
- **Oracle script** (Pine v5):
  ```
  //@version=5
  indicator("uct-hma-macd-parity-v1", overlay=false)
  hma20 = ta.hma(close, 20)
  [macdLine, signalLine, histLine] = ta.macd(close, 12, 26, 9)
  plot(hma20, title="hma20")
  plot(macdLine, title="macdLine")
  plot(signalLine, title="signalLine")
  plot(histLine, title="histLine")
  ```
- **Source-entry mechanism**: the hardened OS-clipboard paste, issued as SEPARATE (non-batched) tool
  calls per the fix established in the SMA/EMA and RMA/WMA batches — confirmed working on the first
  attempt this batch, byte-exact match verified via a zoomed screenshot with no retry needed. No
  clipboard-collision hazard recurred (verified length-matched immediately before every paste/export, per
  explicit instruction not to re-elaborate this as a finding unless it recurred materially).
- **Capture window**: **2,031 real trading-day bars, 2018-08-07 through 2026-09-04** — identical window
  to the SMA/EMA and RMA/WMA batches, chronologically sorted, no duplicate timestamps (verified directly).
- **Export mechanism**: identical to every prior batch — Table view → Download data, intercepted
  client-side via a hooked `URL.createObjectURL`, moved out via a real trusted-gesture click into the
  clipboard, read locally. No OS-level file download occurred. The Table view export required scrolling
  the table horizontally to reach the new indicator's columns (`hma20`, `macdLine`, `signalLine`,
  `histLine`) — visually confirmed against the live legend values before export
  (`766.69 / 3.07 / 3.73 / -0.6643`, internally consistent since histogram ≈ line − signal).

## Raw artifact paths

- `tests/fixtures/vendor/raw_captures/2026-09-06-tv_hma_macd_capture_spy.csv` (443,033 bytes).
- `tests/fixtures/vendor/observations/hma-close20-2026-09-06.json`,
  `tests/fixtures/vendor/observations/macd-line-12-26-2026-09-06.json`,
  `tests/fixtures/vendor/observations/macd-signal-12-26-9-2026-09-06.json`,
  `tests/fixtures/vendor/observations/macd-hist-12-26-9-2026-09-06.json`.
- `tests/fixtures/vendor/parity/hma-close20-2026-09-06.json`,
  `tests/fixtures/vendor/parity/macd-line-12-26-2026-09-06.json`,
  `tests/fixtures/vendor/parity/macd-signal-12-26-9-2026-09-06.json`,
  `tests/fixtures/vendor/parity/macd-hist-12-26-9-2026-09-06.json`.

## `divergences.json` / `vendor_truth.py` — reused, not duplicated

MACD line/signal/histogram's seed-convergence-lag reuses the EXISTING general divergence row
(`recursive-smoother-cold-start-in-a-finite-capture`) via `expect.explains`, confirmed general and
function-agnostic across five now-independent recursive-smoother contexts (ema, rma, rsi, atr, macd).
HMA needed no `expect.explains` entry — like sma/wma, it carries no divergence to explain.
`python tools/vendor_truth.py --check` now reports 14 held observations, 14 parity-comparable, exits 0
with every delta EXPLAINED or matched (verified live, 2026-09-06).

## Unresolved boundaries (explicitly disclosed)

- HMA's rounding behavior was verified only at `n=20` (half=10, root=4) — a different `n` producing a
  different half/root combination (e.g. an `n` where `sqrt(n)` lands near a different rounding boundary)
  was not separately captured or tested.
- The swapped-fast/slow `TableRefusal` finding (§9 item 5) confirms UCT refuses that specific malformed
  input; it does not test every other way a member could misconfigure `macd`'s arguments.
- Per the explicit instruction, Stoch and the ADX-family were NOT begun after this batch. **Stop after
  HMA + MACD**, honored.

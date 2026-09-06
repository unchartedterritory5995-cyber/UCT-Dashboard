# Vendor Parity Tranche 2 — Lane A, First Batch (RSI + ATR)

Per `PHASE_TWO_PLAN.md` §2 Lane A and `VENDOR_PARITY_TRANCHE_2_READINESS_REPORT.md`'s recommended
first batch. Real TradingView capture → UCT comparison → classification → mutation/non-vacuity →
documentation, for exactly two functions: `rsi(close, 14)` and `atr(high, low, close, 14)`. No other
Lane A function was touched. No product code was changed.

## 1. Exact vendor capture setup

- **Symbol/timeframe**: `AMEX:SPY`, Daily — same choice the readiness report specified (real market
  data, not synthetic; ATR's own open question is specifically about real-series bar alignment).
- **Chart**: `jHASRSzx` (owner's account, TSDR_TRADING), the same chart used by every prior Track A/
  Layer C capture this program has made.
- **Oracle script** (Pine v5, added to a fresh "Untitled script" tab, never touching the pre-existing
  "Uncharted Scanners" indicator):
  ```
  //@version=5
  indicator("uct-rsi-atr-parity-v1", overlay=false)
  rsi14 = ta.rsi(close, 14)
  atr14 = ta.atr(14)
  plot(rsi14, title="rsi14")
  plot(atr14, title="atr14")
  ```
- **Source-entry mechanism**: the same hardened OS-clipboard paste this program's most recent
  closeout established (`Get-Content -Raw | Set-Clipboard`, verified byte-exact pre-paste; `Ctrl+End`
  line-count-verified post-paste — landed at line 7, matching the 6-line source's trailing newline).
- **Compile/render**: zero errors; object-tree legend resolved live values (`55.61  6.22` at time of
  add), confirming genuine execution, not a placeholder.
- **Capture window**: the chart's history buffer was deliberately scrolled/panned back before export
  (three successive exports of growing size — 300, 405, then 1,328 rows) specifically to get enough
  runway to separate the true 14-bar period-warmup from a much longer seed-convergence lag (§9 below).
  The final, authoritative capture holds **1,328 real trading-day bars, 2021-05-24 through
  2026-09-04** — chronologically sorted, no duplicate timestamps (verified directly).
- **Export mechanism**: right-click chart → Table view → Download data. The CSV download was
  intercepted client-side (`URL.createObjectURL` hook, same technique the 2026-09-05 oracle-capture
  raw-artifact upgrade used) and moved out of the page via a real, trusted-gesture click into
  `navigator.clipboard.writeText`, then read locally via `Get-Clipboard`. No OS-level file download to
  disk occurred. Length matched exactly at every step (clipboard length == captured blob length ==
  saved file length).
- **Precision**: full double-precision floats (e.g. `atr14=6.219020531481768`), not the 2-decimal
  Table-view-display rounding earlier captures needed before Premium/Plus CSV export was available.

## 2. Raw artifact paths

- `tests/fixtures/vendor/raw_captures/2026-09-06-tv_rsi_atr_capture_spy.csv` (237,666 bytes, 1,329
  lines incl. header) — the sole committed raw artifact; two smaller, superseded intermediate captures
  (300-row, 405-row) were discarded, not committed, since the final 1,328-row capture strictly
  supersedes them with more real data at zero additional information cost.
- `tests/fixtures/vendor/observations/rsi-close14-2026-09-06.json`,
  `tests/fixtures/vendor/observations/atr-14-2026-09-06.json` — full observation records (provenance,
  `market.bars` = all 1,328 real OHLCV bars, `engine.ast` = the exact canonical AST for
  `rsi(close,14)`/`atr(high,low,close,14)`, `vendor.values` = every bar from index 14 onward, i.e.
  1,314 real vendor values each — not a single probe row, deliberately avoiding Lane B's first-pass
  single-probe overclaim per explicit instruction).
- `tests/fixtures/vendor/parity/rsi-close14-2026-09-06.json`,
  `tests/fixtures/vendor/parity/atr-14-2026-09-06.json` — the full `tools/vendor_parity_compare.py`
  comparison output (per-bar rows, verdict).

## 3. Exact row counts

| | Total bars in capture | Vendor values recorded | True period-warmup (no vendor.values entry) | Seed-convergence-lag region (recorded, `is_warmup`) | Genuine steady-state comparison |
|---|---|---|---|---|---|
| RSI | 1,328 | 1,314 (index 14+) | 14 (index 0-13) | 166 (index 14-179) | **1,148** (index 180-1327) |
| ATR | 1,328 | 1,314 (index 14+) | 14 (index 0-13) | 166 (index 14-179) | **1,148** (index 180-1327) |

## 4. Usable/excluded rows, with exact exclusion reasons

Two distinct, non-overlapping exclusion classes, both reported explicitly by
`vendor_parity_compare.py`, never silently dropped:

1. **True period-warmup (indices 0-13, 14 bars each function)** — UCT's `rsi`/`atr` are structurally
   incapable of producing a value before their `period`-bar minimum (`compute_rsi_raw`/
   `compute_atr_raw` need `period` prior diffs/true-ranges). These bars carry NO `vendor.values` entry
   at all (a deliberate observation-construction choice — see §9's `vendor_truth.py` note below) and
   so never appear as a comparable row.
2. **Seed-convergence-lag region (indices 14-179, 166 bars each function, `warmup_bars=180` passed to
   `--warmup-bars`)** — genuinely computable by UCT, genuinely carries a real vendor value, but marked
   `is_warmup=True` and excluded from the verdict. This is **not** a semantic warmup — see §9 for the
   full justification and the empirical convergence measurement that set this boundary.

**1,148 of 1,328 bars (86.4%) are genuine, unqualified steady-state comparisons** for each function.

## 5. Max deltas

| | Compared (steady-state) | Disagreements | Max absolute delta | Verdict |
|---|---|---|---|---|
| RSI | 1,148 | **0** | 7.18877e-06 | **VENDOR-PARITY VERIFIED** |
| ATR | 1,148 | **0** | 3.84955e-06 | **VENDOR-PARITY VERIFIED** |

Both max deltas are float-precision noise relative to the values' own scale (RSI ~48-90, ATR ~4-10) —
6-7 orders of magnitude below the 1e-6 *relative* tolerance actually used.

## 6. Mutation / non-vacuity results

Per the explicit instruction, five checks, all run against the SAME real observations and the SAME
comparison mechanism used for the real result above (`tools/vendor_parity_compare.py::compare`):

1. **RSI mutation** — `api.services.ast_interpret.compute_rsi_raw` monkeypatched to Cutler's RSI
   (simple trailing-window means, no recursion — the exact historical bug shape from RISK-019,
   reproduced from `tests/test_screener_technicals_accuracy.py::_cutler_rsi`). Result: **verdict
   flips to PARTIAL, 1,148/1,148 (100%) of steady-state bars disagree.** Restored; the unmutated
   observation re-verified clean immediately after, proving the harness itself wasn't left broken by
   the monkeypatch/restore cycle.
2. **ATR mutation** — `compute_atr_raw` monkeypatched to a bare `high - low` (never the true range).
   Result: **verdict flips to PARTIAL, 1,148/1,148 (100%) disagree.** Same restore-and-reverify
   discipline.
3. **Vendor-source-refusal control** — three poisoned copies of the real observations, each with
   `provenance.platform` set to a forbidden token (`"uct-generated"`, `"internal-generated"`,
   `"self-generated"`). All three: `VendorSourceRefused` raised, confirming
   `vendor_parity_compare.py`'s own `_assert_real_vendor_source` guard is live and would catch exactly
   the authorization's named failure mode ("UCT output was accidentally substituted for vendor
   output").
4. **Empty-provenance control** — `provenance.platform` set to `""`. Also `VendorSourceRefused`.
5. **DATA_BLOCKED non-silence check** — confirmed the comparison output's `rows` array has exactly
   1,328 entries (one per bar, matching `market.bars` length exactly — nothing dropped), with 14
   explicitly marked `DATA_BLOCKED` (the true period-warmup bars) and `any_data_blocked: true` set.

All five checks behaved as required. Full prototype script (throwaway, not committed —
the committed permanent regression is `tests/test_vendor_parity_rsi_atr.py`, see §12).

## 7. RSI final parity status

**VENDOR-PARITY VERIFIED.** 1,148 real, current-market steady-state bars agree with the real vendor's
`ta.rsi(close,14)` to ~1e-9 relative (float noise). RISK-019's historical incident (Cutler's RSI
shipped under Wilder's name) is now independently reconfirmed fixed against REAL vendor data, not
merely against a hand-typed reference implementation — closing the "no real-runtime confirmation of
the fix exists yet" gap the readiness report named as RSI's own motivating open question.

## 8. ATR final parity status

**VENDOR-PARITY VERIFIED — steady-state half; the already-adjudicated bar-0/TR-definition half
(`divergences.json::atr-tr-starts-at-bar-1`) is CONFIRMED-CONSISTENT, not reopened, and its separate
ALIGNMENT claim remains untested by this specific capture.** See §10 for the precise disposition —
this status intentionally does not collapse two different claims into one label.

## 9. Convergence decay curve — why `warmup_bars=180`, not the naive `14`

**The single largest real risk this batch was explicitly warned about, and what it looked like in
practice.** A first pass using the naive `--warmup-bars 14` (the true, minimal period-warmup) against
this program's first, smaller (300-bar) capture produced `verdict: PARTIAL` with disagreements on
roughly half of all "comparable" bars — which would have been a direct instance of "reading a
seed/alignment difference near the warm-up and mis-classifying it as a calculation defect" had it been
reported as-is.

**Root cause, confirmed by direct inspection of the per-row deltas, not assumed**: `interpret()`
computes `rsi`/`atr` using ONLY the bars in a given capture window. Both are Wilder/RMA-recursive —
their first computable value (bar 14) is seeded from a SIMPLE mean of just the 14 diffs/true-ranges
inside that window, with zero knowledge of anything before it. The real vendor's value at that SAME
calendar bar already reflects TradingView's continuous smoothing since SPY's actual ~1993 inception —
already fully converged, decades deep. Comparing UCT's freshly-cold-seeded early bars against an
already-converged vendor value is not a formula disagreement; it is a **capture-methodology artifact**
that decays as UCT's own recursion catches up — exactly the shape `divergences.json`'s existing
`atr-tr-starts-at-bar-1` ruling already describes for a *different*, much smaller effect (§10), and
exactly the misclassification risk `VENDOR_PARITY_TRANCHE_2_READINESS_REPORT.md` named before any
capture was made.

**Measured decay** (relative delta at each checkpoint, final 1,328-bar capture):

| Bar index | RSI rel Δ | ATR rel Δ |
|---|---|---|
| 14 | 0.1175 (11.75%) | 0.2500 (25.00%) |
| 20 | 0.00797 | 0.1401 |
| 30 | 0.0318 | 0.0806 |
| 50 | 0.00139 | 0.0156 |
| 80 | 0.000142 | 0.00176 |
| 100 | 4.75e-06 | 0.000264 |
| 130 | 1.16e-05 | 3.60e-05 |
| 150 | 7.19e-07 | 5.45e-06 |
| 160 | 7.55e-07 | 2.89e-06 |
| 170 | 1.88e-06 | 9.59e-07 |
| **180** | **9.43e-08** | **4.39e-07** |
| 200 | 3.08e-08 | 8.82e-08 |
| 220 | 2.41e-09 | 2.69e-08 |

Last bar with `rel_delta > 1e-6`: **RSI index 172, ATR index 169** (of 1,328). `warmup_bars=180` is a
conservative round number chosen past BOTH, documented in each observation's own
`_vendor_parity_warmup_bars_note` field so a future reader never has to re-derive it from a bare
number. Bars 180+ never disagree again for either function, for the full remaining 1,148-bar tail.

**This is a general finding, not specific to RSI/ATR**: any future real-vendor capture of a
Wilder/RMA-seeded function over a finite window will show the same shape, and a naive `warmup_bars`
equal to the semantic period will systematically overclaim a disagreement that is actually a capture
artifact. Recorded as a new, general `divergences.json` row (§11) so this does not have to be
re-discovered per function.

## 10. Cross-reference with the existing ATR ruling — precisely disposed, not conflated

`divergences.json::atr-tr-starts-at-bar-1` (ruled 2026-08-29, KEEP OURS) is about a DIFFERENT,
much smaller effect: TradingView's `ta.tr(true)` defines bar 0's true range as `high - low` where ours
leaves it undefined, producing a ~0.23%-at-the-seed, decaying-to-~0-by-bar-300 difference — measured
there via a spec-derived probe, never previously confirmed against a real vendor capture.

This batch's ~25%-at-bar-14 figure is **NOT** that effect, measured more precisely — it is one to two
orders of magnitude larger, and (per §9) attributable almost entirely to this capture's own
window-truncation cold start. **This capture cannot cleanly isolate the smaller 0.23%-scale effect from
the larger cold-start artifact**, because both manifest in the same early region of any window-bounded
capture — disclosed as a real limit of this evidence, not glossed over.

**What this batch DOES confirm, for the first time with real vendor data**: past the
capture-window's own convergence tail, UCT and the real vendor agree on ATR to float precision on
1,148 real, current-market bars — directly corroborating the existing ruling's own central claim ("THE
DELTA IS INVISIBLE WHERE IT IS READ") with real numbers instead of a spec-probe estimate.

**What this batch does NOT confirm or deny**: the ruling's separate ALIGNMENT claim (one fewer emitted
value at a symbol's true first-ever bar) — this capture's window starts in 2021, decades after SPY's
real inception, and cannot reach that bar. Untested, not silently assumed either way.

Both findings are appended to `divergences.json::atr-tr-starts-at-bar-1` as a new
`real_vendor_capture_2026_09_06` field, **without altering its existing `measured`/`decision` fields**
— the original spec-probe evidence and 2026-08-29 ruling stand verbatim, per the explicit "do not
rewrite historical raw evidence" instruction.

## 11. New standing divergence row

`divergences.json` gained one new row, `recursive-smoother-cold-start-in-a-finite-capture` (status:
`confirmed`), generalizing §9's finding beyond RSI/ATR specifically: it wires into
`vendor_truth.py --check`'s existing `expect.explains` mechanism (both new observations set
`"expect": {"explains": "recursive-smoother-cold-start-in-a-finite-capture"}`) so the gate script
reports these bars as `EXPLAINED`, not `UNEXPLAINED` — using the tool's own existing, intended
mechanism for a measured-and-understood delta, rather than leaving `--check` broken or silently
suppressing rows. Confirmed: `python tools/vendor_truth.py --check` now exits 0 (`385` deltas, all
`EXPLAINED`; `0` unexplained; `0` blank) where it previously crashed (`vendor.readDecimals is
required`) on these two new observations before this fix.

## 12. Permanent regression + documentation

- `tests/test_vendor_parity_rsi_atr.py` — new, mirrors `tests/test_vendor_parity_lane_b.py`'s shape:
  asserts both observations' parity files read `VENDOR-PARITY VERIFIED`, re-runs the real comparison
  live (not just reading the committed parity JSON) to guard against silent drift, and carries the
  RSI/ATR mutation + vendor-source-refusal controls as permanent, not throwaway, tests.
- `tests/fixtures/vendor/divergences.json` — `atr-tr-starts-at-bar-1` amended (appended, not rewritten)
  with `real_vendor_capture_2026_09_06`; new `recursive-smoother-cold-start-in-a-finite-capture` row
  added.
- `tests/fixtures/vendor/observations/{rsi-close14,atr-14}-2026-09-06.json`,
  `tests/fixtures/vendor/parity/{rsi-close14,atr-14}-2026-09-06.json`,
  `tests/fixtures/vendor/raw_captures/2026-09-06-tv_rsi_atr_capture_spy.csv` — committed.
- `RISK_REGISTER.md`, `VALIDATION_COVERAGE_MAP.md`, `PHASE_TWO_PLAN.md`, `PROGRESS.md` — updated;
  see each file's own entry for this tranche.

## 13. Incidental findings — pre-existing, NOT part of this batch, NOT fixed

Two pre-existing, unrelated test failures were discovered while confirming no regressions from this
batch's own changes. Both are confirmed pre-existing (via `git log`/`git status` showing zero local
modification to the files involved, and commit dates predating this session), disclosed here per this
program's standing "no known silent wrong answers" discipline, and **not fixed** — fixing either is
compatibility/implementation remediation, explicitly out of this batch's scope and the stop condition.

1. **`app/src/components/chart/engine/ast/vendorTruth.test.js` fails for all 4 pre-existing Lane B
   oracle observations** (`ta-{rising,median_even_length,percentrank,bbw}-oracle-ambiguity-v3-1-
   2026-09-05.json`) — re-translating each observation's `script.source` through the real `pine.js`
   now returns a `pine:operator` refusal on `bar_index % 25` ("this Pine operator has no counterpart
   this door is sure of... Pine does not publish how `%` rounds a negative operand"). This refusal has
   existed in `pine.js` since commit `766af6aee` (2026-08-09) — well before both `vendorTruth.test.js`
   itself (created 2026-08-29) and the oracle captures (2026-09-05) — meaning this specific
   cross-check has apparently never actually been run against these 4 committed observations since
   they were written. My own two new RSI/ATR observations pass this same check cleanly (confirmed:
   `translatePine` reproduces the exact recorded `engine.ast` for both). Recommend a future tranche
   investigate whether the oracle script's real-vendor findings (RISK-018a/RISK-018b) are affected by
   this — the script demonstrably still COMPILES and RUNS on the real vendor (already independently
   confirmed via live browser capture), so this is very likely a UCT-translator-side gap
   (`%` unsupported) rather than a vendor-compile problem, but that inference is not verified here.
2. **`tests/test_ast_indicators.py::test_every_function_PINS_ITS_ARGUMENT_ORDER_for_the_translators`
   fails**: `bbw`'s `mult` argument role is outside the closed `_INT_ROLES` set and does not name a
   period. This is a direct, mechanical consequence of RISK-018b's own already-disclosed limitation
   ("`bbw`'s `mult` argument is typed `int`... narrower than Pine's true float signature") — confirmed
   pre-existing via `git log` (last touched by the Lane B implementation commit `fa56e2677`,
   2026-09-05, before this session). Not touched here.

Neither finding affects RSI or ATR, neither was caused by this batch, and neither is remediated by it.

## 14. Unresolved semantic boundaries (explicitly disclosed)

- ATR's ALIGNMENT claim (one fewer emitted value at a symbol's true first bar) remains genuinely
  untested by any real-vendor capture this program holds — would require a capture starting at a
  symbol's actual inception.
- The 0.23%-scale bar-0/TR-definition effect and the ~25%-scale window-truncation cold-start effect
  cannot be cleanly separated within a single finite capture; only the combined early-window shape has
  been measured.
- The two incidental findings in §13 remain open, unquantified beyond what's stated here (no attempt
  was made to determine how many OTHER committed vendor observations or closed-table functions might
  carry similar undiscovered gaps).

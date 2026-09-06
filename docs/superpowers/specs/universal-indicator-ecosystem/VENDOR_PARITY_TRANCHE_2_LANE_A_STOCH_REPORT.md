# Vendor Parity Tranche 2 — Lane A, Fifth Batch (Stoch)

Per explicit owner authorization following the HMA/MACD batch's acceptance: "Proceed with the next
bounded Vendor Parity Lane A batch: STOCH ONLY. Do NOT begin ADX-family yet." Real TradingView
capture → UCT comparison → classification → mutation/non-vacuity → documentation, for exactly one
function: `stoch(high, low, close, 14)` (raw fast %K — the only output UCT's closed table exposes).
No other Lane A function was touched. No product code was changed.

**This batch's capture required an unscheduled safety detour.** The first capture attempt hit an
unexplained chart-state anomaly on the program's usual `jHASRSzx` chart; the owner paused the batch,
required a full forensic diagnostic, then authorized a re-attempt on a fresh, disposable, isolated
TradingView layout instead. That full incident trail — reconstruction, root-cause classification,
and the safety procedure that produced the eventual clean capture — is preserved in full in
**Appendix A**, since it materially affects this batch's provenance and is itself a real finding
about this program's own operating safety.

---

## 1. Exact UCT Stoch contract

**Both kernels, verified identical by direct code reading, not assumed:**

- **JS**: `computeStochastic(bars, kPeriod=14, dPeriod=3)` (`app/src/components/chart/indicators.js:311`).
- **Python**: `compute_stoch_raw(bars, k_period=14, d_period=3)` (`api/services/indicator_compute.py:476`).
- **Algorithm** (identical in both): for each bar `i >= kPeriod-1`, `lowestLow`/`highestHigh` = the
  min/max of `low`/`high` over the INCLUSIVE trailing `kPeriod`-bar window (`bars[i-kPeriod+1..i]`);
  `range = highestHigh - lowestLow`; `%K = range==0 ? 50 : (close[i] - lowestLow) / range * 100`.
- **No recursive or leaky state** — %K at bar `i` depends ONLY on the trailing `kPeriod` bars'
  high/low and the current close. No running average, no prior %K value feeds forward.
- **Warm-up**: bars `0..kPeriod-2` (i.e. the first `kPeriod-1` bars) have NO value at all (blank/
  `None`); bar `kPeriod-1` is the first computable one (its window is bars `0..kPeriod-1`, i.e.
  `kPeriod` bars of history). For `kPeriod=14`: **13 bars true structural warmup**, first valid at
  0-indexed bar 13.
- **Zero-range**: `range == 0` (i.e. `highestHigh == lowestLow` — every bar in the window has the
  identical high AND low) returns exactly `50.0`, never a NaN/error.
- **What the Pine-translatable closed-table door exposes**: `stoch(h, l, c, n)`
  (`app/src/components/chart/engine/ast/interpret.js:1256`, `api/services/ast_interpret.py:1389`),
  bound to `computeStochastic(bars, n, 1).k` / `compute_stoch_raw(bars, n, 1)[0]` — **raw fast %K
  ONLY**. `dPeriod` is pinned to `1` deliberately (mirroring `macd`'s own `signal` pin) so it cannot
  reach a guard this entry's own declaration says nothing about; it has NO effect on the exposed `k`
  array regardless of its value. **%D is NOT exposed by this door at all**
  (`closedTable.json::_functions_excluded.stochD`) — a member composes it manually as
  `sma(stoch(...), d)`.
- **`closedTable.json`'s own declared contract** (`app/src/components/chart/engine/ast/
  closedTable.json:1043`): `args: ["series","series","series","int"]`, **`argRoles: ["high","low",
  "close","period"]`**, `lookback: "arg3"`, `yields: "num"`.

## 2. Exact TradingView oracle

Pine's real function is `ta.stoch(source, high, low, length)` — a **different argument order** from
the table's own `stoch(h, l, c, n)`. This was previously measured (not assumed) by
`pine.js::PINE_CALL_SHAPES.stoch` (`app/src/components/chart/engine/ast/pine.js:559`):

```
stoch: { table: 'stoch', pineArity: 4, build: [{ pine: 1 }, { pine: 2 }, { pine: 0 }, { pine: 3 }] }
```

i.e. Pine's `ta.stoch(close, high, low, 14)` translates to this table's `stoch(high, low, close,
14)`. That mapping's own file-header comment records a genuine prior incident: "the verbatim order
produced a plausible number, a plausible read-back, and was WRONG BY 126 POINTS of a 0-100
oscillator" — caught by `pine.roles.test.js`, which compares against a **hand-coded re-
implementation of Pine's published formula** (`100 * (source - lowest(low,n)) / (highest(high,n) -
lowest(low,n))`). **That is a self-consistency check against documented algebra, not real vendor
evidence** — this batch is the first time this exact permutation has been checked against a REAL
TradingView runtime output. The oracle script used for the real capture:

```pine
//@version=5
indicator("uct-stoch-parity-v1", overlay=false)
stochK = ta.stoch(close, high, low, 14)
plot(stochK, title="stochK")
```

`translatePine()` run directly on this exact script (verified live, not hand-transcribed) confirms:
`formula: "stoch(high, low, close, 14)"` — the correct permutation, applied by the real translator.

## 3. Exact vendor capture setup

- **Symbol/timeframe**: `AMEX:SPY`, Daily.
- **Chart**: a **brand-new, disposable layout** (`UCT Vendor Capture — Stoch TEMP`, layout id
  `qAHjBkf4`) — deliberately NOT the program's usual `jHASRSzx` chart, per the owner-authorized
  safety procedure in Appendix A. Created via TradingView's own "Manage layouts → Create new layout"
  (never "Make a copy" of `jHASRSzx`, and `jHASRSzx` itself was interacted with ONLY through that one
  menu action — no symbol/timeframe/indicator/drawing/save/broker/sync change was made to it at any
  point).
- **Pre-capture baseline check** (mandatory per the safety procedure, evidenced twice via
  screenshots over a short settling period, all 8 criteria agreeing on both observations): layout
  name, unique layout URL/ID distinct from `jHASRSzx`, SPY selected intentionally, title = SPY, OHLC
  header = SPY, visible candles = SPY, object-tree symbol = SPY, no unexpected broker modal, no
  unsaved Pine Editor draft, no unexplained symbol transition. **Clean on both observations.**
- **A second narrow blocker, resolved with explicit authorization**: opening the Pine Editor first
  surfaced a leftover, unsaved "Untitled script" buffer from the PRIOR (HMA/MACD) batch — proving
  TradingView's scratch-script buffer is **account-wide, not layout-scoped**. Per an explicit,
  narrowly-scoped owner authorization, a genuinely separate blank buffer was opened via the editor's
  own "Untitled script" dropdown → "Create new" → "Indicator" (confirmed distinct: a blank v6-
  template `indicator("My script") / plot(close)`, never touched/saved/renamed/closed the old
  HMA/MACD buffer).
- **Oracle script**: pasted into the NEW blank buffer only (verified byte-for-byte before running).
  Zero compile errors; `uct-stoch-parity-v1` appeared in the object tree; live legend value
  **67.70** (plausible 0-100 range).
- **Capture window**: **300 real trading-day bars, 2025-06-27 through 2026-09-04** —
  chronologically sorted, no duplicate timestamps (verified directly). **Deliberately smaller than
  prior batches' ~2,031-bar window** — a brand-new disposable layout has no long scroll-back history
  to draw on, unlike the long-lived `jHASRSzx` chart. Fewer bars, but every one real.
- **Export mechanism**: identical to every prior batch — right-click chart → Table view → Download
  data, intercepted client-side (`URL.createObjectURL` hook), moved out via a real trusted-gesture
  click into the clipboard (`navigator.clipboard.writeText`), read locally via `Get-Clipboard`. No OS
  file download occurred.
- **Precision**: full double-precision floats (e.g. `stochK=93.95918367346931`).
- **Cleanup**: the `uct-stoch-parity-v1` indicator was removed from the TEMP layout after export
  (object tree confirmed back to `SPY · NYSE Arca, 1D` + default `Vol`, matching the pre-capture
  baseline). Neither Pine buffer was saved. All tabs created this retry were closed. The TEMP layout
  itself was left in place, undeleted, per explicit instruction (a clearly-named leftover is
  preferred to any risk of deleting the wrong layout). `jHASRSzx` was left completely unmodified —
  confirmed by a final tab-context check showing it in its original, untouched state.

## 4. Raw artifact paths

- `tests/fixtures/vendor/raw_captures/2026-09-06-tv_stoch_capture_spy.csv` (20,121 bytes, 300 real
  data rows + 1 header).
- `tests/fixtures/vendor/observations/stoch-k-14-2026-09-06.json` — full observation record
  (provenance, `market.bars` = all 300 real OHLCV bars, `engine.ast` = the exact canonical AST for
  `stoch(high,low,close,14)` produced by running `translatePine()` on the real oracle script,
  `vendor.values` = every bar from index 13 onward, 287 real vendor values — not a single probe row).
  Per the SAME established convention already set by the sma/wma/hma observations (verified
  directly against `wma-close20-2026-09-06.json`), `vendor.values` deliberately EXCLUDES entries for
  the 13 true-structural-warmup bars even though the real CSV happens to carry a value there too
  (TradingView's full multi-decade SPY history means the export's own leading edge is NOT SPY's real
  inception — the vendor's own indicator was already fully converged before this capture's first
  visible row). This keeps `tools/vendor_truth.py --check` from mis-flagging an already-disclosed,
  already-excluded structural boundary as a new REACH defect.
- `tests/fixtures/vendor/parity/stoch-k-14-2026-09-06.json` — the full `tools/vendor_parity_compare.py`
  comparison output (per-bar rows, verdict).

## 5. Exact row counts

| | Total bars | Vendor values recorded | True period-warmup (no vendor value recorded) | Additional excluded (seed-lag) | Genuine comparison |
|---|---|---|---|---|---|
| Stoch %K | 300 | 287 (index 13+) | 13 (index 0-12) | **0** | **287** (index 13-299) |

## 6. Max deltas

| | Compared (steady-state) | Disagreements | Max absolute delta |
|---|---|---|---|
| Stoch %K | 287 | **0** | **1.42109e-14** (pure float noise) |

## 7. Warm-up / seed-convergence result

**Zero seed-convergence lag, confirmed empirically — not merely assumed by analogy to sma/wma/hma.**
Stoch's %K reads only the trailing 14 bars' high/low/close, with no running/recursive state carried
between bars, so it is structurally incapable of the "capture-window cold-start" effect already
documented for rsi/atr/ema/rma/macd (`divergences.json::recursive-smoother-cold-start-in-a-finite-
capture`). Every one of the 287 steady-state bars — starting IMMEDIATELY at the true 13-bar
structural warmup boundary, with no additional margin — agrees with the real vendor to float
precision. **No `expect.explains` entry was needed for this observation's own comparison** (the
divergence row's reuse in §4 above concerns only the `vendor.values` truncation convention, not a
comparison-time exclusion).

## 8. Role-order (source-ordering) result — VENDOR-CONFIRMED

**Confirmed against real vendor data for the first time.** `test_MUTATION_wrong_role_order_high_low_
close_disagrees_on_real_vendor_data` runs the WRONG, verbatim (unpermuted) argument order —
`stoch(close, high, low, 14)`, i.e. feeding the real close where the table expects high, the real
high where it expects low, the real low where it expects close — against the SAME real captured
vendor values: **287/287 (100%) of steady-state bars disagree.** The correct, permuted order
(`stoch(high, low, close, 14)`, what the real translator actually produces) is what achieves the
clean VENDOR-PARITY VERIFIED result in §6/§7. This closes the gap the internal-only
`pine.roles.test.js` check could not: that check proved the permutation matches Pine's *documented*
formula; this batch proves it matches Pine's *real runtime output*.

## 9. Denominator / numerator result

- **Wrong denominator** (`(close - lowestLow) / highestHigh * 100` instead of dividing by the true
  range `highestHigh - lowestLow`): **287/287 (100%) disagree.**
- **Inverted numerator** (`(highestHigh - close) / range * 100` — Williams %R's shape, not %K's):
  **287/287 (100%) disagree.**
- **Wrong window length** (`stoch(high, low, close, 10)` compared against the real vendor's own
  `length=14` capture): **171/287 (~60%) disagree** — a real, material, discriminating majority, but
  explicitly NOT reported as ~100%: %K frequently saturates at 0 or 100 during a strong local trend
  regardless of the exact window length, so two different window lengths can legitimately coincide
  on a meaningful minority of real bars. Stating a near-100% figure here would be an overclaim this
  real capture does not support — the honest, measured number is reported instead.

## 10. Zero-range (denominator-zero) result — HONEST NON-COVERAGE, DISCLOSED

**Genuinely untestable against this real capture, and disclosed as such rather than silently
skipped or assumed from internal code.** `test_zero_range_windows_do_not_occur_in_this_real_capture`
directly confirms: **0 of the 287 real rolling 14-bar windows in this capture have `highestHigh ==
lowestLow`** — a liquid ETF's 14-trading-day high-low range is essentially never exactly zero. No
amount of re-slicing this real dataset would manufacture that condition. A SEPARATE, explicitly-
labelled SYNTHETIC fixture (`test_zero_range_fallback_is_internally_consistent_NOT_vendor_verified`,
20 bars of `h=l=c=100` fed directly to the interpreter, never run through `compare()` — a synthetic
provenance would correctly be REFUSED by `_assert_real_vendor_source`) proves only that UCT's own
`range==0 → 50` branch is deterministic and internally self-consistent. **This does NOT establish
TradingView's real behavior for a flat/zero-range window, which remains genuinely UNVERIFIED** — no
capture this program has taken (across all six Lane A batches) has ever exhibited one.

## 11. Smoothing / multi-output result — NOT APPLICABLE, CONFIRMED BY CONTRACT

Two of the authorization's explicit checklist items resolve to "not applicable," stated precisely
rather than silently skipped:

- **Smoothing**: the closed-table `stoch()` door exposes ONLY raw, unsmoothed fast %K (`dPeriod`
  pinned to 1, no effect on `k`). Pine's own `ta.stoch(source, high, low, length)` function is
  LIKEWISE raw/unsmoothed by definition — it has no smoothing parameter in its signature at all (the
  "smoothed %K" convention belongs to TradingView's separate built-in "Stochastic" STUDY/indicator,
  a different Pine construct entirely, not under test here). §7's "Real vendors disagree on %K
  smoothing" concern named in `PHASE_TWO_PLAN.md`'s original priority table is therefore resolved
  for this specific comparison: there is no smoothing question between UCT's `stoch()` and Pine's
  `ta.stoch()`, because neither smooths.
- **Multi-output/tuple representation**: Pine's `ta.stoch()` returns a SINGLE value (unlike
  `ta.macd()`'s 3-tuple) — no destructuring/packing convention applies.

## 12. JS/Python dual-kernel conformance (kept separate from vendor parity, per instruction)

**Confirmed passing, via the EXISTING standing frozen-corpus check — not re-derived, not
conflated with real-vendor evidence.** `tools/ast_conformance.py`'s own 144-AST frozen digest log
(`tests/fixtures/ast/conformance_log.json`) includes BOTH `stoch_k` (the raw %K path, exactly what
this batch vendor-tested) and `stoch_d_by_composition` (the `sma(stoch(...), d)` composed-%D idiom).
`python tools/ast_conformance.py --check` currently reports exactly 4 mismatches — all four are
`rising_close_3`/`median_close_4`/`percentrank_close_10`/`bbw_close_20_2` (a pre-existing, already-
classified, unrelated staleness — RISK-033, explicitly left unactioned per an earlier owner
instruction "without reopening scope"). **Neither `stoch_k` nor `stoch_d_by_composition` appears in
that mismatch list** — both remain in full JS/Python agreement at rel-tol 1e-9 over the frozen
`intraday5m` series. This is a genuinely SEPARATE claim from §6-9's real-vendor result (per the
tool's own docstring: "JS and Python already agreeing with each other... is a separate,
already-existing, already-passing check and is never re-proven here") — both now independently
confirmed for Stoch.

## 13. Mutation / non-vacuity summary

All run against the real observation via `tools/vendor_parity_compare.py::compare`, each followed
immediately by an unmutated control re-verifying clean:

1. **Wrong role order** (verbatim `stoch(close, high, low, 14)`) — verdict flips to PARTIAL,
   287/287 (100%) disagree.
2. **Wrong window length** (`n=10` vs. the real vendor's `n=14`) — verdict flips to PARTIAL,
   171/287 (~60%) disagree (honestly reported as a material majority, not near-100% — see §9).
3. **Wrong denominator** (divide by `highestHigh` alone) — verdict flips to PARTIAL, 287/287 (100%)
   disagree.
4. **Inverted numerator** (Williams %R's shape) — verdict flips to PARTIAL, 287/287 (100%) disagree.
5. **Zero-range windows do not occur** — a direct, positive confirmation that this real capture
   contains none (0/287), disclosing the boundary rather than hiding it.
6. **Zero-range fallback synthetic control** — internally consistent (every flat-window bar reads
   exactly 50.0), explicitly labelled as NOT vendor evidence.
7. **Vendor-source-refusal controls** — 4 poisoned-provenance tokens, all correctly raised
   `VendorSourceRefused`.

Permanent regression: `tests/test_vendor_parity_stoch.py` (13 tests, all passing).
`tools/vendor_truth.py --check` reports 15 held observations, all matched or explained, exits 0
(verified live, 2026-09-06, after the `vendor.values`-truncation fix in §4).

## 14. Final qualified status

**Stoch %K → VENDOR-PARITY VERIFIED — MULTI-BAR** (zero seed-convergence-lag exclusion beyond the
true 13-bar structural period-warmup — joining sma/wma/hma as a confirmed memoryless, finite-window
function), **PLUS PARTIAL — ZERO-RANGE BEHAVIOR UNVERIFIED** (real vendor confirmation of the
`range==0 → 50` convention was not obtainable from any real market data this program has captured;
only an internal-consistency synthetic control exists for that branch).

The role-order permutation (`pine.js::PINE_CALL_SHAPES.stoch`) is now **VENDOR-CONFIRMED**, not
merely internally self-consistent.

## 15. Implications for prior Lane A evidence

**None invalidated.** This batch corroborates the established "finite-window functions carry no
capture-window seed-convergence lag" finding (previously sma, wma, hma) on a fifth, structurally
distinct function (a rolling max/min + one arithmetic step, rather than a weighted rolling mean or a
composition of rolling means) — a genuinely different code path, independently reaching the same
conclusion. No RSI/ATR/SMA/EMA/RMA/WMA/HMA/MACD evidence was re-examined, re-captured, or changed.

## 16. Remaining limitations (explicitly disclosed)

- Zero-range vendor behavior remains genuinely unverified against real data (§10) — this is a
  disclosed boundary of what real market data can exercise, not an oversight.
- This capture holds 300 bars, not the ~2,031-bar depth of prior batches — a consequence of using a
  fresh disposable layout rather than the long-scrolled-back `jHASRSzx` chart (a deliberate,
  authorized safety trade-off; see Appendix A). 287 genuine steady-state comparisons remains
  comfortably non-vacuous, but is a narrower evidence base than sma/wma/rma/hma/macd's own ~1,800-
  2,000-bar comparisons.
- The wrong-window-length mutation's ~60% (not ~100%) disagreement rate is reported honestly rather
  than rounded up — future readers should not expect every window-length error to be this
  discriminating on every dataset; it depends on how often %K saturates at the range boundaries.
- Per the explicit instruction, the ADX-family and every other Track F/Lane A item remain
  untouched. **Stop after Stoch**, honored.

---

## Appendix A — the capture-safety incident and its resolution

**Summary, for readers who do not need the full transcript-level detail**: the first capture
attempt (on the program's usual `jHASRSzx` chart) hit an unexplained sequence — the chart was
already showing a different symbol (ANF) on load, a deliberate switch to SPY updated the object
tree and title but not the visible candles (a genuine client-side render/state desync, confirmed by
screenshot), and after a reload attempt was blocked by an "unsaved changes" dialog, the tab was next
observed on a THIRD symbol (SMH) with an unprompted "Trade with your broker" modal open — a
transition the capturing agent made zero clicks or keystrokes to cause. The agent correctly stopped
per its own explicit blocker condition, used Ctrl+Z to restore the chart to its original visible
state, and reported rather than continued.

**Diagnostic performed before any retry** (no further TradingView interaction during this phase, per
explicit instruction): a full forensic reconstruction of the agent's own action log, plus a
concurrent-session check across every other Claude session active on the machine at the time.
**CONFIRMED**: the chart was already on ANF before any action; a real render/state desync existed at
the SPY-selection step (object tree advanced, canvas did not); zero agent actions occurred between
the blocked reload and the SMH/modal appearance; the agent never touched any broker UI itself. **All
5 other Claude sessions active on the machine at the time explicitly confirmed, on request, zero
Chrome browser automation usage** — ruling out cross-session interference for every session that
could be queried. **LIKELY**: the sequence is most consistent with an app-internal client
render/state race (the app's internal state had already progressed further than what was being
rendered) rather than an external actor. **UNKNOWN**: the precise technical trigger; whether ANF was
the chart's genuinely intended resting state; whether the two "Trendline" objects that appeared
under the SPY symbol were pre-existing per-symbol saved drawings (most likely) or something else.

**Resolution, authorized by the owner in stages, each with explicit written constraints**:
1. A first retry attempt on a bare `/chart/` URL was correctly aborted when that URL redirected
   straight back into the existing `jHASRSzx` layout rather than opening a blank one — the agent
   took no action beyond closing the redundant tab, per the "any ambiguity → stop" rule.
2. The owner then explicitly authorized ONE narrowly-scoped exception: using TradingView's own
   "Manage layouts → Create new layout" menu action (never "Make a copy") to create a genuinely
   separate, disposable layout, with an extensive list of things NOT to touch on the existing
   layout (symbol, timeframe, indicators, drawings, save, broker controls, autosave, sync settings,
   object tree, reload, undo/redo). This succeeded cleanly with a passing 8-point baseline check
   evidenced twice.
3. A second narrow blocker (the account-wide, not layout-scoped, Pine Editor scratch buffer holding
   leftover content from the prior HMA/MACD batch) was likewise stopped on rather than worked around,
   and the owner authorized ONE further narrow exception (open a separate blank buffer via the
   editor's own "New" affordance, without touching the existing one).
4. With both narrow authorizations exercised exactly as scoped, the capture itself proceeded
   cleanly with zero further anomalies of any kind.

**Throughout the entire incident, `jHASRSzx` — the program's normal working chart — was never
modified in any way.** No broker/trading action was ever taken. The eventual capture used a
DIFFERENT chart precisely so that this batch's evidence carries no residual uncertainty from the
original anomaly.

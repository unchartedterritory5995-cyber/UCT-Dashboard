# Vendor Parity Tranche 2 — Lane A, Sixth Batch (ADX Family)

Per explicit owner authorization following the Stoch batch's acceptance: "Proceed with the next
bounded Lane A parity batch: ADX FAMILY ONLY. Do not begin another Track F input type. Do not
begin broad parser expansion. Do not begin QQE remediation. Do not begin new BuilderSheet work."
Real TradingView capture → UCT comparison → classification → mutation/non-vacuity →
documentation, for the full directional-movement stack: `+DI`, `-DI`, and `ADX` (UCT does not
expose `+DM`/`-DM`/`TR` as standalone Pine-translatable functions — see §1). No other Lane A
function was touched. No product code was changed.

**This batch also required a capture-safety detour — a SECOND, independent incident from the
Stoch batch's own.** Reusing the Stoch batch's own disposable layout (`qAHjBkf4`) developed a
persistent blank-chart-canvas rendering fault (title/OHLC/object-tree all correct and stable;
candles never painted), reproduced independently on two separate fresh-tab attempts. The owner
authorized abandoning that layout (left in place, undeleted, undiagnosed further) and creating a
second, brand-new disposable layout instead. That full trail is in **Appendix A**.

---

## 1. Exact UCT ADX-family contract

**Both kernels, verified identical by direct code reading:**

- **JS**: `computeADX(bars, period=14)` (`app/src/components/chart/indicators.js:493`) returns
  `{adx, plusDI, minusDI}`.
- **Python**: `compute_adx_raw(bars, period=14)` (`api/services/indicator_compute.py:625`) returns
  `(adx, plus_di, minus_di)`.
- **Algorithm** (identical in both, standard Wilder DMI/ADX):
  1. Per-bar `+DM = up` if `(up > down and up > 0)` else `0`, where `up = high[i]-high[i-1]`;
     `-DM = down` if `(down > up and down > 0)` else `0`, where `down = low[i-1]-low[i]` (only the
     LARGER directional move counts, and only if positive — standard Wilder convention, not a
     naive "up minus down").
  2. `TR` = the standard true range (`max(h-l, |h-prevClose|, |l-prevClose|)`) — the SAME
     computation ATR uses.
  3. Wilder-smooth `+DM`/`-DM`/`TR` as running SUMS (not averages — mathematically equivalent for
     the ratios below, since a common `/period` factor cancels): seed = sum of the first `period`
     raw values (indices `1..period`), then each step `s = s - s/period + new`.
  4. `+DI = 100 * smoothed(+DM) / smoothed(TR)`; `-DI` likewise (both `0` if `smoothed(TR)==0`).
  5. `DX = 100 * |+DI - -DI| / (+DI + -DI)` (`0` if the denominator is `0`).
  6. `ADX` = a SECOND, independent Wilder smoothing of `DX`: seed = simple average of the first
     `period` `DX` values, then Wilder-recursed (`adx = (adx*(period-1) + dx) / period`).
- **No recursive state is shared between `+DM`/`-DM`/`TR`'s smoothing and `ADX`'s own smoothing of
  `DX`** — two independent Wilder-smoother instances, chained.
- **Warm-up**: overall guard `bars.length < 2*period` returns fully empty. Given enough bars,
  `+DI`/`-DI` first land at 0-indexed bar `period` (true structural warmup: `period` bars, indices
  `0..period-1`); `ADX` first lands at 0-indexed bar `2*period-1` (true structural warmup:
  `2*period-1` bars, indices `0..2*period-2`) — a STRICTLY LONGER structural warmup than its own
  DI inputs, since `DX` isn't defined until bar `period` and `ADX` needs `period` `DX` values to
  seed its own average.
- **`closedTable.json`'s own declared contract**
  (`app/src/components/chart/engine/ast/closedTable.json`): `plusDI`/`minusDI` declare
  `args:["series","series","series","int"]`, `argRoles:["high","low","close","period"]`,
  `lookback:"arg3"`; `adx` declares the SAME args/roles but `lookback:"2*arg3"` — matching the
  algorithm's own doubled structural warmup exactly.
- **`+DM`/`-DM`/`TR` are NOT independently exposed as Pine-translatable functions** — only the
  three composite outputs (`plusDI`, `minusDI`, `adx`) are in the closed table. `TR` alone is
  reachable only through `atr`'s own internal computation (a separate, already-verified function),
  not as a standalone series here.
- **Critical scope limit — DI length and ADX smoothing length are NOT separate in UCT, unlike real
  Pine.** Pine's real `ta.dmi(diLength, adxSmoothing)` allows the two periods to differ (e.g.
  `ta.dmi(14, 20)`); UCT's table takes exactly ONE shared `period` for both. `pine.js`'s own
  `dmiParts` (line ~1739) and `dmiLeg`-kind resolver (line ~3817) enforce this DELIBERATELY: an
  asymmetric pair REFUSES (`pine:tuple` guard: *"`ta.dmi` smooths its ADX over the SECOND period
  and this table uses one period for both, so the two must agree"*) rather than silently
  collapsing to a possibly-unintended answer — the identical decision the code's own comment says
  "TC2000's `ADX14.20`" makes for the same reason. **Verified directly, not assumed**: running the
  real translator on `ta.dmi(14, 14)` produces three clean formulas; `ta.dmi(14, 20)` refuses with
  exactly that message. This refusal is ALREADY permanently regression-tested at the translator
  level (`pine.tupleBuiltins.test.js`, `pine.tuples.test.js`) — not re-tested by this batch, since
  it is a translator-behavior claim, not a real-runtime-arithmetic claim, and internal tests are
  sufficient for that question.
- **No clamping or additional guards beyond the zero-denominator branches above** — verified by
  direct code reading; no min/max clamp is applied to `+DI`/`-DI`/`DX`/`ADX` anywhere.

## 2. Exact TradingView oracle / signature

Because of the scope limit above, the ONLY signature UCT's own product can express is the
SYMMETRIC case. The oracle script used:

```pine
//@version=5
indicator("uct-dmi-parity-v1", overlay=false)
[plusDI, minusDI, adx] = ta.dmi(14, 14)
plot(plusDI, title="plusDI")
plot(minusDI, title="minusDI")
plot(adx, title="adx")
```

`translatePine()` run directly on this exact script (verified live) confirms: three clean
outputs, `plusDI(high, low, close, 14)`, `minusDI(high, low, close, 14)`, `adx(high, low, close,
14)`. Running the SAME translator on `[a,b,c] = ta.dmi(14, 20)` confirms the refusal in §1.

## 3-6. Per-output results

### +DI

**VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR.** 130 real steady-state bars (index 170-299 of
the 300-bar capture) agree with the real vendor to float precision (max absolute delta 2.78e-06),
after excluding the true 14-bar structural period-warmup PLUS a measured 136-bar seed-convergence
lag (last real disagreement at index 150 of 300) — the same general capture-window cold-start
effect already documented for rsi/atr/ema/rma/macd (`divergences.json::recursive-smoother-cold-
start-in-a-finite-capture`), reused here via `expect.explains`.

### -DI

**VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR.** 130 real steady-state bars (index 170-299)
agree to float precision (max absolute delta 8.53e-06), after excluding the true 14-bar structural
warmup plus a measured 139-bar seed-convergence lag (last real disagreement at index 153 of 300).
Converges 3 bars later than `+DI` — a real, measured (not assumed) difference, unsurprising since
`+DM`/`-DM` are independently-seeded series with different early-bar values.

### DX

**Not independently vendor-tested as a standalone output** — UCT's closed table does not expose
`DX` as a Pine-translatable function on its own (only `+DI`/`-DI`/`ADX`, which DX feeds into).
Its correctness is exercised indirectly through `ADX`'s own verified result below, and directly
through the mutation set in §10 (the DX-sign and ADX-smoother mutations specifically isolate DX's
own contribution).

### ADX

**VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR.** 80 real steady-state bars (index 220-299 of
300) agree to float precision (max absolute delta 9.18e-06), after excluding the true 27-bar
structural period-warmup plus a measured 177-bar seed-convergence lag (last real disagreement at
index 204 of 300) — the LONGEST convergence boundary of any output in this batch, exactly as
expected: `ADX` compounds the `+DM`/`-DM`/`TR` smoothers' own seed error PLUS a second,
independent smoothing pass over `DX` itself.

## 7. Warm-up / convergence boundaries

| | True structural warmup | Measured last-disagreement index (of 300) | Chosen `_vendor_parity_warmup_bars` |
|---|---|---|---|
| +DI | 14 | 150 | **170** |
| -DI | 14 | 153 | **170** |
| ADX | 27 | 204 | **220** |

Per the established convention (RSI/ATR/EMA/RMA/MACD reports), each chosen `_vendor_parity_
warmup_bars` is a conservative ROUND NUMBER past its own empirically-measured last-disagreement
index — never the semantic period-warmup, and never silently equated with it.

## 8. Rows compared / excluded

| | Total bars | Vendor values recorded | True period-warmup (no vendor value) | Additional excluded (seed-lag, real vendor value, `is_warmup`) | Genuine comparison |
|---|---|---|---|---|---|
| +DI | 300 | 286 (index 14+) | 14 (index 0-13) | 156 (index 14-169) | **130** (index 170-299) |
| -DI | 300 | 286 (index 14+) | 14 (index 0-13) | 156 (index 14-169) | **130** (index 170-299) |
| ADX | 300 | 273 (index 27+) | 27 (index 0-26) | 193 (index 27-219) | **80** (index 220-299) |

**Disclosed limitation, honestly**: this capture holds only 300 bars (a fresh disposable layout,
not the ~2,031-bar `jHASRSzx` window prior batches used), and ADX's own deep 220-bar warmup
consumes nearly three-quarters of it. 80 genuine steady-state bars is comfortably non-vacuous
(well past the ~20-bar floor internal cross-checks use) but is the THINNEST evidence base of any
Lane A function verified so far — narrower than every prior batch's hundreds-to-thousands of
compared bars.

## 9. Max deltas

| | Compared (steady-state) | Disagreements | Max absolute delta |
|---|---|---|---|
| +DI | 130 | **0** | 2.78287e-06 |
| -DI | 130 | **0** | 8.53299e-06 |
| ADX | 80 | **0** | 9.17885e-06 |

## 10. Mutation / non-vacuity results

All run against the real observations via `tools/vendor_parity_compare.py::compare`, monkeypatching
`api.services.ast_interpret.compute_adx_raw` (the single shared primitive all three outputs read
from), each followed immediately by an unmutated control re-verifying clean:

1. **Directional-condition swap** (the raw condition that computes `+DM` now feeds `-DM` and vice
   versa) — `+DI`/`-DI` BOTH flip to PARTIAL, 130/130 (100%) disagree. **Mechanistically verified,
   not merely asserted**: the mutated "+DI" column matches the REAL VENDOR's own `-DI` values
   bar-for-bar (130/130 checked bars within 1e-3). This single mutation covers BOTH the
   "directional-condition swap" and "swapped +DI/-DI roles" items on the authorization's list —
   they reduce to the identical externally-observable effect.
   **⛔⛔ ADX is STRUCTURALLY, PROVABLY VACUOUS under this mutation** — `DX = 100*|+DI--DI|/
   (+DI+-DI)` is symmetric in `+DI`/`-DI`: swapping which is which changes neither the numerator
   nor the denominator. Reported precisely as a genuine mathematical property of ADX's own
   formula, not a testing gap — ADX is mathematically incapable of ever detecting this specific
   bug class, by design.
2. **Wrong Wilder alpha** (EMA-style `2/(period+1)` instead of Wilder's `1/period`, applied to all
   three smoothed series) — **all three outputs (+DI, -DI, AND ADX) flip to PARTIAL**, 100%
   disagree each. NOT vacuous for ADX, unlike items 1/3/4 below — a smoothing TIME-CONSTANT change
   does not preserve a common per-bar scale factor between `+DI` and `-DI` the way a shared-
   denominator error does.
3. **Wrong TR normalization** (`high-low` only, ignoring the prior-close gap terms) — `+DI`/`-DI`
   flip to PARTIAL, 130/130 (100%) disagree. **ADX is again VACUOUS by the same structural
   argument as item 1**: both `+DI` and `-DI` divide by the SAME (now wrong) smoothed `TR`, so
   `DX`'s ratio is unchanged.
4. **Wrong DI denominator** (`smoothed(+DM)+smoothed(-DM)` instead of `smoothed(TR)`) — same
   result and same reasoning as item 3: `+DI`/`-DI` flip 100%, ADX stays VERIFIED (a denominator
   shared by both cancels in `DX`'s ratio).
5. **DX missing its `abs()`** (allowed to go negative) — **the first isolation proof**: `+DI`/`-DI`
   stay COMPLETELY UNAFFECTED (still VENDOR-PARITY VERIFIED, 0 disagreements), while `ADX` flips
   to PARTIAL, 80/80 (100%) disagree. Confirms `DX`'s own sign-handling is architecturally
   downstream of, and cannot corrupt, `+DI`/`-DI`'s own computation.
6. **Wrong ADX smoother** (a simple rolling mean of `DX` instead of Wilder's recursive smoothing)
   — **the second isolation proof**: `+DI`/`-DI` again stay completely unaffected (VERIFIED, 0
   disagreements), `ADX` flips to PARTIAL, 80/80 (100%) disagree. Confirms `ADX`'s own smoothing
   METHOD is independently swappable/breakable without touching its DI inputs.
7. **Asymmetric `ta.dmi(14, 20)` refusal** — confirmed live via direct translation (§1/§2); already
   permanently regression-tested at the translator level (`pine.tupleBuiltins.test.js`,
   `pine.tuples.test.js`), not re-tested here (a translator-behavior claim needs no vendor data).
8. **Vendor-source-refusal controls** — 4 poisoned-provenance tokens × 3 observations (12 total),
   all correctly raised `VendorSourceRefused`.

**Three of the six numeric mutations (items 1, 3, 4) are honestly reported as STRUCTURALLY VACUOUS
for ADX specifically** — not silently omitted, not pretended to pass by coincidence, but explained
by the exact mathematical property (`DX`'s ratio is invariant to any common per-bar scale factor
shared by `+DI` and `-DI`) that makes them vacuous. Two DIFFERENT, ADX-specific mutations (items 5,
6) were chosen specifically because they operate strictly downstream of `+DI`/`-DI` and correctly
discriminate ADX where the others structurally cannot.

Permanent regression: `tests/test_vendor_parity_adx.py` (25 tests, all passing).
`tools/vendor_truth.py --check` now reports 18 held observations, all matched or explained, exits
0 (verified live, 2026-09-06).

## 11. Zero / flat-market boundary findings

- **`TR == 0`**: NEVER occurs in this real capture (0 of 299 bars) — the same finding already made
  for Stoch's own zero-range case; a liquid ETF's true range essentially never hits exactly zero.
- **Smoothed `+DI + -DI == 0`** (DX's own zero-denominator condition): NEVER occurs across the real
  vendor's own 286 recorded `+DI`/`-DI` pairs — **genuinely UNTESTABLE against real data**,
  disclosed honestly as PARTIAL / ZERO-DENOMINATOR UNVERIFIED rather than silently assumed from
  internal code. No synthetic control was built for this specific case in this batch (Stoch's own
  zero-range synthetic-control pattern is the template should one be wanted later).
- **Raw per-bar flat/no-direction bars** (`+DM==0 AND -DM==0`, BEFORE Wilder smoothing — neither
  high nor low moved decisively that bar): **DOES occur — 26 of 299 real bars.** This narrower
  boundary IS exercised by real data, and is implicitly covered by the overall VENDOR-PARITY
  VERIFIED result (a wrong contribution on any of these 26 bars would have surfaced as a
  steady-state disagreement) — confirmed directly via `test_zero_and_flat_market_boundaries_in_
  the_real_capture`, though not separately isolated by its own dedicated mutation.

## 12. JS/Python dual-kernel conformance (kept separate from vendor parity, per instruction)

**Confirmed passing, via the EXISTING standing frozen-corpus check** — `tools/ast_conformance.py`'s
own 144-AST frozen digest log includes `adx_trend_strength`, `plus_di`, and `minus_di`. `python
tools/ast_conformance.py --check` currently reports exactly the SAME 4 pre-existing, already-
classified mismatches (`rising_close_3`/`median_close_4`/`percentrank_close_10`/`bbw_close_20_2` —
RISK-033, unrelated, left unactioned per an earlier owner instruction). **None of the ADX-family
ASTs appear in that mismatch list** — no drift found; vendor comparison proceeded on that basis, as
instructed.

## 13. Final qualified status per output

- **+DI → VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR**
- **-DI → VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR**
- **ADX → VENDOR-PARITY VERIFIED — STEADY-STATE, MULTI-BAR**, **PLUS PARTIAL / ZERO-DENOMINATOR
  UNVERIFIED** (the `+DI+-DI==0` case, §11)

**The family is NOT collapsed into one broad label** — each output carries its own independently-
measured warmup/convergence boundary and its own mutation coverage; the mutations in §10 prove
`+DI`/`-DI` and `ADX` are each independently correct rather than one output's agreement being
allowed to mask another's disagreement.

## 14. Implications for prior RMA/ATR evidence

**None invalidated; this batch corroborates rather than changes either.** RMA (already `VENDOR-
PARITY VERIFIED — STEADY-STATE, MULTI-BAR + INITIALIZATION CANDIDATE-VERIFIED` from a prior batch)
is the SAME underlying Wilder-smoother primitive `+DM`/`-DM`/`TR` and `DX`-over-ADX both use — this
batch is a further, independent confirmation of that primitive's real-vendor correctness at TWO
MORE simultaneous applications (three smoothed series feeding into a fourth, second-order smoothed
series), not a re-test of RMA itself. **Per the explicit instruction, ADX's own initialization was
NOT assumed verified from RMA's — each of `+DI`/`-DI`/`ADX`'s own convergence boundaries was
measured independently in this batch** (§7), and each is materially different from RMA's own
measured 130-bar boundary and from RSI/ATR's own ~169-172-bar boundary — `+DI`/`-DI` converge
FASTER (150/153) than RSI/ATR's own composites, and `ADX` converges SLOWER (204) than either,
consistent with ADX compounding an additional smoothing layer on top. ATR is unaffected — this
batch does not touch or re-derive `TR`'s own standalone (already-verified) computation.

## 15. Raw artifact path

`tests/fixtures/vendor/raw_captures/2026-09-06-tv_adx_capture_spy.csv` (31,476 bytes, 300 real data
rows, columns `time,open,high,low,close,Volume,plusDI,minusDI,adx`).

Observations: `tests/fixtures/vendor/observations/{plus-di-14,minus-di-14,adx-14}-2026-09-06.json`.
Parity results: `tests/fixtures/vendor/parity/{plus-di-14,minus-di-14,adx-14}-2026-09-06.json`.

## 16. Commit

Recorded in the commit that adds this document, alongside every file listed in §10/§15.

---

## Appendix A — the second capture-safety incident and its resolution

**A DIFFERENT failure mode from the Stoch batch's own incident** (which involved unexplained
symbol/state transitions and an unprompted broker modal, fully resolved with `jHASRSzx` never
modified — see that batch's own report). This one is narrower and more benign: reusing the Stoch
batch's own disposable layout (`qAHjBkf4`) for this batch showed a CORRECT, STABLE symbol/title/
OHLC-header/object-tree (genuinely SPY, matching the clean state the Stoch batch left behind) —
but **the chart canvas itself never rendered any candles**, confirmed across three separate
observations spanning ~50 seconds on the first attempt, PLUS a screenshot-zoom command that timed
out with a "renderer may be unresponsive" error (a plain screenshot immediately after succeeded, so
the tab was not fully hung).

Per the capturing agent's own explicit stop condition ("if candles do not visibly render, STOP and
report"), no recovery action was attempted (no reload, no click, no forced repaint, no fallback to
creating a new layout on its own judgment) — the agent reported the blocker plainly.

**The owner authorized ONE further, narrowly-scoped diagnostic step**: close the tab and open a
BRAND-NEW tab with a fresh navigation to the SAME `qAHjBkf4` URL, with the full baseline check
repeated. This reproduced the IDENTICAL blank-canvas failure — correct symbol/title/OHLC-header/
object-tree, no candles — on a completely fresh tab, independently. This result weakens a "stale
tab" explanation and points toward something specific to that one saved layout's own stored state,
rather than to any one browser tab or session artifact. (No further root-cause investigation was
authorized or attempted — the layout was simply abandoned rather than diagnosed.)

**The owner then authorized falling through to a fresh, brand-new disposable layout**: `qAHjBkf4`
was left in place exactly as found (undeleted, untouched further) and a SECOND new layout was
created via the SAME "Manage layouts → Create new layout" procedure the Stoch batch established
(never "Make a copy," and the ONLY interaction with `jHASRSzx` throughout was that one menu
action). The new layout — **"UCT Vendor Capture — ADX TEMP," layout id `MzVTX6lY`** — passed its
own full baseline check cleanly on the first attempt, with candles genuinely rendering this time,
and the capture proceeded without further incident.

**Throughout both stages of this incident, `jHASRSzx` was never modified in any way beyond the one
narrow "Manage layouts" menu interaction**, and no broker/trading UI element was ever touched (the
only trading-adjacent menu items visible during the capture — Buy/Sell/Add order — were noted but
never clicked). Both disposable layouts (`qAHjBkf4`, now known to have a rendering fault of unknown
cause, and the new `MzVTX6lY`) remain in place, undeleted, per instruction — a clearly-named
leftover being preferred to any risk of deleting the wrong one. One tab could not be closed due to
a recurring tool-side "extension connected but page may be unresponsive" timeout (the same quirk
the Stoch batch's own report recorded) and was left open as a harmless leftover rather than forced.

**Standing recommendation for any future capture on this account**: `qAHjBkf4` should be treated as
suspect (not reused) until someone investigates its rendering fault directly outside of automation;
`MzVTX6lY` is confirmed clean and renderable as of this batch and may be a reasonable default for
the NEXT Lane A capture, subject to the same mandatory baseline check every time.

# Engine 57: three TradingView built-ins made exact (supertrend, stoch, rci)

Branch `fix/pine-engine57-builtins`, on `origin/master` (engine 54). Engines 55 (#1264) and 56 (#1265) merge
first; this branch takes 57. Sources: the S6 investigator report (`s6-bugs-1114`, sections 1-3) and, landed
during this work, the S1 evidence session's probes P1 and P2 (`vw-cs1-rci-p1-rddt-1d-2026-11-14`,
`vw-cs1-stoch-p2-rddt-1d-2026-11-14`). Every capture named below is NYSE:RDDT 1D from the listing; they are
licence-held and stay in `%LOCALAPPDATA%/uct-vendor-batch/runs/*/captures` (only verdicts and numbers read
off them reach the repo). The rails run scripts written in this repo's own words on the committed
`support-and-resistance-5f95e90f-rddt-1d-2026-11-13` bars, which are the same 666 sessions (checked bar for bar).

## What changed

### Supertrend (`callExpansions.js::supertrendTrees`, Python twin `call_expansions.py::supertrend_trees`)
Cause (report section 1): the bands were `accum(up, (up < self || close[1] > self) ? up : self, W)`. From the
listing the listing pass runs from bar 0, where `up` is `na` (ATR warm-up); `cmp` answers 0 on an `na`
operand, so the arm picked `self` and `na` latched for ever. The builtin drew NOTHING on all 666 bars.

Fix, node for node in both lanes:
- seeds `nz(up, 0)` / `nz(dn, 0)` and bodies reading `prev = nz(self, 0)` (Pine's `nz(upperBand[1])`);
- direction body `na(atrPine[1]) ? 1 : <flip>` (Pine's `if na(atr[1]) direction := 1`);
- **the guard**: the report recommended "heal + keep the unknown guard". Kept off the listing, lifted on it.
  The old guard `na(upper[W]) || na(lower[W])` reaches before bar 0 on bars `t < W`, which the listing reads
  as Pine's `na`, and `||` also read the upper band's REAL `na` on bars 1..n-2 as unknown. Heal + that guard
  drew 213 + 245 bars from the listing (bars 9..199 and 201..208 blank where TradingView draws), and the
  harness gives a capture that starts at bar 0 no warm-up excuse, so the builtin would have stayed DIVERGE.
  The guard is now a bounded window's own curtain `2W + n - 1` deep, `na(accum(0, 0, 2W + n - 1))`. Its body
  is a constant, so `varOriginMask` never reads it as a value carried from before the loaded bars (an
  identity-body version was withheld whole off the listing as `var-origin:window`, caught by the door rail).
  Off the listing it is `na` on exactly the bars the BASE expansion withheld. ⚰️ The first version here was
  `2W` deep, which is not the base's curtain: the base seeded its bands with the raw `na` band through the ATR's
  `n - 1` warm-up bars, so its guard held for `t < 2W + n - 1`. `2W` alone served bars `[2W, 2W + n - 2]`
  (review #1294 F2: 980 bars at n = 50, each ~1e-6 off a true full-history reference). The first equivalence rail
  could not see this, because it rebuilt the old guard over the NEW bands and compared the new guard with
  itself. The rail is now a verbatim copy of the base tree (`git show ec72c19913:.../callExpansions.js`): the
  same bars drawn and the same numbers, bar for bar, at (3, 10), (2, 7) and (3, 50). The guard lives in the
  TREE, so the bare `interpret()`, the screen and the Python lane all withhold those bars with no consumer
  mask involved. From the listing the guard is 0 on every bar, so nothing is withheld: every bar TradingView
  draws is drawn.
  ⚠️ Residual, unchanged from the base and stated in `SUPERTREND_NOTE`: off the listing `atrPine` is an RMA
  seeded on this chart's bar n-1, so at a long period it is still settling past the curtain. The reviewer
  measured 6,756 bars that BOTH versions draw at ~1e-6 relative at n = 50 (20 walks); 0 at the default
  (3, 10) and (2, 7) and 1 at (4, 20). A curtain that waits for the RMA to settle would need about 21 x n
  bars (about 1,050 at n = 50), so it would blank the shorter periods' exact bars too. It is not done here.
- `SUPERTREND_NOTE` says so; the recogniser reads the factor and period off a band's `nz` seed.

### Stochastic (`stochPine`, a Pine-only table entry; `pine.js` `ta.stoch` re-pointed; house `stoch` untouched)
The report derived "RESTART highest/lowest, `na` on a 0 range, an interior hole withheld". Probe P2 then
measured it, and two of those three readings were wrong. What five captured columns pin (0 mismatches each
over 666 bars: Stoch RSI K and D, S6; P2's `ta.stoch(x, x, x, 10)`, `ta.stoch(x, high, low, 10)`,
`ta.stoch(y, y, y, 10)` with `x` `na` every 50 bars and `y` flat for 20):
- `bar_index < n - 1` is `na` (P2: ungated, 8-9 bars differ);
- `hi` / `lo` are over the last `n` FINITE highs / lows, fewer while fewer exist (RESTART: 84 mismatches on
  P2's first column; the house tail rule starts the Stoch RSI %K 12 bars late);
- where `100 * (src - lo) / (hi - lo)` has no number (an `na` source, a flat window, no observation) the
  previous answer is KEPT (P2 bars 30, 80, ... repeat 29, 79; "an `na` source is `na`": 13 mismatches; the
  Stoch RSI's first bar, one observation, keeps nothing and is `na`; "a flat window is 0": 1 mismatch there).
- S10 (`vw-cs2-stoch-flat-window`, NYSE:RDDT 1D from the listing, local capture): one flat run (bars
  200..214, fully flat from 209) reached by three lead-ins, plus a hole at 215. Every lead-in reaches the run
  at 100 (the flat level is the window's new high from bar 200), and TradingView keeps 100 through the run and
  through the hole: 0 mismatches on K01, K03, K05 and K07 for "keep". So ONE rule fits every witness: where the
  formula has no number, keep the previous value. "A flat window is 0" misses S10 (and S6 by one bar); "the
  source at the high is 100" misses P2's flat run, which kept a 0.
- One case still not pinned, withheld by name (`stoch:flat-window`, `stochFlatPinned`): a flat window whose
  kept value is neither 0 nor 100, or whose source is off the window's level. Over `ta.stoch(x, x, x, n)` the
  bar before a flat window always reads 0 or 100, so this case needs a source other than the high / low
  columns. Until S10 every flat window after a non-zero value was withheld, which withheld S10's six
  bars 209..214 (100 each, exactly TradingView's) and the hold at 215.
  Pinned by PROVENANCE (review N2): a kept value is a 0 or a 100 when it was computed with the source exactly
  at the window's low or high, whatever its last bit. `(100 * (hi - lo)) / (hi - lo)` is not always the double
  100 (99.99999999999999 and 100.00000000000001 both occur, about 1 time in 20), so the first test, `prev ===
  100`, withheld real 100s. The scan, the kernel (one more state cell) and Python carry the provenance through
  every hold. Railed with a (lo, hi) pair whose 100 is not the double 100 (served), and with a 40 kept through two
  `na` sources into a flat window on its level (withheld).
- Runtime kernel `CARRIED2.stochPine` steps the same rule (rings of finite values, bars seen, the kept
  answer) and stops by name on the withheld case.
- ⚠️ P2's fourth column, `ta.highest(x, 10)` over the same holed source, reads the same "last n finite values"
  rule and contradicts this table's `highest` (RESTART, ruled 2026-09-08). Not changed here (out of scope);
  recorded as an open note.

### RCI (`interpret.js::rciAt/rciCol`, Python `_rci_at/_rci_col`)
- the Pearson correlation of time ranks and AVERAGE price ranks (0 mismatches over 2,564 S6 values; the
  `1 - 6 Σd² / n(n²-1)` shortcut differed on windows with ties);
- first value on bar `length` (all S6 columns; P1's control `ta.rci(close, 10)` starts on bar 10);
- P1 (0 mismatches on all its columns): an `na` of the source inside the window ranks as the
  LOWEST price, tied with every other `na` (`ta.rci(ta.sma(close, 5), 10)` draws 30.06 / -1.22 / -44.24
  on bars 10..12); a flat window is `na` (`ta.rci(math.round(close / 1000), 10)` draws nothing);
- P1's source is positive, so "an `na` ranks lowest" and "an `na` ranks as 0" give the same ranks there.
  This branch first withheld the case where they part (an `na` beside a value at or below 0); the
  coordinator's S1 ruling (`S1-RULES-2026-11-14.md`: "a na inside the window ranks as the LOWEST price")
  settled it, so it is served on every source and nothing is withheld for RCI.

### Withholding by name (both lanes, four doors)
`interpret.js::builtinWitnessMask` / `ast_interpret.builtin_witness_mask`, per call site, over the site's
own argument columns:
- `stoch:flat-window`: a flat window the captures do not pin (a kept value other than 0 or 100, or the
  source off the level), AND every hold that keeps it. (Review F3: an `na` source right after such a run kept
  the same value unflagged. The reviewer's case, a flat run after 100 at the source's level, is now the S10
  witness and is served; the hold-chain rail uses a source off the level.)
- Off the listing only (`opts.historyFromListing !== true`, review F1):
  * `stoch:left-edge`: a window of fewer than `n` finite values, or a hold of nothing or of such a value;
  * `rci:left-edge`: a window that reaches before the source's first finite value.
  Both rules were measured FROM the listing. Off it, a leading `na` is this chart's warm-up, where
  TradingView has real values. The reviewer measured, through the member door, `ta.rci(ta.sma(close, 5), 10)`
  serving 97.55 / 98.48 against 98.79 and `ta.stoch(s, s, s, 14)` wrong on bars 13..16. Both are now withheld
  by name, and every later bar equals the listing's answer (railed).
- How far a flagged bar reaches: every root bar within the tree's reach (`barIndexMask`'s rule:
  `maxLookback(tree) - maxLookback(site)` bars forward). A `stoch:flat-window` flag under a call that carries
  state withholds every later bar (review F4, kept): one unpinned value under `ta.ema` moves the rest of the
  series. A LEFT-EDGE flag never does (review N1). Past its reach, a carried smoother is where it is over
  any source that starts on this chart: its own seed is this chart's, and this engine serves that decay
  everywhere. `ta.ema(ta.stoch(close, high, low, 14), 3)` off the listing, for example, is served from bar 15
  with no code. ⚰️ The left-edge flag used to take the flat-window reach, so off the listing
  `r = ta.rsi(close, 14); plot(ta.ema(ta.stoch(r, r, r, 14), 3))` drew 0 of 566 bars, and so did
  `ta.ema(ta.rci(ta.sma(close, 5), 10), 3)`. The runtime lane drew 0 under no name, and the sentence said
  "every later bar is drawn". Now they are drawn from bar 30 (engine 56's house `stoch` drew from 29) and bar 16,
  every later bar drawn, and both sentences say what is withheld: the edge bars and each bar that reads them
  within the indicator's lookback.
  ⛔ Except under a call whose value a past bar sets FOR GOOD (re-review R1): `ta.valuewhen`
  (`valuewhenOccurrence`), `ta.cum`, any `series`-lookback call, a recurrence. `maxLookback` gives such a call 0
  bars of its own, so the bounded reach was about a bar. `ta.valuewhen(ta.crossunder(k, 20), k, 0)` over an edge
  stochastic then served the edge bar's wrong `k` (0 against 58.39) on every bar until the next cross, an error that
  never decays, and `ta.cum` carried it as an offset forever. Under such a call a left-edge flag withholds every
  later bar, by its code. The bounded reach is kept only for the decaying smoothers (`WITNESS_CARRIED_CALLS`: ema,
  rma, rsi, atr, adx, macd, ...). Railed both ways: `ta.valuewhen` over an edge stochastic is withheld after the
  edge (and drawn from the listing), and over `ta.stoch(close, high, low, 14)` it is served. In Python, `ta.cum` of
  each. Mutants R1a / R1b.
- A site inside a read of other bars (`tf`, `tf_live`, `sym`, `ltf`): the mask is not walked from the root.
  Those nodes evaluate their child through `interpret` on their own bars, so the mask runs THERE, on the bars
  the site reads, and names its code in the same channel (railed: a weekly `request.security` flat run is
  withheld by name; review F5). The runtime lane never reaches such a site: it refuses a weekly
  self-request by name before computing anything (`interpret:bind-time-text` on `syminfo.tickerid`, even when
  told the chart's symbol, and the same over plain `close`). That refusal predates this engine and is reported
  as a finding, not changed here.
- A site that reads a recurrence's own value never reaches the mask: the interpreter already refuses a window
  over `self` by name (`accum(0, stochPine(high, low, close + self * 0, 5), 20)` throws; railed, F5).
The runtime lane declines a column withheld by `stoch:flat-window` (`RuntimeRefusal`), and the VM kernel
stops by it at the first such bar. The left-edge codes do not decline a column that draws: off the
listing, the runtime lane's own measured curtain (`computeOffListing`) withholds the bars that depend on where
the chart starts. ⛔ A column the columnar lane withheld on EVERY bar by any engine-57 code declines the run by
that code (review N1): the runtime lane never draws zero bars under no name. Railed with a 12-bar chart under
`ta.stoch(s, s, s, 14)`: the host lane names `stoch:left-edge`, and the runtime refuses `stoch:left-edge`.

### The coordinator's S1 rules, checked against the captures
- RCI: served exactly as ruled (above).
- Stoch, "hh == ll gives 0": does NOT reproduce the S6 Stoch RSI. Its first bar (bar 14) has one RSI value,
  so its window is flat; answering 0 there starts K on bar 16, where TradingView's K starts on bar 17
  (1 mismatch on K, 1 on D). "Keep the previous value" reproduces P2 AND S6 with 0 mismatches on all five
  columns, and on P2's flat run (which follows a 0) the two readings are the same number. So the rule
  served is "keep". S10 then measured a flat run after 100, where "keep" and "0" differ, and TradingView
  kept the 100; what stays withheld is the case no capture has reached (above). Checked variants (P01/P02/P03/K/D mismatches): last-n-finite + keep 0/0/0/0/0;
  + "flat = 0" 0/0/0/1/1; + "na source = na" 13/13/0/0/0; RESTART windows 84/13/11/...; in-window finite
  values 36/0/0/0/0.
- `ta.highest` / `ta.lowest`: P2's `ta.highest(x, 10)` reads the last 10 finite values (0 mismatches),
  against the 2026-09-08 SPY capture behind this table's RESTART rule
  (`finite-window-na-policy-by-member-spy-1d-2026-09-08`, probe B: `highest` `na` on every hole bar).
  **S10 settles it for "last n finite"** (`vw-cs2-holed-highest-{v5,v6,stoch-v6}`, RDDT and AMEX:SPY, both
  from bar 0): over `x = bar_index % 50 == 30 ? na : close`, `highest` / `lowest` of the last 10 FINITE
  values, `na` before bar 9, reproduce all 12 columns with 0 mismatches. That holds under v5 and v6, alone and
  beside a `ta.stoch`, on both symbols. TradingView keeps a value on the hole bar (bar 30: 47.7 / 40.88 on RDDT,
  45.75 / 44.28125 on SPY), where the RESTART rule gives `na`. "The last 10 bars with the `na` skipped" misses
  26 / 29 (RDDT) and 233 / 365 (SPY). `stochPine` already uses last-n-finite windows: 0 mismatches on S10's
  stoch columns (H03, RDDT and SPY). The bar-9 divergence the S10 grade shows is master's house `stoch`.
  **NOT changed here (own engine):** the fix moves `FINITE_WINDOW.highest/lowest` (`NA.RESTART`), the VM
  window and the Python `NA_RESTART` entries, and it reaches 93 of 439 held capture sources (121 captures, 329
  call sites) and 161 of the repo's 839 `.pine` files. `highestbars` / `lowestbars` share the RESTART rule
  under a separate witness (PART Z, `naCurrent: 0`); that witness needs rereading in the same engine.

## Rails
- `app/src/components/chart/engine/ast/engine57Builtins.test.js` (host and runtime lanes, four doors, committed RDDT
  bars = the captures' 666 sessions, numbers read off the captures): the supertrend draws every bar TradingView
  draws (348 Up + 309 Down, first Down bar 9 = 73.13044, first Up bar 36) against an independent full-history
  reference, the member door equal; Stoch RSI K from 17 / D from 19 with 649 / 647 bars and spot values; probe
  P2's three stochastics (hole kept, windows across the hole, flat run keeping its 0); the S10 shape (a flat run
  after 100 at the source's level keeps 100, on every door and the runtime lane); an unpinned flat run (the source
  off the level after a 100) withheld by name, the runtime declining by the code; runtime lane, member door and the
  runtime KERNEL equal; RCI (10, 14-bar SMA of it, 30, 50): first bars 10 / 23 / 30 / 50, counts 656 / 643 / 636 /
  616, tie bars 103 / 55 / 55; probe P1 (bars 10..13 of `ta.rci(ta.sma(close, 5), 10)`, the flat window `na`); an
  `na` ranked lowest over a source with negative values, by hand; a withheld stochastic bar spreads through a
  finite window and forever through `ema`. Review tails: off the listing the left edge withheld by name and every
  later bar equal to the listing (F1, both functions, plus the control); the hold chain (F3); a weekly
  `request.security` site withheld there by name (F5); a window over `self` refused by the interpreter (F5).
- `app/src/components/chart/engine/ast/supertrend.test.js`: from the listing every bar equals Pine's full
  history on 18 synthetic series (3 settings); the stored tree carries the `nz` / `na(atr[1])` shape; off the
  listing the new tree draws exactly the bars a VERBATIM copy of the base tree (`ec72c19913`) draws, with the same
  numbers, at (3, 10), (2, 7) and (3, 50), the first drawn bar being 2W + n - 1 (F2).
- `runtime/__tests__/w4StateKernels.test.js`: the three tests that railed the old wrong behaviour rewritten,
  each with a comment (leading-`na` start, flat window, `na` source bar), plus a window skipping a high `na`,
  the kernel's stop by name on an unpinned flat window, and the kernel keeping the S10 100.
- `pinePhase1Builtins.test.js`: the `ta.rci` reference rewritten to the measured rule (it railed the shortcut).
- `tests/test_engine57_builtins.py` (Python lane, 18 tests): the same capture and probe numbers, S10's kept 100,
  the unpinned-flat withholding, the off-listing edge, the hold chain, the bounded supertrend's 2W + n - 1
  curtain against the reference, and JS vs Python bar for bar on 11 trees (`ast_conformance.run_js` / `run_py`).
- Registry and roster pins, each with its reason: `parse` / `sentence` (87 functions, 139 bar names, 288
  declared), `doorCoverage` (Pine-only redirect target, its probe), `executionShapeCensus`,
  `test_ast_interpret` / `test_ast_scalars`, the corpus case `stoch_pine_last_finite_values_held_answer`, the
  input-compat saved document, `docs/formulas/GRAMMAR.md` (regenerated), the stoch observation's
  `pasteLowersTo` (as `atr-14` has).
- Focused vitest set (16 files, 487 tests, with the runtime refusal-vocabulary rails) green under the heavy
  lock after the merge of `origin/master` (`6522dfdac5`); `test_engine57_builtins` 20 green. Re-review rails:
  N1 (off the listing, `ta.ema(ta.stoch(rsi, rsi, rsi, 14), 3)` drawn from bar 30 and `ta.ema(ta.rci(ta.sma(close,
  5), 10), 3)` from bar 16, every later bar drawn, the code named; the runtime lane draws or declines by a name; a
  17-bar chart whose every bar is edge declines `stoch:left-edge` in the runtime lane), N2 (a (lo, hi) pair whose
  100 is not the double 100, served through a flat window on the scan, the kernel and Python; a 40 kept through
  two `na` sources into a flat window, withheld). Earlier in this branch, one file at a time:
  `test_call_expansions_parity` 13, `test_ast_interpret` 105, `test_ast_scalars` 174, `test_ast_input_compat` 15,
  `test_ast_lookback_agreement` 5, `test_ast_conformance` 57 (+5 skipped), `test_ast_bounded_state` 38,
  `test_vendor_parity_stoch` 13, `test_saved_script_prebump` 60, `test_script_engine_version_gate` 6. Not run:
  the whole vitest suite (PC load rules).

## Host-parity digests (review F6)
Run on this branch's code with the engine identity pinned to master's 54 (`SCRIPT_ENGINE_VERSION` set to 54 in a
copy-aside edit, restored byte for byte), against `origin/master`'s `expected-digests.json`: 166 cases, **158
unchanged, 8 moved, every move a value digest**: `rsi_stoch@{calcbars,d5000,forming,listing,m5_32768}` and
`supertrend@{calcbars,forming,listing}`. 0 status or guard changes, 0 cases added or lost. Then regenerated at 57
with `--write`: the file is byte-identical to the one already committed at 57. Re-run after N1 / N2 (merged
`6522dfdac5`): the same 8 moves, and `--check` reads `HP-1 GREEN: 166/166 cases equal the committed digests`.

## Mutants (copy aside, mutate, focused rail, restore from the copy, `git hash-object` == HEAD blob)
52 mutants, 52 killed, every restore matched the HEAD blob; the control (no edit) is the green rails run.
Supertrend: S1/S2 a band body without `nz`, S3 seed `up`, S4 no `na(atr[1])` arm, S5 no guard, S6 guard one
window deep, S7 the old offset guard back, S8 Python twin without `nz`. Stochastic: K1 flat = 0, K2 `ta.stoch`
back on the house column, K3 RESTART windows, K4 no keep, K5 flat witness off, K6 kernel gate on the run, K7
kernel no keep, K8 kernel ring emptied by an `na`, K9 kernel no stop, K10 / K11 Python no keep / witness off.
RCI: R1 the 6*sum(d^2) shortcut, R2 ordinal ranks, R3 first bar n-1, R4 `na` propagates, R5 `na` ranked 0, R6 /
R7 / R9 Python ordinal / n-1 / `na` as 0, R8 Python mask not applied. Plumbing: X1 runtime no decline, X2 mask
off, X3 mask without reach. Review: F1a the mask ignores the listing fact, F1b rci edge never flagged, F1c stoch
short window off the listing unflagged, F1d Python ignores the listing fact; F2a / F2b the curtain 2W (JS /
Python); F3a / F3b the hold chain drops the flag (JS / Python); F5b a `tf` child does not name its withholding.
S10: S10a / S10d a kept 100 not pinned (JS / Python), S10b / S10e the source off the level counted as pinned (JS /
Python), S10c the kernel's level check off. Re-review: N1a / N1c a left-edge flag under a smoother withholds
every later bar again (JS / Python), N1b the runtime draws a column withheld on every bar as a silent 0; N2a / N2c
/ N2d the scan / kernel / Python pin by the number (`prev === 100`) instead of provenance, N2b every kept value
counted as from the high or low. (F5a, a self-reading site served, was dropped: that branch is
unreachable, because the interpreter refuses a window over `self` first. The rail asserts that refusal.)

## Vendor harness, both lanes (BEFORE = `origin/master` `6522dfdac5`'s product files swapped into this tree; re-measured after N1 / N2)
| set | lane | before M/D/I | after M/D/I | moves |
|---|---|---|---|---|
| held store (321, incl. S1 probes and S10) | production | 140/110/71 | 145/105/71 | supertrend, stochastic-rsi, rank-correlation-index, rci-ribbon, `vw-cs2-stoch-flat-window` D -> M |
| held store | runtime-on | 154/116/51 | 159/111/51 | the same five |
| fixtures (579, master's S10 / S11 fixtures included) | production | 158/81/340 | 160/80/339 | `vw-cs2-stoch-flat-window` D -> M; `stoch-k-14` I -> M (the swap, below) |
| fixtures | runtime-on | 188/82/309 | 190/81/308 | the same two |

(`stoch-k-14`: a swap that keeps this branch's `pasteLowersTo` reads that one capture INCONCLUSIVE on master's
code; that comes from the swap, it is not a move.) **0 MATCH -> DIVERGE, 0 new DIVERGE, in every set and lane.**
Value level (bars na/value mismatched, summed over plots): supertrend 657 -> 0, rci-ribbon 125 -> 0,
stochastic-rsi 24 -> 0, rank-correlation-index 17 -> 0, `vw-cs2-stoch-flat-window` 342 -> 0, `vw-cs1-stoch-p2`
1343 -> 70 (P04 `ta.highest`, open note 1), `vw-cs1-rci-p1` 670 -> 8 (P01 bars 42..49, open note 2),
`vw-cs2-holed-highest-stoch-v6` RDDT 769 -> 138 and SPY 10339 -> 1858 (H03 stoch now MATCH on both; the rest
is H01 / H02 `ta.highest` / `ta.lowest`, open note 1). The probe captures that stay DIVERGE do so only on those two
open notes. No capture has a withheld bar where TradingView draws a value.

## Census (the four doors and one bind on the NYSE:RDDT 1D listing bars, on and off the listing)
Scoped to every source that calls `supertrend`, `stoch` or `rci` in any spelling (46 unique: licence-held sample
35, repo `.pine` 6, held captures 4, committed fixture 1; nothing outside these names reaches the changed code
except the mask walk, which returns null without a site). Re-measured after the review and S10 changes, the same
numbers as before them. Guard changes at the four doors: **0**. Translations changed (screen or pane formula
text): 21 (the `stochPine` landing and the new supertrend tree). Plots drawn on the listing: 81,938 -> 84,551.
Plots empty on the listing: 68 -> 65; the one newly empty is `vw-cs1-rci-p1`'s `ta.rci(math.round(close / 1000),
10)`, which TradingView draws nothing for (master drew it). Dark plots (the listing drawing less than the
off-listing replay): **4 -> 0**: `builtin:supertrend` (both plots: 665 -> 1322 bars drawn) and
`dual-supertrend-ichimoku-and-dmi` (2). Bars withheld by name: 0 in every census source, on the listing.
Bound census and the dark-plot demotion list are engine 55's (`coverageMapDoorCensus`, not on master); the
scoped bind above runs the same dark-plot test (`listing 0 / off-listing N`, `onWhereOff < offDrawn`).

## Evidence ledger (`python -m tools.vendor_harness.evidence_engine regrade`)
(Before the review round; the coordinator regrades after the rebase, and the 104 foreign rows of the later local
regrade were discarded, not committed.) 314 captures graded, +314 rows at engine 57 (grader `0d24464e1be1`); 0 legacy rows retired. 103 had an earlier
row: **0 verdict moves** among them in either lane; 211 filed for the first time. Totals at engine 57:
production MATCH 141 / DIVERGE 89 / INCONCLUSIVE 84; runtime-on MATCH 157 / DIVERGE 97 / INCONCLUSIVE 60.

## Open notes
1. `ta.highest` / `ta.lowest` (above): S10 settles "last n finite" against the 2026-09-08 SPY RESTART witness;
   the table is unchanged here and goes to its own engine (93 held capture sources / 121 captures / 329 call
   sites, 161 repo `.pine` files).
2. **`ta.sma` precision.** P1's last 8 mismatches (bars 42..49 of `ta.rci(ta.sma(close, 5), 10)`) are an exact
   TIE TradingView sees and we do not: the vendor's `sma` on bars 40 and 42 is the same double and ours differs by
   one ulp. Rebuilt off the capture's own bars, compensated (Neumaier) summation reproduces all 656 values, plain
   left-to-right summation (what `windowMean` / `_window_mean` do) misses exactly these 8. Every exact-equality
   read of an `sma` (ties, `==`) is exposed; changing the summation moves every `sma` digest and is not done here.
   S10 (`vw-cs2-sma-exact-tie`) supports it: RDDT MATCH, AMEX:SPY DIVERGE at bar 3665 (TradingView's tie
   reads 1, ours 0). Recorded only; out of scope.
3. (Closed by review F5.) A stochastic inside a read of other bars (`request.security`) is analysed on the
   bars it reads and withheld there by the same code.
4. Engine 55's census rail `a DARK plot (the builtin Supertrend ...) is a blocker` uses the builtin Supertrend as
   its dark subject; after this branch that plot is no longer dark, so the rail needs another subject at the
   rebase.
5. SCRIPT_ENGINE_VERSION is 57 with history lines 55 and 56 missing on this branch (they are on #1264 / #1265);
   the coordinator rebases after they merge. The merge order is now 55 -> 56 -> 58 -> 57: with this branch's
   supertrend, `dual-supertrend-ichimoku-and-dmi`'s values are exact (0 mismatches), but its colour
   `dirIchi == dirIchi[1] ? ichiColor : na` would draw the default gold on 653 bars until engine 58's colour path
   lands. So this branch rebases onto 58 last and takes master + 1 then, regenerates the digests, has the
   ledger regraded centrally, and moves engine 55's census rail subject (note 4). The ledger rows committed
   earlier on this branch (`7b28e88686`) predate the rule that the ledger is never committed from a branch.
6. **Runtime lane, weekly self-request (finding, predates this engine).** `request.security(syminfo.tickerid,
   "W", close)` refuses `interpret:bind-time-text` on `syminfo.tickerid` through `computeRuntimeColumns`, even with
   `ctx.symbol = {ticker: 'RDDT', exchange: 'NYSE'}` (a confirmed `symbolScope.json` row) and through
   `buildRuntimeIr(..., {symbol, tf: 'D'})`. It is a refusal by name, so nothing wrong is served, but the symbol
   does not seem to reach that request's evaluation.
7. Off-listing RSI warm-up (an observation, not a stochastic rule): the reviewer's bare-`interpret` scratch shows
   `stochPine(rsi(close, 14), ...)` off the listing differing from the listing on bars 27..35. The stochastic's
   windows there are full and finite. The difference is `ta.rsi`'s own RMA seed on the chart's first bar, shared by
   every consumer of an off-listing RSI.
8. Supertrend at long periods off the listing: the base's RMA-convergence residual (6,756 bars at n = 50 in the
   reviewer's 20 walks, both versions), stated in `SUPERTREND_NOTE` and above.
9. `origin/master` moved after the first measurement merge (`8785237ce7` -> `48e1a6cbfc`, S11 capture data
   only).
10. **N3 (pre-existing, recorded):** a strategy's windows bypass the runtime lane's off-listing curtain
    (`computeOffListing`), so off the listing a strategy's early bars are not withheld the way an indicator's
    are. Not changed here.

## Takeover at the master merge (2026-11-15, parked for the landing train)
The original builder left. This section records what the takeover did and measured. Everything above is the
original builder's evidence, measured before this merge.

- **Review state.** #1294 has no GitHub review comments. The last coordinator review item, R1 (`aed0178cbc`), was
  committed but not pushed; its rails and mutants R1a / R1b had been written but not run.
- **Merge.** `origin/master` merged (`e3f5818fed`, a merge commit).
  - `interpret.js`: `withheldReadMask` keeps both masks, this branch's `builtinWitnessMask` and master's
    `tfMergeMask`, and both blocks are kept.
  - `scriptEngineVersion.js`: master's 55 and 56 lines kept. This branch's line is **NUMBER PENDING** (master + 1 at
    the landing train), provisionally 57. Master is at 57 since #1342, so the train assigns the number and re-merges.
  - `expected-digests.json`: master's. The host-parity digests are **not** regenerated here; the train does that at
    its number.
  - `evidence-ledger.jsonl`: master's. A branch never commits ledger rows; the regrade is central.
- **Rails after the merge (normal heavy lock).** 23 vitest files, 676 passed and 2 skipped. These are the 16 of this
  branch's set plus `engine55HtfMerge`, `engine55OtherSymbolDoors`, `vendorHarness.e55NamedGaps`,
  `coverageMapDoorCensus.measure`, `savedDocumentRoundTrip`, `savedScriptUpgrade` and `editorStatus`. Python: 9
  files, 412 passed.
  - Before the fixes below, 3 failed. All three came from this branch meeting master's engine 55 / 56 rails, and
    `8c8945b258` fixes them:
    - `savedDocumentRoundTrip`: `corpus/committed/multicator-table` moves by engine 57. `MOVED_BY_ENGINE` entries now
      carry an undo kind. Engine 57's undo REBUILDS the script, and replays the member's edits, with engine 57's two
      table changes put back: `ta.stoch` on the house `stoch`, and `ta.supertrend` on a verbatim engine-56 expansion
      (`__fixtures__/supertrendTreesEngine56.js`, copied from `origin/master` `839617cdb2`). Both are restored in
      `finally`. The undone document EQUALS the saved one, and a plain build after it is today's document again.
      This script's `ta.stoch` feeds only tables and votes, so its digest moves by the supertrend.
    - `coverageMapDoorCensus`: the dark-plot rail's subject (open note 4). It is now the real engine-56 dark
      Supertrend: the door's translation with engine 56's tree swapped in. A control asserts that today's tree on
      the same script has no dark-plot blocker.
- **Mutants at the takeover.** Run on the merged tree (`8c8945b258`) in the original lists' copy-aside discipline, with a passing CONTROL per command first (5 of 5 green), each run in its own normal heavy-lock hold, and every file restored from its copy (`git hash-object` == HEAD). Parked at the deadline after **41 of 54**: **40 killed, 1 SURVIVED (F5b)**. R1a / R1b, written at R1 and never run before, are both **killed**.
  - Killed: R1a R1b F1a F1b F1c F1d F2a F2b F3a F3b S10a-S10e N1a N1b N1c N2a-N2d S1-S8 K1-K10.
  - Not run (deadline): K11 (interrupted, no verdict; its file restored == HEAD), R1-R9, X1-X3. X2's anchor was re-pointed to the same edit, because master's `tfMergeMask` now follows the witness mask in `withheldReadMask`.
  - **F5b SURVIVES after the merge.** The mutant drops `chartClockSink` from the `tf` child's options in `interpret.js`, and every engine57Builtins rail stays green (33/33). Before the merge it was killed. The likely cause: master's engine-56 `tf_merge` path now names a weekly `request.security` site's withholding through its own channel, so the F5 rail no longer depends on the `tf` child's sink. This was **not investigated**: the branch is parked. Either the F5 rail needs a `tf` (look-ahead-on) subject the merge does not route through `tf_merge`, or that line is no longer load-bearing. Open for the landing train.
- **Not done here.** Phase C (the harness on both lanes and the census, before and after) and the number /
  host-parity / service-smoke steps. This branch is parked for the landing train's shared engine number and
  shared census and harness run. The harness and census numbers above are the original builder's, from before this
  merge.

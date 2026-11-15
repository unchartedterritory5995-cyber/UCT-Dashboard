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
- How far a flagged bar reaches: every root bar within the tree's reach (`barIndexMask`'s rule), and every
  later bar under a call that carries state (review F4, kept for now). One flagged bar under `ta.ema`
  withholds the rest of the series; the queued probe of a flat run after a non-zero %K settles it.
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
stops by it at the first such bar. The left-edge codes do not decline: off the listing, the runtime lane's
own measured curtain (`computeOffListing`) withholds the bars that depend on where the chart starts.

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
  reference, the member door equal, off the listing still nothing before bar 400 and equal where it draws;
  Stoch RSI K from 17 / D from 19 with 649 / 647 bars and spot values; probe P2's three stochastics (hole kept,
  windows across the hole, flat run keeping its 0); runtime lane, member door and the runtime KERNEL equal; a
  flat run after a value other than 0 withheld by name, runtime declining by the code; RCI (10, 14-bar SMA of it,
  30, 50): first bars 10 / 23 / 30 / 50, counts 656 / 643 / 636 / 616, tie bars 103 / 55 / 55; probe P1 (bars
  10..13 of `ta.rci(ta.sma(close, 5), 10)`, the flat window `na`); an `na` ranked lowest over a source with
  negative values, by hand; a withheld stochastic bar spreads through a finite window and forever through
  `ema`; a stochastic inside `request.security` is drawn.
- `app/src/components/chart/engine/ast/supertrend.test.js`: from the listing every bar equals Pine's full
  history on 18 synthetic series (3 settings), the listing replay draws wherever the off-listing one does with
  the same number, the stored tree carries the `nz` / `na(atr[1])` shape, and the new guard withholds exactly
  the bars the old band guard withheld off the listing (and none on it).
- `runtime/__tests__/w4StateKernels.test.js`: the three tests that railed the old wrong behaviour rewritten,
  each with a comment (leading-`na` start, flat window, `na` source bar), plus a window skipping a high `na`
  and the kernel's stop by name.
- `pinePhase1Builtins.test.js`: the `ta.rci` reference rewritten to the measured rule (it railed the shortcut).
- `tests/test_engine57_builtins.py` (Python lane): the same capture numbers, the probe numbers, the flat-run
  withholding, the bounded supertrend against the reference, and JS vs Python bar for bar on 10 trees
  (`ast_conformance.run_js` / `run_py`).
- Registry and roster pins, each with its reason: `parse` / `sentence` (87 functions, 139 bar names, 288
  declared), `doorCoverage` (Pine-only redirect target, its probe), `executionShapeCensus`,
  `test_ast_interpret` / `test_ast_scalars`, the corpus case `stoch_pine_last_finite_values_held_answer`, the
  input-compat saved document, `docs/formulas/GRAMMAR.md` (regenerated), the stoch observation's
  `pasteLowersTo` (as `atr-14` has), host-parity digests (`--write`: all 166 moved with the engine identity,
  0 status or guard changes).
- Focused vitest set (13 files, 401 tests) green under the heavy lock; pytest green one file at a time:
  `test_engine57_builtins` 15, `test_call_expansions_parity` 13, `test_ast_interpret` 105, `test_ast_scalars`
  174, `test_ast_input_compat` 15, `test_ast_lookback_agreement` 5, `test_ast_conformance` 57 (+5 skipped),
  `test_ast_bounded_state` 38, `test_vendor_parity_stoch` 13, `test_saved_script_prebump` 60,
  `test_script_engine_version_gate` 6. Not run: the whole vitest suite (PC load rules).

## Mutants (copy aside, mutate, focused rail, restore from the copy, `git hash-object` == HEAD blob)
31 mutants, 31 killed, every restore matched the HEAD blob; the control (no edit) is the green rails run.
Supertrend: S1/S2 a band body without `nz` (6 / 1 red), S3 seed `up` (7), S4 no `na(atr[1])` arm (5), S5 no
guard (11), S6 guard one window deep (7), S7 the old offset guard back (9), S8 Python twin without `nz`
(tree parity red). Stochastic: K1 flat = 0 (4), K2 `ta.stoch` back on the house column (4), K3 RESTART
windows (2), K4 no keep (2), K5 flat witness off (2), K6 kernel gate on the run (4), K7 kernel no keep (2),
K8 kernel ring emptied by an `na` (1), K9 kernel no stop (1), K10 / K11 Python no keep / witness off (1 / 1).
RCI: R1 the 6·Σd² shortcut (6), R2 ordinal ranks (6), R3 first bar n-1 (7), R4 `na` propagates (2), R5 `na`
ranked 0 (1), R6 / R7 / R9 Python ordinal / n-1 / `na` as 0 (1 each), R8 Python mask not applied (1).
Plumbing: X1 runtime no decline (1), X2 mask off (2), X3 mask without reach (1).

## Vendor harness, both lanes (BEFORE = `origin/master`'s product files swapped into this tree)
| set | lane | before M/D/I | after M/D/I | moves |
|---|---|---|---|---|
| held store (275, incl. S1 probes) | production | 140/90/45 | 144/86/45 | supertrend, stochastic-rsi, rank-correlation-index, rci-ribbon D -> M |
| held store | runtime-on | 155/96/24 | 159/92/24 | the same four |
| fixtures (376) | production | 158/50/168 | 158/50/168 | none |
| fixtures | runtime-on | 185/50/141 | 185/50/141 | none |

(Fixture BEFORE counts are from the first BEFORE run, with master's own `stoch-k-14` fixture; a swap that keeps
this branch's `pasteLowersTo` reads that one capture INCONCLUSIVE on master's code, which is the swap, not a move.)
**0 MATCH -> DIVERGE, 0 new DIVERGE, in every set and lane.** Value level (bars na/value mismatched, summed over
plots): supertrend 657 -> 0, rci-ribbon 125 -> 0, stochastic-rsi 24 -> 0, rank-correlation-index 17 -> 0,
`vw-cs1-stoch-p2` 1343 -> 70 (P04 `ta.highest`, below), `vw-cs1-rci-p1` 670 -> 8 (P01 bars 42..49, below). Both
probe captures stay DIVERGE (they were DIVERGE before on more plots): their remaining items are the two open
notes. No capture has a withheld bar where TradingView draws a value (no `stoch:flat-window` bar occurs). (These
counts predate the S10 narrowing, which only serves bars that were withheld before.)

## Census (the four doors and one bind on the NYSE:RDDT 1D listing bars, on and off the listing)
Scoped to every source that calls `supertrend`, `stoch` or `rci` in any spelling (46 unique: licence-held sample
35, repo `.pine` 6, held captures 4, committed fixture 1; nothing outside these names reaches the changed code
except the mask walk, which returns null without a site). Guard changes at the four doors: **0**. Translations
changed (screen or pane formula text): 21 (the `stochPine` landing and the new supertrend tree). Plots drawn on
the listing: 81,938 -> 84,551. Plots empty on the listing: 68 -> 65; the one newly empty is
`vw-cs1-rci-p1`'s `ta.rci(math.round(close / 1000), 10)`, which TradingView draws nothing for (master drew it).
Dark plots (the listing drawing less than the off-listing replay): **4 -> 0**: `builtin:supertrend` (both
plots: 665 -> 1322 bars drawn, off-listing 920 unchanged) and `dual-supertrend-ichimoku-and-dmi` (2). Rechecked:
`multicator-table` doors unchanged (`OK, OK, runtime:object-op, OK`), listing 5328 bars drawn as before, off-listing
5119 -> 5324; `custom-screener-with-alerts` refuses `pine:objects-only` at the host doors before and after (no
capture of either in the store). Bars withheld by name: 0 in every census source and capture.
Bound census and the dark-plot demotion list are engine 55's (`coverageMapDoorCensus`, not on master); the
scoped bind above runs the same dark-plot test (`listing 0 / off-listing N`, `onWhereOff < offDrawn`).

## Evidence ledger (`python -m tools.vendor_harness.evidence_engine regrade`)
314 captures graded, +314 rows at engine 57 (grader `0d24464e1be1`); 0 legacy rows retired. 103 had an earlier
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
   the coordinator rebases after they merge.

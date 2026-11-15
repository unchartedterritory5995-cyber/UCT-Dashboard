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
  The guard is now a bounded window's own curtain `2W` deep, `na(accum(0, 0, 2W))` (a constant body, so
  `varOriginMask` never reads it as a value carried from before the loaded bars: an identity-body
  version was withheld whole off the listing as `var-origin:window`, caught by the door rail): off the listing it is `na` on exactly the bars `t < 2W` the old
  guard withheld (railed bar for bar against the old guard on three series), and it is in the TREE, so the
  bare `interpret()`, the screen and the Python lane all withhold those bars with no consumer mask involved
  (the condition the report set for dropping the guard is therefore not needed). From the listing both
  accums are 0 on every bar, so nothing is withheld: every bar TradingView draws is drawn.
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
- One case not pinned, withheld by name: a flat window whose kept value is not 0 (`stoch:flat-window`).
  P2's flat run followed a 0, where "keep" and "0" agree.
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
`interpret.js::builtinWitnessMask` / `ast_interpret.builtin_witness_mask`: per `stochPine` site, the bars of
a flat window whose kept value is not 0, spread to every root bar within the tree's reach (`barIndexMask`'s
rule; every later bar under a call that carries state), named `stoch:flat-window` in the chart-clock channel
with a sentence. A site inside a read of other bars is not analysed (stated residual: withholding every
higher-timeframe stochastic for a flat run after a non-zero value would blank plots that draw exactly). The
runtime lane declines a column withheld by the code (`RuntimeRefusal`), and the VM kernel stops by it.

### The coordinator's S1 rules, checked against the captures
- RCI: served exactly as ruled (above).
- Stoch, "hh == ll gives 0": does NOT reproduce the S6 Stoch RSI. Its first bar (bar 14) has one RSI value,
  so its window is flat; answering 0 there starts K on bar 16, where TradingView's K starts on bar 17
  (1 mismatch on K, 1 on D). "Keep the previous value" reproduces P2 AND S6 with 0 mismatches on all five
  columns, and on P2's flat run (which follows a 0) the two readings are the same number. So the rule
  served is "keep", and the one case where "keep" and "0" differ (a flat window after a value other than 0)
  is withheld by name. Checked variants (P01/P02/P03/K/D mismatches): last-n-finite + keep 0/0/0/0/0;
  + "flat = 0" 0/0/0/1/1; + "na source = na" 13/13/0/0/0; RESTART windows 84/13/11/...; in-window finite
  values 36/0/0/0/0.
- `ta.highest` / `ta.lowest`: P2's `ta.highest(x, 10)` reads the last 10 finite values (0 mismatches),
  which contradicts the 2026-09-08 SPY capture behind this table's RESTART rule
  (`finite-window-na-policy-by-member-spy-1d-2026-09-08`, probe B: `highest` `na` on every hole bar and
  `highest == lowest ==` the lone observation the bar after, 346 ok / 0 bad). Both are v6 and both are
  direct reads, so one of them is not the whole rule (a TradingView change between the dates, or a
  context difference: P2's `ta.highest(x, 10)` sits beside a `ta.stoch(x, x, x, 10)` over the same series).
  NOT changed here: flipping the table on one witness against another would move every `highest` /
  `lowest` over a holed source (and the runtime window) on contested evidence. `stochPine` keeps its own
  last-n-finite windows, which P2's stoch columns pin regardless. What would settle it: `ta.highest(x, n)`
  alone on a holed source, and again beside a `ta.stoch` of the same series, captured the same day.

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
notes. No capture has a withheld bar where TradingView draws a value (no `stoch:flat-window` bar occurs).

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
1. `ta.highest` / `ta.lowest` (above): P2 and the 2026-09-08 SPY probe disagree; the table is unchanged.
2. **`ta.sma` precision.** P1's last 8 mismatches (bars 42..49 of `ta.rci(ta.sma(close, 5), 10)`) are an exact
   TIE TradingView sees and we do not: the vendor's `sma` on bars 40 and 42 is the same double and ours differs by
   one ulp. Rebuilt off the capture's own bars, compensated (Neumaier) summation reproduces all 656 values, plain
   left-to-right summation (what `windowMean` / `_window_mean` do) misses exactly these 8. Every exact-equality
   read of an `sma` (ties, `==`) is exposed; changing the summation moves every `sma` digest and is not done here.
3. A stochastic inside a read of other bars (`request.security`) is not analysed by the witness mask (stated
   above): a flat run after a value other than 0 there is served with the kept value.
4. Engine 55's census rail `a DARK plot (the builtin Supertrend ...) is a blocker` uses the builtin Supertrend as
   its dark subject; after this branch that plot is no longer dark, so the rail needs another subject at the
   rebase.
5. SCRIPT_ENGINE_VERSION is 57 with history lines 55 and 56 missing on this branch (they are on #1264 / #1265);
   the coordinator rebases after they merge.

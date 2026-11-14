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
  The guard is now the bounded window's own curtain two windows deep,
  `na(accum(accum(0, self, W), self, W))`: off the listing it is `na` on exactly the bars `t < 2W` the old
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
- P1 (0 mismatches on all its columns): an `na` of the source inside the window ranks as 0
  (`ta.rci(ta.sma(close, 5), 10)` draws 30.06 / -1.22 / -44.24 on bars 10..12); a flat window is `na`
  (`ta.rci(math.round(close / 1000), 10)` draws nothing);
- one case not pinned, withheld by name: an `na` in a window that also holds a value at or below 0, where
  "an `na` is 0" and "an `na` ranks below everything" differ (`rci:na-window`).

### Withholding by name (both lanes, four doors)
`interpret.js::builtinWitnessMask` / `ast_interpret.builtin_witness_mask`: per call site, the flagged bars,
spread to every root bar within the tree's reach (`barIndexMask`'s rule; every later bar under a call that
carries state). Codes in the chart-clock channel with a sentence each (`CHART_CLOCK_WITHHELD`). A site inside
a read of other bars: an `rci` whose source is not provably a positive price withholds the whole tree; a
`stochPine` there is not withheld (stated residual: blanking every higher-timeframe stochastic for a flat
run after a non-zero value would withhold plots that draw exactly). The runtime lane declines a column
withheld by either code (`RuntimeRefusal(code)`), and the VM kernel stops by `stoch:flat-window`.

MEASUREMENTS_PLACEHOLDER

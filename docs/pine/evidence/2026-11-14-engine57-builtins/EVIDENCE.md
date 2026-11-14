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

MEASUREMENTS_PLACEHOLDER

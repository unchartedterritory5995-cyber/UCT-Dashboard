# WS-C, the constant half: TradingView never stops a constant offset (engine 83)

Branch `feat/pine-wsc-history`. This builds the coordinator's design approval of 2026-11-19 (patrick-2b): rule (2)
and rule (3) of WS-C `max_bars_back`. Rule (1), the dynamic half (READ_*_DYN, unproved rings, the four "ours
today" rails), is patrick-54's build and is not touched here.

## 1. The readings

Captures M1-M5: run `wsc-mbb-2026-11-18`, AMEX:SPY 1D from the listing, 8,510 bars, packet sha256
`6f54e4c81044ba73efe4c1af249f217698793fb20c476a76e338f47c7e457011`, promoted in this branch.

| row | script | TradingView |
|---|---|---|
| M1 | `indicator(max_bars_back = 20)`, `plot(close[30])` | real from bar 30, `na` before it |
| M4 | `max_bars_back(x, 50)`, then `x[60]` and `ta.sma(x, 60)` | both real on every bar |
| M5 | `n = 6000`, `plot(close[n])` | real on the 2,509 bars past bar 6,000, `na` before it |

Q-MBB-1 / -2 (runs `mbb-2026-11-18` and `mbb-late-2026-11-18`, packets `2b3c2f290330` and `bc627481ec44`) are
licence-held and promoted as ledger rows only. They read dynamic offsets past a declared buffer, which is the
dynamic half, and are cited here, never read.

## 2. The rules built

**Rule (2): a CONSTANT offset is served past a declared buffer and past 5,000.** On the runtime lane:

- The `runtime:directive` refusal of `mbbStaticCheck` / `mbbCanonicalCheck` is gone at its five sites.
- A chart series or a column at a constant offset is read by `READ_HIST` (no ring). A variable is read from a ring
  as deep as the offset, bounded by `HISTORY_VALUES` (262,144 cells) and the chart's `HISTORY` (32,768 bars), as
  every ring is.
- Before the offset's bar the value is `na`, as M1 and M5 read.
- A pure subtree whose constant offset passes the columnar lane's lookback cap (`budget.js::DEFAULT_BUDGET.
  maxLookback`, 960 on a daily chart) is lowered piecewise instead of as a column
  (`pineRuntimeFrontend.js::constantOffsetPastLookbackCap`, read by `needsRuntime`). As a column it refused
  `budget:lookback`. Lowered piecewise it reads through the VM and needs no warm-up.

The host lane already served a constant offset past a declared buffer (M1 MATCH before this build).

**The production lane keeps M5 refused, by ruling (coordinator, 2026-11-19).**

- `budget.js` makes `maxLookback` both the host lane's warm-up cap and its bar-offset ceiling: one number, by
  design. The 2026-11-17 compute-cap ruling raised none of the caps.
- So `close[6000]` is refused by name on the host lane (`budget:lookback`). The member door hands it to the runtime
  lane, which draws it (runtime-on MATCH).
- A second host ceiling was judged not worth a budget ruling now.

**Rule (3): `max_bars_back(x, n)` is served as declared and bounds nothing.**

- Runtime lane: `max_bars_back(<name>, <whole number>)` is a no-op statement for any bound (`maxBarsBackShape`).
  Only `(x, 5000)` passed before. A computed bound still refuses `runtime:directive`, by name.
- Host lane: the two refusals the CALL triggered on a per-bar read are gone. These were `pine.js::historyReadOf`'s
  `pine:offset-literal` ("a per-series buffer this read does not model") and the object lane's
  `max-bars-back-call`.
- The buffer VALUES the per-bar reads use are the next rule's (below).

**Rule (4), coordinator ruling 2026-11-19 (after #1917 landed the runtime lane's dynamic reads): a declared
`max_bars_back` never SHRINKS the host lanes' per-bar read window.**

- Evidence: M2 (`close[n]`, n = 25 past bar 100, under a declared 20: real on every bar) and Q-MBB-1 / -2
  (`close[k]` and `ta.ema(close, 5)[k]`, k = `bar_index % 120`, under a declared 50: real, early or late).
- Both host lanes took `declared.limit || AUTO_MAX_BARS_BACK` as the window: the plot lane (`barsAgo`, in
  `pine.js::historyReadOf`) and the object lane (`{v:'at'}`, in `historyReadRef`). So M2 was withheld from bar 101
  where TradingView draws it; on the object lane the read was a runtime error.
- Now ONE helper, `pine.js::historyReadBufferOf`, sizes both: max(declared, `AUTO_MAX_BARS_BACK` 400). A declaration
  of at least 400 is the buffer, as before; below it the automatic buffer applies, and a read past 400 is withheld,
  unwitnessed, never an error. A script that declares nothing is unchanged.
- Only a script that declares `max_bars_back` below 400 can move. In the samples: 32 committed captures (29 of them
  Fred RS at 253, plus M1, M2 and one at 50) and 9 sources (the door census below).

## 3. Rails

- `runtime/__tests__/wscConstantOffsets.test.js`:
  - The runtime lane runs each committed capture's own source over its own 8,510 bars. Every row of M1, M4 and M5
    is TradingView's on every bar.
  - The captures hold the rule: `na` before the offset's bar, real after it.
  - A variable's constant offset of 5,500 reads from a ring that deep.
  - `ta.sma(close, 10)[cap + 40]` is read piecewise and is correct on every bar.
  - CONTROL: a computed `max_bars_back` bound is refused.
- `__tests__/vendorHarness/vendorHarness.wscAcceptance.test.js`, as a member sees it, both lanes:
  - M1 and M4 are drawn by the host lane and MATCH.
  - M5 is refused `budget:lookback` on the production lane.
  - On the runtime-on lane the door hands M5 to the runtime lane, and every row MATCHes.
- Flipped from "ours today", each citing its capture:
  - `w4T17T13Probes.test.js`: the M1 / M4 / M5 rows now build.
  - `historySeriesWalls.test.js`: section 1's three constant rows (`close[6000]`, `close[30]` past a declared 20,
    a variable's `x[25]` past a declared 20) are now served and checked bar by bar.
  - `c18WhileAndLastBar.test.js`: `max_bars_back(x, 100)` is a no-op. A computed bound refuses.
  - `objectHistoryRead.test.js` and `ast/pine.historyRead.test.js`: a script that calls `max_bars_back(x, n)` is
    read like any other.

| mutant | rail that went red |
|---|---|
| M43 a constant past a DECLARED buffer refused again (column path) | `wscConstantOffsets` (M1 / M4 / M5) + `historySeriesWalls` |
| M44 a constant past 5,000 refused again | `wscConstantOffsets` + `wscAcceptance` (M5 runtime-on) |
| M45 `max_bars_back(x, n)` refused below 5,000 again | `wscConstantOffsets` (M4) + `c18WhileAndLastBar` |
| M46 no piecewise route past the lookback cap | `wscConstantOffsets` (piecewise) + `wscAcceptance` (M5 runtime-on) |
| M47 host: the call refuses a per-bar read again | `ast/pine.historyRead.test.js` |
| M48 object lane: `max-bars-back-call` refused again | `objectHistoryRead.test.js` |
| M49 a variable's constant ring capped at 5,000 | `wscConstantOffsets` (ring that deep) |

Rule (4)'s rails:
- `__tests__/wscHostReadWindow.test.js`:
  - the plot lane's window for no declaration, a declared 20 and a declared 500;
  - Q-MBB-1's shape on SPY's own 8,510 committed bars: every `close[k]` is the bar k back, by hand, and `ema[k]` is
    the undeclared twin's bar for bar (over 4,000 reads past the declared 50 served);
  - a read past 400 stays withheld, identical to the undeclared script; a declared 500 reads every bar;
  - the object lane carries the same buffer; under a declared 20 a label at `close[25]` is drawn and one at `[450]`
    is withheld, never a stop.
- `vendorHarness.wscAcceptance.test.js`: M2 is drawn by the host lane and MATCHes on both lanes.
- `ast/pine.historyRead.test.js`: the "declared 77 is the buffer" case flipped (77 reads 400; 777 stays 777).

| mutant | rail that went red |
|---|---|
| M53 the helper restores `declared.limit \|\|` | `wscHostReadWindow` (5 of 5) + `wscAcceptance` (m2) + `pine.historyRead` |
| M54 the plot lane alone restores it | `wscHostReadWindow` (plot lane) + `wscAcceptance` (m2) |
| M55 the object lane alone restores it | `wscHostReadWindow` (object lane) + `pine.historyRead` |

- Every mutant was restored byte-equal from a saved copy.
- Each mutant's test filter was shown to select real tests (control runs, unmutated: 4, 1, 1 and 1 passing).
- M43 first STAYED GREEN when placed at the lowered-offset site: a pure `close[30]` is a column, so the refusal it
  restores lived on the column path. It was moved there and went red.

## 4. What this moves

Local grade of the five M captures:

| capture | production | runtime-on |
|---|---|---|
| M1 | MATCH (host) | MATCH (host) |
| M4 | MATCH (host) | MATCH (host) |
| M5 | refused `budget:lookback`, by name | MATCH (runtime lane) |

- M2 MATCHes on both lanes with rule (4), drawn by the host lane (with #1917's runtime lane alone it stayed
  DIVERGE: the member door draws M2 on the host lane). M3 MATCHes.
- Rule (4), graded locally on the merged tree (e81 + this branch), both lanes:
  - M2 and the four Q-MBB captures (`uctprobe-mbb-dyn` / `-late`, SPY and RDDT 1D, licence-held, local): MATCH,
    every row;
  - the 32 committed captures that declare below 400, against the e81 train's verdicts (run 44452719465): the 30
    e81 graded do not move (Fred RS's 29 among them), and M1 / M2 (new in this branch) MATCH.
- Rule (4), the door on the 9 sources that declare below 400 (committed, probes, rs-rating and the reference
  sample), before and after: no door move on either lane; Fred RS stays on the host lane (no new `budget:lookback`).
- The census (680 sample scripts, 2026-11-19, a prototype of all three rules):
  - no door move on either lane;
  - one runtime build newly builds: reference `ytc-swing-highs-lows`, a `max_bars_back(x, n)` directive.
- The corpus diff of this PR's `pine heavy` run is in the PR description.

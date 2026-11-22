# Engine 55 — honest higher timeframes, named other-symbol refusals, named object gaps

Branch `fix/pine-engine55-honest-htf`, cut from `origin/master` `bac37a2c1f`, with `origin/master` merged in twice (`46b2975b86`, then `c2a8e1773f`; no engine file changed in the second).
`SCRIPT_ENGINE_VERSION` 54 -> 55, with a history line. Root cause: the 2026-11-14 DIVERGE investigation
(`_resume-2026-11-01/runs/objects-lane/diverge-1114`, on `bac37a2c1f`).

## 1. `tf_merge` — Pine's look-ahead-off `request.security(…, 'W'|'M')` as TradingView draws it

**Was:** `securityAsNode` emitted formula `tf`, which reads bucket `b - 1` (the last CLOSED period) on every
bar, and the difference was disclosed (`_folds.htfLookaheadOffStepBacks`). `support-and-resistance-multi-
time-frame` read DIVERGE on 213 bars (RDDT + SPY).

**Rule (measured, `diverge-1114/simulate.py`):** on historical bars the HTF value appears on the chart bar
where the HTF bar CLOSES. 0 mismatches over 598 RDDT and 1,799 SPY bars, all 8 W/M plots, the Good Friday
week (Thursday closes it) and weekend month ends included.

**Now:** a Pine-only node `tf_merge` (`parse.js` NODE_TYPES + surface `tf_merge(expr, 'W')`, printed and
round-tripped by `pine.js::printFormula`). For bar `i` in bucket `b`:
- bar `i + 1` in another bucket: `child[b]` (read off the NEXT bar, never a weekday or calendar);
- otherwise, `b > 0`: `child[b - 1]`;
- the newest bar: the evaluator computes the forming reading; the ROOT bar is withheld and named by
  `interpret.js::tfMergeMask` (`request:htf-newest-unconfirmed`, `CHART_CLOCK_WITHHELD`) unless
  `newestBarIsForming === true` at the chart's own level (under another request: always withheld; under
  `sym`, every chart bar from that series' newest bar on). One authority over that bar.
  **Review L3:** a FINISHED newest bar that CERTAINLY closes its period is served: on a daily chart whose
  bars include no Saturday or Sunday, when the next weekday after it falls in another period for every
  merge in the tree (`W`: a Friday; `M`: the month's last weekday). Positive-only and calendar-free: a
  holiday can only end a period earlier, so the Thursday before Good Friday stays withheld by name. Not on
  an intraday chart, not on a series that trades weekends, never under another request. (Every weekend
  had left the last daily bar blank.)
- **Review L2 — the first period, off the listing.** A chart whose history does not start at the listing
  (`historyFromListing !== true`) may start mid-week or mid-month; the first period's value would then be
  built from part of it. The bars that would show it (that period's closing bar and the next period's
  other bars) are withheld and named `request:htf-first-period-partial`, unless the first bar certainly
  opens its period (a daily chart, no weekend bars, the previous weekday in another period — the mirror
  of L3). The binder's warm-up curtain did not hide it (measured: the reviewer's probe drew Friday
  2026-01-09 from a chart starting Wednesday 2026-01-07). Formula `tf` keeps its behaviour. Python twin
  (`_first_period_partial_mask`, `_newest_closes_every_merge_period`) mirrors both.
- Formula `tf` is byte-identical (rails: `engine55HtfMerge.test.js`, `p0.inv.truth`, Python
  `test_engine55_tf_merge.py`; HEAD vs branch Python `tf` column identical on the conformance bars).
- Badge: `preview-repaints` (a forming newest bar shows the forming period and moves once it closes
  mid-period, as TradingView's realtime bar does); `lint.js` / `ast_lint.py` forward reach >= 1.
- Python twin (`ast_interpret.py`): the same column rule and the same root mask (`tf_merge_mask`).
- Scan / alert lanes REFUSE it by name: `scan_definition.assert_scannable` (gate `withheld`),
  `alert_user_series._make_value_fn` (gate `withheld`, code `request:htf-newest-unconfirmed`, mirrored by
  `evaluability.js` and the shared fixture `p1_evaluability_alert.json`). Reason: they read the newest
  finished bar, the one the merge withholds. A formula DOCUMENT that spells `tf_merge` is refused on the
  chart (`request:formula-unsupported`).
- Harness: a plot whose newest bar is withheld by name (`withheldNewest`) has that one bar not compared
  (`compare.mjs`, `oursUnreadAfter`); every other bar is graded.
- Deleted: `_folds.htfLookaheadOffStepBacks`, `pine.js::htfStepBacks`, the output row channel. Flipped
  deliberately, with comments: `p0.inv.truth`, `p0.imp.truth`, `p0.pineack.truth`,
  `memberPaneRepaintAck`, `pine.security` (+ namedargs, c10, requestOffer, tfternary, tfDaily),
  `criteria.nodeTypes` (picker exemption), `closedTable` (`_canonical`: THIRTEEN node types),
  `pineBoxPineRender.fixture.json` (the weekly script's render only).

## 2. Other symbols no binding can serve — refused by name

**Was:** a bare or punctuated spelling no binding can serve became a `sym` node the bind starved: an
all-`na` plot with nothing said. Five scripts in the sample: McClellan (`ADVN`/`DECN`), smt-divergence
(`XAUUSD`), advance-decline-line-nyse-buschi (`ADVDEC.NY`, `SPX`), kyadvance-decline-line (`ADVDEC.NQ`/`.NY`),
LazyBear's McClellan (`ADVN.*`/`DECL.*`).

**L1 (as revised by the review, M1): ONLY THE PLOTS THAT READ IT.** ONE helper,
`otherSymbols.js::staticallyUnservable(ticker, venue)`, decides it from the spelling:
- punctuation other than a class share's dot (`ADVDEC.NY`, `NYSE:BRK-B`, `BRK/B`): `other-symbol:class-share`;
- a BARE ticker in `BARE_AMBIGUOUS` (`ADVN`, `SPX`, `VIX`, `DXY`, ...): `other-symbol:bare`;
- a BARE ticker not shaped like a US listing (`XAUUSD`, `EURUSD`): `other-symbol:bare`.
The translator keeps the read as a `sym` node, so every door ATTACHES the script; the bind refuses exactly
the plots that read it, `columnErrors[key] = {guard: 'pine:request', code, message}`, and the strip names it
(`externalReadNotices`), while every other plot is drawn. ONE sentence everywhere:
`otherSymbols.js::staticOtherSymbolMessage` — "This indicator reads `T`: <code> — <reason>".
`staticOtherSymbolRefusalOf(tree, otherSymbols)` says, at any door, which plots will be refused and with
what sentence (rail: identical for the screen, the pane (strict), the member door and the bind). The runtime
lane runs the whole program, so it refuses the program with the same sentence; the member door draws such a
script from the host lane (the C41 pattern). A script whose ONLY plots read such tickers is attached and
every plot is withheld by name, never drawn blank. A copy saved at engine 54 is UPGRADED on the 54 -> 55
re-translation (`savedScriptUpgrade.retranslateRow`), never `refused`.
⚰️ The first engine-55 cut refused the read AT TRANSLATE; the member door's all-or-nothing gate then refused
the WHOLE script (`plot(close)`, `plot(ta.sma(close, 5))` and one `XAUUSD` read went from two correct plots
plus one blank at engine 54 to refused), and a member's saved copy went `refused` on the upgrade.
**L5:** a spelling the host cannot turn into a listing at all — a foreign exchange (`TSX:RY`, `XETR:SAP`:
new code `other-symbol:venue-foreign`) or `BRK/B` — is named by ONE helper (`spellingUnservable`, over the
one `US_EQUITY_VENUES` list both read) and refused by name, in the same sentence, by the host translator and
the runtime lane (which took any string before and would have read bars that never come). A throw while the
runtime lane asks is a refusal by name, never a read (fails closed).
Breadth spellings add "this breadth symbol is not available yet" — matched by an ANCHORED pattern (L6:
`ADVN`, `TICK.NY`, `USI:ADD` are breadth; `DECKXX`, `ADDYYX` are not). Controls: bare `SPY`, `AMEX:SPY`,
`NYSE:BRK.B` still translate and draw (C29).

**L2, bind:** `otherSymbols.js::otherSymbolRefusalOfTree` (one reader): `nativeRegistry.computeFor` (multi- and
single-tree) writes `columnErrors[key] = {guard: <code>, message}` for a plot reading a ticker the bind
refused (settled, never a read still waiting: a Pine `no-bars` with no answer yet / `loading` is now
`pending`, the formula lane's rule), instead of an all-`na` column; the object lane refuses such a tree by
name (`refusals`); `externalReadNotices` publishes a Pine translation's settled refusals too.

## 3. Silent withheld drawing steps — named

**Was:** OZ named a not-computable family only when NOTHING of it was drawn. K-clustering drew its table
header and silently left out the cells whose last-bar values were unknown (graded DIVERGE).

**Now (`objectRuntime.js`):** a drawn TABLE is also named under `withheldBy['objects:not-computable']` with a
COUNT sentence (`objectLoss.js::partlyNotComputableSentence`), for the cells whose LATEST write certainly ran
(no guard, or a guard known true on that bar) and was withheld because a value it reads could not be computed
(`cellWriteWithheld` booked in `taintOutputs`, filtered by `cellTaint` at finish: a later clean `table.cell`
clears the mark, so an overwritten warm-up write is not counted). Such a cell EXISTS on TradingView.
NOT counted (and why):
- a withheld CREATE of a partly drawn family, and a cell write whose GUARD is unknown: whether that object or
  cell exists on TradingView is itself the unknown; the collector rulings (W-C22-DEL) already count those.
  Measured in the engine-55 suite: naming creates took ict-killzones (RDDT/SPY) and vdubus (SPY) off MATCH,
  where TradingView drew exactly what this run drew.
- a cell held for its colour (C45, named on its own), and a mark the chart clock alone left (C36 names it).
`stats.withheldUnknownPartial` carries the counts. An unserved run half's reason is said ONCE in plain words
(`runtimeUnknownSentence`: `runtime:INSTRUCTIONS_PER_BAR` -> "This script's last-bar calculation is too heavy
to run yet.") under its own `why` key (`RUNTIME_UNKNOWN_KEY`), on both evaluation paths (`runHalfObjectRail.
hostObjectRun` — the binder's — and the harness). The harness's `notShownReport` carries the named table into
`withheldFamilies`, so `compareObjects` grades it INCONCLUSIVE (withheld by name), not DIVERGE. Rails:
`objectRuntimeE55PartlyNamed.test.js`, `vendorHarness.e55NamedGaps.test.js`.
pivot-based-swing-highs-and-lows / uptrick-volume-weighted-bands: their `withheldUnknown` (4 / 2) are withheld
creates (see the census row), so they stay counted-and-unnamed under this rule; the census bound check counts
them as not fully drawn.

### K-clustering is NOT made exact here (precise note)
K-clustering (RDDT + SPY) stays INCONCLUSIVE, withheld by name. Exactness needs two things this engine does
not do:
1. its run half (the last-bar density calculation, the `__uct_runtime_at` placeholders at line 185 —
   `100 * math.round(n1 / denom ...)`) stops on `runtime:INSTRUCTIONS_PER_BAR`: the per-bar instruction
   budget must be raised for a last-bar-only calculation (or the calculation lowered more cheaply);
2. tree node 5 refuses `resolve:function` — `unknown function "__uct_runtime_at"`: a placeholder NESTED
   inside a host tree is not resolved by the object reader (`objectColumns.js::runtimeAtIndex` only reads a
   tree that IS a placeholder); nested resolution must be added.
Both are needed before its table cells, lines and fills can be drawn and graded.

## 4. The census predicate — static AND bound

`coverageMapDoorCensus.measure.test.js::isClean` judged the DOOR's answer and never bound. New:
`boundBlockers(d)` binds the attached definition ONCE on the RDDT 1D reference bars
(`k-clustering-rddt-1d-2026-09-28.json`, `newestBarIsForming: false`, listing on) and blocks on: a column
error, an object op withheld as unknown or a family named not-computable, an other-symbol refusal the
SPELLING decides (`staticallyUnservable`; `unspelled` / `venue-unreadable` / `venue-unconfirmed`), and a
fold note (`baseTimeframeFolds` excepted on this DAILY bind: it is the identity there). A refusal that
depends on our store (not held, no bars, exchange unconfirmed, ...) is NOT counted: the census supplies no
secondary bars and a member's chart does. Rows carry `cleanBound` beside `clean`; `coverage_map.py`
reports `headline.transfer` (static, comparable with history) AND `headline.transferBound`. Self-check
rail in the same file: a clean SMA binds clean; `NYSEARCA:SPY` (a venue TradingView was never measured
answering, spelling-decided) blocks; `AMEX:SPY` with no supply (store-dependent) does not; K-clustering's
partly drawn table blocks; the builtin Supertrend's dark plot blocks; a plot empty in both replays does not.

**The dark-plot test (coordinator addition, `s6-bugs-1114`).** The reference bars start at the listing
(`history.startsAtBar0`), so each clean definition is bound a second time OFF the listing
(`historyFromListing: false`) and compared plot by plot (`darkPlots`): a plot is DARK, and the script not
fully drawn, when on the listing it draws no bar at all (`dark-plot:<key>:listing 0 / off-listing N`) or
draws fewer of the bars the off-listing replay draws (`listing X of the off-listing N`). A plot with a
column error is already counted and is skipped. Self-check: `ta.supertrend(3, 10)` blocks (listing 0 /
off-listing > 0; a NaN seed latches in its ratchet). The Supertrend engine bug is NOT fixed here; the census
is only made honest about it.

## Measurements (before / after)

All numbers measured 2026-11-14 on this branch at `d044bbc106` (the review round, merged with
`origin/master` `a69150804e`; no engine, census, sample or capture file came in with that merge). "Before"
is `origin/master` `46b2975b86` (harness) and `387913b835` (census; the engine files are identical between
the two). Sample: 679 scripts + 295 examples (974 census rows).

### Vendor harness (`tests/fixtures/vendor`, every capture)

| lane | before (MATCH / DIVERGE / INCONCLUSIVE) | after |
|---|---|---|
| production | 155 / 49 / 166 (370) | 157 / 44 / 170 (371) |
| runtime-on | 181 / 49 / 140 (370) | 183 / 44 / 144 (371) |

(Unique capture ids; 5 vw-* captures sit in two directories and count once, identically on both sides. The
371st capture is the one master added, `pivot-high-low-points-rddt-1d-2026-11-14`: DIVERGE on master
`c2a8e1773f` AND on this branch, identically per plot, both lanes — not a new DIVERGE.)

Capture transitions, both lanes, and nothing else moved:
- `support-and-resistance-multi-time-frame` RDDT + SPY: DIVERGE -> MATCH ("all 7 items agree"; 6 plots
  DIVERGE -> MATCH). Both captures end on a Friday: the WEEKLY plots now draw and grade that bar (review
  L3); the MONTHLY ones withhold it by name and do not compare it.
- `k-clustering` RDDT + SPY: DIVERGE -> INCONCLUSIVE (the table named `objects:not-computable`).
- `mcclellan-indicators` RDDT + SPY: DIVERGE -> INCONCLUSIVE, "1 of 15 items could not be compared"
  (review M1): the door ATTACHES it, and only `Osc` — the one plot whose tree reads `ADVN` / `DECN` under the
  input default — is refused by name (`pine:request`, `other-symbol:bare`, the breadth sentence). The other
  plots fold to `na` under that default (`Indicator = 'Oscillator'`), read no symbol, and still MATCH
  TradingView's `na`, exactly as on master.
- Zero plot MATCH -> DIVERGE. Zero new DIVERGE. `htf-liquidity` stays DIVERGE (pre-existing; its CAP3
  signature is master's again, since its bare FX reads are `sym` nodes again).

### Door census and coverage map

| | before | after |
|---|---|---|
| sample row-clean (static, production) | 227 | 227 |
| sample row-clean AND bound-clean (production) | n/a | 215 |
| sample attached any form (production) | 287 | 287 |
| coverage map `headline.transfer` (static) | 214 | 214 |
| coverage map `headline.transferBound` | n/a | 202 |
| runtime-on lane: row-clean / bound-clean | 227 / n/a | 227 / 215 |

Static: unchanged — after review M1 the five scripts that read a spelling no binding serves (McClellan,
smt-divergence `XAUUSD`, advance-decline-line-nyse-buschi, kyadvance-decline-line, LazyBear McClellan)
ATTACH again, with only their reading plots refused. (The first cut refused them whole: 222.)
Bound: twelve clean scripts are not fully drawn on the RDDT 1D bind — the five above (their refused plots:
`column-error:<key>:pine:request` and the spelling-decided `other-symbol:*` refusals), and:
- `builtin:supertrend` — DARK: `value` listing 0 / off-listing 102, `out2` listing 0 / off-listing 119;
- `btc-charlie-trader-xo-macro-trend-scanner` — column errors `resolve:name` (out11-out14);
- `k-clustering` — 51 object ops withheld unknown, table named not-computable;
- `poor-man's-volume-profile` — 160 withheld unknown, named not-computable;
- `fixed-percent-stop-loss-take-profit-for-study-scripts` — column errors `interpret:recurrence` (out3-out10);
- `pivot-based-swing-highs-and-lows` — 4 withheld unknown (creates);
- `uptrick-volume-weighted-bands` — 2 withheld unknown (creates).

**Dark-plot demotions: ONE script, the builtin Supertrend** (both lanes). The "fewer bars than the
off-listing replay" clause demoted nothing else. ⚰️ The first full run of the literal rule ("all-`na` on the
listing") demoted 35; 33 of those were plots empty in BOTH replays by design on a daily chart (inputs left
off — ABA Invest's `show_5m = false` family, the builtin SMA / EMA smoothing plots with type "None" —
and intraday-only session levels such as ORB, session-hilo, previous-day-high-and-low), which TradingView
draws as nothing too. The test now counts only plots the off-listing replay draws (rail + mutant C4).

## Mutants

Every guard mutation-proven: copy aside, mutate, focused test fails, restore from the copy, `git hash-object`
equals the HEAD blob. **62 mutants, 62 killed** (44 in the first round, 18 in the review round).
- tf_merge (JS): M1 `child[b]` on every bar · M2 `child[b-1]` everywhere · M3a weekday (Friday) rule ·
  M3b calendar month-end rule · M4a serve the confirmed newest bar · M4b unknown state read as forming ·
  M4c `sym` series newest not masked · M5 merge applied to formula `tf` · M6 Pine emits `tf` · M7 lint badge
  without forward reach · M8 formula document not refused · M9 alert preflight admits · M10 harness grades the
  withheld newest bar · M11 newest code read as whole-series withholding.
- tf_merge (Python): PM1 `child[b]` on every bar · PM2 serve confirmed newest · PM3 merge applied to `tf` ·
  PM4 scan admits · PM5 alert admits · PM6 lint without forward reach.
- other symbols: O1 translator serves a hopeless spelling · O2 decline reason unnamed · O3 tuple path unnamed ·
  O4 runtime lane skips the check · O5 no US-shape rule · O6 no ambiguous-bare rule · O7 no punctuation rule ·
  O8 bind plot not refused · O9 single-tree bind not refused · O10 Pine notices silent · O11 object tree not
  refused · O12 a pending read refused.
- named gaps: G1 / G1b partly drawn family unnamed (binder path / unit) · G2 run-half reason unsaid ·
  G4 table cells not counted · G5 clock-only table named · G6 harness drops the reason · G7 guard-unknown
  writes counted · G8 held-colour cells counted. (G3, "creates not booked", retired with the creates rule it
  tested: naming creates took ict-killzones and vdubus off MATCH.)
- census: C1 bound ignores withheld-unknown · C2 bound counts store-dependent refusals · C3 dark plot unseen ·
  C4 empty-in-both plot counted dark.
- review round: R-M1a escalate to a whole-document refusal again · R-M1b the bind's guard is the code, not
  `pine:request` · R-M1c static refusals unmarked at the bind · R-M2 another change rides the claimed move
  (an extra key on the `tf_merge` node) · R-L3a a closing newest bar never served · R-L3b a weekend series
  served · R-L3c an intraday chart served · R-L3d a Thursday read as closing (it SURVIVED the first rails —
  the Good Friday Thursday plus three days is still in its ISO week — and was killed by a new rail: Thursday
  2026-01-29 does not close January) · R-L3py the Python twin never serves · R-L2a the first period served ·
  R-L2b the first bar always read as opening its period · R-L2c the listing gate ignored · R-L2py the Python
  twin serves the first period · R-L5a a throw while asking serves · R-L5b the runtime lane takes any string ·
  R-L5c the host's generic sentence · R-L5d a foreign exchange unnamed · R-L6 the breadth prefix unanchored.

## Open notes

- **Supertrend is NOT fixed** (coordinator: a later engine). The census now counts it not fully drawn.
- **K-clustering is not exact** — see the precise note in section 3.
- **Not named (by rule):** a withheld CREATE of a partly drawn family, and a cell write whose guard is
  unknown — whether that object exists on TradingView is itself the unknown. pivot-based-swing-highs-and-lows
  (4) and uptrick-volume-weighted-bands (2) stay counted-and-unnamed; the bound census counts them.
- **`htf-liquidity` stays DIVERGE** (pre-existing). After review M1 its bare FX reads are `sym` nodes again, so its
  probe-replay pin, its CAP3 signature and DIV-1's "reads another symbol, stays cold" case are master's again.
- **A spelling the host cannot turn into a listing at all** (a foreign exchange, `BRK/B`) still refuses the WHOLE
  script, as at engine 54 — now by name, in one sentence, in both lanes (review L5). Only spellings that make a
  `sym` node can be refused per plot.
- **`savedDocumentRoundTrip`**: S&R MTF is listed in `MOVED_BY_ENGINE` — its saved computation digest moved on
  purpose (tf -> tf_merge). Review M2: with every `tf_merge` mapped back to `tf` (and the trees' hash re-taken),
  the digest EQUALS the saved one, in the moved-on-purpose rail and in both round-trip loops, so nothing else can
  ride the move; the bumped engine version re-translates a member's saved copy.
- **Scans and alerts refuse `tf_merge`** by name rather than reading a merged series: both read the newest
  finished bar, the one the merge withholds. A daily-close alert on a merged weekly level is a later decision.
- **Conformance `--check`** is red on master already (pre-existing, 4,439 disagreeing rows); not re-recorded
  here. The two new corpus cases are bound as a series from its listing (`opts.historyFromListing`, review L2:
  the shared bars are five days of intraday bars, so off the listing nothing of a weekly merge is certain).
  `tf_merge_against_the_closed_week` agrees across lanes; `tf_merge_close_weekly` differs exactly as master's
  own formula `tf_close_weekly` already does on these intraday bars (JS 106.9 / Python 106.76 for week one —
  the lanes' existing intraday day bucketing, not the merge).
- **Pre-existing failures** (fail identically on master, not touched): chart suite (`src/components/chart`,
  6 shards, 1,534 files, on `d044bbc106`): 3,916 / 4,251 / 5,569 / 4,185 / 4,816 / 4,999 passed; the 16 failing
  test names are the SAME 16 that fail on master `c2a8e1773f` (run there by checkout): colorUpDownSubstitution,
  markerPixels, readoutSchema.va2 (8), rsRatingDef, rsVsEmaDef, vendorHarness.b1Paints (master added three
  paint captures without the pin), readout.va3, attachedPineDisclosures (11 vs 9 of 18 drawing elements, same
  text on master), oneKey.census. (The one other failure that run showed — `interpret.test.js`, the two new
  corpus cases reading all-NaN off the listing — is fixed by the corpus `opts` above.)
  Python, one file at a time: `test_definition_concierge.py` 5 failures and `test_c45_withheld_doors.py` 2,
  identical names on master; the rest of the engine-55 Python set passes.
- **Measurement note:** the harness, census, coverage map and chart suite are all from `d044bbc106`. The commit
  after it only gives the two corpus cases their `opts` and records the tool files the suite rewrote
  (`tools/corpus_metric.json`, `tools/lookback_agreement.json`, read by `tests/test_ast_lookback_agreement.py`,
  which passes).
- **The last master merge** (`f7a6f13d39`) brought no engine file and 21 new vendor capture files (20 captures):
  graded on master `f7a6f13d39` and on this branch (`ccbdb0ff14`), they are identical capture for capture, plot
  for plot and object family for family, in both lanes (production 1 / 11 / 8, runtime-on 4 / 11 / 5
  MATCH / DIVERGE / INCONCLUSIVE on both sides): no new DIVERGE. The engine-55 rails pass after it (173).

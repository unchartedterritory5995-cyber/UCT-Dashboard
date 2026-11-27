# History parity: start a Pine run on TradingView's first bar

Status: phase 1 (design and the pure helper), 2026-11-27. Nothing here changes a served value. The helper is
`app/src/components/chart/engine/tvRunStart.js`, its rails are `__tests__/tvRunStart.test.js`, and its mutants are
`ci/mutants/hp1-tv-run-start.json`. Phases 2 and 3 below change served values.

## 1. The problem

A Pine script carries state from bar to bar: `var` latches (Fred RS's rating thresholds), recursive averages (EMA,
RMA, Heikin-Ashi), cumulative sums, `ta.barssince`. Its value on any bar depends on the bar the run started on. Our
runs start on the first bar the chart holds, and that bar is not TradingView's, so start-dependent scripts are
refused by name off the listing (`runtime:history-start`, `runtimeColumns.js`; PR #2893 turns the off-listing
curtain off). The fix is to start the run on TradingView's first bar. Then every start-dependent value matches by
construction, without a warm-up curtain.

## 2. TradingView's rule (evidence)

Source: FRED's mining of 1,921 TradingView captures (374 distinct symbol x timeframe x date x depth rows) from the
vendor batch runs. Every capture forced the history to exhaustion (`requestMoreData` until the count stops
growing), so each row's first bar is the deepest bar TradingView serves. The committed fixture
(`engine/__fixtures__/tvRunStartCaptures.json`) holds only bar counts and bar times, with no prices and no plot values.
The capture files themselves stay local.

| Timeframe | First bar of the run | Evidence |
|---|---|---|
| D / W / M | The vendor's first bar: the listing (RDDT 2024-03-21), or TradingView's data start (SPY 1993-01-29, GE/HPQ/IP 1962-01-02, many NYSE names 1968-01-02) | 227 exhausted D/W/M rows. The deepest is 16,333 bars (HPQ 1D). No cap was hit, so a cap above that is unknown. |
| 1m, 5m | The first held bar of the ISO week (exchange timezone) that contains the cap-th newest bar | 25 capped rows (SPY, RDDT, AZTA, ADT) |
| 15m | Same, calendar month | 6 capped rows (SPY, RDDT), plus the `bar_index` witness below |
| 30m, 45m, 60m, 65m, 120m, 195m, 240m | Same, calendar year | 27 capped rows (SPY, AAPL, NVDA, JPM, AZTA, ADT, BTCUSD in `Etc/UTC`) |
| Any intraday with fewer bars than the cap | The vendor's first bar | 17 rows (RDDT 30m/60m/240m, BGIN 5m/30m/60m, ADT 240m, SPY 240m RTH) |

- **The cap** is about 20,000 bars counted in the chart's own session: with extended hours on, pre- and
  post-market bars count, and with them off only regular-session bars count (SPY 60m RTH starts 2015-01-02 while
  ETH starts 2021-01-04). The captures pin the cap only to **19,963..20,024**: every cap row has at most 19,962 bars
  after its first chunk, and the smallest capped row holds 20,024. Whether the forming bar counts is unknown.
- **The boundary moves in whole chunks.** SPY 5m moved 06-15 to 06-22 between the 11-16 capture (19,852 bars after
  the first week) and the 11-17 capture.
- **The run starts at the capped bar even when the chart has loaded fewer bars.** A SPY 15m capture with 6,343 loaded
  bars read `bar_index` 14,433 on its first loaded bar. That is exactly the capped first bar (2025-08-01 08:00Z) of the
  exhausted 11-23 capture.
- **Not yet confirmed live (hypothesis):** that scrolling and reloading do not move the study's first bar between
  chunk moves. FRED's phase 2 live probe (`run_tv_probe.sh`) waits for the owner's go. Until it reports, phase 3 must
  not lift a refusal on the strength of this.

Unmeasured, and so never claimed by the helper: 2m, 3m, 10m and any other timeframe not in the table; sub-minute
timeframes; a week chunk on a symbol that trades at the weekend (crypto 1m/5m, Sunday-evening futures), because
which day TradingView's week starts on there is unknown; D/W/M deeper than 16,333 bars.

## 3. The helper: `tvRunStart(tf, sessionBars, tz, opts)`

Pure. It takes the bars the run would compute on, oldest first, already in the chart's session. It returns
`{ index, rule, chunk, proven, ambiguous, why }`, where `index` is the run's first bar in that array.

- **D / W / M:** `index 0`, rule `date-full-history`. It is proven only with `opts.startsAtListing` (the listing
  statement, which a caller proves) and at most 16,333 bars.
- **Intraday, measured timeframe:** let `k = n - cap`. The chunk key of `bars[k]` is computed in `tz` (week: the
  ISO week's Monday; month: year and month; year), and the run starts at the first bar with that key (binary search).
  With `n < cap`, it is `index 0`, rule `whole-history`, proven only with `startsAtListing`.
- **The cap is a range.** The start is computed at both ends of 19,963..20,024, widened by `opts.toleranceBars`. When
  the two ends fall in different chunks the result is `ambiguous` and not proven. The index reported is the 20,000
  point estimate.
- **Not proven** when the held series starts inside TradingView's first chunk (`index 0` without the listing
  statement), because the vendor may hold earlier bars of that chunk. It is also not proven for a weekend-trading week
  chunk or an unmeasured timeframe (which gives `index: null`).
- `proven` means "this is TradingView's first bar **if our bar population equals TradingView's**". Population parity
  is a separate claim (section 7).

Rails (`tvRunStart.test.js`) do four things:

1. Re-derive the cap range, the D/W/M depth and the chunk table from the fixture, so the constants are never restated.
2. Replay every capture row as a series with the row's shape: 500 deeper vendor bars, then the row's first chunk,
   then its bars after it. The shape is checked with a separate chunk implementation before it is replayed.
3. Pin the exact cap edge, the exchange timezone (winter 19:30 ET is the next day in UTC: month and year edges), the
   ambiguity and tolerance cases, the truncated chunk, the weekend case and the D/W/M claims.
4. Run 18 mutants, one for each rounding rule and each refusal to claim. None tests the ISO week's Monday start: on
   weekday-only sessions a Sunday start groups the same bars, and the weekend case is refused.

## 4. Data depth: what parity needs, and what it costs

Store bars needed to hold 20,000 session bars plus one whole chunk (worst case; a regular day is 390 of the 960
extended minutes, `barsBackfill.RTH_VISIBLE_FRACTION` = 0.406):

| tf | chunk | ETH chart (store = session) | RTH chart (store holds ETH) | Today: cap / lake target |
|---|---|---|---|---|
| 1m | week | ~25k | ~54k | 20k / 20k |
| 5m | week | ~21k | ~50k | 32k / 20k |
| 15m | month | ~22k | ~51k | 32k / 20k |
| 30m | year | ~28k | ~57k | 40k / 40k |
| 60m | year | ~24k | ~54k (the RTH 60m grid is its own series) | 50k / 50k |
| D | - | 16,500 | 16,500 | 12,000 (`registry.js`), 12,500 (`fullBarsFor`, `_DEEP_TARGET`) |

Today the ETH chart is short of TradingView's start on 1m, 5m and 15m (by up to one chunk), and deeper than it on
30m/60m. That is harmless once the run is sliced. The RTH chart is about 60% short on every intraday timeframe,
because the lake depth counts ETH bars. `reducer.js` `finalize` trims the oldest bar on every new bar, so the held
start drifts by one bar a bar and is never chunk-aligned.

**CHART SPEED's ruling (2026-11-27, via TRADINGVIEW), cited as given:**

- Ranking: (a) on-demand depth > (b) a separate run series >> (c) global caps. **(c) is refused.** Global depth is
  paid on every switch and in resting memory for every member, phones included (store off, legacy path), against the
  2.5M-bar budget and a heap just brought down from 632 to 465 MB (#2814).
- **(a) yes:** raise depth on demand, only while a runtime-lane document is mounted, and only after first paint. Join
  the extra bars off-screen, and never re-frame the visible range or the price scale (cf. #2871).
- **(b)** is cleanest if the run needs 20k RTH session bars. A non-painted run series sized to `tvRunStart` avoids
  50-60k-row painted entries. But it is a second source of truth, so it needs a parity rail against the painted
  series on the overlap.
- Cost data: there is no clean per +10k-bars figure. Ingest scales about linearly with rows
  (`clampToExtendedSession` and `foldOffGridBars` dominate). A 15-piece 60m lake re-ingest cost 44-92 ms per click
  before #2892/#2867. The 4h resample took 1,050 ms before the one-pass fix (#2810/#2823). A press allocates about
  50 MB on a 2-chart board. Paint is bounded by the visible window, not by depth. **Measure a +10k step with the bench
  rig before fixing numbers.**
- A 60k 1m entry on demand is acceptable only if it is not the painted resting entry (that is, option (b)), or if it
  drops back to the normal cap when the document unmounts. It is never the default 1m depth.
- **D 16,500 globally: yes.** But deep-once (#2869) asks the full depth once per page, and `registry.js` D,
  `barsBackfill.fullBarsFor('D')` and `deep_history_warm._DEEP_TARGET['D']` must move together: one constant, not
  three.
- A chunk trim is fine and better than the rolling trim, with hysteresis: trim a whole chunk only when depth exceeds
  cap plus one chunk. The trim must never touch the visible range, the lake/deep "settled" bookkeeping (`lakeSettled`
  and `deepSettled` are lowered with the trim, or loads re-trigger), or any indicator warm-up window.

**Proposal.** Use (a) for ETH charts, where the extra depth is small (+5k on 1m; 5m/15m only need the lake target
raised to the cap they already have). Use (b) for RTH charts. A run series is fetched in the chart's session to
`20,000 + one chunk + 5%` session bars, held outside the bar store, and never painted. A rail holds it bar for bar
equal to the painted series on their overlap. Raise D to 16,500 through one shared constant. Every number waits for
the +10k bench measurement (section 9).

## 5. The seam: where a run is sliced

The runtime lane already slices a run for strategies: `runtimeColumns.js::computeStrategyWindow` runs
`rows.slice(cut)` and widens the columns back to the chart with `widenToChart(cols, cut, ...)`, with NaN before the
cut. Phase 2 adds a sibling, `computeTvRunWindow`, on the same lane:

1. The binder (`StockChart.jsx`, where the engine context is built with `historyFromListing`, about lines 10160-10190
   and 14075 on f867d80085) computes `tvRunStart(resolvedTf, filteredBars, exchangeTz, { startsAtListing })` once per
   (series identity, session, held depth). It passes it as `ctx.tvRunStart = { t, rule, proven }`, keyed by the start
   bar's TIME, not its index, so a prepend does not move it.
2. For a document with `meta.runtimeHistory === 'listing'`, the lane finds the start time's index in `rows` and runs
   `rows.slice(cut)`. It passes `historyFromListing: true` (the VM's [B-START] meaning: bar 0 is TradingView's bar 0)
   **only when `ctx.tvRunStart.proven === true` and `rows[cut].t === ctx.tvRunStart.t`**. Otherwise the refusal stands.
   Bars before the cut are NaN, as on TradingView, where those bars do not exist.
3. The run's memo key (`runKey`) and its incremental session include the start time. Live bars grow the window at the
   tail without moving the start, so a resumed session stays valid. A whole-chunk move restarts the run, which is
   what TradingView does when a reload moves its start.
4. `historyFromListingOf` generalises to the statement "the run starts at the vendor's first bar" (D/W/M listing,
   and intraday whole-history). `tvRunStart`'s `startsAtListing` reads it, and nothing else does.

The same helper runs on the server lane (alerts run this bundle). A server run whose held depth cannot prove the
start stays refused.

## 6. How a result proves its run started at `tvRunStart`

The lifted path is reachable only through one condition, and the result carries the proof:

- `computeTvRunWindow` stamps `result.runStart = { t, rule, chunk, proven: true, capRange, tolerance }`. The `t` is
  the first row the VM saw (read from the sliced rows, not from the context).
- `runtime:history-start` is lifted only when the stamp is present, its `t` equals the first row the VM ran on, and
  `proven` is true. Rails pin that a series one chunk short, an ambiguous range, an unmeasured timeframe, and a missing
  or false listing statement all stay refused by name. Mutants pin it from both sides: the condition forced true turns
  the "refused" rails red, and forced false turns the "drawn and exact" rails red.
- The witness is a capture held to TradingView: a vendor-harness run of FRED RS (and an EMA/Heikin-Ashi control) on
  SPY 5m ETH, SPY 15m ETH and SPY 60m RTH, at the capped start. It must match TradingView bar for bar from the first
  bar, with no curtain. #2893's refusal is lifted per timeframe only where that witness is MATCH.

## 7. Thin names and extended hours: population risk

The cap counts bars, so the start depends on how many bars exist. On thin names our extended-hours population is
larger than TradingView's (RDDT 5m +1,583 bars over the cap window, 15m +740), so our cap-th newest bar lies later and
the start can land a chunk late. A 5m ETH week is 960 bars, so a 1,583-bar mismatch is more than a chunk.

- **Tolerance (built in):** `opts.toleranceBars` widens the cap range. A start is proven only when the whole widened
  range gives one chunk. With a tolerance equal to the measured mismatch, RDDT 5m ETH is always ambiguous and stays
  withheld. It is never drawn from the wrong chunk.
- **Data-side fix (proposed, phase 3):** for the capture symbols, compare our per-chunk ETH bar counts with the
  fixture's counts over the same range, and find the rule that explains the excess (candidates: bars built only from
  trades TradingView excludes, such as odd-lot or out-of-sequence conditions, or empty-volume prints). If one rule
  explains every row, apply it to the run series only (option (b)) and set the tolerance from the residual. If none
  does, the tolerance stays at the measured mismatch per liquidity band. Liquid names are expected to be less
  exposed (their extended-hours minutes are mostly full on both sides) but that is unmeasured: measure them in the
  same pass.
- RTH charts are not exposed: regular-session bars exist on both sides.

## 8. Phases

- **Phase 1 (this PR):** the design, `tvRunStart` and its rails and mutants. No served value changes.
- **Phase 2 (depth and slicing):** measure the +10k step on the bench rig. Then:
  - D 16,500 through one constant.
  - On-demand ETH depth while a runtime-lane document is mounted.
  - The RTH run series (option (b)) with its overlap parity rail.
  - The chunk trim with hysteresis, keeping `lakeSettled`/`deepSettled` consistent.
  - `computeTvRunWindow` with `ctx.tvRunStart` and the `runStart` stamp.
  - The withheld-by-name reason, which names the missing depth while it loads.

  The refusal is not lifted yet. Phase 2 is NUMBER PENDING: it changes which bars a run sees.
- **Phase 3 (lift):** after FRED's live probe confirms the start does not move on scroll or reload, and the per-timeframe
  vendor-harness witness is MATCH, lift `runtime:history-start` where `runStart.proven`. Then add the thin-name data
  fix.

## 9. Open measurements

- The +10k step (CHART SPEED's condition): ingest, reducer trim, IDB persist and heap on the bench rig, under
  `heavy_lock --solo` behind the owner and chart-speed tickets, never 13:55-15:05Z.
- FRED phase 2: scroll and reload do not move the study's first bar, and whether the forming bar counts.
- 2m/3m/10m chunks, weekend-trading week chunks, and D/W/M beyond 16,333 bars.

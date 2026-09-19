# Volume provenance — census and diagnosis (item (i))

**Question.** Does the hosted PANE and does the SCREENER source `volume` from the
same place, and is that place the one Wave 1's rendering tolerance was measured
against?

**Instrument.** `tools/pine_volume_provenance_census.py` — read-only, Python
only, no network, no vendor call, nothing written under `C:\data`. Run it from
the worktree root:

```
python tools/pine_volume_provenance_census.py
```

**Answer in one line.** ⭐ **ONE STORE, THREE WRITERS, AND FOUR READERS THAT
DISAGREE ABOUT TODAY'S BAR.** The sealed history both lanes read is the same
`bars.db` column, filled by the same code; the divergence is entirely in what
each reader adds on top of it for the CURRENT session, and in which physical
`bars.db` the reader is sitting next to.

---

## 1. The Pine side — every `volume` read in `corpus/committed/*.pine`

266 scripts scanned. **63** contain the `volume` token; **77** read the volume
series once the implicit builtins are counted. **346** token reads.

| form | uses | files | reaches an output | does not | unresolved | a named script |
|---|---|---|---|---|---|---|
| bare `volume` | 168 | 43 | 119 | 45 | 4 | `anchored-vwap-pinch-handoff-intervals-and-signals__2174489a80.pine:255` |
| other call over volume | 76 | 32 | 50 | 25 | 1 | `anchored-vwap-pinch-handoff-intervals-and-signals__2174489a80.pine:281` |
| `ta.*` over volume | 45 | 17 | 40 | 5 | 0 | `ai-supertrend-x-pivot-percentile-strategy-presenttrading__3b9db05a48.pine:74` |
| `request.security(…)` containing volume | 44 | 10 | 25 | 19 | 0 | `delta-imbalance-map-joat__b80f337fb3.pine:116` |
| `math.*` over volume | 13 | 3 | 12 | 1 | 0 | `chart-champions-part-1-npoc-levels-vwaps__wdeUFJ4ZD2.pine:264` |

Enumerated, not assumed — these are the call names actually found:

* **`ta.*`** — `ta.sma`×13, `ta.ema`×6, `ta.wma`×4, `ta.rma`×4, `ta.vwma`×4,
  `ta.highest`×4, `ta.median`×3, `ta.lowest`×2, `ta.percentrank`×1,
  `ta.rising`×1, `ta.alma`×1, `ta.cum`×1, `ta.hma`×1.
* **`math.*`** — `math.sum`×11, `math.abs`×1, `math.round`×1.
* **`request.*`** — `request.security`×34, `request.security_lower_tf`×10.
* **bare** — 159 with no enclosing call at all, plus 9 handed straight to a
  drawing (`barcolor`×4, `plot`×4, `plotchar`×1).
* **other call** — the long tail: `orderBlockInfo.new`×12, `na`×10, `nz`×6,
  `sum`×4, `obSwing.new`×4, user helpers (`getVwap`, `linreg`, `switch_ma`,
  `f_mvwap`, `minimax`, `getVolumeTransparency`, …), `array.push`/`array.set`,
  `str.tostring`, `input.color`.

### ⭐ The form that carries no `volume` token

A census of the token alone under-reports the population that depends on volume
provenance, because several Pine builtins read the series without naming it. The
instrument searches for all ten and prints the misses, so the zeros are evidence
rather than silence:

| builtin | uses | files | a named script |
|---|---|---|---|
| `ta.vwap` | 19 | 8 | `advanced-custom-multi-ma-signals-emasmavwmavwap__1bca3565a4.pine:131` |
| `ta.vwma` | 17 | 13 | `advanced-custom-multi-ma-signals-emasmavwmavwap__1bca3565a4.pine:129` |
| `ta.obv` | 6 | 3 | `atr-support-and-resistance__3e9ddb38c4.pine:282` |
| `ta.mfi` | 5 | 3 | `artemis-oscillator-pro__ea1097ca9e.pine:271` |
| `ta.nvi` | 4 | 2 | `smart-money-interest-index-algoalpha__effdd7852c.pine:14` |
| `ta.pvi` | 4 | 2 | `smart-money-interest-index-algoalpha__effdd7852c.pine:13` |
| `ta.pvt` · `ta.wad` · `ta.accdist` · `ta.iii` | 0 | 0 | searched, not found |

### Which lanes even see these scripts

A pane/screener provenance split can only bite a script BOTH lanes admit. Lane
verdicts are read off the committed `tools/corpus_metric.json`, never re-derived:

* scripts reading volume at all: **77**
* admitted by the **host** lane: **7**
* admitted by the **screener** lane: **16**
* admitted by **both**: **7** ← the population at risk today
* of the 77, **6** call `ta.cum`: `cvd-cumulative-volume-delta-candles`,
  `cvd-cumulative-volume-delta-chart`, `delta-volume-candles-lucf`,
  `rolling-vwap`, `smc-structures-and-multi-timeframe-fvg-ma-py`,
  `volume-suite-by-leviathan`.

⚠️ Exactly one of those six — `volume-suite-by-leviathan__48da793360.pine` — is
in the both-lanes set. `closedTable.json::_requirement_tags.window_dependent`
lists `cum` under `calls` and `screener` under `refused_by`, and
`api/services/user_definitions.py:1081::consumer_refusal` is the one function
five consumers ask. **So the at-risk population is 6, not 7.** ⛔ That last step
is derived from the RULE, not observed on a saved definition: I did not read a
stamped `requirements` field for this script, and `requirement_tags` is stamped
at save time.

### Residual the scope model could not attribute — 5 of 346, named

⛔ Reported, not absorbed. Counting these as "does not reach an output" is the
absence-without-evidence error.

```
bull-vs-bear-market-intraday-sessions-kioseff-trading__0999ba6cd8.pine:478
higher-time-frame-fair-value-gap-zeroherotrading__202f1347b8.pine:177, :184
volume-footprint-measuring-classical-indicators-by-math-geometry-intro__e15e52b27d.pine:653, :660
```

---

## 2. The engine side — where `volume` actually comes from

Both lanes agree on the VOCABULARY and that is worth saying first, because it is
the one place this defect class did NOT land: `volume → 'v'` is declared once, in
`app/src/components/chart/engine/ast/closedTable.json::series.volume.field`, and
the Python lane reads **the same bytes** (`api/services/ast_table.py:46`, which
opens that exact file). The JS binding is
`app/src/components/chart/engine/ast/interpret.js:2861`
(`bars[i][spec.field]`); the Python binding is
`api/services/ast_interpret.py:3437` (`field = spec["field"]`). One name, one
field, two lanes.

### 2a. The PANE path

| step | file:line | what it does to `v` |
|---|---|---|
| route | `api/routers/bars.py:434` `get_bars` → `:598` `serve_bars` | "Cache hierarchy: memory → SQLite (delta-updated) → disk fallback → Massive API" (`:608`) |
| sealed daily fetch | `api/services/bars_fetch.py:1734` `_fetch_daily` | Massive aggregates via `api/services/massive.py:1368` `get_agg_bars` — `/v2/aggs/ticker/{sym}/range/1/day/…?adjusted=true` |
| normalise | `api/services/bars_fetch.py:1261` `_massive_raw_to_iso` | `"v": int(_bar_volume(bar))` |
| null rule | `api/services/bars_fetch.py:1819` `_bar_volume` | a `None` volume becomes **0**, deliberately, "ZERO, NOT NaN" |
| **second vendor** | `api/services/bars_fetch.py:1282` `_fill_daily_tail_with_yf` → `:1625` `_fetch_daily_yf` (`"v": int(row.get("Volume", 0) or 0)`, `:1663`) | when Massive's tail lags, **yfinance** supplies the missing sessions; Massive wins any overlap |
| store write | `api/services/bars_fetch.py:3117` / `:3149` `_sqlite.put_bars` → `api/services/bars_sqlite.py:1182` | the merged series is written into `bars.db::ohlcv(…,v)` and re-read from there |
| **developing bar** | `api/routers/bars.py:464` `_augment_daily_with_today` → `api/services/massive.py:1176` `todays_daily_bar` → `:460` `get_todays_daily_ohlcv` | `v` = the provider SNAPSHOT's `day.v`, from `/v2/snapshot/locale/us/markets/stocks/tickers/{sym}` — a different endpoint from the aggregate that filled the store |
| **deep history** | `api/routers/bars.py:879` `serve_bars_history`, proxied at `:963` `_proxy_bars_history_to_worker` | ⭐ a **different process's `bars.db`** — the worker's deep 20 GB db, edge-cached; split-fetch is at `BARS_HISTORY_SPLIT_ROLLOUT_PCT = 100` (`app/src/components/StockChart.jsx:1078`) |
| client merge | `app/src/components/StockChart.jsx:5845` (history URL) + `:5851` (tail URL) | tail wins the overlap |
| **hand-off to the member pane** | `app/src/components/StockChart.jsx:10744` `binder.sync({ …, bars: filteredBars })` → `app/src/components/chart/engine/binder.js:703` | the binder's own comment: the tri-state is "carried from the `/api/bars` payload the SAME bars came from" |

### 2b. The SCREENER path

| step | file:line | what it does to `v` |
|---|---|---|
| sweep read | `api/services/screener/scan_evaluator.py:1021` `_read_bars` | `bars_sqlite.get_bars(sym, tf, want)` — the module header at `:5` says it plainly: "local, no network" |
| store read | `api/services/bars_sqlite.py:584` `get_bars` | `SELECT ts,o,h,l,c,v FROM ohlcv` — raw column, no augmentation |
| nightly snapshot columns | `api/services/screener/snapshot_builder.py:585` `_read_daily_bars` | same call, `DEEP_BARS` deep |
| **forming bar** | `api/services/screener/scan_evaluator.py:931` `live_bars_for`, `:1011` | `"v": int(quote.get("today_vol") or 0)` |
| quote source | `api/services/screener/live_tier.py:36-40` → `api/services/scan_volume.py:214` `full_market_snapshot` → `api/services/massive.py:770` `get_full_market_snapshot`, `:833` | `today_vol` = `day.v`, from the **all-tickers** snapshot behind a ~30 s shared cache |

### 2c. Verdict — SAME PLACE FOR SEALED BARS, TWO PLACES FOR TODAY

**Same** for every sealed daily bar: one table, `bars.db::ohlcv.v`, written by one
function (`bars_sqlite.put_bars`), read by both lanes through
`bars_sqlite.get_bars`.

**Two** from the last sealed close onward. The divergence points, named:

1. **`api/routers/bars.py:464`** — `_augment_daily_with_today`. The pane's
   payload gains a bar the store does not hold, whose `v` is the SINGLE-ticker
   snapshot's `day.v` (~8 s TTL, `massive.py:1176`). The screener never executes
   this line; it builds its own forming bar at
   `scan_evaluator.py:1011` from the ALL-TICKERS snapshot's `day.v` (~30 s
   shared cache). ⭐ Same provider FIELD, two endpoints, two caches, two clocks.
   Both are reads of `day.v` — I did not observe two fetched values, so the
   claim is that the two CALL SITES request the same field through different
   endpoints, not that a particular pair of numbers differed.
2. **`api/routers/bars.py:879` / `:963`** — the pane's deep sealed history comes
   from the WORKER's `bars.db` via the CDN edge while its tail comes from the
   web pod's `bars.db`; the screener reads only whichever single `bars.db` its
   own process sits beside. Two physical stores compose one rendered series on
   the pane; one store answers the screener.
3. **`api/services/bars_fetch.py:1282`** — the `v` column is filled from TWO
   vendors (Massive aggregates, yfinance on a lagging tail) with a
   Massive-wins-overlap rule. Not a pane-vs-screener split — both lanes inherit
   it — but it is a second authority over one value INSIDE the store, and it is
   the mechanism the committed AGEN evidence already fingerprints (§4).

### 2d. And a third and fourth reader, on the pane itself

⛔ The sharpest finding of this census, and it is inside the pane path rather
than across it. On one chart, "today's volume" has up to four values:

| renderer | file:line | today's `v` |
|---|---|---|
| member Pine pane (the chart engine) | `StockChart.jsx:10744` → `binder.js` → `interpret.js:2861` | `filteredBars[last].v` — exactly what `/api/bars` served |
| built-in volume histogram | `StockChart.jsx:7830`, `:7859-7861` | `max(b.v, livePrices[sym].volume)` |
| built-in volume MA line | `StockChart.jsx:7890` | raw `b.v` — the live top-up is NOT applied here |
| legend / crosshair readout | `StockChart.jsx:4090-4104` | `max(b.v, lp.volume)` again, computed a second time |

…and when "include extended hours" is on, `applySessionCandle`
(`app/src/components/chart/sessionPreview.js:103`) ADDS the extended aggregate's
volume into the last bar's `v` — but only for `sessionAppliedBars`, which is what
the BUILT-IN pane reads (`StockChart.jsx:7374`); the member pane is handed
`filteredBars`, before that merge. `livePrices[…].volume` itself is a third
provenance again: `api/routers/live_prices.py:440` prefers `day.v` and falls back
to `min.av`, and in extended hours `:252 _fetch_extended_volume` replaces it with
a **sum of 60-minute aggregates**.

---

## 3. Consolidated vs primary-exchange volume

**The daily/pane path does not make this choice, and that is the finding.**
Nothing in `bars_fetch.py`, `massive.py::get_agg_bars`, `bars_sqlite.py` or the
chart engine selects a tape, a venue set, or a trade-condition filter for VOLUME.
The requests are `?adjusted=true` on the aggregate endpoint and a bare snapshot
read; neither exposes a tape parameter, and no code reads one. A grep for
`consolidated`, `primary exchange`, `off-exchange`, `odd lot`, `trade condition`,
`TRF`, `CTA`, `UTP` across `api/` and `app/src` returns nothing on the daily bar
path.

Where the codebase DOES make the choice, it makes it for price and explicitly
**not** for volume, on a different lane:

* `api/services/trade_conditions.py:1-9` — "The consolidated tapes (CTA for
  NYSE-listed, UTP for Nasdaq-listed) tag every print with sale-condition codes…
  Professional charts (TC2000/TradingView) drop the ineligible ones".
  `classify()` returns `(hl_ok, last_ok)` — high/low and last. **No volume arm.**
* `api/services/bar_broadcaster.py:292-293` — "volume accumulates for every print
  (odd-lots count toward volume on the consolidated tape)". That is a live
  STREAM bar, not the `/api/bars` daily series.
* The provider's own condition rules carry an `updates_volume` flag — the repo
  knows it exists (`api/massive_processor.py:90`, on the OPTIONS lane) — and
  **no equity bar path reads it.** `grep -rn updates_volume api/` returns three
  hits, all comments in `massive_processor.py`.
* `api/routers/live_prices.py:207-210` is the one place the repo has measured a
  venue/condition effect on a volume number: "the snapshot's `min.av` counts
  every trade condition (odd-lots, off-exchange) and over-states it — pre-market
  NBIS read 418k on `min.av` vs the chart's ~330k". And `massive.py:891`: "`day.v`
  … is RTH-only". Both are statements about the LIVE lane.

⛔ So: the classic consolidated-vs-primary mismatch is **unchosen**, not chosen
wrongly. Nobody can point at a line that picked a tape, which means nobody can
change it without first deciding. That is precisely what the open divergence row
asks for — "a provenance decision, not a code change".

---

## 4. What Wave 1's tolerance was measured against

**It was measured against the PANE path, from a frozen `/api/bars` payload.** The
bars fixture says so in its own header:

> `tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json::_` — *"SPY 1D bars as
> this repo's own **/api/bars** served them on 2026-09-13 (Massive primary). The
> LAST 3000 the provider had."*

and the parity test states the comparison it is making:

> `app/src/components/chart/engine/__tests__/pineTableVendorParity.test.js:19` —
> *"The vendor ran on TradingView's bars; we run on ours (`/api/bars`, Massive
> primary)"*, and `:359-367`: *"our column IS our bars, exactly (the engine is
> faithful), and our bars are NOT the vendor's bars (the providers disagree)"*.

The tolerance itself:

> `app/src/components/chart/builder/memberPane/seriesCompare.js:5-7` — *"Owner
> ruling, 2026-09-12: **integers exact, floats max rel ≤ 1e-9 with abs beside,
> per-series table.**"* … *"AN INTEGER SERIES IS EXACT OR IT IS WRONG. A volume of
> 45,510,000 against 45,510,001 passes any relative tolerance you would pick for a
> float and is a different number of shares. Tolerance on a count is not
> tolerance, it is a hidden rounding rule."*

with R-L beside it (`seriesCompare.js:28-62`): *"An integer series compares
EXACTLY **after the coarser side's granularity is applied**… Our store QUANTISES
SPY's volume to 100 shares and the vendor does not… ⛔ AND IT IS NOT A
TOLERANCE."*

**The SCREENER path was never measured against anything.** There is no vendor
capture, no `seriesCompare` row and no fixture that compares a screener column's
volume to TradingView, or to the pane. Searched: `tests/fixtures/vendor/**`,
`docs/pine/*.md`, `docs/pine/capture-procedure.md`. The 44/266 and 46/266
screener numbers in `docs/pine/PR-BODY.md` and `tools/corpus_metric.json` are
TRANSLATION-pass counts, not numeric parity.

⛔ And note what that means for the sealed-vs-today split in §2c: Wave 1's
capture window ended at **2026-09-11** with the fixture taken on **2026-09-13** —
i.e. entirely SEALED bars. The tolerance was therefore measured on exactly the
half of the series where the two lanes agree by construction, and says nothing
about the developing bar where they diverge.

---

## 5. `uncharted-volume-v2.pine` — where a discrepancy would enter

The script reads the `volume` token **three** times (the census attributes all
three, all reaching an output):

```
line 201  ta.* over volume   ta.sma      scope=fn:f_getDailyData   output=yes
line 210  bare volume        (no call)   scope=fn:f_getDailyData   output=yes
line 216  bare volume        (no call)   scope=sym:v               output=yes
```

Line 216 is `v = volume`, and `v` then carries the series into eleven downstream
expressions (227, 235, 325, 336, 342, 351, 403, 409, 412, 461). `format.volume`
on line 24 is NOT a read — see the dot-guard control.

⭐ **The script has TWO provenance routes for the same quantity, chosen by
timeframe** (`:249-269`; the two routes are `:251` and `:261`): on a 1D chart `volD` comes straight from
`f_getDailyData()`; on any other timeframe it comes from
`request.security(syminfo.tickerid, 'D', f_getDailyData(), lookahead = barmerge.lookahead_off)`.
Wave 1 captured 1D only, so the security route has never been compared.

| output | reads | consolidated-vs-primary | session boundary | stale bar |
|---|---|---|---|---|
| `plot(…, 'Volume')` `:336` | `v` (today's bar included) | moves 1:1 with the tape difference. Measured on the committed SPY capture that is ~**8e-4** on two of four bars and ~0 on the other two | moves 1:1 on the CURRENT bar only: `day.v` is RTH-only (`massive.py:891`) while the built-in pane's number may include extended prints (`sessionPreview.js:103`). Sealed bars unaffected | the last bar is stale between SWR polls; the member pane does NOT take the live max the built-in pane takes (`StockChart.jsx:7861`), so it lags by whatever the poll interval leaves |
| `plot(…, 'Avg Vol Line')` `:346` = `ta.sma(v, 50)` | 50 bars | **damped by 50×**: a single-bar delta of 8e-4 moves the mean by ~1.6e-5. The committed capture measured 1.235e-4 max rel on `Avg Vol Columns`, and says why: *"it averages volumes that already differ"* | one bar in fifty | one bar in fifty |
| `plot(…, 'Avg Vol Columns')` `:342-343` = `v > avgv ? avgv : na` | `v`, `avgv` | ⛔ **a THRESHOLD, so the failure is categorical, not proportional.** A bar within 8e-4 of its own 50-bar average flips between drawing and `na`. The capture found agreement about WHEN it draws on all four bars, which is evidence for those four bars and not a proof | same | same |
| `plot(…, 'Scale Padding')` `:351` = `math.max(v, avgv) * 1.25` | `v`, `avgv` | proportional, invisible — it only sets headroom | same | same |
| bar colour `vcolornew` `:322-326` | `v > avgv` | ⛔ **threshold again** — a near-average bar changes COLOUR on a 35k-share difference | same | same |
| `triggerHVE_Daily` / `triggerHV1_Daily` `:292-301` (the `>=` is `:297`) | `ta.highest(volD[1], 2500)` vs `volD` | ⛔⛔ **`>=` against a 2,500-bar maximum.** A single record bar landing 0.05% differently flips a label on or off. Compounded by depth: the committed AGEN record shows **ours 8 firings whole-series vs the vendor's 23**, cause recorded as history depth, not arithmetic | `volD` uses the PRIOR completed daily bar (`volD[1]`), so today's session boundary cannot pre-trigger it | a stale `volD` delays a same-day firing; `barstate.isconfirmed` already gates it |
| Volume table cell `:495`/`:499` (`Vol : 41M (1.20x)`) | `volDisplay / avgVolDisplay` | the multiplier is a RATIO of two volumes from the same tape, so a uniform tape shift cancels; a per-bar shift does not. Rendered to 2 dp, so ~1e-3 is at the edge of visible | on W/M charts `volDisplay` is `v` (the chart's own bar); on 1D it is `volD` — different routes, §5 above | the table draws on `barstate.islast`, i.e. always on the most stale bar |

⛔ Every magnitude above is reasoning from the committed capture's own measured
deltas (§4) plus the arithmetic of the expression. I did not fetch a bar to
re-measure any of them, and none of the threshold outputs has been exercised
against a second data source.

---

## 6. Reproduction against the Wave 1 capture

**A capture record exists** — `tests/fixtures/vendor/uncharted-volume-v2-spy-1d-forced-depth-2026-09-13.json`
(supersedes the 2026-09-12 shallow one) and
`tests/fixtures/vendor/uncharted-volume-v2-agen-1d-hve-2026-09-12.json`, with the
matching bar fixtures `spy-1d-bars-3000-2026-09-13.json` and
`agen-1d-bars-2000-2026-09-13.json`.

**What I reproduced** (CONTROL 2/3 below): the committed record says our AGEN
store changes volume source on 2024-04-12 — 606 bars since, 100% multiples of
100. Recomputing that from the committed `/api/bars` fixture gives **606** and
**100.0%**. Both sides derived, neither typed. Over the fixture's own
pre-boundary window (1,394 bars from 2018-09-26) the rate is **1.65%**; ⛔ that is
NOT a reproduction of the record's 1.1%, which is measured over 5,394 bars — a
different population, stated rather than silently matched.

**What is UNVERIFIED, and why.** The census cannot compare what the engine WOULD
produce today against what was captured, because doing so requires bars the repo
does not hold and I may not fetch:

* the committed bar fixtures are the pane payload of 2026-09-13; there is no
  committed SCREENER-side bar array for SPY or AGEN, so the two lanes' columns
  cannot be diffed from committed data alone;
* the divergence the capture is about lives in the DEVELOPING bar and in deep
  history, and the fixtures contain neither a developing bar nor the worker db's
  deeper range;
* running the engine over the fixtures reproduces Wave 1's own numbers, which is
  the parity test's job, not a new measurement.

**The reproduction for the main session to run**, precisely:

1. On the rig backend, for one symbol during RTH, capture in the same second:
   (a) `GET /api/bars/{SYM}?tf=D&bars=5` — read `bars[-1].v` and `bars[-1].t`;
   (b) `api.services.bars_sqlite.get_bars(SYM,"D",5)` — read the last row's `v`;
   (c) `api.services.scan_volume.full_market_snapshot()[SYM]["today_vol"]`;
   (d) `api.services.massive.todays_daily_bar(SYM)["v"]`.
   Expected under the reading in §2c: (b) is the sealed value and lacks today
   entirely or holds a `bars_prewarm` partial; (a) equals (d); (c) is a second,
   independently-cached read of the same provider field. **Any difference
   between (c) and (d) is the pane/screener split, in shares.**
2. Repeat after the close, when both should collapse onto the sealed row — which
   is the control that says step 1 measured the session and not the plumbing.
3. For the depth half: request `/api/bars-history/{SYM}?tf=D&bars=60000` and
   compare its oldest `t` against `bars_sqlite.get_first_ts(SYM,"D")` on the web
   pod. A difference names the two-store composition in §2c-2.

⛔ Marked **UNVERIFIED**: none of the four reads above was performed. The brief
forbids a vendor call and a live backend, and steps 1 and 3 need both.

---

## 7. Control output, verbatim

```
CONTROL: corpus-size-reproduces-tools/corpus_metric.json::scripts expected 266 got 266 OK   [committed number, reproduced — not a new baseline]
CONTROL: agen-post-boundary-bar-count (committed record vs the /api/bars fixture) expected 606 got 606 OK   [reproduction]
CONTROL: agen-post-boundary-pct-multiples-of-100 expected 100.0 got 100.0 OK   [reproduction]
CONTROL: stripper-ON-counts-only-real-reads expected 4 got 4 OK   [probe has 4 code reads]
CONTROL: stripper-OFF-over-counts (the mutation arm: it must move) expected 7 got 7 OK   [+1 comment, +1 title string, +1 label string]
CONTROL: stripper-discriminates expected different got different OK
CONTROL: dot-guard (a `\bvolume\b` regex counts `format.volume`) expected 5 got 5 OK   [the naive count is 5; the guarded count above is 4]
CONTROL: reachability-sees-a-PRESENCE (`y` is plotted, `f_live` is called) expected 2 got 2 OK
CONTROL: reachability-sees-an-ABSENCE (`x` unused, `f_dead` never called) expected 2 got 2 OK   [an absence is only evidence if a presence was visible — both arms fire]
CONTROL: reachability-leaves-nothing-unresolved-on-the-probe expected 0 got 0 OK
ALL CONTROLS OK
```

The instrument exits non-zero if any line reads FAIL — it did, twice, during
construction (§8).

---

## 8. Defects found in this instrument while building it

Four, all caught by a control, all fixed. Recorded rather than quietly corrected,
because a control that has never failed is a control nobody has measured.

1. ⚰️ **The reachability control failed and the INSTRUMENT was right.** The first
   probe wrote `x = volume` and `y = ta.sma(volume, 20)`, plotted neither, and
   expected 3 reads to be live. The instrument answered 1 live / 3 dead, which is
   the correct answer for a script whose only drawing is `plot(f_live(close))`.
   The EXPECTATION was the defect. The probe is now symmetric — two live, two
   dead — so an "everything is live" answer and an "everything is dead" answer
   both fail it.
2. ⚰️ **Scoping by physical line put 67 of 346 reads in `unresolved`** — the same
   shape as the failure the brief warns about. Two causes: a `volume` on the
   second physical line of a wrapped assignment had no assignment to belong to,
   and a `volume` in an `if` CONDITION had no statement to belong to. Fixed by
   joining continuations into logical lines and by resolving a block header
   through the block it guards. 67 → 39.
3. ⚰️ **The whole remaining residual was one shape, and 20 of 39 were in one
   script.** `vwma1 = switch maSrc` with `"SMA" => ta.sma(TfClose1*volume, len) /
   ta.sma(volume, len)` on the lines below: the arms are indented children of the
   assignment, so the assignment is their scope. Adding that, plus a UDT
   field-write rule (`vwap.volume := …` is a write to `vwap`), a collection
   mutator rule (`array.push(avg, volume[i])` writes into `avg`) and a
   leading-`=` continuation (a tuple destructure with the `=` on its own line,
   `volume-delta-oi-delta-kioseff-trading` lines 27-28), took it to **5 of 346**,
   each named in §1.
4. ⚰️ **The report rendered in a terminal and died in a redirect.** On Windows,
   `python tools/…py > file.txt` gives stdout a cp1252 encoder and the first `⛔`
   raised `UnicodeEncodeError` — AFTER the census table had printed, so a reader
   seeing the top of the file would have thought it finished. `main()` now
   reconfigures stdout to UTF-8.

Also checked and found clean: the dot guard (a `\bvolume\b` regex counts
`format.volume`, which `uncharted-volume-v2.pine:24` writes — the control pins
the naive count at 5 against the guarded 4); the stripper's both-ways arm (7
reads with stripping off, 4 with it on, and an explicit assertion that the two
differ); and that the corpus population the census reports is the one
`tools/corpus_metric.json` measured (266).

---

## 9. Scope boundary — what is NOT this branch's to fix

This branch owns the Pine→chart-engine translator. Of everything above:

| finding | owning workstream |
|---|---|
| the pane's four disagreeing renderings of today's volume (§2d) — the built-in histogram's live top-up, the MA line's raw read, the legend's second computation, `applySessionCandle`'s extended merge | **UCT Terminal / charts** (`StockChart.jsx`, `sessionPreview.js`). ⛔ NOT ours to change. Recorded with the reproduction in §6 step 1. |
| two vendors (Massive + yfinance) filling one `v` column (§2a) | **bars / data platform** (`api/services/bars_fetch.py`). Same row the committed `volume-provenance-two-sources-disagree-and-one-of-them-rounds` divergence already names. |
| the pane's two physical stores composing one series (§2c-2) | **bars / edge deep-history** (`docs/superpowers/specs/2026-08-31-edge-deep-history`). |
| the screener's forming bar from a second snapshot endpoint (§2b) | **screener** (`api/services/screener/`). |
| the unmade consolidated-vs-primary choice (§3) | ⭐ the owner's provenance decision, routed OUT of this wave on 2026-09-12 (`divergences.json::…_owner_ruling_2026_09_12`). |

What IS ours and is already correct: one vocabulary for `volume → 'v'` shared by
both lanes from one file, and the depth gate + R-L granularity rule that stop the
comparator from reporting a store resolution as a market disagreement.

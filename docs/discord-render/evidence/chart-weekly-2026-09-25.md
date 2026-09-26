# Weekly `/chart` renders vs daily (2026-09-25, after the close)

The owner reported that weekly charts look different from daily ones. I rendered the member's
own `/chart` job inside web for NVDA and QQQ, D and W, captured the images without posting,
and compared them. Found:

## 1. The developing weekly candle was wrong (data, not drawing)

Latest bars from the bars service (`get_bars`, in-process on web), 21:20 ET:

| symbol | daily close 9/25 | week bar as served | the week from its own dailies |
|---|---|---|---|
| AMD | 630.63 | close 615.52, high 616.69, vol 44.5M | high 639.00, close 630.63 |
| MSFT | 516.17 | open 494.95, high 501.87, close 501.61, vol 28.0M | high 519.40, close 516.17 |
| TSLA | 372.11 | close 375.30, vol 36.6M | high 386.83, close 372.11 |
| AAPL | 341.07 | close 338.98, high 339.64 | high 345.34, close 341.07 |
| NVDA | 225.07 | the render read **$224.58**, then 225.07 on the next request | close 225.07 |

**Cause.** `bars_fetch._needs_fresh` refreshes D/W/M when `last_ts <= latest session`. Weekly bars
are keyed by their week's **Friday**, which is ahead of the latest session from Monday to
Thursday, so the developing week read as fresh all week and froze at whatever was stored
first. On Friday it refreshes, but stale-while-revalidate: the FIRST request (the one a chart
paints once, the one the Discord renderer screenshots) still got the stale week.

**Fix.**

- `_needs_fresh('W')` compares with the week key of the latest session.
- The serve chokepoint (`_fmt_sqlite_bars`) rebuilds the developing week from the stored daily
  bars when they are further along, read-only. "Further along" is judged by cumulative volume,
  which only grows inside a week, so a fresher weekly row is never regressed.
- A daily week that the weekly store hasn't seen yet is appended under its Friday key.
- This fixes the app's weekly charts too, not only Discord.

## 2. The weekly image mixed a week and a day

QQQ weekly:

- the header read "W $744.50 +3.19%", which is the week;
- the strip read "Day +0.5%", the day's O/H/L/C and "Vol 30.3M";
- the volume pane read "Volume 179.4M".

**Fix.** `compute_stats(daily, "W")` describes the week, from the same
`_resample_weekly_iso` the bars service uses. It reports the week's O/H/L/C, its change and gap,
and its volume against the 10 completed weeks before it (RVOL on that basis). 52-week range,
ADR and the vintage stay daily. The page and the fallback image label the row "Wk" and
"Avg10w".

## 3. Cosmetic

On weekly charts, the chart component's own bottom-left compass mark sat on the first date
label. The render already carries the mark in its header, so `/r/chart` turns it off
(`showBrandMark={false}`). The app is unchanged.

Not changed: the daily chart's clipped month label at the far right of the time axis is
lightweight-charts' own label in the right-offset area, and it is the same in the app.

## Rails

- `tests/test_weekly_developing_bar.py` (13): mutation-proved 5 ways.
- `tests/test_discord_chart_weekly_stats.py` (6): 3 ways, including the call site. A rail on
  `compute_stats` alone passed while the house path still asked for daily stats.
- `app/src/pages/ChartRender.stats.test.jsx` (+3): 3 ways.
- Pre-existing reds, identical on master (verified by swapping the file back):
  - `api/routers/stream_bars_test.py` ×6
  - `test_bars_ordinal_census` (census stale on master)
  - `test_cold_fetch_pool_protection::…WARM…`
  - `test_discord_render_observe::…log_exception`
  - `StockChart.smoke.test.jsx`'s unhandled `LineType` mock error

## Watch-coverage classification (required by `docs/runbooks/deploy-windows.md`)

`tools/flow_worker_watch_coverage.py` is red on `api/services/bars_fetch.py`: flow-worker runs
the file and will not redeploy for it.

**Classification: INERT STRAND. No flow-worker redeploy.**

flow-worker reaches `bars_fetch` for minute snapshots and the NYSE holiday calendar. It serves no
chart bars; web and bars-api do. Both changed branches are weekly-only:

- `_needs_fresh(tf="W")`;
- `_fmt_sqlite_bars` rebuilding a WEEKLY serve that carries a ticker.

On flow-worker the old code is therefore behaviourally identical. Web, worker and bars-api
redeploy on `api/**` and pick the fix up.

## 4. Found while verifying: a render right after a deploy lost its header

AMD's weekly render was the first `/chart` after the `414f713dc` web deploy, with the pod 32 s up.
Its header read just "AMD W": no company, price or change, and no company name in the
watermark. A minute later the same render was complete.

The header is DOM text from its own `/api/ticker-meta` and `/api/bars` lookups, and neither
readiness flag waited for it. `eea9818e4` adds `window.__chartHeaderReady`, which is true once
those lookups settle, whether they succeed or fail. The renderer waits for it.

**After the deploy, on a pod 47 s up:**

- MSFT weekly: "Microsoft Corporation W $516.17 +4.53%", strip "Wk +4.5%", H 519.40.
- TSLA weekly: "Tesla, Inc. W $372.11 +2.15%", strip "Wk +2.2%".

**First request after `414f713dc`:** the weekly bars of AMD, MSFT, TSLA, AAPL and NVDA all equal
their own dailies, both close and week high.

# 2026-11-20 — an index's intraday chart lost its newest bar at every bar boundary

**Impact:** every member's intraday chart of a cash index (SPX, NDX, VIX, RUT, DJX, XSP, XND; tf 1, 5,
15, 30, 60) could watch its newest bar go BACK in time, and spent most of each 5-minute cycle two bars
behind the clock. A Pine script reading an index from an intraday chart (`request.security("SP:SPX", ...)`,
RS Rating) sat "pending": the client lays each fetched tail over the rows it holds
(`app/src/components/chart/engine/secondaryBars.js` `mergeTail`), so a shorter tail deleted the held
newest row. Equities and ETFs were not affected (they never reach `api/index_bars.py`); daily, weekly
and monthly index bars were not affected.

**Cause, in one sentence:** RS RATING L12 (`97abba9921`, 2026-11-18) withholds a newest bar that was
stored while it was forming once its period ends, but a copy was judged fresh by its AGE alone, and
nothing refreshed it at the bar's end.

## What was measured (production, read-only)

Anonymous `GET https://uctintelligence.com/api/bars/SPX`, browser User-Agent, one request every 10 s,
55 requests between 15:02 and 15:16 UTC. Every answer came from the bars-api tier (`X-Bars-Edge: tier`,
`CF-Cache-Status: DYNAMIC`, no `Age`), and `refreshed_at` only ever moved forward, across both Railway
edges and all three edge traces: one store, no replica disagreement, no CDN cache.

- **Every regression happened inside ONE stored copy, at a bar boundary.** tf=5: 15:00 forming at
  15:04:47Z, then 14:55 at 15:05:07Z (copy `refreshed_at` 15:04:04 both times); 15:05 forming at
  15:09:47Z, then 15:00 at 15:10:07Z (copy 15:09:07); 15:10 forming at 15:14:43Z, then 15:05 at
  15:15:04Z (copy 15:14:14). tf=1 and tf=15 did the same at their own boundaries.
- **tf=5, first run (21 answers): 16 were two bars behind the clock, 5 current, none one behind.**
  Withholding takes the bar that just ended; the bar now forming is not in the copy at all.
- The tier refreshed its 5m copy every 303 to 307 s (its warm loop), drifting against the 5-minute
  grid, so how long each cycle sits withheld drifts too (about 80% of each cycle in this window).
- One anonymous tf=1 request took 1.66 s and got 401, which only web answers (the tier is ungated):
  the edge hedged it to web, which serves its OWN index store. For a member that is a second copy with
  its own phase. Not the cause; recorded.

## The mechanism (file:line on `129b88de91`)

1. `api/index_bars.py:893-900` `_settled_partial_withheld`, applied at `:1046` in `fetch_index_bars`.
2. `api/index_bars.py:960-961` and `:975-976`: `_cached_series` called a copy fresh when
   `now - saved_at <= _TTL` (`:107-108`: 300 s; 120 s for 1m), whatever the bars in it.
3. `api/index_bars.py:1242` and `:1283-1294`, started at `api/bars_api_main.py:298`: the tier warms
   D/W/M/5 every ~300 s plus the pass; 1/15/30/60 are refreshed only by reads, stale-while-revalidate.

## The fix

- `_tail_ended_since_saved`: the D7 test as ONE rule with two readers, the withhold and the refresh.
- `_cached_series`: a copy whose newest bar has ended since it was stored is not fresh; it is refreshed
  in the request (the cold-stale path, `yf_util.bounded_call`). The copy that refresh stores holds the
  new bar, so a read pays one vendor call per bar. A vendor that answers nothing leaves the withheld
  copy, now answered `refresh_state` stale or failed instead of "fresh".
- One serve clock: `_now()` reads the module's `time`, and `_cached_series` uses it.
- A request that finds the refresh already running waits for it (`REFRESH_WAIT_S` = 1.0 s, under the
  edge's 1.2 s hedge) and answers what it stored.

Rails D8a-D8d (`tests/test_index_bars_depth.py`), red on `129b88de91`; D8a fails with "the newest bar
went BACK 300 s". Mutants, each red: the freshness test ignores the boundary (D8a); the refresh trigger
ignores the boundary (D8a); `_cached_series` reads the wall clock instead of `_now` (D8a); no wait on a
running refresh (D8d). Restored from a saved copy each time, hash checked.

## Deploy

`bars-api` watches `api/**` (read live, `tools/railway_watch_patterns.py`, 2026-11-20) and deploys from
`master` (CLAUDE.md, measured 2026-09-20); it is not one of the two manual services (worker,
flow-worker). So a merge redeploys the tier members read. `web` serves the same module behind the
edge's hedge and picks it up when `production` is promoted after the gate.

**flow-worker strand: INERT, no flow-worker redeploy.** `tools/flow_worker_watch_coverage.py` is red on
`api/index_bars.py`. flow-worker reaches it only by import, through
`flow_worker_main -> flow_router -> flow_admin_auth -> auth_service -> auth_db -> journal_two.db ->
template_gallery -> notebook_widgets -> discord_render.symbols -> index_bars`, and the one name used
there is `is_index`, unchanged. flow-worker mounts no `/api/bars` route and starts no index warm loop
(`api/flow_worker_main.py`: "consumer + flow routers only (no bars prewarm)"), so none of the changed
functions run in it.

## Proof in production, after the tier serves the fix

The same read-only probe (one request every 10 s, about 40 requests, alternating tf=5 and tf=1 across
several boundaries). Pass: no answer's newest bar is older than the previous answer's for the same tf;
every tf=5 answer is at most one bar behind the clock (16 of 21 were two behind); the first answer after
each boundary shows `Server-Timing: bars;desc="index-yf"`. Run it only once the tier's running commit
contains this fix (a reset of the tier, not the merge, is the start).

## Left as it is

- `api/crypto_bars.py:419` `_withhold_ended_partial` withholds a forming DAILY crypto bar at UTC midnight
  the same way; it is dark behind `CRYPTO_BARS_ENABLED`. Check it before that switch goes on.
- A vendor that lags (Yahoo answering an older newest bar than the copy held) can still shorten a tail;
  this fix removes the regression the serve manufactured, not one the vendor hands it.
- `mergeTail` could refuse a tail that ends before a held FORMING row; with the server fixed it is
  hardening, not a fix.

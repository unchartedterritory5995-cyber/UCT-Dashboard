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

⚰️ **This said `bars-api` "deploys from `master`" (from CLAUDE.md, measured 2026-09-20). It does not, now.**
`bars-api` watches `api/**` (read live, `tools/railway_watch_patterns.py`, 2026-11-20) and **deploys from
`production`, like `web`**. Measured read-only with `railway deployment list --service bars-api --json` on
2026-11-20: every bars-api deployment carries `meta.branch = production`, and each one has the SAME `createdAt` as
web's deployment of the same commit (129b88de91 at 16:09:56.733Z; 80ce773df2 at 16:44:49.299Z). `worker` is
the one that still shows `branch = master`.

So bars-api is held by the deploy freeze too: `tools/deploy_freeze.py` holds `production` 09:20-16:15 ET on
weekdays (the two rushes plus `SESSION_HOLD_ET`, 2026-11-19), and a promotion that arrives inside waits for the
16:20 ET catch-up. This merge (027274e27f, 16:28Z) passed its gate at 16:51:35Z and every promotion after it
answered `decision: HOLD` with 027274e27f recorded PENDING. The coordinator ruled NO override: an override restarts
web and bars-api mid-session, and that swap is itself the moment the edge's hedge serves web's stale local copy
(see "Related" below). The index lag it leaves is real prices two bars late, not wrong prices.

`web` serves the same module behind the edge's hedge.

**Live on the tier: 2026-11-20 18:34:06Z.** `production` was promoted to `04622f8f03`, which contains
`66b15cc79e`; the promotion landed in the session.
- bars-api deployment `b34c4aaf` was created at 18:25:29.732Z with `meta.branch = production`.
- Its process logged `Started server process` and `Application startup complete` at 18:34:06.77Z.
- Read-only: `railway deployment list` / `railway logs`, plus `git merge-base --is-ancestor`.

**flow-worker strand: INERT, no flow-worker redeploy.** `tools/flow_worker_watch_coverage.py` is red on
`api/index_bars.py`. flow-worker reaches it only by import, through
`flow_worker_main -> flow_router -> flow_admin_auth -> auth_service -> auth_db -> journal_two.db ->
template_gallery -> notebook_widgets -> discord_render.symbols -> index_bars`, and the one name used
there is `is_index`, unchanged. flow-worker mounts no `/api/bars` route and starts no index warm loop
(`api/flow_worker_main.py`: "consumer + flow routers only (no bars prewarm)"), so none of the changed
functions run in it.

## Proof in production: run 2026-11-20 18:34-18:41Z. Verdict FAIL by the letter, the symptom is gone

40 anonymous GETs, one every 10 s, tf=5 and tf=1 alternating, against the fixed tier. That covers two
5-minute boundaries and seven 1-minute ones. The script and its pass rules are below.

| criterion | result |
|---|---|
| 1. no newest bar older than the previous answer's | **PASS**: 0 regressions in 40 answers (before the fix: 4 in 41) |
| 2. tf=5 at most 1 bar behind the clock | **PASS**: 20 of 20 answers current, 0 behind (before: 16 of 21 two behind) |
| 3. the first answer after each boundary is refreshed | **FAIL**: 8 of 9. The miss was tf=1 at 18:37:14Z |

- **Refreshes seen:** `index-yf` was the first answer after the boundaries at 18:35:04, 18:35:14 and 18:40:04.
  The other boundaries were refreshed by another reader first (`refreshed_at` after the boundary).
- **The miss, and why it is a second case rather than the first one returning:**
  - The 1m refresh at 18:36:01 got a series whose newest bar was 18:35. The vendor had not published the
    18:36 bar one second into the minute.
  - That copy's newest bar had already ENDED when it was stored, so `_tail_ended_since_saved` is false
    for it, by design (D7c).
  - Nothing refreshed it until its 120 s TTL ran out. It answered 18:35 "fresh" at 18:36:14 (1 behind) and
    at 18:37:14 to 18:37:54 (2 behind). It never went back.
  - At 18:38:03 the next refresh was current, and the rest of the run was current.
- **Residual, not built:** the vendor lags at the moment of a refresh.
  - The follow-up rule: also refresh when a bar that should exist ended after the copy was stored, i.e.
    `saved_at < end(newest) + step <= now`, bounded by the session's close.
  - One vendor read per bar at most. Rail: a copy stored at 09:56:01 whose newest bar is 09:55, served at
    09:57:14, must refresh in the request.
  - Signed-in companion probe (patrick-54, as smoke@): results go to the coordinator.

### Re-running it

It needs live intraday boundaries, so it runs in a regular session, between 09:45 and 15:30 ET (14:45-20:30Z).
**Precondition, read-only:** bars-api's live deployment is a commit that contains `66b15cc79e`:

```sh
railway deployment list --service bars-api --json   # newest SUCCESS entry: meta.commitHash, meta.branch
git fetch origin production && git merge-base --is-ancestor 66b15cc79e <that commitHash> && echo CONTAINS
```

**The probe** (anonymous, browser User-Agent, one GET every 10 s, 40 GETs alternating tf=5 and tf=1, about seven
minutes, so it crosses at least one 5-minute boundary and six 1-minute ones). Save as `index_tail_probe.py` and run
`python index_tail_probe.py`:

```python
import datetime as dt, email.utils as eu, json, sys, time, urllib.error, urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
STEP = {"5": 300, "1": 60}
hms = lambda t: dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%H:%M:%S")
prev, prev_bucket, regressed, behind5, missed, refreshed_ok, n_ok = {}, {}, [], [], [], 0, 0
for i in range(int(sys.argv[1]) if len(sys.argv) > 1 else 40):
    tf = ("5", "1")[i % 2]
    t0 = time.time()
    try:
        r = urllib.request.urlopen(urllib.request.Request(
            f"https://uctintelligence.com/api/bars/SPX?tf={tf}", headers={"User-Agent": UA}), timeout=40)
        d, h = json.loads(r.read()), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        print(hms(t0), tf, "HTTP", e.code, e.headers.get("X-Bars-Edge"), round(time.time() - t0, 2), "s")
        time.sleep(max(10 - (time.time() - t0), 5.2)); continue
    srv = eu.parsedate_to_datetime(h["date"]).timestamp()
    newest, step = d["bars"][-1]["t"], STEP[tf]
    bucket = int(srv // step * step)
    lag = int((bucket - newest) // step)
    st = [v for v in (r.headers.get_all("Server-Timing") or []) if v.startswith("bars;")]   # Cloudflare adds its own
    desc = st[0].split(";")[1].replace("desc=", "").strip('"') if st else "?"
    note = ""
    if tf in prev and newest < prev[tf]:
        regressed.append((hms(srv), tf)); note += " <<REGRESSED"
    if tf in prev_bucket and bucket > prev_bucket[tf]:
        if desc == "index-yf" or (d.get("refreshed_at") or 0) >= bucket:
            refreshed_ok += 1; note += f" boundary: {desc}"
        else:
            missed.append((hms(srv), tf, desc)); note += " boundary: NOT REFRESHED"
    if tf == "5":
        behind5.append(lag)
    prev[tf], prev_bucket[tf], n_ok = newest, bucket, n_ok + 1
    print(hms(srv), tf, "newest", hms(newest), "forming" if d.get("newest_bar_is_forming") else "settled",
          "refreshed", hms(d["refreshed_at"]) if d.get("refreshed_at") else None, d.get("refresh_state"),
          desc, h.get("x-bars-edge"), f"behind={lag}", f"{time.time() - t0:.2f}s{note}")
    time.sleep(max(10 - (time.time() - t0), 5.2))
p = (not regressed) and all(x <= 1 for x in behind5) and not missed and refreshed_ok > 0
print(f"answers={n_ok} regressed={regressed} tf5_behind={sorted(set(behind5))} boundaries_refreshed={refreshed_ok} "
      f"boundaries_missed={missed}\nVERDICT: {'PASS' if p else 'FAIL'}")
```

**Pass** (all three):
1. no `<<REGRESSED` row: for each tf, no answer's newest bar is older than the previous answer's;
2. every tf=5 answer is at most 1 bar behind the clock (`behind` 0 or 1; before the fix 16 of 21 were 2);
3. the first answer after each bar boundary shows `Server-Timing: bars;desc="index-yf"`, or its copy was already
   refreshed after that boundary by another reader (`refreshed_at` >= the boundary). None `NOT REFRESHED`.

⭐ **The script was first checked against the UNFIXED tier, on 2026-11-20 at 17:09-17:10Z, and it read FAIL.**
On 6 GETs it caught a tf=1 copy (refreshed_at 17:09:42) answering 17:09 forming and then 17:08 settled
(`<<REGRESSED`, `boundary: NOT REFRESHED`), and tf=5 two bars behind. So it is not a blind probe: a PASS
means the tier, not the instrument. ⚠️ Read `Server-Timing` with `get_all`: Cloudflare now adds its own `Server-Timing: cfOrigin;dur=..`,
and a plain header dict keeps only the last one.

Run a signed-in browser probe alongside (patrick-54's in-page probe, as smoke@), so the signed-in hedge path is
covered and any slow reply comes back with full headers.

## Left as it is

- `api/crypto_bars.py:419` `_withhold_ended_partial` withholds a forming DAILY crypto bar at UTC midnight
  the same way; it is dark behind `CRYPTO_BARS_ENABLED`. Check it before that switch goes on.
- A vendor that lags (Yahoo answering an older newest bar than the copy held) can still shorten a tail;
  this fix removes the regression the serve manufactured, not one the vendor hands it.
- `mergeTail` could refuse a tail that ends before a held FORMING row; with the server fixed it is
  hardening, not a fix.

## Related, open: a tier swap answers web's stale local copy (any symbol, signed-in members)

Measured the same day, read-only (Railway HTTP and deploy logs). It is a separate defect; its fix is not
decided here.

- **What a member saw:** at 16:52:49Z a signed-in poll got `/api/bars/SPX` in 3,378 ms and `/api/bars/RDDT`
  (tf=5) in 3,417 ms. RDDT's newest bar was 13:50 ET on 2026-11-19, 22 hours old. The poll before and the
  poll after were about 65 ms and current.
- **The trigger:** an override promotion of 80ce773df2 rebuilt bars-api from 16:44:49Z. The new process
  started at 16:52:56.85Z (healthcheck OK 16:52:58), so the poll landed in the swap.
- **The edge hedged** after 1.2 s (`edge/bars-edge-router/worker.js:55`, `:64-96`): the first answer wins,
  with no check of how fresh it is.
- **Web did both requests** (its HTTP log on `web-production-05cb6`): SPX 200 in 2,056 ms, RDDT 200 in
  2,168 ms.
  - Web has `BARS_PROXY_ENABLED=1` and `BARS_PROXY_PCT=100`, so it re-proxied each request to the SAME
    restarting tier (`api/routers/bars.py:653-660`).
  - It waited for httpx's 2.0 s connect timeout (`:389-390`), then fell back to its LOCAL serve.
  - The arithmetic matches: 1.2 + 2.06 = about 3.38 s, and 1.2 + 2.17 = about 3.42 s.
- **Why web's local copy is old:** web proxies every read, so its local intraday rows are never healed by a
  read. They are an R2-merge copy plus `warm=1` prefetches.
- **Why it was served as-is:** web runs `BARS_INTRADAY_ASYNC_HEAL=1` (the tier does not).
  - `_intraday_deblockable` (`api/services/bars_fetch.py:1861`) compares only the DATE of the newest bar
    with the last closed session.
  - So a tail that stops at 13:50 of that session passes as "carries the last closed session", which its
    own docstring says it must.
  - The tail went down the stale-while-revalidate branch (`:5113-5118`, `:5313-5432`) and came back as an
    instant 200, with a background heal.
- **How often:**
  - In RTH before the swap (14:30-16:53Z), 21 edge-to-web hedges reached web, and none paid the 2 s
    connect-timeout fallback: 13 were anonymous 401s, 7 lost the race to the tier (499), and 1 answered
    200 in under 2 s.
  - In the 14 minutes after the swap there were 25 hedges, and the 2 local fallbacks were exactly the
    swap's.
  - So stale hedged answers cluster at tier swaps, which means every production promotion. Their staleness
    is the age of web's local copy for that symbol and tf.

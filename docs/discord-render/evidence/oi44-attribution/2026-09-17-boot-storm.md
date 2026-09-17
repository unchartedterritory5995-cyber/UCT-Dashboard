# OI-44 / W2b — the first durable stall record, and the log slice beside it

**Pod:** commit `d9455a6d64a5`, booted ~`2026-09-17T12:58:50Z` (the SECOND restart today with no
commit change; the first was `12:22:35Z`). **Captured 2026-09-17 09:05 ET, inside Railway's
retention window** — the record and the log slice are the same two minutes.

⛔ **RAW FIRST, INTERPRETATION SECOND (R-RAW).** Everything in §1 and §2 is copied as read. §3 is
the only part that argues, and it names what it did NOT establish.

---

## §1 — The durable stall record, read from the volume

Four events, from `stall_record.snapshot()["recent"]` via the R31 trace at `13:02:06Z`
(`docs/discord-render/evidence/d14-monitor/r31-trace.jsonl`, `slots_src: volume`):

| at (UTC) | ms | uptime_s | tier | paged |
|---|---|---|---|---|
| 13:00:07 | 1,360.9 | 77.8 | — | false |
| 13:00:19 | 4,332.1 | 89.3 | — | false |
| **13:00:33** | **10,469.7** | **103.6** | **1** | **true** |
| 13:01:04 | 6,778.4 | 135.0 | 1 | false |

⭐⭐ **W1 COMMIT A WORKED END TO END IN PRODUCTION, AND THIS IS THE PROOF.** It recorded, it
tiered, and it **PAGED** — `paged: true` on the 10,469.7 ms event. OI-45 said the `loop_stalled`
rule had never been able to fire; this is the replacement path firing on a real pod, with V2 still
dark. The fourth event is `tier: 1, paged: false`, which is the **durable 30-minute cooldown doing
its job** rather than a miss — the very thing the in-memory cooldown could not do across ~20
restarts a day.

⚠️ Both sub-5 s events show `tier: null, paged: false`: below `LOOP_STALL_PAGE_ALWAYS_MS` (5,000)
and below the 900 s uptime floor, so **recorded and counted, never paged** — R34 exactly as
written, and the below-floor count is the per-boot cost evidence R35 asks to keep.

## §2 — The `web` log across the same two minutes, verbatim where it matters

Read with `railway logs --service web`, filtered to `13:00:16`–`13:01:0x` and printed; no file of
the full stream was taken.

```
12:59:50,914  apscheduler ... Job "...wrapped (trigger: interval[0:01:00]...)"
              <-- 25.3 SECONDS OF SILENCE -->
13:00:16,211  api.services.discord_interactions: [discord-chart] warmed 3 hot chart(s): DELL:D, LITE:D, SMTC:D
13:00:16,211  api.services.discord_interactions: [discord-chart] hot warm hit its 20s budget after 26.8s
                                                 - 6 chart(s) deferred to the next cycle (resuming there)
13:00:17,316  ERROR yfinance: HTTP 404 Quote not found for symbol: ATGE
13:00:19,621  api.services.perplexity_search: perplexity call surface=catalyst model=sonar-pro
13:00:21,627  api.main: [calendar-enrich-warm] current week 5 day(s)/27 syms; week-2 5 day(s)/46 syms
              <-- 11.7 SECONDS OF SILENCE -->
13:00:33,337  snaptrade_client WARNING: account_information.get_user_account_positions is deprecated
13:00:34,142  api.routers.calendar: Calendar metrics: Finviz returned data for 2/2 tickers
13:00:41,931  api.services.bars_sqlite: put_bars refused 1/5335 impossible bars for QQQ tf=D
13:00:48,204  api.services.rs_ranking: [rs_ranking] Computing RS scores for 3696 stocks...
13:00:49,29x  apscheduler: EIGHT jobs "Running job ..." within ~130 ms
13:00:49,712  darkpool_intraday: 9/17/2026: +25 new / 25 prints from 53 tickers in 49s
13:00:52,650  snaptrade_client WARNING: options.list_option_holdings is deprecated
              <-- 6.7 SECONDS OF SILENCE -->
13:00:59,351  api.services.bars_reconciliation: [reconcile] DRIFT NFLX/5: 1 fail / 1 warn - healed 1 row(s)
13:01:00,001  apscheduler WARNING: Execution of job "...(cron[mon-fri, hour='9-1...])" ...
13:01:22,955  [discord-chart] hot warm hit its 20s budget after 33.5s - 3 chart(s) deferred
```

## §3 — What this establishes, and what it does not

**The three silences line up with three of the four recorded stalls, to within the logging
resolution:**

| log gap | length | recorded stall ending in that window |
|---|---|---|
| 12:59:50.9 → 13:00:16.2 | 25.3 s | 1,360.9 ms @ 13:00:07 *(and the warm's own 26.8 s overrun)* |
| 13:00:21.6 → 13:00:33.3 | 11.7 s | **10,469.7 ms @ 13:00:33** |
| 13:00:52.6 → 13:00:59.4 | 6.7 s | 6,778.4 ms @ 13:01:04 *(began ~13:00:57)* |

⭐ **A log gap is what a blocked event loop looks like from the outside**: nothing can be written
while nothing can run. The 11.7 s silence around the 10.47 s stall is the closest thing to a
direct observation this instrument can produce.

⛔ **IT DOES NOT NAME THE BLOCKER, AND NOTHING HERE SHOULD BE WRITTEN AS IF IT DID.** Several
candidates ran in each window — the `[discord-chart]` hot warm, `calendar-enrich-warm`,
`rs_ranking` over 3,696 stocks, `darkpool_intraday` (self-reported 49 s of work), a SnapTrade
sync, `bars_reconciliation`, and an APScheduler burst that fired **eight jobs inside 130 ms** at
13:00:49. A gap bounded by two of them is consistent with any of them.

⭐ **The leading NAMED candidate, and the reason it leads, is that it measures itself.**
`[discord-chart] hot warm` is the only participant that reports its own duration against a budget,
and it reported **26.8 s and 33.5 s against a 20 s budget**, twice, in these two minutes. It is
the one job in the window known to have overrun, by its own reckoning. **That makes it a
candidate, not the cause** — the next step is an instrumented run that times the loop against
named job boundaries, not more log reading.

⚠️ **AND THE BOOT STORM IS NOT ONE JOB, IT IS A SHAPE.** Everything above happens in minutes 1–3
of a pod's life because that is when the boot warms and the first interval ticks coincide. This
matches the R31 profile exactly: minutes 0–3 carry a ≥5 s stall rate of 3.55/pod-h against the
settled tail's 0.16. **Fixing one job would move one of these numbers.**

⚠️ **THE POD RESTARTED TWICE TODAY WITH NO COMMIT CHANGE** (12:22:35Z and ~12:58:50Z, both
serving `d9455a6d64a5`). If that cadence holds, the boot storm runs far more often than the
"~20 deploys/day" figure this programme has been sizing against, and every run of it is a fresh
tier-1 page opportunity. **Not explained here; recorded because it changes the exposure.**

---

## §4 — THE PAGE DELIVERED. OI-45 is closed by the artifact, not by a boolean.

⛔ **`paged: true` in the record is a DECISION, not a delivery.** `chart_health_alerts._page_discord`
is fire-and-forget on a daemon thread with a bare `except Exception: pass` and **no logging on
either path** — so the web log can never show whether Discord received it, and reading the log for
one is the absence-that-proves-nothing trap. The only artifact that settles it is the channel.

**Read in `#system-alerts`, guild `UCT Intelligence` (`1524909611054792786`), channel
`1524909746996510770`, 4 members, zero member exposure — verbatim:**

> 🔴 **Chart health — loop_stalled**: The event loop was blocked for 10470 ms at uptime 104s
> (tier 1). Discord closes an interaction at 3,000 ms and the renderer's page load fails in the
> same window (C-02).

⭐⭐ **THAT SENTENCE IS THE CLOSE OF OI-45.** The finding was that `loop_stalled` had never been
able to fire in production: its only evaluator was `observe.Observer`, built solely inside
`if _render_v2.enabled():`, and V2 is dark on every pod. W1 commit A routed the page around that
gate through `chart_health_alerts.emit(..., "critical", ...)`. This is that path, on a production
pod, with V2 still dark — **recorded, tiered, delivered, and legible to a human.**

The `10470 ms` and `uptime 104s` in the Discord text match the record's `10,469.7 ms @ uptime
103.6 s` exactly, so the message and the volume are the same event and not two readings that
happen to agree.

⚠️ **The severity is load-bearing and it held.** `_should_page_discord` returns False for anything
but `"critical"`, so a lower severity would have reproduced OI-45 in a new place — recorded,
never told. It did not.

---

## §5 — R29's DURABILITY IS NOW OBSERVED, across TWO restarts, and the restarts are the other finding

The R31 trace polls the volume every ~60 s and stamps `slots_since`. Across 33 consecutive
readings the pod's `uptime_s` collapses twice — **the tell that a restart happened** — and the
counter does not:

```
12:57:57Z  uptime 2122   current 200   since 12:23:20Z
12:58:58Z  uptime   21   current 200   since 12:23:20Z   <-- RESTART, counter intact
13:13:31Z  uptime  894   current 251   since 12:23:20Z
13:15:34Z  uptime   39   current 255   since 12:23:20Z   <-- RESTART, counter intact
13:17:38Z  uptime  163   current 258   since 12:23:20Z
```

⭐⭐ **`slots_since` never moved and `current` never went backwards.** That is exactly the check
this programme wrote down in advance as the one that decides R29 — *"the tell at the next boot is
`slots_since`: if it MOVES, the counter is not durable"* — and it passed twice without being
touched. **The token-slot counter is durable in production, measured rather than argued**, which
is what R29 needs before OI-13 step 6 can ever be permitted. (`previous` is still 0 throughout:
zero senders on the old credential so far, which is the direction that permits the clear.)

⚠️ The span condition is untouched by this. R29 still needs a full weekday including a 07:35 ET
Morning Wire run, and `since` is 12:23:20Z **today**, so the earliest qualifying window still
closes Friday ~08:23 ET.

### ⛔⛔ THREE POD RESTARTS IN 55 MINUTES, ALL ON THE SAME COMMIT

`12:22:35Z` · `~12:58:50Z` · `~13:14:55Z`, every one serving `d9455a6d64a5`, with no push in
between (`/renderhealth` reports the same commit throughout, and `origin/master`'s tip has not
moved). **That is a restart every 20–35 minutes, not a deploy.**

⛔ **THIS CHANGES THE EXPOSURE ARITHMETIC THIS PROGRAMME HAS BEEN USING.** Every artifact here
sizes against *"web deployed TWENTY times on 2026-09-15 and the longest pod life was ~45 minutes"*
— a figure derived from deploys. If pods are also restarting on their own two to three times an
hour, then:

- the **boot storm** (§2–§3) runs far more often than the deploy count suggests, and every run of
  it is a fresh tier-1 page opportunity — which is why R35 matters here: **the answer is to fix
  the cause, not to widen the threshold that would otherwise fire correctly all day**;
- every piece of **in-process state** is erased that often — which is precisely why W1 made the
  record, the cooldown and the counters durable, and is now a stronger argument for it than the
  one that was written at the time.

⛔ **NOT EXPLAINED, and not to be guessed at here.** Candidates a future session must
*distinguish rather than assume*: a Railway platform restart, an OOM kill, a healthcheck failure,
or a crash-and-respawn. The discriminator is the pod's own exit — a restart with a non-zero exit
or an OOM signature looks nothing like a graceful platform cycle, and **neither the stall record
nor this trace can tell them apart.** That is the next measurement, and it is upstream of the
render programme rather than inside it.

# The Wire — live multi-source earnings feed

**Date:** 2026-07-31
**Surface:** `/calendar` → new "Wire" view
**Status:** design approved, not yet planned or built

---

## Purpose

During earnings season the owner wants to open a feed on the Calendar page and
watch results arrive **as they hit the tape** — not discover them minutes later
on a board that refreshes on a cache clock.

> "essentially like a news wire but earnings results coming through immediately
> as they drop… so during earnings season i can open up my feed spot on the
> calendar page and I get the results to start coming in as they hit the wire."

The value is concentrated in two narrow windows: **16:00–16:30 ET** (AMC) and
**06:00–09:30 ET** (BMO). A 250-name night is normal (Wed 7/29 had 248; the week
of 7/27 had 732).

## What it is

A fourth view beside Table / Board / Month, persisted through the existing
`usePreferences('calendar_view')`. Rows stream in newest-first, ranked by what
deserves attention, and **each row upgrades in place** as better information
arrives.

```
16:02:11  NVDA   ▲ +6.4%
          EPS 1.24 vs 1.11   ○ unconfirmed
          Rev 51.2B vs 49.8B ○ @DeItaone

   … 90s later …

16:03:41  NVDA   ▲ +6.4%  BEAT
          EPS 1.24 vs 1.11   ● confirmed
          Rev 51.2B vs 49.8B ● FMP
```

## Decisions (owner-selected)

| # | Decision | Rationale |
|---|---|---|
| 1 | **Progressive rows** — price first, numbers fill in | Price is real-time with zero provider lag; the row is never blocked waiting on Finnhub |
| 2 | **Ranked firehose**, with a My Stocks toggle | 250 rows is unusable unsorted; the 6 names actually moving must sit on top, the other 244 below but not lost |
| 3 | **Alert on any outsized reaction**, not just owned names | The name that rips 12% on its print is exactly the one he did not know to watch |
| 4 | **Multi-source race** (below) | Single-source means single-source latency |
| 5 | **Show unconfirmed numbers, tagged** | The 90s before confirmation is the point; uncertainty goes on screen rather than being hidden |

## The latency ladder

Sources race; the first to produce a number fills the row and later sources
confirm or correct it. **Nothing chains** — a slow source never gates a fast one.

| # | Source | Gives | Latency | Cost control |
|---|--------|-------|---------|--------------|
| 1 | Massive snapshot | the move (extended-hours vs regular close) | real-time | already polled; batch call |
| 2 | TwitterAPI.io curated accounts | headline EPS / revenue | seconds + poll interval | `since_id` bills only what's new |
| 3 | FMP `stable/earnings` | structured EPS + revenue | targeted per-symbol | **only for names already moving or tweeted** |
| 4 | Finnhub `/calendar/earnings` range | the bulk sweep — catches everything | one call covers the day | already in `_patch_today_actuals` |
| 5 | Perplexity | last-resort gap fill | seconds, expensive | only a mover with numbers nowhere else |

All five credentials verified live in Railway on 2026-07-31.
`FINVIZ_AUTH` is **unset**, so Finviz is deliberately not a source here.

### The highest-leverage change is config, not code

`tweet_poller` currently bursts every **2 minutes** during 3:30–7pm ET. Inside
the narrow 16:00–16:30 print window that is the difference between "live" and
"up to 2 minutes late". Tightening to ~20–30s **within the window only** is a
few cents a night because `since_id` bills only new tweets. This should be
measured and tuned before any UI work is called done.

## Four correctness rules

1. **Race, don't chain.** First number wins the row; later sources confirm or correct.
2. **Deterministic parse first.** `@DeItaone`'s format is highly regular → regex.
   Claude Haiku is a *fallback for unmatched formats only*. **The model parses
   text that already contains the number — it never supplies one.** Grounding is
   non-negotiable here: LLM-generated market figures scored 29/181 correct in
   this project's own backtest (`lesson_llm_market_examples_need_data_grounding`).
3. **Provenance per field.** Every figure carries its source and a confirmed flag.
   On disagreement **the structured source wins** and the row shows it was corrected.
4. **Targeted, never broadcast.** FMP and Perplexity fire per-symbol only for names
   already moving or tweeted — never across all 250. This is what bounds the bill.

## Architecture

### Detector runs server-side on a schedule, not on request

A scheduler job (APScheduler, next to the existing catalyst/tweet jobs) runs
every ~20–30s inside the two windows and much slower outside:

1. batch snapshot for today's reporters → extended-hours move vs regular close
2. new tweets for those cashtags from `tweet_store`
3. detect prints: **move beyond threshold OR actuals appeared OR cashtag hit**
4. targeted FMP per newly-detected mover
5. write rows; fire alerts

`GET /api/calendar/wire` then only **reads the table** — no provider fan-out on
the request path. This is deliberate:

- `first_seen_at` must be accurate even when nobody has the page open
- alerts must fire when nobody is watching
- it keeps the request path off the anyio threadpool (the 2026-07-01 524 class)

### No new SSE rail

Frontend polls ~10s inside the windows via `useMobileSWR`, far slower outside.
**A second SSE stream is explicitly rejected**: the web pod is a single uvicorn
process with in-process stream state, which is precisely the 524-outage surface.
Since the endpoint is a table read and the price data underneath is already
real-time, 10s polling is indistinguishable from push here.

### Storage — one new SQLite store

**This revises an earlier "no new table" position.** That was correct for a
price+Finnhub feed. Per-field provenance, confirmation state, correction history
and alert dedup are relational, and the sticky-actuals ledger is a whole-file
JSON rewrite under a lock — it would thrash during a 250-name window. Follows the
established `catalysts.db` / `tweets.db` / `cot.db` pattern.

```sql
CREATE TABLE wire_prints (
  market_date   TEXT,
  sym           TEXT,
  timing        TEXT,     -- bmo | amc | tbd
  first_seen_at REAL,     -- when it entered the wire (the "hit the tape" stamp)
  trigger       TEXT,     -- price | tweet | actuals
  eps_act REAL, eps_est REAL,
  rev_act REAL, rev_est REAL,
  eps_src TEXT, rev_src TEXT,   -- 'tweet:@DeItaone' | 'fmp' | 'finnhub' | 'perplexity'
  confirmed     INTEGER,  -- 0 = tweet-only, 1 = structured source agrees
  corrected     INTEGER,  -- 1 = a structured source overrode a tweet value
  peak_move_pct REAL,
  updated_at    REAL,
  PRIMARY KEY (market_date, sym)
);

CREATE TABLE wire_alerts_fired (          -- mirrors catalyst_alerts_fired
  sym TEXT, market_date TEXT, fired_at REAL,
  PRIMARY KEY (sym, market_date)
);
```

Reaction % is **not stored** — it is live, overlaid at read time from the shared
price cache. `peak_move_pct` is stored only for ranking and alert hysteresis.

### Alerts

When |reaction| first crosses a threshold (start ~8%), fire through the existing
`watchlist_alert_service.deliver_alert_payload` rail. Dedup per
`(sym, market_date)` exactly like `catalyst_alerts_fired`. **Env-gated and shipped
dark** until one real earnings night has been observed and the threshold tuned.

## Failure behaviour

- Any provider failing degrades the wire to what it still has — price-only rows,
  or numbers-only rows. **Never blank.**
- No AMC on a Friday is **correct, not an outage**; holiday-guarded
  (`lesson_scheduled_jobs_holiday_guard`).
- A tweet that cannot be parsed deterministically and fails Haiku fallback is
  **dropped, not guessed**.
- Tweet/structured disagreement is surfaced as a correction, never silently
  overwritten.

## Testing

- Deterministic parser: a fixture corpus of real `@DeItaone` / `@FinancialJuice`
  earnings tweets, including the awkward ones (adjusted vs GAAP, revenue in
  millions vs billions, negative EPS, "beats by").
- Detector state machine: price-first → tweet upgrade → FMP confirm; and the
  correction path where FMP disagrees with the tweet.
- Alert dedup: one alert per (sym, market_date) maximum.
- **At least one test must make a REAL provider fetch.** Mocked tests passed
  while a calendar feature was wrong-shaped and shipped in 0 of 24 charts
  (`lesson_injected_dependency_hides_the_fetch`).
- **The acceptance test is a live 16:00 ET window** — watching real prints land,
  measuring source-by-source latency, not a green suite.

## Open questions to resolve during implementation

1. **Actual source latency is unmeasured.** How long after a print do Finnhub,
   FMP and the tweet wire each deliver? Measure in a live AMC window on the first
   trading day of implementation. This determines how much work the price trigger
   is really doing and whether the Perplexity rung earns its cost at all.
2. **Tweet poll cadence** inside the window — tune to the measured latency.
3. **Alert threshold** — 8% is a starting guess, to be set after one real night.
4. **Revenue units** vary by source (millions vs billions); normalize at the
   parser boundary with explicit tests.

## Explicitly out of scope for v1

- A second SSE rail (rejected above)
- Options-implied reaction / expected-move comparison on the wire row
- Transcript or call-recap integration (already exists in EarningsModal on click-through)
- Historical wire replay for a past date

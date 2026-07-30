# Weekly Calendar → Discord — design

**Date:** 2026-07-30
**Status:** approved, implementing

Every Saturday 4:30 AM ET, render the week-ahead earnings calendar and the
week-ahead economic events as two branded PNGs and post both in ONE Discord
message to the Uncharted Territory #event-calendar channel (a PAID server —
no paywall-teaser constraint).

## Why this shape

Two facts drove the design:

1. **The data already exists and is already correct.** `get_calendar()` returns
   the week's `bmo`/`amc`/`tbd` plus ForexFactory-sourced `econ`/`fed` per day,
   and on a weekend `_week_dates()` already rolls forward to next Monday — so
   "the week ahead" needs no new resolution logic. Market caps for ranking come
   from `get_day_metrics()`, the same call `/api/calendar/most-anticipated.png`
   already makes.
2. **The rendering and posting chrome already exists.** `calendar_anticipated_png.py`
   owns the palette, fonts, compass mark, gradient background and logo-cache
   loader. `desk_session_announce.py` owns the multipart webhook pattern
   including Discord's attachment gotchas.

So this is mostly composition, not new machinery.

## Components

### `api/services/calendar_png_common.py` (NEW — extraction)

The shared chrome lifted out of `calendar_anticipated_png.py`: `_W/_H`-agnostic
gradient background, brand palette, `_font()`, `_compass()`, logo loader with
monogram fallback, and text-fitting helpers. `calendar_anticipated_png.py` is
refactored to import from it so all three cards stay visually identical and
there is ONE place to change the brand.

This is a targeted extraction, not a rewrite — `render_anticipated_png`'s
output must be byte-identical before and after (regression-tested).

### `api/services/calendar_week_png.py` (NEW)

- `render_earnings_week_png(week_label, days, ranked) -> bytes`
  1600×1000. Five day columns. Per column: `MON 3` header, a BMO section and an
  AMC section, up to **8 names per session** ranked by market cap descending,
  each a 34px logo + ticker. Unknown-session (`tbd`) names fold into a third
  section only when present. A per-day `+N more` line states the overflow
  honestly — never silently truncate.
- `render_econ_week_png(week_label, days) -> bytes`
  Same chrome and column geometry. Per day, events in time order with forecast
  and prior. `_curate_econ_events` already filters to high/medium impact plus
  Fed speakers, so no additional filtering here. Fed-speaker rows are visually
  distinguished from data releases.

Both are deterministic (same inputs → same bytes) and make **zero network calls**
at render time — every value is passed in. Empty week renders an explicit
"no scheduled reporters/events" card rather than a blank grid.

### `api/services/calendar_week_poster.py` (NEW)

The job. In order:

1. Resolve the target Monday (default: `_week_dates()[0]`, which on Saturday is
   next Monday).
2. Pull the week payload + per-day metrics; rank each day's entries by `mc_b`.
3. **Guard:** if the earnings grid would be empty AND econ is empty, post
   nothing and alert the admin Discord instead. A scheduled job that "succeeds"
   with a hollow card is the `incident_wire_dns_outage_silent_success` failure
   mode — it must fail loudly, not quietly.
4. Render both PNGs.
5. Post ONE multipart message: short copy + `embeds[0]` → `attachment://earnings.png`,
   `embeds[1]` → `attachment://econ.png`, `files[0]`/`files[1]`.
6. Record the posted week for dedup.

**Dedup** on `week_start` in a small SQLite store (mirrors `desk_announce.db`),
so a pod restart, a double-fire, or a manual run cannot double-post.

**Never raises** into the scheduler.

### Webhook targeting

| env | purpose |
|---|---|
| `DISCORD_EVENT_CALENDAR_WEBHOOK_URL` | LIVE — Uncharted Territory #event-calendar |
| `DISCORD_EVENT_CALENDAR_TEST_WEBHOOK_URL` | TEST — a channel in the UCT Intelligence server |

`target='test'` resolves TEST → falls back to `DISCORD_WEBHOOK_URL` (the existing
admin channel) so a test post works with **zero setup**. `target='live'` resolves
LIVE ONLY and refuses to post if it is unset — it must never silently fall back
into the admin channel.

### Endpoints (`api/routers/calendar.py`)

- `GET /api/calendar/week-earnings.png?week=` — preview, cached per week.
- `GET /api/calendar/week-econ.png?week=` — preview, cached per week.
- `POST /api/calendar/post-week?target=test|live&week=&force=1` — `require_admin`.
  Defaults to `target=test`. `force=1` bypasses the dedup guard.

Previews exist so the render can be eyeballed immediately instead of waiting for
Saturday, and so a bad render is caught before it is ever posted.

### Scheduler (`api/main.py`)

`CronTrigger(day_of_week='sat', hour=4, minute=30, timezone=_ET)`,
`max_instances=1`, gated on `CALENDAR_WEEK_POST_ENABLED=1` (default OFF).
Pinned to `America/New_York` so it stays 4:30 **local** across the DST flip
rather than drifting an hour in summer (`lesson_apscheduler_cron_utc_trap`).
The scheduled job always targets LIVE.

## Rollout

1. Ship with `CALENDAR_WEEK_POST_ENABLED` unset — everything inert.
2. `POST /api/calendar/post-week?target=test` → owner reviews the real post in
   the UCT Intelligence server.
3. Owner creates the #event-calendar webhook, sets
   `DISCORD_EVENT_CALENDAR_WEBHOOK_URL`, and confirms.
4. Set `CALENDAR_WEEK_POST_ENABLED=1`.

Rollback is unsetting one env var. No code change.

## Testing

- **Renderers:** dimensions, determinism (same input → identical bytes), the
  8-per-session cap, the `+N more` overflow count, empty-week card, a name whose
  logo is missing (monogram path).
- **Extraction:** `render_anticipated_png` output is byte-identical pre/post
  refactor.
- **Poster:** the empty-data guard blocks the post (mutation-checked — deleting
  the guard must fail the test); dedup blocks a second post for the same week;
  `target='live'` with the env unset refuses rather than falling back to admin;
  a webhook failure never raises.
- No test makes a network call or posts to a real webhook.

## Deliberately out of scope

- Editing/updating an already-posted message (post-once; no `attachments:[{id}]`
  edit gotcha to handle).
- Per-user personalization — this is one broadcast card for the whole server.
- Backfilling past weeks beyond what `?week=` already allows.

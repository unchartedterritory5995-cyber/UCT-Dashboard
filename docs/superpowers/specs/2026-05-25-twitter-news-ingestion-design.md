# Twitter News Ingestion — Design

**Date:** 2026-05-25
**Status:** Proposed (v1)
**Goal:** Scrape a curated set of Twitter accounts for single-stock catalyst news to enhance morning watchlist building, the Movers at Open sidebar, and the Earnings modal.

---

## Problem

The user trades from pre-market into the open. Today, MoversSidebar surfaces tickers gapping ≥3% but offers no context for *why* a stock is moving. EarningsModal shows AI-summarized financials but no real-time analyst/news reactions. Most morning catalyst news (M&A, FDA results, guidance, contract wins, halts, upgrades/downgrades, short reports) breaks first on Twitter via newswire-style accounts.

The user needs a way to:

1. Identify single-stock catalyst names from overnight + pre-market tweets, even before they appear in the gappers list.
2. See *why* a current gapper is moving, inline with the gainer/loser row.
3. See real-time analyst/news reactions inside the EarningsModal during the BMO and AMC report windows.

## Non-goals (v1)

- AI summarization of tweets.
- Per-user account customization (curated list is global).
- Plain-prose ticker extraction (only `$CASHTAG` matches).
- A standalone Twitter / Catalyst Feed page in the nav.
- Tweet-driven alerts (Discord/email notifications when a tracked account tweets).
- The TwitterAPI.io webhook/monitoring API path (tracked as a v2 evaluation item — see Approach C below).

## Account list (v1)

Four accounts, locked for shipping:

1. `@WallStEngine` (handle to be confirmed against `get_user_last_tweets` during smoke test — also commonly seen as `@WallStreetEngine`)
2. `@DeItaone`
3. `@FinancialJuice`
4. `@Benzinga`

Estimated cost at burst-window cadence: **$13–22/mo** (see Cost forecast below for breakdown). Admin Settings UI lets the user add/remove accounts post-deploy without redeploy.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Railway WEB service  (api/main.py — same place as COT scheduler)  │
│                                                                    │
│  APScheduler (shared with COT, weekly email digest, etc.)          │
│   ├── tweet_poll_burst    2 min, 4–9:30am ET + 3:30–7pm ET, Mon–Fri│
│   ├── tweet_poll_regular  15 min, 10am–3:15pm ET, Mon–Fri          │
│   ├── tweet_poll_slow     60 min, all hours (incl. overnight/wknd) │
│   └── tweet_cleanup       daily 3am ET                             │
│                                                                    │
│  Each poll:                                                        │
│    for handle in enabled_accounts():                               │
│        tweets = twitterapi_io.get_user_last_tweets(                │
│            handle, since_id=poll_state[handle].last_seen_tweet_id) │
│        for t in tweets:                                            │
│            tickers = extract_cashtags(t.text)                      │
│            tweet_store.upsert(t, tickers)                          │
│        poll_state.update(handle, latest_id, status='ok')           │
│                                                                    │
│  Storage: /data/tweets.db (SQLite, WAL) on web /data volume.       │
│  No R2 bridge — writes and reads co-located on the web service,    │
│  same pattern as /data/cot.db (api/services/cot_service.py).       │
│                                                                    │
│  Routes:                                                           │
│    GET  /api/tweets/ticker/{sym}?hours=24                          │
│    GET  /api/tweets/tape?hours=12&limit=15                         │
│    GET  /api/tweets/has-tweets-batch?tickers=A,B,C                 │
│    GET  /api/admin/twitter-accounts        (admin only)            │
│    POST /api/admin/twitter-accounts        (admin only)            │
│    PATCH/DELETE /api/admin/twitter-accounts/{handle} (admin only)  │
│    POST /api/admin/twitter-accounts/{handle}/force-poll (admin)    │
│    GET  /api/admin/twitter-stats           (admin only)            │
└─────────┬──────────────────────────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────────────────────────────────────┐
│  React frontend                                                    │
│    MoversSidebar  — 3 sections: RIPPING | DRILLING | ON THE TAPE   │
│                   + 🐦 icon on rows with tweets                    │
│    EarningsModal  — new collapsible "Recent tweets" section        │
│    Settings       — new admin-only "Twitter Accounts" TileCard     │
└────────────────────────────────────────────────────────────────────┘
```

### Approach selection

Three architectures were considered:

| | A: Worker polls → SQLite → web reads | B: On-demand fetch per request | C: TwitterAPI.io monitoring webhook |
|---|---|---|---|
| Freshness | ~2 min in burst windows | 5–15 min stale on hit | Real-time |
| Cost @ 4 accounts | $13–22/mo | scales w/ user count | unknown |
| Fits UCT pattern | Yes (mirrors bars / COT / breadth) | No | Net-new |

**Selected: A.** Polling runs on the web service in the existing APScheduler instance (same place as COT and the weekly email digest), writing directly to `/data/tweets.db` on the web volume. Predictable cost, decoupled from user count. We deliberately avoid the worker→R2→web pipeline that bars uses, because `data_sync.py` is hardcoded to `bars.db` and the tweet workload is small enough that co-located write/read on the web service is the correct fit (mirrors `cot_service.py`). C remains a v2 evaluation track — if monthly polling cost exceeds $30 or staleness becomes user-visible, research the monitoring/push API.

---

## Data model

SQLite database at `/data/tweets.db` on the web service's Railway volume. Single source — no cross-service replication.

```sql
CREATE TABLE tweets (
  id              TEXT PRIMARY KEY,         -- TwitterAPI.io tweet id (idempotent ingest)
  author_handle   TEXT NOT NULL,            -- "DeItaone" (no @, canonical case from API)
  author_name     TEXT,                     -- display name from API
  text            TEXT NOT NULL,
  created_at      INTEGER NOT NULL,         -- unix seconds UTC
  url             TEXT NOT NULL,            -- https://twitter.com/{h}/status/{id}
  reply_count     INTEGER DEFAULT 0,
  like_count      INTEGER DEFAULT 0,
  retweet_count   INTEGER DEFAULT 0,
  is_retweet      INTEGER DEFAULT 0,
  raw_json        TEXT,                     -- full API response (debug / schema evolution)
  ingested_at     INTEGER NOT NULL
);
CREATE INDEX idx_tweets_created ON tweets(created_at DESC);
CREATE INDEX idx_tweets_author  ON tweets(author_handle, created_at DESC);

CREATE TABLE tweet_tickers (
  tweet_id  TEXT NOT NULL,
  ticker    TEXT NOT NULL,
  PRIMARY KEY (tweet_id, ticker),
  FOREIGN KEY (tweet_id) REFERENCES tweets(id) ON DELETE CASCADE
);
CREATE INDEX idx_tt_ticker ON tweet_tickers(ticker);

CREATE TABLE twitter_accounts (
  handle           TEXT PRIMARY KEY,        -- "DeItaone" (no @)
  display_name     TEXT,
  added_at         INTEGER NOT NULL,
  added_by_user_id INTEGER,
  enabled          INTEGER DEFAULT 1,
  notes            TEXT
);

CREATE TABLE tweet_poll_state (
  handle             TEXT PRIMARY KEY,
  last_seen_tweet_id TEXT,                  -- for since_id pagination
  last_poll_at       INTEGER,
  last_poll_status   TEXT,                  -- 'ok' | 'auth_error' | 'out_of_credits' | 'rate_limited' | 'error'
  last_error         TEXT,
  total_tweets_seen  INTEGER DEFAULT 0,
  FOREIGN KEY (handle) REFERENCES twitter_accounts(handle) ON DELETE CASCADE
);
```

### Retention

7-day rolling window for tweets (configurable via `TWEET_RETENTION_DAYS` env var). Nightly `tweet_cleanup` job: `DELETE FROM tweets WHERE created_at < now − 7d` — cascades to `tweet_tickers`. Expected DB size: 4 accounts × ~100 tweets/day × 7 days ≈ 3K rows. Negligible.

### Cashtag extraction

```python
# api/services/tweet_ticker_extract.py
import re

CASHTAG_RE = re.compile(r"\$([A-Z]{1,5})\b")

# Forex pairs traders post as cashtags — we don't track these
FOREX_EXCLUDE = {"USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "HKD", "NZD"}

def extract_tickers(tweet_text: str) -> set[str]:
    raw = set(CASHTAG_RE.findall(tweet_text.upper()))
    return {t for t in raw if t not in FOREX_EXCLUDE}
```

- Keeps crypto cashtags (`$BTC`, `$ETH`, `$SOL`) — they're tradable.
- No universe validation in v1. Source accounts are professional; their cashtags are real tickers. False positives surface nothing (no join target on MoversSidebar / EarningsModal), so harm is zero.
- Retweets get cashtag-extracted and stored. `is_retweet=1` flag lets the UI de-emphasize them.

---

## Backend services & endpoints

### New service files

| File | Purpose |
|---|---|
| `api/services/twitterapi_io.py` | HTTP client. Single `x-api-key` header. Structured exceptions for 401/402/429/5xx. Base URL: `https://api.twitterapi.io`. |
| `api/services/tweet_ticker_extract.py` | Cashtag regex + forex exclude. |
| `api/services/tweet_store.py` | SQLite CRUD: tweet upsert + ticker links, query by ticker, tape window query, account CRUD, poll-state. Uses `bars_sqlite._WRITE_LOCK`-equivalent in-process lock for writes; reads stay lock-free under WAL. |
| `api/services/tweet_poller.py` | Orchestrator. For each enabled account, fetch via `since_id`, extract cashtags, upsert. Wraps `acquire_scheduler_lock('tweet_poll')` to prevent duplicate worker pods from double-polling. |
| `api/services/tweet_cleanup.py` | Retention sweep. |

### New routers

| File | Endpoint | Auth | Returns |
|---|---|---|---|
| `api/routers/tweets.py` | `GET /api/tweets/ticker/{sym}?hours=24` | logged-in | `[{id, author_handle, author_name, text, created_at, url, like_count, retweet_count, is_retweet}]` newest first |
| `api/routers/tweets.py` | `GET /api/tweets/tape?hours=12&limit=15` | logged-in | `[{ticker, latest_at, n_tweets, sample_tweet: {...}}]` — distinct tickers in window, excluding current MoversSidebar RIPPING/DRILLING symbols |
| `api/routers/tweets.py` | `GET /api/tweets/has-tweets-batch?tickers=A,B,C` | logged-in | `{A: 3, B: 0, C: 1}` — count per ticker in last 24h |
| `api/routers/admin_twitter.py` | `GET /api/admin/twitter-accounts` | admin | List with `last_poll_at`, `last_poll_status`, `total_tweets_seen` |
| `api/routers/admin_twitter.py` | `POST /api/admin/twitter-accounts` body `{handle, notes?}` | admin | Validates handle exists via TwitterAPI.io before persisting |
| `api/routers/admin_twitter.py` | `PATCH /api/admin/twitter-accounts/{handle}` body `{enabled?, notes?}` | admin | Updated row |
| `api/routers/admin_twitter.py` | `DELETE /api/admin/twitter-accounts/{handle}` | admin | Soft-disable (sets `enabled=0`) |
| `api/routers/admin_twitter.py` | `POST /api/admin/twitter-accounts/{handle}/force-poll` | admin | Triggers immediate poll for debugging |
| `api/routers/admin_twitter.py` | `GET /api/admin/twitter-stats` | admin | Aggregate stats + estimated MTD cost. Also triggers `_maybe_auto_refresh_if_stale()` (request-driven self-heal, 30-min cooldown). |

### Scheduler

Added to the existing APScheduler in `api/main.py` (web service) next to the COT and weekly-email-digest jobs. All `CronTrigger` in `America/New_York` timezone. Gated by `acquire_scheduler_lock()` which the existing scheduler already calls — our jobs piggyback on the same lock so multi-worker pods don't double-fire.

```python
# burst — every 2 min during high-value windows (pre-market gappers, AMC earnings)
scheduler.add_job(poll_all_accounts, CronTrigger(
    day_of_week="mon-fri", hour="4-9", minute="*/2", timezone=ET))
scheduler.add_job(poll_all_accounts, CronTrigger(
    day_of_week="mon-fri", hour="9", minute="30-58/2", timezone=ET))
scheduler.add_job(poll_all_accounts, CronTrigger(
    day_of_week="mon-fri", hour="15", minute="30-58/2", timezone=ET))
scheduler.add_job(poll_all_accounts, CronTrigger(
    day_of_week="mon-fri", hour="16-19", minute="*/2", timezone=ET))

# regular — 15 min, mid-day
scheduler.add_job(poll_all_accounts, CronTrigger(
    day_of_week="mon-fri", hour="10-15", minute="*/15", timezone=ET))

# slow — 60 min, all hours (catches overnight + weekend drops, and acts
# as a safety net if burst/regular jobs miss e.g. during a worker restart).
# Overlap with burst is intentional: duplicate calls cost ~$0 because
# `since_id` filtering returns 0 new tweets when nothing changed.
scheduler.add_job(poll_all_accounts, CronTrigger(
    hour="*/1", minute="0", timezone=ET))

# retention cleanup
scheduler.add_job(cleanup_old_tweets, CronTrigger(
    hour=3, minute=0, timezone=ET))
```

The existing `acquire_scheduler_lock()` call in `api/main.py` already gates the entire scheduler — our `add_job` calls live inside that same `if acquire_scheduler_lock():` block, so a single web pod owns the scheduler and no extra per-job locking is needed.

### Error handling

| Response | Action |
|---|---|
| `200` | Store tweets, update `last_seen_tweet_id`, `last_poll_status='ok'`. |
| `401` Unauthorized | `last_poll_status='auth_error'`, log loudly, do NOT retry until key changed. Fire `chart_health_alerts.emit('twitterapi_auth_failed', ...)`. |
| `402` Payment Required | All accounts → `last_poll_status='out_of_credits'`. Alert. Back off all polling for 1 hr. |
| `429` Rate Limited | Exponential backoff 60s → 120s → 240s, log, continue. |
| `5xx` / network | Retry with backoff (3 attempts). If all fail, `last_poll_status='error'`, try next scheduled tick. |

All errors land in `tweet_poll_state.last_error` so admin Settings UI renders per-account status pills.

### Cost telemetry

Per poll, `len(response.tweets)` is the billable count. Multiply by `$0.00015/tweet`, accumulate into `tweet_poll_state.total_tweets_seen`. `GET /api/admin/twitter-stats` returns MTD cost estimate so the user sees the bill before TwitterAPI.io emails it.

---

## Frontend changes

### MoversSidebar (`app/src/components/MoversSidebar.jsx`)

Add third section. Final layout:

```
🟢 RIPPING                           (existing, ≥3% gainers)
  NVDA   +5.2%   🐦                  ← icon if has tweets in last 24h
  PLTR   +4.1%

🔴 DRILLING                          (existing, ≤−3% losers)
  SOFI   −3.8%   🐦

📰 ON THE TAPE                       (NEW)
  ABBV   3 tweets · 7m ago
  ▸ "ABBV phase 3 results positive for…" — @DeItaone
  XYZ    1 tweet · 22m ago
  ▸ "..."
```

- **🐦 icon**: rendered when `useBatchTweetCounts(allMoverSymbols)` returns >0 for that ticker. Click → expands a panel below the row with the actual tweets.
- **ON THE TAPE rows**: ticker + tweet count + latest-mention age. Below, single-line preview of most recent tweet (truncated ~80 chars). Click ticker → opens TickerPopup (consistent with the rest of MoversSidebar). Click preview → opens tweet on x.com new tab.
- **Polling cadence**: 30s SWR, same as the existing movers feed.
- **Cap "On the Tape" at 15 rows.** Sorted by latest mention.

### EarningsModal (`app/src/components/tiles/EarningsModal.jsx`)

New collapsible section below the existing AI analysis box:

```
─────────────────────────────────────────
🐦 Recent tweets (5)            [collapse]
─────────────────────────────────────────
@DeItaone · 2h ago
$PLTR reports Q4 EPS $0.14 vs $0.11 est,
raises FY25 guidance, shares +8% AH      ← cashtags styled gold
[link → tweet]

@Benzinga · 1h ago
Palantir CEO tells CNBC the Pentagon...
```

- Fetched once on modal open via `useTickerTweets(sym, hours=24)`. No polling.
- Hides cleanly when zero tweets (no empty state — same pattern as the existing transcript section).
- Default expanded if ≤5 tweets, collapsed if >5.

### Settings — admin-only "Twitter Accounts" TileCard

Lives in `app/src/pages/Settings.jsx`, gated by `user.role === 'admin'`.

```
TWITTER ACCOUNTS
────────────────────────────────────────────
Curated list (4 active)

DeItaone        ✓ OK 2m ago    12 tweets/24h   [✏] [✕]
FinancialJuice  ✓ OK 2m ago     8 tweets/24h   [✏] [✕]
Benzinga        ✓ OK 2m ago    35 tweets/24h   [✏] [✕]
WallStEngine    ✗ auth_error                   [✏] [✕]

[+ Add account]   handle: ___________  notes: ___________

────────────────────────────────────────────
Last 24h: $0.42 · MTD: $8.30 · TwitterAPI.io credits: $11.70
```

- ✕ → soft-disable.
- ✏ → inline notes edit ("Why this account: …").
- + Add account → POST validates handle via TwitterAPI.io before persisting.
- Status pills: green=ok, amber=rate_limited, red=auth_error / out_of_credits.

### New React hooks

```javascript
// app/src/hooks/useTickerTweets.js
//   GET /api/tweets/ticker/{sym}?hours=24
//   used by EarningsModal on open + MoversSidebar 🐦-expanded rows

// app/src/hooks/useTapeFeed.js
//   GET /api/tweets/tape?hours=12&limit=15
//   used by MoversSidebar "ON THE TAPE" section, 30s SWR poll

// app/src/hooks/useBatchTweetCounts.js
//   GET /api/tweets/has-tweets-batch?tickers=A,B,C
//   used by MoversSidebar to render 🐦 icons in single fetch
//   30s SWR poll, debounced 500ms when ticker set changes
```

### Visual / styling

- Cashtags in tweet text styled `color: var(--color-accent-gold)` — matches existing brand gold from the cinematic intro animation.
- "ON THE TAPE" header gets 📰 emoji + amber accent.
- Relative timestamps via the existing inline `timeAgo()` helper in `app/src/components/AlertBell.jsx`. Extract into a shared util (`app/src/utils/timeAgo.js`) as part of Phase 3 so MoversSidebar + EarningsModal + AlertBell all import the same function. No new npm dependency (project does not use `date-fns` / `dayjs` / `moment`).
- Mobile: "ON THE TAPE" still renders inside the MoversSidebar drawer; same 15-row cap.

---

## Env vars

```bash
TWITTERAPI_IO_API_KEY=<key from twitterapi.io dashboard>
TWITTERAPI_IO_ENABLED=1            # master switch for polling worker
TWITTER_UI_ENABLED=1               # master switch for frontend surfaces
TWEET_RETENTION_DAYS=7
TWEET_POLL_TIMEOUT_SECONDS=10
TWEET_POLL_MAX_RETRIES=3
```

---

## Testing strategy

| Layer | Test | File |
|---|---|---|
| TwitterAPI.io client | Smoke test (real key) — verifies endpoint, auth header, response shape | `tools/twitterapi_io_smoke_test.py` (manual, gitignored output) |
| TwitterAPI.io client | Unit — mock HTTP, verify 401/402/429/5xx exception types | `tests/test_twitterapi_io.py` |
| Cashtag extraction | Unit — golden fixtures (real tweets), edge cases (forex, crypto, plain text, RT, emoji, `$1` not matched) | `tests/test_tweet_ticker_extract.py` |
| `tweet_store` | Unit — upsert idempotency, ticker many-to-many, retention sweep, account CRUD, poll-state | `tests/test_tweet_store.py` |
| `tweet_poller` | Integration — mock TwitterAPI.io, run 1 cycle, assert since_id passed, tweets stored, poll-state updated | `tests/test_tweet_poller.py` |
| Routers | API — auth gates, response shapes, batch endpoint, tape excludes current movers | `tests/test_tweets_router.py` + `tests/test_admin_twitter_router.py` |
| Frontend hooks | Vitest — SWR behavior for the 3 hooks | `app/src/hooks/__tests__/*.test.js` |
| MoversSidebar | Vitest — 3 sections render, 🐦 icons appear, "ON THE TAPE" excludes RIPPING/DRILLING | `app/src/components/__tests__/MoversSidebar.test.jsx` |

---

## Rollout sequence

Matches `feedback_ship_then_polish` — phases run end-to-end then polish.

1. **Pre-flight: smoke test.** Run `tools/twitterapi_io_smoke_test.py` locally with the API key. Confirm endpoint URL, auth header, response shape, and that `@WallStEngine` is the correct handle (vs `@WallStreetEngine`). Catches mismatches before Railway commits.
2. **Phase 1: ingestion live, no UI.** Ship backend (schema + services + poller + admin endpoints) gated by `TWITTERAPI_IO_ENABLED=1`. Worker polls, tweets land in SQLite. Verify via `/api/admin/twitter-stats`. No user-visible change.
3. **Phase 2: Settings admin card.** Ship the TileCard so the user can monitor accounts + cost without SSH.
4. **Phase 3: MoversSidebar surfaces.** Ship 🐦 icons + "ON THE TAPE" section. Gated by `TWITTER_UI_ENABLED=1` for instant toggle-off.
5. **Phase 4: EarningsModal section.** Ship tweet section in modal.
6. **Phase 5: polish pass.** Cashtag styling, RT collapse, preview truncation, mobile breakpoints.

Each phase = its own commit + push to Railway.

---

## Operational gotchas

- **No R2 / cross-service replication.** Polling and serving run on the same web service pod; storage is `/data/tweets.db` on the web volume. This is intentional — adding tweets to the bars R2 pipeline would require refactoring `data_sync.py` (hardcoded to `bars.db`) for no real benefit at this scale.
- **`acquire_scheduler_lock()`** — already called by the existing scheduler in `api/main.py`. Our `add_job` calls slot inside that same block. Also implement request-driven self-heal in `GET /api/admin/twitter-stats` (mirror of `_maybe_auto_refresh_if_stale()` from `cot_service.py`): if no successful poll in last 30 min, kick a background refresh.
- **`since_id`** — must be the latest id seen *for that account*, stored per-account in `tweet_poll_state`. Don't conflate across accounts.
- **Handle case sensitivity** — TwitterAPI.io may or may not be case-sensitive. Smoke test will verify. Store handles in canonical case (whatever the API returns) to avoid duplicate rows.
- **Tweet text URLs** — TwitterAPI.io likely returns t.co shortlinks. We display tweets as-is; the per-tweet link icon points to the full status URL.
- **Partner-collab safety** (`project_partner_collab_branch` memory) — none of the touched files (MoversSidebar, EarningsModal, Settings.jsx) are partner-edited. Safe to modify directly.
- **Free-tier visibility** — MoversSidebar is on the free Dashboard and EarningsModal is on the free Calendar. Tweets will be visible to all logged-in users. Cost is unaffected (polling is centralized, not per-user).

---

## Cost forecast

- 4 accounts × ~30 polls/day during burst windows + 30 polls/day during regular + 24 polls/day overnight ≈ 84 polls/day per account = 336 polls/day total
- Each poll returns ~5–10 new tweets (with `since_id` filtering) outside burst windows; up to 20 during burst
- ~3,000–5,000 tweets/day at peak ≈ 90K–150K tweets/month
- @ $0.15/1K tweets = **$13–22/mo**

Cost telemetry is built in (`/api/admin/twitter-stats`) so reality will be measurable from day 2 of operation.

---

## Open questions / v2 candidates

- **TwitterAPI.io monitoring/webhook API (Approach C).** If monthly cost > $30 or staleness becomes user-visible, evaluate switching to push-based delivery.
- **AI summarization** for EarningsModal when >3 tweets exist for a ticker (Claude Haiku ~$2–5/mo).
- **Plain-prose ticker extraction** if cashtag-only miss rate is observably high during the first month of operation.
- **Tweet-driven alerts** — Discord/email when a tracked account tweets a ticker on the user's watchlist.
- **Per-user account lists** — if the user wants to follow accounts the team shouldn't pay to track globally.

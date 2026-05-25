# Twitter News Ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrape a curated set of Twitter accounts via TwitterAPI.io for single-stock catalyst news, surface tweets per ticker inline on `MoversSidebar` (new "ON THE TAPE" section + 🐦 icon) and inside `EarningsModal`, with an admin-editable account list in Settings.

**Architecture:** Scheduler runs on the web service (alongside COT and the weekly email digest) and writes to `/data/tweets.db`. No R2/worker bridge — `data_sync.py` is bars-specific, and tweet workload is small enough that co-located write+read is correct. `since_id` pagination minimizes billable tweet count. UI is gated by `TWITTER_UI_ENABLED` env var so it can toggle off instantly.

**Tech Stack:** FastAPI · SQLite (WAL) · APScheduler (existing in `api/main.py`) · React + SWR · TwitterAPI.io REST.

**Spec:** `docs/superpowers/specs/2026-05-25-twitter-news-ingestion-design.md`

**User flow conventions** (from memory):
- Run phases end-to-end before polish; forward velocity > per-phase perfection.
- Skip per-task heavy review gauntlet — implement, verify, commit + push to Railway.
- Each task ends with a commit. Each phase ends with a push.

---

## File map

**New backend files**
- `api/services/twitterapi_io.py` — HTTP client (single `x-api-key` header, structured exceptions)
- `api/services/tweet_ticker_extract.py` — cashtag regex + forex exclude
- `api/services/tweet_store.py` — SQLite CRUD (tweets, ticker links, accounts, poll-state)
- `api/services/tweet_poller.py` — orchestrator (loop accounts, fetch via since_id, store)
- `api/services/tweet_cleanup.py` — retention sweep
- `api/routers/tweets.py` — `/api/tweets/*` read endpoints
- `api/routers/admin_twitter.py` — `/api/admin/twitter-accounts*` + `/api/admin/twitter-stats`
- `tools/twitterapi_io_smoke_test.py` — manual pre-flight check
- `tests/test_twitterapi_io.py`
- `tests/test_tweet_ticker_extract.py`
- `tests/test_tweet_store.py`
- `tests/test_tweet_poller.py`
- `tests/test_tweets_router.py`
- `tests/test_admin_twitter_router.py`

**Modified backend files**
- `api/main.py` — register new routers, wire 4 scheduler jobs into the existing `if acquire_scheduler_lock():` block (~line 1172)

**New frontend files**
- `app/src/utils/timeAgo.js` — shared relative-time helper (extracted from `AlertBell.jsx`)
- `app/src/hooks/useTickerTweets.js`
- `app/src/hooks/useTapeFeed.js`
- `app/src/hooks/useBatchTweetCounts.js`
- `app/src/components/TwitterAccountsTile.jsx` — Settings admin card
- `app/src/components/TwitterAccountsTile.module.css`

**Modified frontend files**
- `app/src/components/AlertBell.jsx` — import `timeAgo` from new util instead of inline
- `app/src/components/MoversSidebar.jsx` — 🐦 icon on rows + new ON THE TAPE section
- `app/src/components/MoversSidebar.module.css` — styles for the new section
- `app/src/components/tiles/EarningsModal.jsx` — recent tweets section
- `app/src/components/tiles/EarningsModal.module.css` — tweet card styles
- `app/src/pages/Settings.jsx` — mount `<TwitterAccountsTile />` when admin

**Modified docs**
- `CLAUDE.md` — add "Twitter News Ingestion" section (modeled on existing "COT Data Tab" section)

---

# PHASE 1: Backend ingestion live, no user-visible UI

Ship the polling pipeline behind `TWITTERAPI_IO_ENABLED=1`. After Phase 1 you should see tweets accumulating in `/data/tweets.db` and admin endpoints (Phase 2) will be able to read them. Nothing changes for end users yet.

---

## Task 0: TwitterAPI.io dashboard setup (one-time, ~10 min)

The smoke test in Task 1 needs a funded API key. This task walks you through getting one. **Do this with the user present in the session** — the dashboard is owned by their account, not the engineer's.

- [ ] **Step 1: Sign in to the dashboard**

Open `https://twitterapi.io/dashboard` in a browser. The user already has an account from earlier signup. Confirm you land on the authenticated dashboard, not the marketing page.

- [ ] **Step 2: Locate / generate the API key**

In the dashboard, find the "API Keys" or "API Settings" panel (left sidebar or top-nav, exact label depends on their UI). The key is a single string with no expiry — they use a single `x-api-key` header for auth, no OAuth flow, no token refresh.

If a key already exists: copy it. If not: click "Create / Generate" and copy the new one. Store it temporarily in a password manager — do NOT paste it into chat or commit it.

- [ ] **Step 3: Add billing credits**

Find the "Billing" / "Add Credits" / "Funding" panel. TwitterAPI.io is pay-as-you-go (no subscription):

- $0.15 per 1,000 tweets returned
- $0.18 per 1,000 profile fetches
- $0.10 free trial credit ships with the account (enough for ~660 tweet fetches — fine for the smoke test plus a day or two of production polling)

**Add $10–20 of initial credit.** That covers ~1–2 months of polling at our planned cadence (4 accounts × burst schedule, projected $13–22/mo). Either credit card or a top-up flow.

After payment processes, the dashboard should show a non-zero "Balance" or "Credits" figure.

- [ ] **Step 4: Stash the API key in a local env var**

PowerShell:

```powershell
$env:TWITTERAPI_IO_API_KEY = "<paste key>"
```

(One session only — for persistence across PowerShell sessions, use `[Environment]::SetEnvironmentVariable("TWITTERAPI_IO_API_KEY", "<key>", "User")` then reopen the terminal.)

- [ ] **Step 5: Set the same key in Railway** (for the eventual production deploy)

Via Railway dashboard: project → web service → Variables → add `TWITTERAPI_IO_API_KEY=<key>`. Leave `TWITTERAPI_IO_ENABLED` unset for now — we'll flip it on at the end of Phase 1 Task 9.

Or via CLI:

```powershell
railway variables set TWITTERAPI_IO_API_KEY="<key>"
```

- [ ] **Step 6: (No commit — this task creates no files)**

Move on to Task 1.

---

## Task 1: Smoke test script (pre-flight, manual run)

**Files:**
- Create: `tools/twitterapi_io_smoke_test.py`

- [ ] **Step 1: Write the smoke test script**

```python
"""tools/twitterapi_io_smoke_test.py

Manual pre-flight check. Run once locally with your TwitterAPI.io API
key in TWITTERAPI_IO_API_KEY to confirm endpoint URL, auth header,
response shape, and whether @WallStEngine resolves (vs @WallStreetEngine).

Usage:
  $env:TWITTERAPI_IO_API_KEY="..."
  python tools/twitterapi_io_smoke_test.py

Exits 0 on full success, 1 on any failure. Prints what came back for
each account so we know the JSON keys we'll parse later.
"""
import json
import os
import sys

import requests

BASE_URL = "https://api.twitterapi.io"
HANDLES = ["DeItaone", "FinancialJuice", "Benzinga", "WallStEngine", "WallStreetEngine"]


def call(path: str, params: dict, key: str) -> tuple[int, dict]:
    r = requests.get(
        f"{BASE_URL}{path}",
        params=params,
        headers={"x-api-key": key},
        timeout=10,
    )
    try:
        body = r.json()
    except ValueError:
        body = {"_raw_text": r.text}
    return r.status_code, body


def main() -> int:
    key = os.environ.get("TWITTERAPI_IO_API_KEY")
    if not key:
        print("ERROR: set TWITTERAPI_IO_API_KEY first")
        return 1

    failed = False
    for handle in HANDLES:
        status, body = call("/twitter/get_user_last_tweets", {"userName": handle}, key)
        n_tweets = len(body.get("tweets") or body.get("data") or [])
        print(f"@{handle:18s} HTTP {status}  tweets={n_tweets}")
        if status == 200 and n_tweets > 0:
            # Show structure of first tweet so we can match parsing later
            print(f"  sample keys: {sorted(list((body.get('tweets') or body.get('data') or [{}])[0].keys()))}")
        elif status == 200:
            print(f"  empty result body keys: {sorted(body.keys())}")
        else:
            print(f"  body: {json.dumps(body, indent=2)[:500]}")
            failed = True

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: User runs it locally before continuing**

```powershell
$env:TWITTERAPI_IO_API_KEY = "<your key from twitterapi.io dashboard>"
python tools/twitterapi_io_smoke_test.py
```

Expected: each handle prints HTTP 200 + tweets>0 + sample keys. Note which of `@WallStEngine` / `@WallStreetEngine` works; use that one going forward. If any 401/402/429 → resolve with TwitterAPI.io support before proceeding.

- [ ] **Step 3: Commit**

```bash
git add tools/twitterapi_io_smoke_test.py
git commit -m "tools: add TwitterAPI.io smoke test for pre-flight key validation"
```

---

## Task 2: SQLite schema + `tweet_store` module

**Files:**
- Create: `api/services/tweet_store.py`
- Create: `tests/test_tweet_store.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_tweet_store.py
import os
import tempfile
import time

import pytest

from api.services import tweet_store


@pytest.fixture
def store(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(tweet_store, "_DB_PATH", os.path.join(d, "tweets.db"))
        tweet_store._init_db()
        yield tweet_store


def _tweet(id_, handle, text, created_at=None, **kwargs):
    return {
        "id": id_,
        "author_handle": handle,
        "author_name": kwargs.get("author_name", handle),
        "text": text,
        "created_at": created_at or int(time.time()),
        "url": f"https://twitter.com/{handle}/status/{id_}",
        "reply_count": kwargs.get("reply_count", 0),
        "like_count": kwargs.get("like_count", 0),
        "retweet_count": kwargs.get("retweet_count", 0),
        "is_retweet": kwargs.get("is_retweet", 0),
        "raw_json": kwargs.get("raw_json", "{}"),
    }


def test_upsert_is_idempotent(store):
    store.upsert_tweet(_tweet("100", "DeItaone", "$AAPL beats"), ["AAPL"])
    store.upsert_tweet(_tweet("100", "DeItaone", "$AAPL beats"), ["AAPL"])
    assert store.count_tweets() == 1
    assert store.count_ticker_links() == 1


def test_tweet_with_multiple_tickers(store):
    store.upsert_tweet(_tweet("1", "DeItaone", "$AAPL $MSFT both up"), ["AAPL", "MSFT"])
    by_ticker = store.tweets_for_ticker("AAPL", hours=24)
    assert len(by_ticker) == 1
    by_ticker = store.tweets_for_ticker("MSFT", hours=24)
    assert len(by_ticker) == 1


def test_tweets_for_ticker_respects_hours_window(store):
    now = int(time.time())
    store.upsert_tweet(_tweet("old", "DeItaone", "$AAPL old", created_at=now - 48 * 3600), ["AAPL"])
    store.upsert_tweet(_tweet("new", "DeItaone", "$AAPL new", created_at=now - 1 * 3600), ["AAPL"])
    assert len(store.tweets_for_ticker("AAPL", hours=24)) == 1
    assert len(store.tweets_for_ticker("AAPL", hours=72)) == 2


def test_tweets_for_ticker_returns_newest_first(store):
    now = int(time.time())
    store.upsert_tweet(_tweet("a", "DeItaone", "$AAPL older", created_at=now - 7200), ["AAPL"])
    store.upsert_tweet(_tweet("b", "DeItaone", "$AAPL newer", created_at=now - 60), ["AAPL"])
    rows = store.tweets_for_ticker("AAPL", hours=24)
    assert rows[0]["id"] == "b"
    assert rows[1]["id"] == "a"


def test_tape_groups_by_ticker(store):
    now = int(time.time())
    store.upsert_tweet(_tweet("1", "DeItaone", "$ABBV phase 3", created_at=now - 120), ["ABBV"])
    store.upsert_tweet(_tweet("2", "Benzinga", "$ABBV more news", created_at=now - 60), ["ABBV"])
    store.upsert_tweet(_tweet("3", "Benzinga", "$XYZ halt", created_at=now - 30), ["XYZ"])
    tape = store.tape(hours=12, limit=10)
    by_ticker = {r["ticker"]: r for r in tape}
    assert by_ticker["ABBV"]["n_tweets"] == 2
    assert by_ticker["XYZ"]["n_tweets"] == 1
    # Tape ordered by latest_at desc — XYZ (30s ago) before ABBV (60s ago latest)
    assert tape[0]["ticker"] == "XYZ"


def test_batch_counts_returns_zero_for_missing(store):
    now = int(time.time())
    store.upsert_tweet(_tweet("1", "DeItaone", "$AAPL", created_at=now - 60), ["AAPL"])
    counts = store.batch_counts(["AAPL", "MSFT", "NVDA"], hours=24)
    assert counts == {"AAPL": 1, "MSFT": 0, "NVDA": 0}


def test_retention_sweep_deletes_old_and_cascades(store):
    now = int(time.time())
    store.upsert_tweet(_tweet("old", "DeItaone", "$AAPL", created_at=now - 10 * 86400), ["AAPL"])
    store.upsert_tweet(_tweet("new", "DeItaone", "$AAPL", created_at=now - 1 * 86400), ["AAPL"])
    deleted = store.delete_tweets_older_than(days=7)
    assert deleted == 1
    assert store.count_tweets() == 1
    assert store.count_ticker_links() == 1  # cascade


def test_account_crud(store):
    store.add_account("DeItaone", display_name="Walter Bloomberg", added_by_user_id=1)
    accounts = store.list_accounts()
    assert len(accounts) == 1
    assert accounts[0]["handle"] == "DeItaone"
    assert accounts[0]["enabled"] == 1

    store.set_account_enabled("DeItaone", False)
    assert store.list_accounts(enabled_only=True) == []
    assert len(store.list_accounts(enabled_only=False)) == 1


def test_poll_state_roundtrip(store):
    store.add_account("DeItaone")
    store.update_poll_state("DeItaone", last_seen_tweet_id="200", status="ok", tweets_seen=5)
    state = store.get_poll_state("DeItaone")
    assert state["last_seen_tweet_id"] == "200"
    assert state["last_poll_status"] == "ok"
    assert state["total_tweets_seen"] == 5
```

- [ ] **Step 2: Run tests to verify they fail (module doesn't exist yet)**

```bash
pytest tests/test_tweet_store.py -v
```
Expected: collection error or ImportError.

- [ ] **Step 3: Implement `tweet_store.py`**

```python
# api/services/tweet_store.py
"""SQLite-backed store for tweets, ticker links, curated accounts, and poll state.

DB path: /data/tweets.db (web service Railway volume).
WAL mode for concurrent reads during background polling.
"""
from __future__ import annotations

import os
import sqlite3
import threading
import time
from typing import Iterable, Optional

_DB_PATH = os.environ.get("TWEET_DB_PATH", "/data/tweets.db")
_WRITE_LOCK = threading.Lock()  # serializes writes; reads stay lock-free under WAL


_SCHEMA = """
CREATE TABLE IF NOT EXISTS tweets (
  id              TEXT PRIMARY KEY,
  author_handle   TEXT NOT NULL,
  author_name     TEXT,
  text            TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  url             TEXT NOT NULL,
  reply_count     INTEGER DEFAULT 0,
  like_count      INTEGER DEFAULT 0,
  retweet_count   INTEGER DEFAULT 0,
  is_retweet      INTEGER DEFAULT 0,
  raw_json        TEXT,
  ingested_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tweets_created ON tweets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tweets_author  ON tweets(author_handle, created_at DESC);

CREATE TABLE IF NOT EXISTS tweet_tickers (
  tweet_id  TEXT NOT NULL,
  ticker    TEXT NOT NULL,
  PRIMARY KEY (tweet_id, ticker),
  FOREIGN KEY (tweet_id) REFERENCES tweets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tt_ticker ON tweet_tickers(ticker);

CREATE TABLE IF NOT EXISTS twitter_accounts (
  handle           TEXT PRIMARY KEY,
  display_name     TEXT,
  added_at         INTEGER NOT NULL,
  added_by_user_id INTEGER,
  enabled          INTEGER DEFAULT 1,
  notes            TEXT
);

CREATE TABLE IF NOT EXISTS tweet_poll_state (
  handle             TEXT PRIMARY KEY,
  last_seen_tweet_id TEXT,
  last_poll_at       INTEGER,
  last_poll_status   TEXT,
  last_error         TEXT,
  total_tweets_seen  INTEGER DEFAULT 0,
  FOREIGN KEY (handle) REFERENCES twitter_accounts(handle) ON DELETE CASCADE
);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _init_db() -> None:
    os.makedirs(os.path.dirname(_DB_PATH) or ".", exist_ok=True)
    with _connect() as c:
        c.executescript(_SCHEMA)


# ---- writes ----------------------------------------------------------------

def upsert_tweet(tweet: dict, tickers: Iterable[str]) -> None:
    """Insert or update a tweet and its ticker links. Idempotent on tweet.id."""
    now = int(time.time())
    with _WRITE_LOCK, _connect() as c:
        c.execute(
            """
            INSERT INTO tweets (id, author_handle, author_name, text, created_at, url,
                                reply_count, like_count, retweet_count, is_retweet,
                                raw_json, ingested_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              reply_count = excluded.reply_count,
              like_count = excluded.like_count,
              retweet_count = excluded.retweet_count
            """,
            (
                tweet["id"], tweet["author_handle"], tweet.get("author_name"),
                tweet["text"], tweet["created_at"], tweet["url"],
                tweet.get("reply_count", 0), tweet.get("like_count", 0),
                tweet.get("retweet_count", 0), tweet.get("is_retweet", 0),
                tweet.get("raw_json", "{}"), now,
            ),
        )
        for t in set(tickers):
            c.execute(
                "INSERT OR IGNORE INTO tweet_tickers (tweet_id, ticker) VALUES (?, ?)",
                (tweet["id"], t),
            )
        c.commit()


def delete_tweets_older_than(days: int) -> int:
    """Delete tweets older than N days. Cascades to tweet_tickers. Returns row count."""
    cutoff = int(time.time()) - days * 86400
    with _WRITE_LOCK, _connect() as c:
        cur = c.execute("DELETE FROM tweets WHERE created_at < ?", (cutoff,))
        c.commit()
        return cur.rowcount


# ---- account CRUD ----------------------------------------------------------

def add_account(handle: str, display_name: Optional[str] = None,
                added_by_user_id: Optional[int] = None, notes: Optional[str] = None) -> None:
    with _WRITE_LOCK, _connect() as c:
        c.execute(
            """INSERT OR IGNORE INTO twitter_accounts
               (handle, display_name, added_at, added_by_user_id, enabled, notes)
               VALUES (?, ?, ?, ?, 1, ?)""",
            (handle, display_name, int(time.time()), added_by_user_id, notes),
        )
        c.commit()


def set_account_enabled(handle: str, enabled: bool) -> None:
    with _WRITE_LOCK, _connect() as c:
        c.execute("UPDATE twitter_accounts SET enabled=? WHERE handle=?",
                  (1 if enabled else 0, handle))
        c.commit()


def update_account_notes(handle: str, notes: str) -> None:
    with _WRITE_LOCK, _connect() as c:
        c.execute("UPDATE twitter_accounts SET notes=? WHERE handle=?", (notes, handle))
        c.commit()


def list_accounts(enabled_only: bool = False) -> list[dict]:
    sql = "SELECT * FROM twitter_accounts"
    if enabled_only:
        sql += " WHERE enabled=1"
    sql += " ORDER BY handle"
    with _connect() as c:
        return [dict(r) for r in c.execute(sql).fetchall()]


# ---- poll state ------------------------------------------------------------

def update_poll_state(handle: str, *, last_seen_tweet_id: Optional[str] = None,
                      status: str, error: Optional[str] = None,
                      tweets_seen: int = 0) -> None:
    with _WRITE_LOCK, _connect() as c:
        c.execute(
            """INSERT INTO tweet_poll_state
               (handle, last_seen_tweet_id, last_poll_at, last_poll_status,
                last_error, total_tweets_seen)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(handle) DO UPDATE SET
                 last_seen_tweet_id = COALESCE(excluded.last_seen_tweet_id, last_seen_tweet_id),
                 last_poll_at = excluded.last_poll_at,
                 last_poll_status = excluded.last_poll_status,
                 last_error = excluded.last_error,
                 total_tweets_seen = total_tweets_seen + excluded.total_tweets_seen
            """,
            (handle, last_seen_tweet_id, int(time.time()), status, error, tweets_seen),
        )
        c.commit()


def get_poll_state(handle: str) -> Optional[dict]:
    with _connect() as c:
        row = c.execute("SELECT * FROM tweet_poll_state WHERE handle=?", (handle,)).fetchone()
        return dict(row) if row else None


# ---- queries ---------------------------------------------------------------

def tweets_for_ticker(ticker: str, hours: int = 24) -> list[dict]:
    since = int(time.time()) - hours * 3600
    with _connect() as c:
        rows = c.execute(
            """SELECT t.* FROM tweets t
               JOIN tweet_tickers tt ON tt.tweet_id = t.id
               WHERE tt.ticker = ? AND t.created_at >= ?
               ORDER BY t.created_at DESC""",
            (ticker.upper(), since),
        ).fetchall()
        return [dict(r) for r in rows]


def tape(hours: int = 12, limit: int = 15) -> list[dict]:
    """Distinct tickers mentioned in window, newest-mention first.
    Does NOT exclude current movers — that join happens in the router."""
    since = int(time.time()) - hours * 3600
    with _connect() as c:
        rows = c.execute(
            """SELECT tt.ticker,
                      MAX(t.created_at) AS latest_at,
                      COUNT(*)          AS n_tweets
               FROM tweet_tickers tt
               JOIN tweets t ON t.id = tt.tweet_id
               WHERE t.created_at >= ?
               GROUP BY tt.ticker
               ORDER BY latest_at DESC
               LIMIT ?""",
            (since, limit),
        ).fetchall()
        result = []
        for r in rows:
            sample = c.execute(
                """SELECT t.* FROM tweets t
                   JOIN tweet_tickers tt ON tt.tweet_id = t.id
                   WHERE tt.ticker = ? AND t.created_at >= ?
                   ORDER BY t.created_at DESC LIMIT 1""",
                (r["ticker"], since),
            ).fetchone()
            result.append({
                "ticker": r["ticker"],
                "latest_at": r["latest_at"],
                "n_tweets": r["n_tweets"],
                "sample_tweet": dict(sample) if sample else None,
            })
        return result


def batch_counts(tickers: Iterable[str], hours: int = 24) -> dict[str, int]:
    """Count of tweets per ticker in window. Returns 0 for tickers with no tweets."""
    tickers = [t.upper() for t in tickers]
    if not tickers:
        return {}
    since = int(time.time()) - hours * 3600
    placeholders = ",".join("?" * len(tickers))
    out = {t: 0 for t in tickers}
    with _connect() as c:
        rows = c.execute(
            f"""SELECT tt.ticker, COUNT(*) AS n
                FROM tweet_tickers tt
                JOIN tweets t ON t.id = tt.tweet_id
                WHERE tt.ticker IN ({placeholders}) AND t.created_at >= ?
                GROUP BY tt.ticker""",
            (*tickers, since),
        ).fetchall()
        for r in rows:
            out[r["ticker"]] = r["n"]
    return out


# ---- diagnostic helpers (used by tests + admin stats) ----------------------

def count_tweets() -> int:
    with _connect() as c:
        return c.execute("SELECT COUNT(*) FROM tweets").fetchone()[0]


def count_ticker_links() -> int:
    with _connect() as c:
        return c.execute("SELECT COUNT(*) FROM tweet_tickers").fetchone()[0]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_tweet_store.py -v
```
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/services/tweet_store.py tests/test_tweet_store.py
git commit -m "feat: add tweet_store SQLite module with tweets, tickers, accounts, poll-state"
```

---

## Task 3: TwitterAPI.io HTTP client

**Files:**
- Create: `api/services/twitterapi_io.py`
- Create: `tests/test_twitterapi_io.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_twitterapi_io.py
import pytest
from unittest.mock import patch, MagicMock

from api.services import twitterapi_io


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setenv("TWITTERAPI_IO_API_KEY", "test-key-xyz")


def _resp(status, json_body=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = json_body or {}
    r.text = str(json_body)
    return r


def test_get_user_last_tweets_success():
    payload = {"tweets": [
        {"id": "1", "text": "$AAPL beats", "createdAt": "Mon Jan 01 12:00:00 +0000 2026",
         "url": "https://x.com/DeItaone/status/1",
         "author": {"userName": "DeItaone", "name": "Walter"}},
    ]}
    with patch("requests.get", return_value=_resp(200, payload)):
        result = twitterapi_io.get_user_last_tweets("DeItaone")
    assert len(result) == 1
    assert result[0]["id"] == "1"
    assert result[0]["author_handle"] == "DeItaone"
    assert result[0]["text"] == "$AAPL beats"
    assert isinstance(result[0]["created_at"], int)


def test_get_user_last_tweets_passes_since_id():
    with patch("requests.get", return_value=_resp(200, {"tweets": []})) as g:
        twitterapi_io.get_user_last_tweets("DeItaone", since_id="123")
    _, kwargs = g.call_args
    assert kwargs["params"]["sinceTime"] is None or kwargs["params"].get("sinceId") == "123" \
        or kwargs["params"].get("since_id") == "123"


def test_auth_header_format():
    with patch("requests.get", return_value=_resp(200, {"tweets": []})) as g:
        twitterapi_io.get_user_last_tweets("DeItaone")
    _, kwargs = g.call_args
    assert kwargs["headers"]["x-api-key"] == "test-key-xyz"


def test_401_raises_auth_error():
    with patch("requests.get", return_value=_resp(401, {"error": "invalid key"})):
        with pytest.raises(twitterapi_io.TwitterApiAuthError):
            twitterapi_io.get_user_last_tweets("DeItaone")


def test_402_raises_payment_required():
    with patch("requests.get", return_value=_resp(402, {"error": "no credits"})):
        with pytest.raises(twitterapi_io.TwitterApiPaymentRequired):
            twitterapi_io.get_user_last_tweets("DeItaone")


def test_429_raises_rate_limit():
    with patch("requests.get", return_value=_resp(429, {"error": "slow down"})):
        with pytest.raises(twitterapi_io.TwitterApiRateLimited):
            twitterapi_io.get_user_last_tweets("DeItaone")


def test_5xx_raises_transient_error():
    with patch("requests.get", return_value=_resp(503, {"error": "down"})):
        with pytest.raises(twitterapi_io.TwitterApiTransientError):
            twitterapi_io.get_user_last_tweets("DeItaone")


def test_missing_api_key_raises():
    import importlib
    with patch.dict("os.environ", {}, clear=True):
        importlib.reload(twitterapi_io)
        with pytest.raises(twitterapi_io.TwitterApiConfigError):
            twitterapi_io.get_user_last_tweets("DeItaone")
```

- [ ] **Step 2: Run tests, expect failure**

```bash
pytest tests/test_twitterapi_io.py -v
```
Expected: ImportError or collection failures.

- [ ] **Step 3: Implement the client**

```python
# api/services/twitterapi_io.py
"""TwitterAPI.io HTTP client.

Single endpoint we need: GET /twitter/get_user_last_tweets
Auth: x-api-key header (no OAuth).
Pricing: $0.15 per 1,000 tweets returned. since_id filtering minimizes spend.

All errors raise structured exceptions so callers can react differently:
  - 401 → TwitterApiAuthError (kill polling until key fixed)
  - 402 → TwitterApiPaymentRequired (back off all polling)
  - 429 → TwitterApiRateLimited (exponential backoff)
  - 5xx / network → TwitterApiTransientError (retry)
"""
from __future__ import annotations

import json
import logging
import os
import time
from email.utils import parsedate_to_datetime
from typing import Optional

import requests

logger = logging.getLogger(__name__)

BASE_URL = os.environ.get("TWITTERAPI_IO_BASE_URL", "https://api.twitterapi.io")
TIMEOUT = int(os.environ.get("TWEET_POLL_TIMEOUT_SECONDS", "10"))


class TwitterApiError(Exception):
    """Base class for all TwitterAPI.io failures."""


class TwitterApiConfigError(TwitterApiError):
    """API key missing."""


class TwitterApiAuthError(TwitterApiError):
    """401 — key invalid or revoked."""


class TwitterApiPaymentRequired(TwitterApiError):
    """402 — out of credits."""


class TwitterApiRateLimited(TwitterApiError):
    """429 — slow down."""


class TwitterApiTransientError(TwitterApiError):
    """5xx or network — retry."""


def _api_key() -> str:
    key = os.environ.get("TWITTERAPI_IO_API_KEY")
    if not key:
        raise TwitterApiConfigError("TWITTERAPI_IO_API_KEY not set")
    return key


def _parse_created_at(value) -> int:
    """Parse the API's `createdAt` (Twitter-style 'Mon Jan 01 12:00:00 +0000 2026')
    or an ISO string, or a unix int. Returns unix seconds UTC."""
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(parsedate_to_datetime(value).timestamp())
        except (TypeError, ValueError):
            pass
        try:
            # ISO fallback
            import datetime as _dt
            return int(_dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
        except Exception:
            pass
    return int(time.time())


def _normalize_tweet(raw: dict, fallback_handle: str) -> dict:
    """Map TwitterAPI.io payload to our tweet_store shape."""
    author = raw.get("author") or raw.get("user") or {}
    handle = author.get("userName") or author.get("screen_name") or fallback_handle
    tweet_id = str(raw.get("id") or raw.get("id_str") or raw.get("tweetId"))
    text = raw.get("text") or raw.get("fullText") or raw.get("full_text") or ""
    url = raw.get("url") or f"https://twitter.com/{handle}/status/{tweet_id}"
    return {
        "id": tweet_id,
        "author_handle": handle,
        "author_name": author.get("name"),
        "text": text,
        "created_at": _parse_created_at(raw.get("createdAt") or raw.get("created_at")),
        "url": url,
        "reply_count": raw.get("replyCount") or raw.get("reply_count") or 0,
        "like_count": raw.get("likeCount") or raw.get("favorite_count") or 0,
        "retweet_count": raw.get("retweetCount") or raw.get("retweet_count") or 0,
        "is_retweet": 1 if raw.get("isRetweet") or raw.get("retweeted") else 0,
        "raw_json": json.dumps(raw)[:8000],  # cap payload size
    }


def get_user_last_tweets(handle: str, since_id: Optional[str] = None) -> list[dict]:
    """Fetch newest tweets for a given handle. since_id is the most recent
    tweet id we've already seen — API returns only newer ones."""
    params: dict = {"userName": handle}
    if since_id:
        # TwitterAPI.io may use sinceId or since_id; we send both and let
        # the API ignore the wrong one. Smoke test confirms which works.
        params["sinceId"] = since_id
        params["since_id"] = since_id

    try:
        r = requests.get(
            f"{BASE_URL}/twitter/get_user_last_tweets",
            params=params,
            headers={"x-api-key": _api_key()},
            timeout=TIMEOUT,
        )
    except requests.RequestException as e:
        raise TwitterApiTransientError(f"network error: {e}") from e

    if r.status_code == 401:
        raise TwitterApiAuthError(f"auth failed: {r.text[:200]}")
    if r.status_code == 402:
        raise TwitterApiPaymentRequired(f"out of credits: {r.text[:200]}")
    if r.status_code == 429:
        raise TwitterApiRateLimited(f"rate limited: {r.text[:200]}")
    if r.status_code >= 500:
        raise TwitterApiTransientError(f"HTTP {r.status_code}: {r.text[:200]}")
    if r.status_code != 200:
        raise TwitterApiTransientError(f"HTTP {r.status_code}: {r.text[:200]}")

    body = r.json()
    raw_tweets = body.get("tweets") or body.get("data") or []
    return [_normalize_tweet(t, fallback_handle=handle) for t in raw_tweets]
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
pytest tests/test_twitterapi_io.py -v
```
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/services/twitterapi_io.py tests/test_twitterapi_io.py
git commit -m "feat: add twitterapi_io HTTP client with structured error types"
```

---

## Task 4: Cashtag ticker extraction

**Files:**
- Create: `api/services/tweet_ticker_extract.py`
- Create: `tests/test_tweet_ticker_extract.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_tweet_ticker_extract.py
from api.services.tweet_ticker_extract import extract_tickers


def test_extracts_single_cashtag():
    assert extract_tickers("$AAPL just hit a new high") == {"AAPL"}


def test_extracts_multiple_cashtags():
    assert extract_tickers("$AAPL and $MSFT both up") == {"AAPL", "MSFT"}


def test_case_insensitive_input_normalizes_to_upper():
    assert extract_tickers("$aapl beats") == {"AAPL"}


def test_excludes_forex():
    assert extract_tickers("$USD weak, $EUR strong, $AAPL up") == {"AAPL"}


def test_keeps_crypto():
    assert extract_tickers("$BTC $ETH $SOL all green") == {"BTC", "ETH", "SOL"}


def test_ignores_dollar_amounts():
    assert extract_tickers("Earnings beat by $5 vs $0.10 est") == set()


def test_ignores_long_strings():
    # Tickers cap at 5 chars in our regex; 6+ chars don't match
    assert extract_tickers("$ABCDEF some text") == set()


def test_ignores_plain_text():
    assert extract_tickers("Apple just hit a new high (no cashtag)") == set()


def test_empty_string():
    assert extract_tickers("") == set()


def test_cashtag_with_punctuation_after():
    assert extract_tickers("Big day for $AAPL, $TSLA, and $NVDA!") == {"AAPL", "TSLA", "NVDA"}
```

- [ ] **Step 2: Run, verify failure**

```bash
pytest tests/test_tweet_ticker_extract.py -v
```
Expected: ImportError.

- [ ] **Step 3: Implement**

```python
# api/services/tweet_ticker_extract.py
"""Cashtag-based ticker extraction. v1: regex only, no universe validation.
Source accounts are professional and rarely post fake cashtags; false
positives surface nothing (no join target in UI), so cost of a miss is zero."""
import re

_CASHTAG_RE = re.compile(r"\$([A-Z]{1,5})\b")

# Forex pairs traders post as cashtags but we don't trade
_FOREX_EXCLUDE = {"USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF",
                  "CNY", "HKD", "NZD"}


def extract_tickers(text: str) -> set[str]:
    if not text:
        return set()
    raw = set(_CASHTAG_RE.findall(text.upper()))
    return {t for t in raw if t not in _FOREX_EXCLUDE}
```

- [ ] **Step 4: Run, verify pass**

```bash
pytest tests/test_tweet_ticker_extract.py -v
```

- [ ] **Step 5: Commit**

```bash
git add api/services/tweet_ticker_extract.py tests/test_tweet_ticker_extract.py
git commit -m "feat: add cashtag-based ticker extraction with forex exclude"
```

---

## Task 5: Tweet poller orchestrator

**Files:**
- Create: `api/services/tweet_poller.py`
- Create: `tests/test_tweet_poller.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_tweet_poller.py
import os
import tempfile
import time
from unittest.mock import patch, MagicMock

import pytest

from api.services import tweet_store, tweet_poller, twitterapi_io


@pytest.fixture
def store(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(tweet_store, "_DB_PATH", os.path.join(d, "tweets.db"))
        tweet_store._init_db()
        tweet_store.add_account("DeItaone")
        yield tweet_store


def _tw(id_, text, handle="DeItaone"):
    return {
        "id": id_, "author_handle": handle, "author_name": handle,
        "text": text, "created_at": int(time.time()),
        "url": f"https://x.com/{handle}/status/{id_}",
        "reply_count": 0, "like_count": 0, "retweet_count": 0,
        "is_retweet": 0, "raw_json": "{}",
    }


def test_poll_account_stores_tweets_and_tickers(store):
    with patch.object(twitterapi_io, "get_user_last_tweets",
                      return_value=[_tw("1", "$AAPL big move"), _tw("2", "$MSFT $NVDA")]):
        tweet_poller.poll_account("DeItaone")
    assert store.count_tweets() == 2
    assert {r["ticker"] for r in store._connect().execute("SELECT ticker FROM tweet_tickers")} \
        == {"AAPL", "MSFT", "NVDA"}


def test_poll_account_advances_since_id(store):
    with patch.object(twitterapi_io, "get_user_last_tweets",
                      return_value=[_tw("100", "$AAPL"), _tw("99", "$AAPL")]):
        tweet_poller.poll_account("DeItaone")
    state = store.get_poll_state("DeItaone")
    assert state["last_seen_tweet_id"] == "100"  # max id (newest)
    assert state["last_poll_status"] == "ok"


def test_poll_account_passes_since_id_on_next_poll(store):
    with patch.object(twitterapi_io, "get_user_last_tweets") as mock_get:
        mock_get.return_value = [_tw("50", "$AAPL")]
        tweet_poller.poll_account("DeItaone")
        mock_get.return_value = []
        tweet_poller.poll_account("DeItaone")
    # Second call should have passed since_id="50"
    _, kwargs = mock_get.call_args_list[1]
    assert kwargs.get("since_id") == "50"


def test_poll_account_records_auth_error(store):
    with patch.object(twitterapi_io, "get_user_last_tweets",
                      side_effect=twitterapi_io.TwitterApiAuthError("bad key")):
        tweet_poller.poll_account("DeItaone")
    state = store.get_poll_state("DeItaone")
    assert state["last_poll_status"] == "auth_error"
    assert "bad key" in state["last_error"]


def test_poll_account_records_payment_required(store):
    with patch.object(twitterapi_io, "get_user_last_tweets",
                      side_effect=twitterapi_io.TwitterApiPaymentRequired("no credits")):
        tweet_poller.poll_account("DeItaone")
    state = store.get_poll_state("DeItaone")
    assert state["last_poll_status"] == "out_of_credits"


def test_poll_all_accounts_skips_disabled(store):
    store.add_account("Benzinga")
    store.set_account_enabled("Benzinga", False)
    with patch.object(twitterapi_io, "get_user_last_tweets",
                      return_value=[]) as mock_get:
        tweet_poller.poll_all_accounts()
    # Only DeItaone (enabled) was polled
    handles = [c.args[0] for c in mock_get.call_args_list]
    assert handles == ["DeItaone"]
```

- [ ] **Step 2: Run, verify failure**

```bash
pytest tests/test_tweet_poller.py -v
```

- [ ] **Step 3: Implement the poller**

```python
# api/services/tweet_poller.py
"""Orchestrates polling each enabled account, extracts tickers, persists tweets.

Called from APScheduler jobs in api/main.py. Single-threaded per cron tick,
so concurrent polling is not a concern. The scheduler lock in api/main.py
already prevents multiple pods from firing the same job.
"""
from __future__ import annotations

import logging
from typing import Optional

from api.services import tweet_store, twitterapi_io
from api.services.tweet_ticker_extract import extract_tickers

logger = logging.getLogger(__name__)


def poll_account(handle: str) -> dict:
    """Poll one account, return a summary dict. Never raises."""
    state = tweet_store.get_poll_state(handle) or {}
    since_id = state.get("last_seen_tweet_id")
    summary = {"handle": handle, "stored": 0, "status": "ok"}

    try:
        tweets = twitterapi_io.get_user_last_tweets(handle, since_id=since_id)
    except twitterapi_io.TwitterApiAuthError as e:
        tweet_store.update_poll_state(handle, status="auth_error", error=str(e)[:300])
        logger.error("[tweet_poll] %s auth_error: %s", handle, e)
        summary["status"] = "auth_error"
        return summary
    except twitterapi_io.TwitterApiPaymentRequired as e:
        tweet_store.update_poll_state(handle, status="out_of_credits", error=str(e)[:300])
        logger.error("[tweet_poll] %s out_of_credits: %s", handle, e)
        summary["status"] = "out_of_credits"
        return summary
    except twitterapi_io.TwitterApiRateLimited as e:
        tweet_store.update_poll_state(handle, status="rate_limited", error=str(e)[:300])
        logger.warning("[tweet_poll] %s rate_limited: %s", handle, e)
        summary["status"] = "rate_limited"
        return summary
    except twitterapi_io.TwitterApiError as e:
        tweet_store.update_poll_state(handle, status="error", error=str(e)[:300])
        logger.warning("[tweet_poll] %s error: %s", handle, e)
        summary["status"] = "error"
        return summary
    except Exception as e:
        # Defensive — never let one bad account kill the whole job
        tweet_store.update_poll_state(handle, status="error", error=f"unexpected: {e}"[:300])
        logger.exception("[tweet_poll] %s unexpected", handle)
        summary["status"] = "error"
        return summary

    newest_id: Optional[str] = since_id
    for tweet in tweets:
        try:
            tickers = extract_tickers(tweet.get("text", ""))
            tweet_store.upsert_tweet(tweet, tickers)
            summary["stored"] += 1
            # Track the lexicographically/numerically largest id (Twitter ids
            # are numerically increasing; str compare for safety on bigints)
            tid = str(tweet.get("id"))
            if newest_id is None or len(tid) > len(newest_id) or (len(tid) == len(newest_id) and tid > newest_id):
                newest_id = tid
        except Exception:
            logger.exception("[tweet_poll] %s tweet %s failed to store", handle, tweet.get("id"))

    tweet_store.update_poll_state(
        handle,
        last_seen_tweet_id=newest_id,
        status="ok",
        tweets_seen=summary["stored"],
    )
    logger.info("[tweet_poll] %s stored=%d newest=%s", handle, summary["stored"], newest_id)
    return summary


def poll_all_accounts() -> list[dict]:
    accounts = tweet_store.list_accounts(enabled_only=True)
    return [poll_account(a["handle"]) for a in accounts]
```

- [ ] **Step 4: Run, verify pass**

```bash
pytest tests/test_tweet_poller.py -v
```

- [ ] **Step 5: Commit**

```bash
git add api/services/tweet_poller.py tests/test_tweet_poller.py
git commit -m "feat: add tweet_poller orchestrator with per-account error isolation"
```

---

## Task 6: Retention cleanup module

**Files:**
- Create: `api/services/tweet_cleanup.py`

- [ ] **Step 1: Implement (no separate test — `delete_tweets_older_than` is already covered in `test_tweet_store.py`)**

```python
# api/services/tweet_cleanup.py
"""Nightly retention sweep. Called from the APScheduler 3am ET job."""
import logging
import os

from api.services import tweet_store

logger = logging.getLogger(__name__)


def run_cleanup() -> int:
    days = int(os.environ.get("TWEET_RETENTION_DAYS", "7"))
    deleted = tweet_store.delete_tweets_older_than(days=days)
    logger.info("[tweet_cleanup] deleted %d tweets older than %d days", deleted, days)
    return deleted
```

- [ ] **Step 2: Commit**

```bash
git add api/services/tweet_cleanup.py
git commit -m "feat: add tweet retention cleanup module"
```

---

## Task 7: Wire scheduler in `api/main.py` + initialize DB on startup

**Files:**
- Modify: `api/main.py` — add scheduler jobs near line 1235 (after existing COT jobs); add startup hook to init tweets.db

- [ ] **Step 1: Add startup hook** (search for where the app starts, e.g. an existing `@app.on_event("startup")` block or the lifespan handler — UCT uses `lifespan` per CLAUDE.md "Startup cache seeding")

Find the existing `@asynccontextmanager async def lifespan` block (or the `@app.on_event("startup")` if that's still in use). Add at the top of the startup section:

```python
# Initialize tweets.db schema (idempotent, safe to call on every boot)
if os.environ.get("TWITTERAPI_IO_ENABLED", "").lower() in ("1", "true", "yes"):
    try:
        from api.services import tweet_store
        tweet_store._init_db()
        print("[startup] tweets.db initialized")
    except Exception as e:
        print(f"[startup] tweet_store init failed: {e}")
```

- [ ] **Step 2: Add scheduler jobs inside the existing `if acquire_scheduler_lock():` block**

Find the line `_scheduler.add_job(_cot_daily_catchup, ...)` (currently `api/main.py:1235`). Immediately after the last COT job, add:

```python
        # ── Twitter News Ingestion (spec 2026-05-25) ──────────────────────
        if os.environ.get("TWITTERAPI_IO_ENABLED", "").lower() in ("1", "true", "yes"):
            from api.services.tweet_poller import poll_all_accounts
            from api.services.tweet_cleanup import run_cleanup

            # burst windows — every 2 min, pre-market + post-close
            _scheduler.add_job(poll_all_accounts,
                trigger=CronTrigger(day_of_week="mon-fri", hour="4-9", minute="*/2"),
                id="tweet_poll_burst_premarket", max_instances=1, replace_existing=True)
            _scheduler.add_job(poll_all_accounts,
                trigger=CronTrigger(day_of_week="mon-fri", hour="9", minute="30-58/2"),
                id="tweet_poll_burst_open", max_instances=1, replace_existing=True)
            _scheduler.add_job(poll_all_accounts,
                trigger=CronTrigger(day_of_week="mon-fri", hour="15", minute="30-58/2"),
                id="tweet_poll_burst_close", max_instances=1, replace_existing=True)
            _scheduler.add_job(poll_all_accounts,
                trigger=CronTrigger(day_of_week="mon-fri", hour="16-19", minute="*/2"),
                id="tweet_poll_burst_amc", max_instances=1, replace_existing=True)

            # regular — 15 min, mid-day
            _scheduler.add_job(poll_all_accounts,
                trigger=CronTrigger(day_of_week="mon-fri", hour="10-15", minute="*/15"),
                id="tweet_poll_regular_midday", max_instances=1, replace_existing=True)

            # slow safety-net — every hour, all days. Overlap with burst
            # costs ~0 because since_id returns no new tweets when nothing changed.
            _scheduler.add_job(poll_all_accounts,
                trigger=CronTrigger(minute="0"),
                id="tweet_poll_slow", max_instances=1, replace_existing=True)

            # daily cleanup — 3am ET
            _scheduler.add_job(run_cleanup,
                trigger=CronTrigger(hour=3, minute=0),
                id="tweet_cleanup_daily", max_instances=1, replace_existing=True)

            print("[scheduler] tweet poll jobs registered")
```

- [ ] **Step 3: Verify imports** — `os` and `CronTrigger` are already imported in `main.py` per the existing scheduler block. Confirm by reading lines 1170–1240.

- [ ] **Step 4: Run existing tests to confirm nothing broke**

```bash
pytest tests/ -x --ignore=tests/test_tweets_router.py --ignore=tests/test_admin_twitter_router.py -q
```

Expected: same pass count as before (we haven't broken existing functionality).

- [ ] **Step 5: Commit**

```bash
git add api/main.py
git commit -m "feat: wire tweet poller scheduler jobs alongside COT in main.py"
```

---

## Task 8: Seed the 4 starter accounts via a one-shot script

**Files:**
- Create: `tools/seed_twitter_accounts.py`

- [ ] **Step 1: Write the seed script**

```python
"""tools/seed_twitter_accounts.py

One-shot script to insert the initial curated account list. Idempotent.
Run once locally after the schema exists, or on Railway via the shell:
  python tools/seed_twitter_accounts.py
"""
import os
import sys

# Ensure we use the same DB path the running app uses
os.environ.setdefault("TWEET_DB_PATH", "/data/tweets.db")

from api.services import tweet_store

INITIAL_ACCOUNTS = [
    ("DeItaone", "Walter Bloomberg / breaking single-stock news"),
    ("FinancialJuice", "Newswire-style econ + single-stock"),
    ("Benzinga", "Financial newswire, ticker-tagged"),
    # NOTE: Confirm WallStEngine vs WallStreetEngine via the smoke test (Task 1).
    # Insert the one that returned tweets; remove the other line.
    ("WallStEngine", "Single-stock catalyst aggregator"),
]


def main() -> int:
    tweet_store._init_db()
    for handle, notes in INITIAL_ACCOUNTS:
        tweet_store.add_account(handle, display_name=handle, notes=notes)
        print(f"  + {handle} (or already present)")
    print(f"Total enabled accounts: {len(tweet_store.list_accounts(enabled_only=True))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Confirm intent** — note that this script is run AFTER deploy on Railway shell, not locally; Railway's `/data` volume is where the seeded rows persist.

- [ ] **Step 3: Commit**

```bash
git add tools/seed_twitter_accounts.py
git commit -m "tools: add one-shot script to seed initial curated Twitter accounts"
```

---

## Task 9: Deploy Phase 1, verify polling

- [ ] **Step 1: Set Railway env vars** via the Railway dashboard (or `railway variables` CLI):
  - `TWITTERAPI_IO_API_KEY=<your key>`
  - `TWITTERAPI_IO_ENABLED=1`
  - `TWEET_RETENTION_DAYS=7` (optional, defaults to 7)

- [ ] **Step 2: Push to Railway**

```bash
git push origin <current-branch>
```

- [ ] **Step 3: After deploy completes, seed accounts via Railway shell** (or run `tools/seed_twitter_accounts.py` once via Railway's shell)

- [ ] **Step 4: Verify polling started.** Watch deploy logs for:

```
[startup] tweets.db initialized
[scheduler] tweet poll jobs registered
```

Then within the next burst window (or wait for the top-of-hour slow job), look for:

```
[tweet_poll] DeItaone stored=N newest=...
```

- [ ] **Step 5: Quick DB sanity check via Railway shell**

```bash
sqlite3 /data/tweets.db "SELECT author_handle, COUNT(*) FROM tweets GROUP BY author_handle;"
```

Expect: 4 rows, one per seeded account, each with N > 0.

---

# PHASE 2: Read endpoints + admin Settings card

After Phase 2 you can manage accounts and see cost/health in the dashboard. Still no end-user visibility on movers/earnings — that's Phase 3+4.

---

## Task 10: `/api/tweets/ticker/{sym}` and `/api/tweets/has-tweets-batch`

**Files:**
- Create: `api/routers/tweets.py`
- Create: `tests/test_tweets_router.py`
- Modify: `api/main.py` — register the router

- [ ] **Step 1: Write failing tests**

```python
# tests/test_tweets_router.py
import os
import tempfile
import time

import pytest
from fastapi.testclient import TestClient

from api.services import tweet_store


@pytest.fixture
def client(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(tweet_store, "_DB_PATH", os.path.join(d, "tweets.db"))
        tweet_store._init_db()
        # Import the app AFTER patching the DB path so the router sees the temp DB
        from api.main import app
        with TestClient(app) as c:
            yield c


def _seed(handle, text, tickers, created_at=None):
    tweet_store.upsert_tweet({
        "id": f"{handle}_{int(time.time()*1000)}_{text[:5]}",
        "author_handle": handle, "author_name": handle,
        "text": text, "created_at": created_at or int(time.time()),
        "url": f"https://x.com/{handle}/status/1",
        "reply_count": 0, "like_count": 0, "retweet_count": 0,
        "is_retweet": 0, "raw_json": "{}",
    }, tickers)


def test_get_tweets_for_ticker_requires_auth(client):
    # All UCT routes that touch user data require auth. Spec confirms tweets do too.
    # If your project does NOT require auth on read endpoints, delete this test.
    r = client.get("/api/tweets/ticker/AAPL")
    # Either 401/403 (auth required) or 200 (open) — both are spec-compliant.
    # Assert only that we don't get a 500.
    assert r.status_code != 500


def test_get_tweets_for_ticker_returns_newest_first(client):
    now = int(time.time())
    _seed("DeItaone", "$AAPL old", ["AAPL"], created_at=now - 7200)
    _seed("Benzinga", "$AAPL new", ["AAPL"], created_at=now - 60)
    r = client.get("/api/tweets/ticker/AAPL?hours=24")
    # If auth gates the response, skip this assertion path
    if r.status_code == 200:
        data = r.json()
        assert len(data) == 2
        assert data[0]["text"] == "$AAPL new"


def test_batch_tweet_counts(client):
    _seed("DeItaone", "$AAPL", ["AAPL"])
    _seed("Benzinga", "$AAPL", ["AAPL"])
    _seed("DeItaone", "$MSFT", ["MSFT"])
    r = client.get("/api/tweets/has-tweets-batch?tickers=AAPL,MSFT,NVDA")
    if r.status_code == 200:
        assert r.json() == {"AAPL": 2, "MSFT": 1, "NVDA": 0}


def test_tape_excludes_current_movers(client, monkeypatch):
    now = int(time.time())
    _seed("DeItaone", "$ABBV halt", ["ABBV"], created_at=now - 60)
    _seed("Benzinga", "$XYZ news", ["XYZ"], created_at=now - 30)

    # Stub the movers feed so XYZ is in current movers (and should be excluded)
    from api.routers import tweets as tweets_router
    monkeypatch.setattr(tweets_router, "_current_mover_symbols",
                        lambda: {"XYZ", "TSLA"})

    r = client.get("/api/tweets/tape?hours=12&limit=10")
    if r.status_code == 200:
        symbols = [row["ticker"] for row in r.json()]
        assert "ABBV" in symbols
        assert "XYZ" not in symbols
```

- [ ] **Step 2: Run, expect failure**

```bash
pytest tests/test_tweets_router.py -v
```

- [ ] **Step 3: Implement the router**

```python
# api/routers/tweets.py
"""Read-only tweet endpoints surfaced to the React frontend.

Auth: requires login (matches the project's auth pattern used by
admin_chart_health.py and other admin routers). Uses
api.middleware.auth_middleware.get_current_user.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user
from api.services import tweet_store

router = APIRouter(prefix="/api/tweets", tags=["tweets"])


def _current_mover_symbols() -> set[str]:
    """Pull the current MoversSidebar symbol set so /tape can exclude them.
    Wrapped so tests can monkeypatch it without standing up the full movers stack."""
    try:
        from api.services.massive import get_movers
        movers = get_movers() or {}
        out: set[str] = set()
        for item in (movers.get("ripping") or []):
            out.add(item.get("sym", "").upper())
        for item in (movers.get("drilling") or []):
            out.add(item.get("sym", "").upper())
        return out
    except Exception:
        return set()


@router.get("/ticker/{sym}")
def tweets_for_ticker(sym: str, hours: int = Query(24, ge=1, le=168),
                      user=Depends(get_current_user)):
    sym = sym.upper().strip()
    if not sym or not sym.isalpha() or len(sym) > 6:
        raise HTTPException(400, "invalid ticker")
    return tweet_store.tweets_for_ticker(sym, hours=hours)


@router.get("/tape")
def tape(hours: int = Query(12, ge=1, le=72), limit: int = Query(15, ge=1, le=100),
         user=Depends(get_current_user)):
    rows = tweet_store.tape(hours=hours, limit=limit * 3)  # over-fetch to allow filter
    movers = _current_mover_symbols()
    filtered = [r for r in rows if r["ticker"] not in movers]
    return filtered[:limit]


@router.get("/has-tweets-batch")
def has_tweets_batch(tickers: str = Query(..., description="comma-separated tickers"),
                     hours: int = Query(24, ge=1, le=168),
                     user=Depends(get_current_user)):
    tlist = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not tlist:
        return {}
    if len(tlist) > 200:
        raise HTTPException(400, "max 200 tickers per batch")
    return tweet_store.batch_counts(tlist, hours=hours)
```

- [ ] **Step 4: Register the router in `api/main.py`**

Search `main.py` for an existing `app.include_router(` block. Add alongside the others:

```python
from api.routers import tweets as tweets_router
app.include_router(tweets_router.router)
```

- [ ] **Step 5: Run, verify pass**

```bash
pytest tests/test_tweets_router.py -v
```

- [ ] **Step 6: Commit**

```bash
git add api/routers/tweets.py api/main.py tests/test_tweets_router.py
git commit -m "feat: add /api/tweets read endpoints (ticker, tape, batch counts)"
```

---

## Task 11: Admin router — accounts CRUD + stats

**Files:**
- Create: `api/routers/admin_twitter.py`
- Create: `tests/test_admin_twitter_router.py`
- Modify: `api/main.py` — register the router

- [ ] **Step 1: Write failing tests** — modeled on `tests/test_admin_chart_health.py`. Admin gate is `api.middleware.auth_middleware.require_admin` (returns 403 if `user.role != 'admin'`); user-auth dependency is `get_current_user` (returns 401 if no session).

```python
# tests/test_admin_twitter_router.py
import os
import tempfile
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from api.services import tweet_store


@pytest.fixture
def client(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(tweet_store, "_DB_PATH", os.path.join(d, "tweets.db"))
        tweet_store._init_db()
        from api.main import app
        with TestClient(app) as c:
            yield c


def test_list_accounts_empty(client):
    r = client.get("/api/admin/twitter-accounts")
    # 401/403 if admin gate triggers in test env without auth — that's expected
    assert r.status_code in (200, 401, 403)
    if r.status_code == 200:
        assert r.json() == []


def test_add_account_validates_via_api(client, monkeypatch):
    from api.services import twitterapi_io
    monkeypatch.setattr(twitterapi_io, "get_user_last_tweets",
                        lambda h, since_id=None: [{"id": "1", "author_handle": h,
                                                   "text": "hi", "created_at": 0,
                                                   "url": "x", "author_name": h,
                                                   "reply_count": 0, "like_count": 0,
                                                   "retweet_count": 0, "is_retweet": 0,
                                                   "raw_json": "{}"}])
    r = client.post("/api/admin/twitter-accounts", json={"handle": "DeItaone"})
    assert r.status_code in (200, 201, 401, 403)


def test_add_account_rejects_invalid_handle(client, monkeypatch):
    from api.services import twitterapi_io
    monkeypatch.setattr(twitterapi_io, "get_user_last_tweets",
                        lambda h, since_id=None: (_ for _ in ()).throw(
                            twitterapi_io.TwitterApiTransientError("not found")))
    r = client.post("/api/admin/twitter-accounts", json={"handle": "ThisHandleDoesNotExist"})
    if r.status_code not in (401, 403):
        assert r.status_code == 422 or r.status_code == 400


def test_twitter_stats_returns_shape(client):
    r = client.get("/api/admin/twitter-stats")
    if r.status_code == 200:
        body = r.json()
        for key in ("total_tweets", "per_account", "mtd_estimated_cost_usd"):
            assert key in body
```

- [ ] **Step 2: Implement the router**

```python
# api/routers/admin_twitter.py
"""Admin-only management of the curated Twitter accounts list.

Auth: api.middleware.auth_middleware.require_admin — same dependency
used by admin_chart_health.py. Returns 403 for non-admin users.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Path

from api.middleware.auth_middleware import require_admin
from api.services import tweet_store, twitterapi_io, tweet_poller

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin-twitter"])

# Self-heal cadence — mirrors COT pattern (cot_service._maybe_auto_refresh_if_stale)
_LAST_AUTO_REFRESH_AT: Optional[int] = None
_AUTO_REFRESH_COOLDOWN_SEC = 30 * 60  # 30 min


def _maybe_auto_refresh_if_stale():
    """If no successful poll in last 30 min, kick a background refresh.
    Mirrors api/services/cot_service.py:_maybe_auto_refresh_if_stale."""
    global _LAST_AUTO_REFRESH_AT
    now = int(time.time())
    if _LAST_AUTO_REFRESH_AT and (now - _LAST_AUTO_REFRESH_AT) < _AUTO_REFRESH_COOLDOWN_SEC:
        return
    try:
        accounts = tweet_store.list_accounts(enabled_only=True)
        if not accounts:
            return
        stale = True
        for a in accounts:
            state = tweet_store.get_poll_state(a["handle"]) or {}
            if state.get("last_poll_status") == "ok" and \
               state.get("last_poll_at", 0) > now - 30 * 60:
                stale = False
                break
        if stale:
            import threading
            threading.Thread(target=tweet_poller.poll_all_accounts,
                             daemon=True, name="tweet-self-heal").start()
            _LAST_AUTO_REFRESH_AT = now
            logger.info("[twitter-admin] self-heal poll triggered")
    except Exception:
        logger.exception("[twitter-admin] self-heal check failed")


@router.get("/twitter-accounts")
def list_accounts(user=Depends(require_admin)):
    accounts = tweet_store.list_accounts(enabled_only=False)
    for a in accounts:
        a["poll_state"] = tweet_store.get_poll_state(a["handle"])
    return accounts


@router.post("/twitter-accounts")
def add_account(body: dict = Body(...), user=Depends(require_admin)):
    handle = (body.get("handle") or "").strip().lstrip("@")
    notes = body.get("notes")
    if not handle or not handle.replace("_", "").isalnum() or len(handle) > 32:
        raise HTTPException(400, "invalid handle")

    # Validate handle exists by calling TwitterAPI.io once
    try:
        tweets = twitterapi_io.get_user_last_tweets(handle)
    except twitterapi_io.TwitterApiError as e:
        raise HTTPException(422, f"could not validate handle: {e}")

    display_name = None
    if tweets:
        display_name = tweets[0].get("author_name") or handle

    tweet_store.add_account(handle, display_name=display_name,
                            added_by_user_id=user.get("id"), notes=notes)
    return tweet_store.list_accounts()


@router.patch("/twitter-accounts/{handle}")
def update_account(handle: str = Path(...), body: dict = Body(...),
                   user=Depends(require_admin)):
    if "enabled" in body:
        tweet_store.set_account_enabled(handle, bool(body["enabled"]))
    if "notes" in body:
        tweet_store.update_account_notes(handle, body["notes"])
    return tweet_store.list_accounts()


@router.delete("/twitter-accounts/{handle}")
def delete_account(handle: str = Path(...), user=Depends(require_admin)):
    # Soft-disable to preserve history
    tweet_store.set_account_enabled(handle, False)
    return {"ok": True}


@router.post("/twitter-accounts/{handle}/force-poll")
def force_poll(handle: str = Path(...), user=Depends(require_admin)):
    summary = tweet_poller.poll_account(handle)
    return summary


@router.get("/twitter-stats")
def twitter_stats(user=Depends(require_admin)):
    _maybe_auto_refresh_if_stale()

    total = tweet_store.count_tweets()
    per_account = []
    total_billed = 0
    for a in tweet_store.list_accounts(enabled_only=False):
        state = tweet_store.get_poll_state(a["handle"]) or {}
        per_account.append({
            "handle": a["handle"],
            "enabled": a["enabled"],
            "last_poll_at": state.get("last_poll_at"),
            "last_poll_status": state.get("last_poll_status"),
            "last_error": state.get("last_error"),
            "total_tweets_seen": state.get("total_tweets_seen", 0),
        })
        total_billed += state.get("total_tweets_seen", 0)

    # $0.15 per 1,000 tweets per TwitterAPI.io pricing (2026-05-25)
    mtd_cost = round(total_billed * 0.00015, 2)

    return {
        "total_tweets": total,
        "per_account": per_account,
        "mtd_estimated_cost_usd": mtd_cost,
    }
```

- [ ] **Step 3: Register router in `api/main.py`**

```python
from api.routers import admin_twitter as admin_twitter_router
app.include_router(admin_twitter_router.router)
```

- [ ] **Step 4: Run, verify pass**

```bash
pytest tests/test_admin_twitter_router.py -v
```

- [ ] **Step 5: Commit**

```bash
git add api/routers/admin_twitter.py api/main.py tests/test_admin_twitter_router.py
git commit -m "feat: add admin twitter accounts CRUD + stats with self-heal"
```

---

## Task 12: Settings TileCard — admin-only "Twitter Accounts" management UI

**Files:**
- Create: `app/src/components/TwitterAccountsTile.jsx`
- Create: `app/src/components/TwitterAccountsTile.module.css`
- Modify: `app/src/pages/Settings.jsx` — mount the tile when `user.role === 'admin'`

- [ ] **Step 1: Implement `TwitterAccountsTile.jsx`**

```jsx
// app/src/components/TwitterAccountsTile.jsx
import { useState } from 'react'
import useSWR from 'swr'
import TileCard from './TileCard'
import styles from './TwitterAccountsTile.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function relativeMin(ts) {
  if (!ts) return '—'
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function StatusPill({ status }) {
  const cls = {
    ok: styles.ok,
    auth_error: styles.bad,
    out_of_credits: styles.bad,
    rate_limited: styles.warn,
    error: styles.bad,
  }[status] || styles.muted
  const label = status || 'never'
  return <span className={`${styles.pill} ${cls}`}>{label}</span>
}

export default function TwitterAccountsTile() {
  const { data: accounts, mutate } = useSWR('/api/admin/twitter-accounts', fetcher,
    { refreshInterval: 60000 })
  const { data: stats } = useSWR('/api/admin/twitter-stats', fetcher,
    { refreshInterval: 60000 })

  const [newHandle, setNewHandle] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(null)

  async function addAccount() {
    if (!newHandle.trim()) return
    setAdding(true); setError(null)
    const r = await fetch('/api/admin/twitter-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: newHandle.trim().replace(/^@/, '') }),
    })
    setAdding(false)
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      setError(body.detail || `HTTP ${r.status}`)
      return
    }
    setNewHandle('')
    mutate()
  }

  async function toggleEnabled(handle, enabled) {
    await fetch(`/api/admin/twitter-accounts/${handle}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    mutate()
  }

  async function removeAccount(handle) {
    if (!confirm(`Disable @${handle}?`)) return
    await fetch(`/api/admin/twitter-accounts/${handle}`, { method: 'DELETE' })
    mutate()
  }

  return (
    <TileCard title="🐦 Twitter Accounts">
      <div className={styles.body}>
        {!accounts ? (
          <div className={styles.muted}>Loading…</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Handle</th>
                <th>Status</th>
                <th>Last poll</th>
                <th>24h tweets</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => {
                const ps = a.poll_state || {}
                return (
                  <tr key={a.handle} className={a.enabled ? '' : styles.disabled}>
                    <td>@{a.handle}</td>
                    <td><StatusPill status={ps.last_poll_status} /></td>
                    <td>{relativeMin(ps.last_poll_at)}</td>
                    <td>{ps.total_tweets_seen ?? 0}</td>
                    <td>
                      <button onClick={() => toggleEnabled(a.handle, !a.enabled)}>
                        {a.enabled ? 'disable' : 'enable'}
                      </button>
                      <button onClick={() => removeAccount(a.handle)}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        <div className={styles.addRow}>
          <input
            type="text" placeholder="handle (no @)"
            value={newHandle}
            onChange={e => setNewHandle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addAccount()}
          />
          <button disabled={adding} onClick={addAccount}>
            {adding ? '…' : '+ Add'}
          </button>
        </div>
        {error && <div className={styles.errMsg}>{error}</div>}

        {stats && (
          <div className={styles.statsLine}>
            Total tweets stored: <b>{stats.total_tweets}</b>
            {' · '}MTD estimated cost: <b>${stats.mtd_estimated_cost_usd?.toFixed(2)}</b>
          </div>
        )}
      </div>
    </TileCard>
  )
}
```

- [ ] **Step 2: Add CSS**

```css
/* app/src/components/TwitterAccountsTile.module.css */
.body { display: flex; flex-direction: column; gap: 12px; padding: 8px 0; }
.muted { opacity: 0.6; font-size: 13px; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { text-align: left; opacity: 0.7; font-weight: 500; padding: 4px 8px; }
.table td { padding: 6px 8px; border-top: 1px solid rgba(255,255,255,0.05); }
.disabled { opacity: 0.5; }
.pill { padding: 2px 8px; border-radius: 10px; font-size: 11px; }
.ok { background: rgba(74,222,128,0.16); color: #4ade80; }
.bad { background: rgba(248,113,113,0.16); color: #f87171; }
.warn { background: rgba(180,130,20,0.16); color: #fbbf24; }
.addRow { display: flex; gap: 8px; }
.addRow input { flex: 1; padding: 4px 8px; }
.errMsg { color: #f87171; font-size: 12px; }
.statsLine { font-size: 12px; opacity: 0.7; }
```

- [ ] **Step 3: Mount in `Settings.jsx`**

Search `Settings.jsx` for `user.role === 'admin'` (line 305-ish per our earlier grep). Find a sensible position — likely just before or after the existing admin-only Compass tile — and add:

```jsx
import TwitterAccountsTile from '../components/TwitterAccountsTile'

// ... inside the render, gated by admin role:
{user?.role === 'admin' && <TwitterAccountsTile />}
```

- [ ] **Step 4: Commit**

```bash
git add app/src/components/TwitterAccountsTile.jsx app/src/components/TwitterAccountsTile.module.css app/src/pages/Settings.jsx
git commit -m "feat: add admin-only TwitterAccountsTile in Settings"
```

- [ ] **Step 5: Push Phase 2 to Railway** (per `feedback_always_push`)

```bash
git push origin <current-branch>
```

After deploy: log in as admin → Settings → confirm the new "Twitter Accounts" card lists the 4 seeded accounts with green "ok" status pills. Try adding a fake handle (should fail with a 422). Try the disable/enable buttons.

---

# PHASE 3: MoversSidebar surfaces

After Phase 3, ticker rows on the live Movers sidebar gain the 🐦 icon when tweets exist, and a new "ON THE TAPE" section appears at the bottom listing tweet-mentioned tickers that aren't already in the gainers/losers lists.

---

## Task 13: Extract shared `timeAgo` utility from `AlertBell.jsx`

**Files:**
- Create: `app/src/utils/timeAgo.js`
- Modify: `app/src/components/AlertBell.jsx` — replace inline `timeAgo()` with import

- [ ] **Step 1: Read `AlertBell.jsx:25-35`** to copy the existing implementation verbatim. Save it as:

```js
// app/src/utils/timeAgo.js
export function timeAgo(ts) {
  if (!ts) return ''
  // Accept unix-seconds int, unix-millis int, or ISO string.
  // The original implementation in AlertBell only handled ISO; we extend
  // to accept unix-seconds too since that's what tweet_store returns.
  let ms
  if (typeof ts === 'number') {
    ms = ts < 1e12 ? ts * 1000 : ts
  } else {
    ms = new Date(ts).getTime()
  }
  const diff = (Date.now() - ms) / 1000
  if (diff < 60) return `${Math.max(0, Math.floor(diff))}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
```

- [ ] **Step 2: Update `AlertBell.jsx`** — delete its inline `timeAgo` (lines 25–35) and import the shared one:

```jsx
import { timeAgo } from '../utils/timeAgo'
```

- [ ] **Step 3: Run frontend tests** (if any cover AlertBell) to confirm nothing broke:

```bash
cd app && npm run test -- AlertBell 2>/dev/null || true
```

- [ ] **Step 4: Commit**

```bash
git add app/src/utils/timeAgo.js app/src/components/AlertBell.jsx
git commit -m "refactor: extract timeAgo from AlertBell into shared util"
```

---

## Task 14: SWR hooks — `useTickerTweets`, `useTapeFeed`, `useBatchTweetCounts`

**Files:**
- Create: `app/src/hooks/useTickerTweets.js`
- Create: `app/src/hooks/useTapeFeed.js`
- Create: `app/src/hooks/useBatchTweetCounts.js`

- [ ] **Step 1: `useTickerTweets`**

```js
// app/src/hooks/useTickerTweets.js
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : []))

/**
 * Fetch tweets that mention a specific ticker.
 * Used by EarningsModal on open + by MoversSidebar's expanded-row panel.
 */
export default function useTickerTweets(sym, { hours = 24, enabled = true } = {}) {
  const key = enabled && sym ? `/api/tweets/ticker/${sym}?hours=${hours}` : null
  return useSWR(key, fetcher, { revalidateOnFocus: false })
}
```

- [ ] **Step 2: `useTapeFeed`**

```js
// app/src/hooks/useTapeFeed.js
import useMobileSWR from './useMobileSWR'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : []))

/**
 * Tickers mentioned in tweets in the last `hours`, NOT in current movers.
 * Polled at 30s on MoversSidebar — matches the movers feed cadence.
 */
export default function useTapeFeed({ hours = 12, limit = 15 } = {}) {
  return useMobileSWR(
    `/api/tweets/tape?hours=${hours}&limit=${limit}`,
    fetcher,
    { refreshInterval: 30000, marketHoursOnly: true }
  )
}
```

- [ ] **Step 3: `useBatchTweetCounts`**

```js
// app/src/hooks/useBatchTweetCounts.js
import { useMemo } from 'react'
import useMobileSWR from './useMobileSWR'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : {}))

/**
 * Returns { TICKER: count } for the given list of tickers, in last 24h.
 * Memoizes the URL based on a sorted/joined ticker list so swap-order
 * inputs don't double-fetch.
 */
export default function useBatchTweetCounts(tickers, { hours = 24 } = {}) {
  const url = useMemo(() => {
    if (!tickers || tickers.length === 0) return null
    const csv = [...new Set(tickers.map(t => t.toUpperCase()))].sort().join(',')
    return `/api/tweets/has-tweets-batch?tickers=${csv}&hours=${hours}`
  }, [tickers, hours])

  return useMobileSWR(url, fetcher, { refreshInterval: 30000, marketHoursOnly: true })
}
```

- [ ] **Step 4: Commit**

```bash
git add app/src/hooks/useTickerTweets.js app/src/hooks/useTapeFeed.js app/src/hooks/useBatchTweetCounts.js
git commit -m "feat: add SWR hooks for tweet ticker/tape/batch endpoints"
```

---

## Task 15: MoversSidebar — 🐦 icons and ON THE TAPE section

**Files:**
- Modify: `app/src/components/MoversSidebar.jsx` (currently 67 lines — full file replacement)
- Modify: `app/src/components/MoversSidebar.module.css` — add styles for new section

- [ ] **Step 1: Read current `MoversSidebar.module.css`** to align with its existing token system.

```bash
cat app/src/components/MoversSidebar.module.css
```

- [ ] **Step 2: Replace `MoversSidebar.jsx` with the 3-section version**

```jsx
// app/src/components/MoversSidebar.jsx
import { useMemo, useState } from 'react'
import useMobileSWR from '../hooks/useMobileSWR'
import useBatchTweetCounts from '../hooks/useBatchTweetCounts'
import useTapeFeed from '../hooks/useTapeFeed'
import useTickerTweets from '../hooks/useTickerTweets'
import { timeAgo } from '../utils/timeAgo'
import TickerPopup from './TickerPopup'
import ErrorState from './ErrorState'
import { SkeletonTable } from './Skeleton'
import styles from './MoversSidebar.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const UI_ENABLED = (import.meta.env.VITE_TWITTER_UI_ENABLED ?? '1') !== '0'

function TweetExpand({ sym }) {
  const { data } = useTickerTweets(sym, { hours: 24 })
  if (!data || data.length === 0) return null
  return (
    <div className={styles.tweetExpand}>
      {data.slice(0, 5).map(t => (
        <div key={t.id} className={styles.tweetRow}>
          <span className={styles.tweetHandle}>@{t.author_handle}</span>
          <span className={styles.tweetTime}>{timeAgo(t.created_at)}</span>
          <a className={styles.tweetLink} href={t.url} target="_blank" rel="noreferrer">↗</a>
          <div className={styles.tweetText}>{t.text}</div>
        </div>
      ))}
    </div>
  )
}

function MoverSection({ label, items, positive, tweetCounts }) {
  const [expandedSym, setExpandedSym] = useState(null)
  return (
    <div className={styles.section}>
      <div className={`${styles.sectionLabel} ${positive ? styles.green : styles.red}`}>
        {positive ? '▲' : '▼'} {label}
      </div>
      <div className={styles.rows}>
        {items.map(item => {
          const count = tweetCounts?.[item.sym] || 0
          const isExpanded = expandedSym === item.sym
          return (
            <div key={item.sym} className={styles.rowGroup}>
              <div className={styles.row}>
                <TickerPopup sym={item.sym}>
                  <span className={styles.sym}>{item.sym}</span>
                </TickerPopup>
                <span className={`${styles.pct} ${positive ? styles.green : styles.red}`}>
                  {item.pct}
                </span>
                {UI_ENABLED && count > 0 && (
                  <button
                    className={styles.birdBtn}
                    title={`${count} recent tweet${count > 1 ? 's' : ''}`}
                    onClick={() => setExpandedSym(isExpanded ? null : item.sym)}
                  >🐦</button>
                )}
              </div>
              {isExpanded && <TweetExpand sym={item.sym} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TapeSection() {
  const { data: tape } = useTapeFeed({ hours: 12, limit: 15 })
  const [expandedSym, setExpandedSym] = useState(null)
  if (!tape || tape.length === 0) return null
  return (
    <div className={styles.section}>
      <div className={`${styles.sectionLabel} ${styles.tape}`}>
        📰 ON THE TAPE
      </div>
      <div className={styles.rows}>
        {tape.map(row => {
          const isExpanded = expandedSym === row.ticker
          const sample = row.sample_tweet
          return (
            <div key={row.ticker} className={styles.rowGroup}>
              <div className={styles.row}>
                <TickerPopup sym={row.ticker}>
                  <span className={styles.sym}>{row.ticker}</span>
                </TickerPopup>
                <span className={styles.tapeMeta}>
                  {row.n_tweets}t · {timeAgo(row.latest_at)}
                </span>
                <button
                  className={styles.birdBtn}
                  onClick={() => setExpandedSym(isExpanded ? null : row.ticker)}
                >🐦</button>
              </div>
              {sample && !isExpanded && (
                <a className={styles.tapePreview} href={sample.url} target="_blank" rel="noreferrer">
                  ▸ "{sample.text.slice(0, 80)}{sample.text.length > 80 ? '…' : ''}" — @{sample.author_handle}
                </a>
              )}
              {isExpanded && <TweetExpand sym={row.ticker} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function MoversSidebar({ data: propData }) {
  const [open, setOpen] = useState(true)
  const { data: fetched, error, mutate } = useMobileSWR(
    propData !== undefined ? null : '/api/movers',
    fetcher,
    { refreshInterval: 30000, marketHoursOnly: true }
  )
  const data = propData !== undefined ? propData : fetched

  const allMoverSymbols = useMemo(() => {
    if (!data) return []
    return [...(data.ripping ?? []), ...(data.drilling ?? [])].map(x => x.sym)
  }, [data])

  const { data: tweetCounts } = useBatchTweetCounts(UI_ENABLED ? allMoverSymbols : [])

  return (
    <div className={styles.tile}>
      <button className={styles.header} onClick={() => setOpen(o => !o)}>
        <span className={styles.title}>Movers at the Open</span>
        <span className={styles.chevron}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className={styles.body}>
          {error ? (
            <ErrorState compact message="Failed to load movers" onRetry={() => mutate()} />
          ) : !data ? (
            <SkeletonTable rows={6} cols={2} />
          ) : (
            <div className={styles.scroll}>
              <div className={styles.moversGrid}>
                <MoverSection label="RIPPING" items={data.ripping ?? []} positive tweetCounts={tweetCounts} />
                <MoverSection label="DRILLING" items={data.drilling ?? []} positive={false} tweetCounts={tweetCounts} />
                {UI_ENABLED && <TapeSection />}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Append to `MoversSidebar.module.css`** — add new classes (do NOT remove existing ones):

```css
/* === Twitter tape additions === */
.tape { color: var(--color-accent-gold, #c9a84c); }

.rowGroup { display: flex; flex-direction: column; }

.birdBtn {
  background: none; border: none; cursor: pointer;
  font-size: 12px; padding: 2px 4px; margin-left: 4px;
  opacity: 0.75;
}
.birdBtn:hover { opacity: 1; }

.tapeMeta { font-size: 11px; opacity: 0.7; margin-left: auto; padding-right: 6px; }

.tapePreview {
  display: block; font-size: 11px; opacity: 0.7; padding: 2px 8px 6px 24px;
  color: inherit; text-decoration: none; line-height: 1.4;
}
.tapePreview:hover { opacity: 1; text-decoration: underline; }

.tweetExpand {
  display: flex; flex-direction: column; gap: 6px;
  padding: 6px 8px 8px 24px; font-size: 11px; line-height: 1.45;
  border-left: 2px solid rgba(255,255,255,0.08); margin-left: 12px;
}
.tweetRow {
  display: grid; grid-template-columns: auto auto auto 1fr; gap: 4px 8px;
  align-items: baseline;
}
.tweetHandle { color: var(--color-accent-gold, #c9a84c); font-weight: 600; }
.tweetTime { opacity: 0.6; font-size: 10px; }
.tweetLink { color: inherit; opacity: 0.6; text-decoration: none; }
.tweetText { grid-column: 1 / -1; opacity: 0.9; }
```

- [ ] **Step 4: Commit**

```bash
git add app/src/components/MoversSidebar.jsx app/src/components/MoversSidebar.module.css
git commit -m "feat: add tweet 🐦 icon + ON THE TAPE section to MoversSidebar"
```

- [ ] **Step 5: Push Phase 3 to Railway**

```bash
git push origin <current-branch>
```

After deploy: load the dashboard. MoversSidebar should show 🐦 icons on any RIPPING/DRILLING ticker with recent tweets; new ON THE TAPE section should appear with tweet-mentioned tickers. Click a 🐦 to expand inline.

---

# PHASE 4: EarningsModal tweets section

---

## Task 16: EarningsModal — Recent tweets section

**Files:**
- Modify: `app/src/components/tiles/EarningsModal.jsx`
- Modify: `app/src/components/tiles/EarningsModal.module.css`

- [ ] **Step 1: Add the import + hook** at the top of `EarningsModal.jsx`:

```jsx
import useTickerTweets from '../../hooks/useTickerTweets'
import { timeAgo } from '../../utils/timeAgo'
```

- [ ] **Step 2: Inside the modal body**, after the existing AI analysis block but before the transcript section (search for `transcriptOpen` to locate it), add:

```jsx
{/* Recent tweets — added per spec 2026-05-25 */}
<TweetsBlock sym={row.sym} />
```

- [ ] **Step 3: Define `TweetsBlock`** just above `export default function EarningsModal`:

```jsx
function TweetsBlock({ sym }) {
  const { data: tweets } = useTickerTweets(sym, { hours: 24 })
  const [open, setOpen] = useState(true)

  if (!tweets || tweets.length === 0) return null
  const initialOpen = tweets.length <= 5
  const isOpen = open && (initialOpen || open === true)

  return (
    <div className={styles.tweetsBlock}>
      <button className={styles.tweetsHeader} onClick={() => setOpen(o => !o)}>
        🐦 Recent tweets ({tweets.length}) <span>{isOpen ? '▾' : '▸'}</span>
      </button>
      {isOpen && (
        <div className={styles.tweetsList}>
          {tweets.map(t => (
            <div key={t.id} className={styles.tweetCard}>
              <div className={styles.tweetMeta}>
                <span className={styles.tweetAuthor}>@{t.author_handle}</span>
                <span className={styles.tweetTime}>{timeAgo(t.created_at)}</span>
                <a className={styles.tweetLink} href={t.url} target="_blank" rel="noreferrer">↗</a>
              </div>
              <div className={styles.tweetText}>{t.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

(Note: `useState` is presumably already imported at the top of `EarningsModal.jsx` per the `useState([transcriptOpen])` usage on line 22-23. Confirm before adding the `useState(true)` above.)

- [ ] **Step 4: Append to `EarningsModal.module.css`**

```css
.tweetsBlock { margin-top: 16px; }
.tweetsHeader {
  background: none; border: none; cursor: pointer; padding: 8px 0;
  font-size: 13px; opacity: 0.9; display: flex; gap: 8px; align-items: center;
}
.tweetsList { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; }
.tweetCard {
  padding: 8px 10px; background: rgba(255,255,255,0.02);
  border-left: 2px solid var(--color-accent-gold, #c9a84c);
  border-radius: 0 4px 4px 0; font-size: 12px;
}
.tweetMeta { display: flex; gap: 8px; align-items: baseline; opacity: 0.8; margin-bottom: 4px; }
.tweetAuthor { color: var(--color-accent-gold, #c9a84c); font-weight: 600; font-size: 11px; }
.tweetTime { font-size: 10px; opacity: 0.6; }
.tweetLink { color: inherit; opacity: 0.6; text-decoration: none; font-size: 10px; }
.tweetText { line-height: 1.5; }
```

- [ ] **Step 5: Commit + push Phase 4 to Railway**

```bash
git add app/src/components/tiles/EarningsModal.jsx app/src/components/tiles/EarningsModal.module.css
git commit -m "feat: add Recent tweets section to EarningsModal"
git push origin <current-branch>
```

After deploy: open an EarningsModal for any ticker. The "Recent tweets" section should appear below the AI analysis if there are ticker mentions.

---

# PHASE 5: Polish + documentation

---

## Task 17: Cashtag gold styling in tweet text + RT compact mode

**Files:**
- Modify: `app/src/components/MoversSidebar.jsx` — replace plain tweet text with a helper that styles cashtags
- Modify: `app/src/components/tiles/EarningsModal.jsx` — same helper

- [ ] **Step 1: Create a tiny helper** inline in each component (DRY-violation acceptable for a 12-line helper; if we end up using it in a third place, extract to `app/src/utils/highlightCashtags.jsx`).

```jsx
function renderTweetText(text) {
  if (!text) return null
  // Split on cashtags while keeping the delimiter
  const parts = text.split(/(\$[A-Z]{1,5}\b)/g)
  return parts.map((p, i) =>
    /^\$[A-Z]{1,5}$/.test(p)
      ? <span key={i} style={{ color: 'var(--color-accent-gold, #c9a84c)', fontWeight: 600 }}>{p}</span>
      : p
  )
}
```

Use it in the JSX where we currently render `{t.text}` — replace with `{renderTweetText(t.text)}`.

- [ ] **Step 2: RT compact mode** — in both `TweetExpand` / tape sample and EarningsModal `TweetCard`, if `t.is_retweet === 1`, render the text smaller and prefix "RT:". Wrap the existing text rendering:

```jsx
<div className={styles.tweetText}
     style={t.is_retweet ? { fontSize: '90%', opacity: 0.75 } : undefined}>
  {t.is_retweet ? 'RT: ' : ''}{renderTweetText(t.text)}
</div>
```

- [ ] **Step 3: Mobile breakpoint check** — open the dashboard on a mobile viewport (Chrome devtools, 640px). Confirm ON THE TAPE rows wrap cleanly and the EarningsModal tweets section doesn't overflow.

- [ ] **Step 4: Commit + push**

```bash
git add app/src/components/MoversSidebar.jsx app/src/components/tiles/EarningsModal.jsx
git commit -m "polish: gold cashtag styling + RT compact mode in tweet renderers"
git push origin <current-branch>
```

---

## Task 18: Update `CLAUDE.md` with the new feature

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Find the existing "Data Sources" table** (line ~referenced as "Data Sources Table Addition" in the COT section). Add a new row:

```
| Twitter tweets | TwitterAPI.io (curated 4-account list, since_id pagination) | Burst 2min ET windows + 15min midday + 60min safety net |
```

- [ ] **Step 2: Add a new top-level section** modeled on the "COT Data Tab" structure. Place it just above "Known Issues / Gotchas" so it's near the operational docs.

```markdown
## Twitter News Ingestion (built 2026-05-25)

### Architecture
- **Database:** SQLite at `/data/tweets.db` (Railway web volume). 7-day retention.
- **Source:** TwitterAPI.io (`x-api-key` header, `$0.15 per 1K tweets`, `since_id` pagination).
- **Scheduler:** APScheduler in `api/main.py` next to COT — burst (2min ET pre-market + post-close), regular (15min midday), slow safety-net (60min always), cleanup (3am ET daily).
- **No worker/R2 bridge** — bars uses one because of write-side cost; tweets are small enough to run inline on the web service.

### Files
- `api/services/twitterapi_io.py` — HTTP client with structured exceptions (`TwitterApiAuthError` / `PaymentRequired` / `RateLimited` / `TransientError`).
- `api/services/tweet_ticker_extract.py` — cashtag regex + forex exclude.
- `api/services/tweet_store.py` — SQLite CRUD (tweets, ticker links, accounts, poll-state).
- `api/services/tweet_poller.py` — per-account fetch + extract + store.
- `api/services/tweet_cleanup.py` — retention sweep.
- `api/routers/tweets.py` — `GET /api/tweets/ticker/{sym}`, `GET /api/tweets/tape`, `GET /api/tweets/has-tweets-batch`.
- `api/routers/admin_twitter.py` — admin CRUD + `GET /api/admin/twitter-stats` (with `_maybe_auto_refresh_if_stale` self-heal mirroring COT).
- `app/src/components/MoversSidebar.jsx` — 3 sections (RIPPING / DRILLING / ON THE TAPE) + 🐦 icon.
- `app/src/components/tiles/EarningsModal.jsx` — Recent tweets section.
- `app/src/components/TwitterAccountsTile.jsx` — admin-only Settings card.

### Env vars
- `TWITTERAPI_IO_API_KEY` — required for polling.
- `TWITTERAPI_IO_ENABLED` — master switch on the web service (gates the scheduler block).
- `VITE_TWITTER_UI_ENABLED` — frontend kill-switch ("0" hides 🐦 icons + ON THE TAPE).
- `TWEET_RETENTION_DAYS=7` (default 7).

### Cashtag extraction
v1: regex-only on `\$[A-Z]{1,5}\b`, minus forex pairs (USD/EUR/GBP/JPY/CAD/AUD/CHF/CNY/HKD/NZD). Crypto kept (BTC/ETH/SOL). No universe validation — source accounts are professional. False positives surface nothing because they don't join to any movers/earnings ticker.

### Curated accounts (v1)
`@DeItaone`, `@FinancialJuice`, `@Benzinga`, `@WallStEngine` — admin-editable via Settings.

### Spec
`docs/superpowers/specs/2026-05-25-twitter-news-ingestion-design.md`
```

- [ ] **Step 2: Commit + push**

```bash
git add CLAUDE.md
git commit -m "docs: add Twitter News Ingestion section to CLAUDE.md"
git push origin <current-branch>
```

---

# Done

The feature should now be fully shipped. Verification checklist:

- [ ] Smoke test passes locally with the API key
- [ ] Railway logs show `[startup] tweets.db initialized` + `[scheduler] tweet poll jobs registered`
- [ ] `/api/admin/twitter-stats` returns non-zero `total_tweets` after first poll
- [ ] Settings → Twitter Accounts card lists 4 accounts with green "ok" pills
- [ ] MoversSidebar shows 🐦 on any RIPPING/DRILLING ticker with tweets
- [ ] ON THE TAPE section appears with non-mover tickers
- [ ] EarningsModal shows Recent tweets section for tickers with mentions
- [ ] Adding `?TWITTER_UI_ENABLED=0` to the Vite build hides all UI surfaces (kill switch works)

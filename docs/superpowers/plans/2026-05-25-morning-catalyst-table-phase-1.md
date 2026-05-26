# Morning Catalyst Table — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-source pre-market intelligence engine that pulls candidates from 7 existing data sources, composite-scores them, picks the top 12 with a forced category mix (6 Catalyst / 3 Earnings / 2 Gapper / 1 News), and uses Claude Opus 4.7 to synthesize a 2–3 sentence catalyst description per entry. Surfaces as a full-width tile at the top of Dashboard.

**Architecture:** APScheduler cron jobs run in the existing `acquire_scheduler_lock()` block in `api/main.py` alongside COT + Twitter. Each refresh: parallel source pulls → composite score → tag → quota select → Opus synthesis (with skip-if-stable hash + Haiku fallback + cost guard) → write to `/data/catalysts.db`. Frontend SWR-polls `/api/catalysts/today` and renders a 6-column table.

**Tech Stack:** FastAPI · SQLite (WAL) · APScheduler · Anthropic SDK (Claude Opus 4.7) · React + SWR · existing project services (Massive, Finnhub, EW, news_aggregator, tweet_store, scanner).

**Spec:** `docs/superpowers/specs/2026-05-25-morning-catalyst-table-design.md`

**User flow conventions** (from memory):
- Run phases end-to-end before polish; forward velocity > per-phase perfection
- Skip per-task heavy review gauntlet — implement, verify, commit + push to Railway
- Each task ends with a commit; phases end with a push

---

## File map (Phase 1 only)

**New backend files:**
- `api/services/catalyst/__init__.py` — empty marker
- `api/services/catalyst/sources.py` — 7 parallel source pulls; returns `list[Candidate]`
- `api/services/catalyst/scoring.py` — `score(candidate) -> float` pure function
- `api/services/catalyst/tagging.py` — `assign_tag(candidate) -> str` deterministic
- `api/services/catalyst/selection.py` — `select_top_12(scored) -> list[Candidate]`
- `api/services/catalyst/cost_guard.py` — daily spend tracking + soft/hard caps
- `api/services/catalyst/synthesize.py` — Opus call + skip-if-stable + Haiku fallback + validation
- `api/services/catalyst/store.py` — SQLite CRUD
- `api/services/catalyst/engine.py` — orchestrator `run_refresh()`
- `api/routers/catalysts.py` — `/api/catalysts/*` + `/api/admin/catalyst-stats`
- `tests/test_catalyst_scoring.py`
- `tests/test_catalyst_tagging.py`
- `tests/test_catalyst_selection.py`
- `tests/test_catalyst_cost_guard.py`
- `tests/test_catalyst_synthesize.py`
- `tests/test_catalyst_store.py`
- `tests/test_catalyst_engine.py`

**Modified backend files:**
- `api/main.py` — lifespan `_init_db()`, scheduler block, router registration

**New frontend files:**
- `app/src/components/tiles/CatalystTable.jsx`
- `app/src/components/tiles/CatalystTable.module.css`
- `app/src/utils/highlightThesis.jsx`
- `app/src/hooks/useCatalysts.js`

**Modified frontend files:**
- `app/src/pages/Dashboard.jsx` — mount `<CatalystTable />` at the top

**Modified docs:**
- `CLAUDE.md` — add "Morning Catalyst Table (built 2026-05-25)" section

---

# PHASE 1A: Backend foundation (Tasks 1–9, all gated off)

Ship the backend behind `CATALYST_ENGINE_ENABLED` unset. Routes exist, scheduler dormant. No user-visible change. Sets up the entire ingestion + synthesis pipeline.

---

## Task 1: SQLite store + schema

**Files:**
- Create: `api/services/catalyst/__init__.py` (empty)
- Create: `api/services/catalyst/store.py`
- Create: `tests/test_catalyst_store.py`

- [ ] **Step 1: Create empty package marker**

```python
# api/services/catalyst/__init__.py
```

- [ ] **Step 2: Write failing tests for store**

```python
# tests/test_catalyst_store.py
import json
import os
import tempfile
import time

import pytest

from api.services.catalyst import store


@pytest.fixture
def s(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(store, "_DB_PATH", os.path.join(d, "catalysts.db"))
        store._init_db()
        yield store


def _row(ticker, market_date="2026-05-26", rank=1, tag="Catalyst",
         thesis="test thesis", sources=None, signals_hash="abc", **kw):
    return {
        "market_date": market_date,
        "ticker": ticker,
        "rank": rank,
        "score": kw.get("score", 10.0),
        "tag": tag,
        "price": kw.get("price", 100.0),
        "gap_pct": kw.get("gap_pct", 5.0),
        "vol_x": kw.get("vol_x", 2.0),
        "market_cap": kw.get("market_cap", 1_000_000_000),
        "sector": kw.get("sector", "Tech"),
        "thesis_text": thesis,
        "thesis_model": kw.get("thesis_model", "claude-opus-4-7"),
        "thesis_at": kw.get("thesis_at", int(time.time())),
        "thesis_sources": json.dumps(sources or []),
        "signals_hash": signals_hash,
        "raw_signals": kw.get("raw_signals", "{}"),
    }


def test_upsert_is_idempotent_on_ticker_per_date(s):
    s.upsert_catalyst(_row("AAPL"))
    s.upsert_catalyst(_row("AAPL", thesis="updated"))
    rows = s.get_for_date("2026-05-26")
    assert len(rows) == 1
    assert rows[0]["thesis_text"] == "updated"


def test_get_for_date_orders_by_rank(s):
    s.upsert_catalyst(_row("ZZZ", rank=12))
    s.upsert_catalyst(_row("AAA", rank=1))
    s.upsert_catalyst(_row("MID", rank=5))
    rows = s.get_for_date("2026-05-26")
    assert [r["ticker"] for r in rows] == ["AAA", "MID", "ZZZ"]


def test_get_today_returns_only_today(s):
    s.upsert_catalyst(_row("YES", market_date="2026-05-26"))
    s.upsert_catalyst(_row("OLD", market_date="2026-05-20"))
    today = s.get_for_date("2026-05-26")
    assert {r["ticker"] for r in today} == {"YES"}


def test_get_ticker_today_for_skip_stable_check(s):
    s.upsert_catalyst(_row("AAPL", signals_hash="hash1"))
    found = s.get_ticker_for_date("AAPL", "2026-05-26")
    assert found["signals_hash"] == "hash1"
    assert s.get_ticker_for_date("MISSING", "2026-05-26") is None


def test_clear_unselected_for_date_keeps_top_12(s):
    """When re-running selection, rows that drop out get rank=NULL but stay
    in the DB for historical analysis."""
    for i, t in enumerate(["A", "B", "C"]):
        s.upsert_catalyst(_row(t, rank=i + 1))
    s.clear_ranks_for_date("2026-05-26")
    rows = s.get_for_date("2026-05-26", ranked_only=False)
    assert all(r["rank"] is None for r in rows)


def test_cost_log_writes(s):
    s.log_cost(market_date="2026-05-26", ticker="AAPL",
               model="claude-opus-4-7", input_tokens=1000,
               output_tokens=250, cost_usd=0.015, was_cached=False)
    s.log_cost(market_date="2026-05-26", ticker="MSFT",
               model="claude-opus-4-7", input_tokens=0,
               output_tokens=0, cost_usd=0.0, was_cached=True)
    stats = s.cost_stats_for_date("2026-05-26")
    assert stats["total_cost_usd"] == pytest.approx(0.015)
    assert stats["call_count"] == 2
    assert stats["cached_count"] == 1
```

- [ ] **Step 3: Run tests, expect failure**

```bash
pytest tests/test_catalyst_store.py -v
```
Expected: `ImportError: cannot import name 'store' from 'api.services.catalyst'`

- [ ] **Step 4: Implement the store**

```python
# api/services/catalyst/store.py
"""SQLite store for catalyst rows + cost log.

DB path: /data/catalysts.db (web service Railway volume).
WAL mode for concurrent reads during background refresh.
All connections wrapped in contextlib.closing — same pattern as
tweet_store.py (Windows teardown requires explicit close).
"""
from __future__ import annotations

import contextlib
import os
import sqlite3
import threading
import time
from typing import Optional

_DB_PATH = os.environ.get("CATALYST_DB_PATH", "/data/catalysts.db")
_WRITE_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS catalysts (
  market_date     TEXT NOT NULL,
  ticker          TEXT NOT NULL,
  rank            INTEGER,
  score           REAL,
  tag             TEXT,
  price           REAL,
  gap_pct         REAL,
  vol_x           REAL,
  market_cap      REAL,
  sector          TEXT,
  thesis_text     TEXT,
  thesis_model    TEXT,
  thesis_at       INTEGER,
  thesis_sources  TEXT,
  signals_hash    TEXT,
  raw_signals     TEXT,
  PRIMARY KEY (market_date, ticker)
);
CREATE INDEX IF NOT EXISTS idx_catalysts_date_rank  ON catalysts(market_date, rank);
CREATE INDEX IF NOT EXISTS idx_catalysts_date_score ON catalysts(market_date, score DESC);

CREATE TABLE IF NOT EXISTS catalyst_cost_log (
  ts              INTEGER NOT NULL,
  market_date     TEXT NOT NULL,
  ticker          TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cost_usd        REAL,
  was_cached      INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_catalyst_cost_date ON catalyst_cost_log(market_date);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _init_db() -> None:
    parent = os.path.dirname(_DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        c.commit()


def upsert_catalyst(row: dict) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO catalysts
               (market_date, ticker, rank, score, tag, price, gap_pct, vol_x,
                market_cap, sector, thesis_text, thesis_model, thesis_at,
                thesis_sources, signals_hash, raw_signals)
               VALUES (:market_date, :ticker, :rank, :score, :tag, :price, :gap_pct,
                       :vol_x, :market_cap, :sector, :thesis_text, :thesis_model,
                       :thesis_at, :thesis_sources, :signals_hash, :raw_signals)
               ON CONFLICT(market_date, ticker) DO UPDATE SET
                 rank           = excluded.rank,
                 score          = excluded.score,
                 tag            = excluded.tag,
                 price          = excluded.price,
                 gap_pct        = excluded.gap_pct,
                 vol_x          = excluded.vol_x,
                 market_cap     = excluded.market_cap,
                 sector         = excluded.sector,
                 thesis_text    = excluded.thesis_text,
                 thesis_model   = excluded.thesis_model,
                 thesis_at      = excluded.thesis_at,
                 thesis_sources = excluded.thesis_sources,
                 signals_hash   = excluded.signals_hash,
                 raw_signals    = excluded.raw_signals""",
            row,
        )
        c.commit()


def get_for_date(market_date: str, ranked_only: bool = True) -> list[dict]:
    sql = "SELECT * FROM catalysts WHERE market_date = ?"
    if ranked_only:
        sql += " AND rank IS NOT NULL"
    sql += " ORDER BY rank ASC NULLS LAST, score DESC"
    with contextlib.closing(_connect()) as c:
        return [dict(r) for r in c.execute(sql, (market_date,)).fetchall()]


def get_ticker_for_date(ticker: str, market_date: str) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT * FROM catalysts WHERE market_date = ? AND ticker = ?",
            (market_date, ticker),
        ).fetchone()
        return dict(row) if row else None


def clear_ranks_for_date(market_date: str) -> None:
    """Null-out ranks for all rows on a given date. Called before re-ranking
    so that dropped tickers stay in the DB (rank=NULL) for historical view."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE catalysts SET rank = NULL WHERE market_date = ?",
                  (market_date,))
        c.commit()


def log_cost(*, market_date: str, ticker: str, model: str,
             input_tokens: int, output_tokens: int,
             cost_usd: float, was_cached: bool) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO catalyst_cost_log
               (ts, market_date, ticker, model, input_tokens, output_tokens,
                cost_usd, was_cached)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (int(time.time()), market_date, ticker, model,
             input_tokens, output_tokens, cost_usd, 1 if was_cached else 0),
        )
        c.commit()


def cost_stats_for_date(market_date: str) -> dict:
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            """SELECT COUNT(*) AS call_count,
                      COALESCE(SUM(cost_usd), 0.0) AS total_cost_usd,
                      COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
                      COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
                      COALESCE(SUM(was_cached), 0) AS cached_count
               FROM catalyst_cost_log WHERE market_date = ?""",
            (market_date,),
        ).fetchone()
        return dict(row)


def cost_stats_mtd(year_month: str) -> dict:
    """year_month format: 'YYYY-MM'. Returns aggregate for that month."""
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            """SELECT COUNT(*) AS call_count,
                      COALESCE(SUM(cost_usd), 0.0) AS total_cost_usd
               FROM catalyst_cost_log WHERE market_date LIKE ?""",
            (f"{year_month}-%",),
        ).fetchone()
        return dict(row)
```

- [ ] **Step 5: Run tests, verify pass**

```bash
pytest tests/test_catalyst_store.py -v
```
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add api/services/catalyst/__init__.py api/services/catalyst/store.py tests/test_catalyst_store.py
git commit -m "feat: catalyst store SQLite schema + CRUD + cost log"
```

---

## Task 2: Scoring (pure function)

**Files:**
- Create: `api/services/catalyst/scoring.py`
- Create: `tests/test_catalyst_scoring.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_catalyst_scoring.py
import pytest
from api.services.catalyst.scoring import score


def _c(**overrides):
    """Build a candidate dict with safe defaults."""
    defaults = {
        "ticker": "TEST",
        "price": 50.0,
        "gap_pct": 5.0,
        "vol_x": 2.0,
        "tweet_mention_count": 0,
        "rss_headline_count": 0,
        "earnings_just_reported": False,
        "scanner_setup": None,
        "sector_momentum_count": 0,
    }
    defaults.update(overrides)
    return defaults


def test_gap_dominates_baseline():
    low = score(_c(gap_pct=1.0))
    high = score(_c(gap_pct=20.0))
    assert high > low


def test_vol_x_increases_score():
    flat = score(_c(vol_x=1.0))
    surge = score(_c(vol_x=10.0))
    assert surge > flat


def test_vol_x_is_logarithmic_not_linear():
    """Going from 10x to 100x should add less than 1x to 10x (log behavior)."""
    s1, s2, s3 = score(_c(vol_x=1.0)), score(_c(vol_x=10.0)), score(_c(vol_x=100.0))
    assert (s2 - s1) > (s3 - s2)


def test_tweet_mentions_add_score():
    quiet = score(_c(tweet_mention_count=0))
    loud = score(_c(tweet_mention_count=5))
    assert loud > quiet


def test_rss_headline_weight_higher_than_tweets():
    s_tweet = score(_c(tweet_mention_count=1))
    s_rss = score(_c(rss_headline_count=1))
    assert s_rss > s_tweet


def test_earnings_just_reported_big_bonus():
    no_er = score(_c(earnings_just_reported=False))
    er = score(_c(earnings_just_reported=True))
    assert (er - no_er) >= 20


def test_scanner_setup_bonus():
    no_setup = score(_c(scanner_setup=None))
    has_setup = score(_c(scanner_setup="PB"))
    assert (has_setup - no_setup) >= 12


def test_penny_stock_penalty():
    """Stocks under $5 are downweighted; under $2 even more."""
    mid = score(_c(price=10.0, gap_pct=10.0))
    sub5 = score(_c(price=3.0, gap_pct=10.0))
    sub2 = score(_c(price=1.5, gap_pct=10.0))
    assert sub5 < mid
    assert sub2 < sub5


def test_negative_gap_uses_abs():
    """Big drops should score the same as big gains for ranking purposes."""
    up = score(_c(gap_pct=10.0))
    down = score(_c(gap_pct=-10.0))
    assert up == pytest.approx(down)


def test_zero_safe():
    """All-zero candidate should not crash or return NaN."""
    s = score(_c(gap_pct=0, vol_x=0, tweet_mention_count=0,
                 rss_headline_count=0))
    assert isinstance(s, float)
    assert s == s  # not NaN
```

- [ ] **Step 2: Run, expect failure**

```bash
pytest tests/test_catalyst_scoring.py -v
```

- [ ] **Step 3: Implement scoring**

```python
# api/services/catalyst/scoring.py
"""Composite scoring formula. Pure function — easy to tune in isolation.

All weights are env-var overridable so live tuning doesn't need a redeploy.
"""
import math
import os


def _w(name: str, default: float) -> float:
    """Read a weight from env or return default."""
    raw = os.environ.get(f"CATALYST_SCORE_W_{name}")
    return float(raw) if raw else default


def score(c: dict) -> float:
    """Composite score for a candidate. Higher = more interesting."""
    s = 0.0

    # Raw gap — primary signal. abs() so big drops score same as big gains.
    s += abs(c.get("gap_pct", 0.0)) * _w("GAP", 1.0)

    # Log-volume bonus (plateaus past ~100x).
    vol_x = max(1.0, c.get("vol_x", 1.0))
    s += math.log(vol_x) * _w("VOLX", 15.0)

    # Social + news signals
    s += c.get("tweet_mention_count", 0) * _w("TWEET_MENTION", 5.0)
    s += c.get("rss_headline_count", 0) * _w("RSS_HEADLINE", 8.0)

    # Earnings — huge bonus for AMC/BMO reporters
    if c.get("earnings_just_reported"):
        s += _w("EARNINGS_REPORTED", 20.0)

    # UCT scanner already flagged this — credit it
    if c.get("scanner_setup"):
        s += _w("SCANNER_SETUP", 12.0)

    # Sector momentum: each peer in candidate pool adds a small bonus
    s += c.get("sector_momentum_count", 0) * _w("SECTOR_MOMENTUM", 5.0)

    # Penny stock penalties
    price = c.get("price", 100.0) or 100.0
    floor = float(os.environ.get("CATALYST_PRICE_FLOOR", "2.0"))
    if price < 5.0:
        s -= _w("PENNY_5_PENALTY", 20.0)
    if price < floor:
        s -= _w("PENNY_FLOOR_PENALTY", 30.0)

    return s
```

- [ ] **Step 4: Run, verify pass**

```bash
pytest tests/test_catalyst_scoring.py -v
```

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/scoring.py tests/test_catalyst_scoring.py
git commit -m "feat: catalyst composite scoring formula with env-tunable weights"
```

---

## Task 3: Tagging (deterministic)

**Files:**
- Create: `api/services/catalyst/tagging.py`
- Create: `tests/test_catalyst_tagging.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_catalyst_tagging.py
import pytest
from api.services.catalyst.tagging import assign_tag


def _c(**overrides):
    defaults = {
        "ticker": "TEST",
        "gap_pct": 2.0,
        "vol_x": 1.5,
        "tweet_mention_count": 0,
        "rss_headline_count": 0,
        "earnings_reported_recently": False,
    }
    defaults.update(overrides)
    return defaults


def test_earnings_wins_first():
    """Earnings tag wins even when other signals present."""
    c = _c(earnings_reported_recently=True, tweet_mention_count=5,
           rss_headline_count=3, gap_pct=10.0)
    assert assign_tag(c) == "Earnings"


def test_catalyst_when_2_tweets():
    c = _c(tweet_mention_count=2)
    assert assign_tag(c) == "Catalyst"


def test_catalyst_when_1_rss():
    c = _c(rss_headline_count=1)
    assert assign_tag(c) == "Catalyst"


def test_gapper_when_big_gap_no_news():
    c = _c(gap_pct=8.0, vol_x=5.0)
    assert assign_tag(c) == "Gapper"


def test_gapper_requires_both_gap_and_volume():
    """5%+ gap WITHOUT vol_x >= 3.0 doesn't qualify as Gapper."""
    c = _c(gap_pct=8.0, vol_x=1.5)
    assert assign_tag(c) != "Gapper"


def test_news_when_1_tweet_and_small_gap():
    c = _c(tweet_mention_count=1, gap_pct=1.0)
    assert assign_tag(c) == "News"


def test_none_when_no_signals():
    c = _c()
    assert assign_tag(c) is None


def test_negative_gap_counts_for_gapper():
    c = _c(gap_pct=-8.0, vol_x=5.0)
    assert assign_tag(c) == "Gapper"
```

- [ ] **Step 2: Run, expect failure**

```bash
pytest tests/test_catalyst_tagging.py -v
```

- [ ] **Step 3: Implement tagging**

```python
# api/services/catalyst/tagging.py
"""Deterministic tag assignment for a candidate. Runs BEFORE scoring.
Order matters — Earnings wins, then Catalyst, then Gapper, then News."""
from typing import Optional


def assign_tag(c: dict) -> Optional[str]:
    if c.get("earnings_reported_recently"):
        return "Earnings"
    if c.get("tweet_mention_count", 0) >= 2 or c.get("rss_headline_count", 0) >= 1:
        return "Catalyst"
    if abs(c.get("gap_pct", 0.0)) >= 5.0 and c.get("vol_x", 0.0) >= 3.0:
        return "Gapper"
    if c.get("tweet_mention_count", 0) >= 1:
        return "News"
    return None
```

- [ ] **Step 4: Run, verify pass**

```bash
pytest tests/test_catalyst_tagging.py -v
```

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/tagging.py tests/test_catalyst_tagging.py
git commit -m "feat: catalyst deterministic tag assignment (Earnings > Catalyst > Gapper > News)"
```

---

## Task 4: Selection (6/3/2/1 quota)

**Files:**
- Create: `api/services/catalyst/selection.py`
- Create: `tests/test_catalyst_selection.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_catalyst_selection.py
import pytest
from api.services.catalyst.selection import select_top_12


def _c(ticker, tag, score):
    return {"ticker": ticker, "tag": tag, "score": score}


def test_fills_quotas_exactly():
    scored = (
        [_c(f"CAT{i}", "Catalyst", 100 - i) for i in range(20)]
        + [_c(f"ERN{i}", "Earnings", 90 - i) for i in range(10)]
        + [_c(f"GAP{i}", "Gapper", 80 - i) for i in range(10)]
        + [_c(f"NEW{i}", "News", 70 - i) for i in range(5)]
    )
    top = select_top_12(scored)
    assert len(top) == 12
    tag_counts = {}
    for c in top:
        tag_counts[c["tag"]] = tag_counts.get(c["tag"], 0) + 1
    assert tag_counts["Catalyst"] == 6
    assert tag_counts["Earnings"] == 3
    assert tag_counts["Gapper"] == 2
    assert tag_counts["News"] == 1


def test_picks_highest_score_per_bucket():
    scored = [
        _c("A_HIGH", "Catalyst", 100),
        _c("A_LOW", "Catalyst", 1),
        _c("B_HIGH", "Earnings", 90),
    ]
    top = select_top_12(scored)
    tickers = {c["ticker"] for c in top}
    assert "A_HIGH" in tickers
    assert "B_HIGH" in tickers


def test_redistributes_when_bucket_empty():
    """No Earnings candidates -> the 3 Earnings slots get filled by
    next-highest from any bucket."""
    scored = (
        [_c(f"CAT{i}", "Catalyst", 100 - i) for i in range(20)]
        + [_c(f"GAP{i}", "Gapper", 50 - i) for i in range(5)]
        + [_c(f"NEW{i}", "News", 40 - i) for i in range(5)]
    )
    top = select_top_12(scored)
    assert len(top) == 12
    cat_count = sum(1 for c in top if c["tag"] == "Catalyst")
    assert cat_count >= 6  # 6 baseline + 3 redistributed from empty Earnings


def test_returns_sorted_by_score_desc():
    scored = [
        _c("LOW", "Catalyst", 10),
        _c("HIGH", "Earnings", 100),
        _c("MID", "Gapper", 50),
    ]
    top = select_top_12(scored)
    scores = [c["score"] for c in top]
    assert scores == sorted(scores, reverse=True)


def test_handles_fewer_than_12_candidates():
    scored = [
        _c("A", "Catalyst", 10),
        _c("B", "Earnings", 5),
    ]
    top = select_top_12(scored)
    assert len(top) == 2


def test_ignores_unknown_tags():
    scored = [
        _c("BAD", "WeirdTag", 999),
        _c("GOOD", "Catalyst", 1),
    ]
    top = select_top_12(scored)
    assert "BAD" not in {c["ticker"] for c in top}
    assert "GOOD" in {c["ticker"] for c in top}
```

- [ ] **Step 2: Run, expect failure**

```bash
pytest tests/test_catalyst_selection.py -v
```

- [ ] **Step 3: Implement selection**

```python
# api/services/catalyst/selection.py
"""Forced category-mix selector. Picks top 12 across 4 buckets, then
redistributes empty quotas to next-highest-scored leftovers."""
import os
from collections import defaultdict


_KNOWN_TAGS = ("Catalyst", "Earnings", "Gapper", "News")


def _quota(tag: str, default: int) -> int:
    return int(os.environ.get(f"CATALYST_QUOTA_{tag.upper()}", default))


def select_top_12(scored: list[dict]) -> list[dict]:
    quotas = {
        "Catalyst": _quota("Catalyst", 6),
        "Earnings": _quota("Earnings", 3),
        "Gapper":   _quota("Gapper", 2),
        "News":     _quota("News", 1),
    }
    total = sum(quotas.values())

    # Bucket scored candidates by tag (drop unknown tags entirely)
    buckets = defaultdict(list)
    for c in scored:
        if c.get("tag") in _KNOWN_TAGS:
            buckets[c["tag"]].append(c)
    for k in buckets:
        buckets[k].sort(key=lambda c: c.get("score", 0.0), reverse=True)

    # Pull quota from each bucket
    selected: list[dict] = []
    for tag, n in quotas.items():
        selected.extend(buckets[tag][:n])

    # Redistribute unfilled slots to next-highest leftovers (any tag)
    if len(selected) < total:
        chosen_ids = {id(c) for c in selected}
        leftovers = sorted(
            [c for c in scored
             if c.get("tag") in _KNOWN_TAGS and id(c) not in chosen_ids],
            key=lambda c: c.get("score", 0.0),
            reverse=True,
        )
        selected.extend(leftovers[: total - len(selected)])

    selected.sort(key=lambda c: c.get("score", 0.0), reverse=True)
    return selected
```

- [ ] **Step 4: Run, verify pass**

```bash
pytest tests/test_catalyst_selection.py -v
```

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/selection.py tests/test_catalyst_selection.py
git commit -m "feat: catalyst forced-mix selector with quota redistribution"
```

---

## Task 5: Cost guard

**Files:**
- Create: `api/services/catalyst/cost_guard.py`
- Create: `tests/test_catalyst_cost_guard.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_catalyst_cost_guard.py
import os
import tempfile

import pytest

from api.services.catalyst import cost_guard, store


@pytest.fixture
def s(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(store, "_DB_PATH", os.path.join(d, "catalysts.db"))
        store._init_db()
        # Reset module-level state
        cost_guard._HARD_CAP_TRIPPED = False
        yield


def test_under_soft_cap_allows(s):
    assert cost_guard.may_synthesize("2026-05-26") is True


def test_estimate_call_cost():
    """Opus 4.7 pricing: $15/M input tokens, $75/M output tokens (2026 pricing)."""
    cost = cost_guard.estimate_cost("claude-opus-4-7",
                                    input_tokens=1000, output_tokens=250)
    # 1000 * 15/1M + 250 * 75/1M = 0.015 + 0.01875 = 0.03375
    assert cost == pytest.approx(0.03375, rel=1e-3)


def test_haiku_pricing_is_cheaper():
    opus = cost_guard.estimate_cost("claude-opus-4-7", 1000, 250)
    haiku = cost_guard.estimate_cost("claude-haiku-4-5", 1000, 250)
    assert haiku < opus


def test_hard_cap_blocks_further_synthesis(s, monkeypatch):
    monkeypatch.setenv("CATALYST_COST_HARD_CAP", "0.10")
    # Pre-populate cost log to exceed hard cap
    store.log_cost(market_date="2026-05-26", ticker="X",
                   model="claude-opus-4-7", input_tokens=10000,
                   output_tokens=1000, cost_usd=0.50,
                   was_cached=False)
    assert cost_guard.may_synthesize("2026-05-26") is False


def test_soft_cap_logs_warning_but_allows(s, monkeypatch, caplog):
    monkeypatch.setenv("CATALYST_COST_CAP_DAILY", "0.10")
    monkeypatch.setenv("CATALYST_COST_HARD_CAP", "999.99")
    store.log_cost(market_date="2026-05-26", ticker="X",
                   model="claude-opus-4-7", input_tokens=10000,
                   output_tokens=1000, cost_usd=0.50,
                   was_cached=False)
    # Soft cap exceeded but hard cap not — should still allow
    import logging
    with caplog.at_level(logging.WARNING):
        assert cost_guard.may_synthesize("2026-05-26") is True
    assert any("soft cap" in r.message.lower() for r in caplog.records)
```

- [ ] **Step 2: Run, expect failure**

```bash
pytest tests/test_catalyst_cost_guard.py -v
```

- [ ] **Step 3: Implement cost guard**

```python
# api/services/catalyst/cost_guard.py
"""Tracks daily spend, enforces soft + hard caps.

Anthropic pricing (USD per million tokens, 2026):
  claude-opus-4-7:  $15.00 input, $75.00 output
  claude-haiku-4-5: $0.80 input,  $4.00  output
"""
import logging
import os

from api.services.catalyst import store

logger = logging.getLogger(__name__)

# Module-level latch so we only log the soft-cap warning once per day
_SOFT_CAP_LOGGED_FOR_DATE: str | None = None
_HARD_CAP_TRIPPED = False

_PRICING = {
    "claude-opus-4-7":  {"input": 15.0, "output": 75.0},
    "claude-haiku-4-5": {"input": 0.80, "output": 4.0},
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """USD cost for one call. Returns 0 if model unknown."""
    # Tolerate dated model aliases like claude-haiku-4-5-20251001
    base = model.rsplit("-", 1)[0] if model.count("-") >= 3 else model
    rates = _PRICING.get(model) or _PRICING.get(base)
    if not rates:
        logger.warning("[cost_guard] unknown model pricing: %s", model)
        return 0.0
    return (input_tokens * rates["input"] / 1_000_000.0
            + output_tokens * rates["output"] / 1_000_000.0)


def may_synthesize(market_date: str) -> bool:
    """Returns False if hard cap exceeded for the day. Logs warning if soft
    cap exceeded but still returns True."""
    global _SOFT_CAP_LOGGED_FOR_DATE
    soft = float(os.environ.get("CATALYST_COST_CAP_DAILY", "5.00"))
    hard = float(os.environ.get("CATALYST_COST_HARD_CAP", "10.00"))

    stats = store.cost_stats_for_date(market_date)
    spent = stats.get("total_cost_usd", 0.0)

    if spent >= hard:
        if not _HARD_CAP_TRIPPED:
            logger.error("[cost_guard] HARD CAP exceeded for %s: $%.2f >= $%.2f. "
                         "Synthesis disabled for remainder of day.",
                         market_date, spent, hard)
        return False

    if spent >= soft and _SOFT_CAP_LOGGED_FOR_DATE != market_date:
        logger.warning("[cost_guard] soft cap exceeded for %s: $%.2f >= $%.2f. "
                       "Synthesis continues until hard cap $%.2f.",
                       market_date, spent, soft, hard)
        _SOFT_CAP_LOGGED_FOR_DATE = market_date

    return True


def record(market_date: str, ticker: str, model: str,
           input_tokens: int, output_tokens: int,
           was_cached: bool = False) -> float:
    """Record a synthesis call. Returns the cost in USD."""
    cost = 0.0 if was_cached else estimate_cost(model, input_tokens, output_tokens)
    store.log_cost(market_date=market_date, ticker=ticker, model=model,
                   input_tokens=input_tokens, output_tokens=output_tokens,
                   cost_usd=cost, was_cached=was_cached)
    return cost
```

- [ ] **Step 4: Run, verify pass**

```bash
pytest tests/test_catalyst_cost_guard.py -v
```

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/cost_guard.py tests/test_catalyst_cost_guard.py
git commit -m "feat: catalyst cost guard with Opus pricing + soft/hard caps"
```

---

## Task 6: Synthesize (Opus 4.7 with skip-if-stable + fallback)

**Files:**
- Create: `api/services/catalyst/synthesize.py`
- Create: `tests/test_catalyst_synthesize.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_catalyst_synthesize.py
import json
import os
import tempfile
from unittest.mock import MagicMock, patch

import pytest

from api.services.catalyst import store, synthesize


@pytest.fixture
def s(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(store, "_DB_PATH", os.path.join(d, "catalysts.db"))
        store._init_db()
        yield


def _candidate(**kw):
    return {
        "ticker": kw.get("ticker", "AAPL"),
        "company": kw.get("company", "Apple Inc"),
        "price": kw.get("price", 150.0),
        "gap_pct": kw.get("gap_pct", 3.5),
        "vol_x": kw.get("vol_x", 2.0),
        "market_cap": kw.get("market_cap", 2_500_000_000_000),
        "sector": kw.get("sector", "Tech"),
        "tweets": kw.get("tweets", []),
        "rss": kw.get("rss", []),
        "earnings_meta": kw.get("earnings_meta"),
        "scanner_setup": kw.get("scanner_setup"),
    }


def _mock_opus_response(text):
    """Build a MagicMock that mimics Anthropic SDK response shape."""
    block = MagicMock(); block.text = text
    msg = MagicMock()
    msg.content = [block]
    msg.usage = MagicMock()
    msg.usage.input_tokens = 1000
    msg.usage.output_tokens = 250
    return msg


def test_signals_hash_stable_for_same_inputs():
    c1 = _candidate(tweets=[{"id": "1", "text": "x"}])
    c2 = _candidate(tweets=[{"id": "1", "text": "x"}])
    assert synthesize.compute_signals_hash(c1) == synthesize.compute_signals_hash(c2)


def test_signals_hash_changes_when_inputs_change():
    c1 = _candidate(tweets=[{"id": "1", "text": "x"}])
    c2 = _candidate(tweets=[{"id": "2", "text": "y"}])
    assert synthesize.compute_signals_hash(c1) != synthesize.compute_signals_hash(c2)


def test_skip_if_stable_reuses_prior_thesis(s):
    c = _candidate()
    h = synthesize.compute_signals_hash(c)
    # Pre-populate prior thesis with matching hash
    store.upsert_catalyst({
        "market_date": "2026-05-26", "ticker": "AAPL", "rank": 1,
        "score": 50.0, "tag": "Catalyst", "price": 150.0, "gap_pct": 3.5,
        "vol_x": 2.0, "market_cap": 2_500_000_000_000, "sector": "Tech",
        "thesis_text": "Cached thesis", "thesis_model": "claude-opus-4-7",
        "thesis_at": 1000, "thesis_sources": "[]",
        "signals_hash": h, "raw_signals": "{}",
    })
    with patch("api.services.catalyst.synthesize._call_anthropic") as mock_call:
        result = synthesize.synthesize_ticker(c, "2026-05-26")
    mock_call.assert_not_called()
    assert result["thesis_text"] == "Cached thesis"
    assert result["was_cached"] is True


def test_opus_call_on_fresh_input(s):
    c = _candidate()
    payload = {"thesis": "**Apple** beat earnings.", "tag": "Earnings",
               "source_urls": ["http://x"]}
    with patch("api.services.catalyst.synthesize._call_anthropic",
               return_value=(_mock_opus_response(json.dumps(payload)), 1000, 250)):
        result = synthesize.synthesize_ticker(c, "2026-05-26")
    assert result["thesis_text"] == payload["thesis"]
    assert result["was_cached"] is False
    assert result["thesis_model"] == "claude-opus-4-7"


def test_falls_back_to_haiku_on_opus_5xx(s):
    c = _candidate()
    payload = {"thesis": "Fallback haiku.", "tag": "News", "source_urls": []}
    # First call (Opus) raises, second call (Haiku) succeeds
    call_count = {"n": 0}

    def side_effect(model, prompt, system):
        call_count["n"] += 1
        if "opus" in model:
            raise Exception("APIError: 500 Internal Server Error")
        return (_mock_opus_response(json.dumps(payload)), 500, 100)

    with patch("api.services.catalyst.synthesize._call_anthropic",
               side_effect=side_effect):
        result = synthesize.synthesize_ticker(c, "2026-05-26")
    assert result["thesis_model"].startswith("claude-haiku")
    assert "Fallback" in result["thesis_text"]
    assert call_count["n"] == 2


def test_no_sources_synthesis_must_say_no_catalyst(s):
    """When source pool empty, prompt mandates 'no clear catalyst' substring;
    if response missing it, we substitute the canned text."""
    c = _candidate(tweets=[], rss=[], earnings_meta=None, scanner_setup=None)
    bad_payload = {"thesis": "Apple surged on bullish vibes.", "tag": "Gapper",
                   "source_urls": []}
    good_payload = {"thesis": "No clear catalyst identified. Source pool was thin.",
                    "tag": "Gapper", "source_urls": []}
    # First Opus call returns bad output (no required phrase) — re-prompt
    # Second Opus call returns good output
    responses = iter([
        (_mock_opus_response(json.dumps(bad_payload)), 1000, 100),
        (_mock_opus_response(json.dumps(good_payload)), 1000, 100),
    ])
    with patch("api.services.catalyst.synthesize._call_anthropic",
               side_effect=lambda *a, **kw: next(responses)):
        result = synthesize.synthesize_ticker(c, "2026-05-26")
    assert "no clear catalyst" in result["thesis_text"].lower()


def test_malformed_json_keeps_prior_thesis(s):
    c = _candidate()
    h = synthesize.compute_signals_hash(c)
    store.upsert_catalyst({
        "market_date": "2026-05-26", "ticker": "AAPL", "rank": 1,
        "score": 50.0, "tag": "Catalyst", "price": 150.0, "gap_pct": 3.5,
        "vol_x": 2.0, "market_cap": 2_500_000_000_000, "sector": "Tech",
        "thesis_text": "Prior good thesis", "thesis_model": "claude-opus-4-7",
        "thesis_at": 1000, "thesis_sources": "[]",
        "signals_hash": "different_hash", "raw_signals": "{}",
    })
    with patch("api.services.catalyst.synthesize._call_anthropic",
               return_value=(_mock_opus_response("not valid json {"), 1000, 100)):
        result = synthesize.synthesize_ticker(c, "2026-05-26")
    assert result["thesis_text"] == "Prior good thesis"


def test_cost_cap_blocks_synthesis(s, monkeypatch):
    monkeypatch.setenv("CATALYST_COST_HARD_CAP", "0.001")
    # Pre-spend the cap
    store.log_cost(market_date="2026-05-26", ticker="X",
                   model="claude-opus-4-7", input_tokens=1000,
                   output_tokens=1000, cost_usd=1.0, was_cached=False)
    c = _candidate()
    with patch("api.services.catalyst.synthesize._call_anthropic") as mock_call:
        result = synthesize.synthesize_ticker(c, "2026-05-26")
    mock_call.assert_not_called()
    assert "cost cap reached" in result["thesis_text"].lower() or result["was_cached"]
```

- [ ] **Step 2: Run, expect failure**

```bash
pytest tests/test_catalyst_synthesize.py -v
```

- [ ] **Step 3: Implement synthesize**

```python
# api/services/catalyst/synthesize.py
"""Opus 4.7 catalyst synthesis with skip-if-stable hash, Haiku fallback,
malformed-JSON recovery, no-sources enforcement, and cost guarding."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from typing import Optional

from api.services.catalyst import cost_guard, store

logger = logging.getLogger(__name__)

OPUS_MODEL = os.environ.get("CATALYST_OPUS_MODEL", "claude-opus-4-7")
HAIKU_FALLBACK = os.environ.get("CATALYST_HAIKU_FALLBACK_MODEL", "claude-haiku-4-5")

SYSTEM_PROMPT = """You write pre-market trading catalyst summaries for a professional trader's morning dashboard.

Rules:
  - Output JSON only: {"thesis": "...", "tag": "...", "source_urls": [...]}
  - thesis is 2-3 sentences, plain factual English, NO buy/sell recommendations
  - Bold $AMOUNTS, percentages, and company names with **markdown**
  - Cite source category in parentheses: (Earnings · Tweet · News · Scanner)
  - If signals are thin or contradictory, the thesis MUST contain the literal phrase "no clear catalyst"
  - Never invent facts. Only synthesize what's in the SIGNALS block.
  - Pick tag from: Catalyst, Earnings, Gapper, News (matches what the engine already classified)
  - source_urls: include the URLs from SIGNALS you actually used"""


def compute_signals_hash(candidate: dict) -> str:
    """SHA1 of a stable JSON serialization of the candidate's source signals.
    Used to skip re-synthesizing when nothing has changed."""
    signal_keys = ("tweets", "rss", "earnings_meta", "scanner_setup",
                   "gap_pct", "vol_x", "price")
    payload = {k: candidate.get(k) for k in signal_keys}
    blob = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()


def _format_tweet_block(tweets: list[dict]) -> str:
    if not tweets:
        return "(none)"
    lines = []
    for t in tweets[:5]:
        lines.append(f"  - @{t.get('author_handle', '?')}: \"{t.get('text', '')[:200]}\" — {t.get('url', '')}")
    return "\n".join(lines)


def _format_rss_block(rss: list[dict]) -> str:
    if not rss:
        return "(none)"
    lines = []
    for h in rss[:5]:
        lines.append(f"  - {h.get('source', '?')}: \"{h.get('title', '')[:200]}\" — {h.get('url', '')}")
    return "\n".join(lines)


def _format_earnings_block(em: Optional[dict]) -> str:
    if not em:
        return "(none)"
    return (f"Q{em.get('quarter', '?')} {em.get('year', '?')} EPS "
            f"${em.get('eps_actual', '?')} vs ${em.get('eps_estimate', '?')} est, "
            f"revenue ${em.get('revenue_actual_m', '?')}M, "
            f"timing={em.get('timing', '?')}")


def _format_scanner_block(setup: Optional[dict]) -> str:
    if not setup:
        return "(none)"
    return f"{setup.get('setup_type', '?')}, candle_score {setup.get('candle_score', '?')}/110"


def _format_market_cap(mc: float) -> str:
    if not mc:
        return "?"
    if mc >= 1e12:
        return f"{mc/1e12:.2f}T"
    if mc >= 1e9:
        return f"{mc/1e9:.2f}B"
    if mc >= 1e6:
        return f"{mc/1e6:.0f}M"
    return f"{mc:.0f}"


def format_prompt(c: dict) -> str:
    return f"""Synthesize a catalyst for {c['ticker']} ({c.get('company', c['ticker'])}).

SIGNALS:
- Price: ${c.get('price', '?')}, gap {c.get('gap_pct', 0):+.2f}%, vol {c.get('vol_x', 0):.1f}x ADV
- Market cap: ${_format_market_cap(c.get('market_cap', 0))}
- Sector: {c.get('sector', '?')}

Tweets (last 24h, {len(c.get('tweets', []))} total):
{_format_tweet_block(c.get('tweets', []))}

RSS headlines ({len(c.get('rss', []))} total):
{_format_rss_block(c.get('rss', []))}

Earnings: {_format_earnings_block(c.get('earnings_meta'))}

UCT scanner: {_format_scanner_block(c.get('scanner_setup'))}

Output the JSON now."""


def _call_anthropic(model: str, prompt: str, system: str) -> tuple:
    """Make one Anthropic API call. Returns (response_message, input_tokens, output_tokens).
    Raises on transport/API errors so caller can handle fallback."""
    from api.services.engine import _get_anthropic_client
    client = _get_anthropic_client()
    msg = client.messages.create(
        model=model,
        max_tokens=500,
        temperature=0.3,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg, msg.usage.input_tokens, msg.usage.output_tokens


def _extract_text(msg) -> str:
    """Pull plain text out of Anthropic SDK response blocks."""
    parts = []
    for block in msg.content:
        text = getattr(block, "text", None)
        if text:
            parts.append(text)
    return "".join(parts).strip()


def _parse_json_response(text: str) -> Optional[dict]:
    """Try to parse JSON; if model wrapped it in markdown fence, strip it."""
    text = text.strip()
    if text.startswith("```"):
        # Strip code fence
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
        text = text.strip()
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None


def _validate_no_sources_phrasing(parsed: dict, has_sources: bool) -> bool:
    """If candidate has no sources, the thesis MUST contain 'no clear catalyst'."""
    if has_sources:
        return True
    return "no clear catalyst" in (parsed.get("thesis") or "").lower()


def synthesize_ticker(candidate: dict, market_date: str) -> dict:
    """Returns dict with thesis_text, thesis_model, thesis_at, thesis_sources,
    signals_hash, was_cached, input_tokens, output_tokens."""
    h = compute_signals_hash(candidate)
    prior = store.get_ticker_for_date(candidate["ticker"], market_date)

    # Skip-if-stable: reuse prior thesis when signals haven't changed
    if prior and prior.get("signals_hash") == h:
        cost_guard.record(market_date, candidate["ticker"],
                          prior.get("thesis_model") or OPUS_MODEL,
                          0, 0, was_cached=True)
        return {
            "thesis_text": prior["thesis_text"],
            "thesis_model": prior["thesis_model"],
            "thesis_at": prior["thesis_at"],
            "thesis_sources": prior["thesis_sources"],
            "signals_hash": h,
            "was_cached": True,
            "input_tokens": 0,
            "output_tokens": 0,
        }

    # Hard cap check
    if not cost_guard.may_synthesize(market_date):
        fallback_text = prior["thesis_text"] if prior else \
            "Synthesis paused — daily cost cap reached. Try again tomorrow."
        return {
            "thesis_text": fallback_text + " (cost cap reached)",
            "thesis_model": prior.get("thesis_model") if prior else "none",
            "thesis_at": int(time.time()),
            "thesis_sources": prior.get("thesis_sources") if prior else "[]",
            "signals_hash": h,
            "was_cached": True,
            "input_tokens": 0,
            "output_tokens": 0,
        }

    prompt = format_prompt(candidate)
    has_sources = bool(candidate.get("tweets") or candidate.get("rss")
                       or candidate.get("earnings_meta")
                       or candidate.get("scanner_setup"))

    # Primary call: Opus 4.7
    msg = None
    used_model = OPUS_MODEL
    in_tokens = out_tokens = 0

    try:
        msg, in_tokens, out_tokens = _call_anthropic(OPUS_MODEL, prompt, SYSTEM_PROMPT)
    except Exception as e:
        logger.warning("[catalyst-synth] Opus failed for %s: %s. Falling back to Haiku.",
                       candidate["ticker"], e)
        try:
            msg, in_tokens, out_tokens = _call_anthropic(HAIKU_FALLBACK, prompt, SYSTEM_PROMPT)
            used_model = HAIKU_FALLBACK
        except Exception as e2:
            logger.error("[catalyst-synth] Haiku fallback also failed for %s: %s",
                         candidate["ticker"], e2)
            # Keep prior thesis if it exists, else canned message
            fallback_text = prior["thesis_text"] if prior else \
                "Synthesis temporarily unavailable. Sources will be checked again on next refresh."
            return {
                "thesis_text": fallback_text,
                "thesis_model": prior.get("thesis_model") if prior else "none",
                "thesis_at": int(time.time()),
                "thesis_sources": prior.get("thesis_sources") if prior else "[]",
                "signals_hash": h,
                "was_cached": True,
                "input_tokens": 0,
                "output_tokens": 0,
            }

    raw_text = _extract_text(msg)
    parsed = _parse_json_response(raw_text)

    # Malformed JSON — keep prior if exists, log failure, return prior
    if parsed is None or not parsed.get("thesis"):
        logger.warning("[catalyst-synth] malformed JSON for %s: %s",
                       candidate["ticker"], raw_text[:300])
        cost_guard.record(market_date, candidate["ticker"], used_model,
                          in_tokens, out_tokens, was_cached=False)
        if prior:
            return {
                "thesis_text": prior["thesis_text"],
                "thesis_model": prior["thesis_model"],
                "thesis_at": prior["thesis_at"],
                "thesis_sources": prior["thesis_sources"],
                "signals_hash": h,
                "was_cached": True,
                "input_tokens": in_tokens,
                "output_tokens": out_tokens,
            }
        # No prior — return canned text
        return {
            "thesis_text": "Synthesis returned malformed output. Will retry next refresh.",
            "thesis_model": used_model,
            "thesis_at": int(time.time()),
            "thesis_sources": "[]",
            "signals_hash": h,
            "was_cached": False,
            "input_tokens": in_tokens,
            "output_tokens": out_tokens,
        }

    # No-sources enforcement: re-prompt once if missing required phrase
    if not _validate_no_sources_phrasing(parsed, has_sources):
        try:
            msg2, in2, out2 = _call_anthropic(
                used_model,
                prompt + "\n\nIMPORTANT: This ticker has no real source signals. "
                        "Your thesis MUST contain the literal phrase 'no clear catalyst'. "
                        "Re-output the JSON.",
                SYSTEM_PROMPT,
            )
            in_tokens += in2
            out_tokens += out2
            raw_text2 = _extract_text(msg2)
            parsed2 = _parse_json_response(raw_text2)
            if parsed2 and _validate_no_sources_phrasing(parsed2, has_sources):
                parsed = parsed2
            else:
                # Deterministic fallback — no LLM cost
                parsed = {
                    "thesis": "No clear catalyst identified. Source pool was thin.",
                    "tag": candidate.get("tag", "Gapper"),
                    "source_urls": [],
                }
        except Exception:
            parsed = {
                "thesis": "No clear catalyst identified. Source pool was thin.",
                "tag": candidate.get("tag", "Gapper"),
                "source_urls": [],
            }

    cost_guard.record(market_date, candidate["ticker"], used_model,
                      in_tokens, out_tokens, was_cached=False)

    return {
        "thesis_text": parsed["thesis"],
        "thesis_model": used_model,
        "thesis_at": int(time.time()),
        "thesis_sources": json.dumps(parsed.get("source_urls", [])),
        "signals_hash": h,
        "was_cached": False,
        "input_tokens": in_tokens,
        "output_tokens": out_tokens,
    }
```

- [ ] **Step 4: Run, verify pass**

```bash
pytest tests/test_catalyst_synthesize.py -v
```

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/synthesize.py tests/test_catalyst_synthesize.py
git commit -m "feat: catalyst Opus 4.7 synthesis with skip-stable + Haiku fallback + validation"
```

---

## Task 7: Sources (parallel pulls)

**Files:**
- Create: `api/services/catalyst/sources.py`

Note: This module has no separate unit test file — it's tested implicitly via the engine integration test (Task 9). Each source pull is a thin wrapper around existing project services; their tests already cover the source-of-truth behavior. We focus testing on the orchestrator that calls them.

- [ ] **Step 1: Implement sources**

```python
# api/services/catalyst/sources.py
"""Parallel pulls from 7 existing project data sources, normalized into
the Candidate dict shape consumed by scoring/tagging/synthesize."""
from __future__ import annotations

import datetime as dt
import logging
import re
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")
_CASHTAG_RE = re.compile(r"\$([A-Z]{1,5})\b")


def _today_market_date() -> str:
    return dt.datetime.now(_ET).date().isoformat()


def _safe(fn, default=None, name="?"):
    """Run a source pull; on any exception return default + log."""
    try:
        return fn()
    except Exception as e:
        logger.warning("[catalyst-sources] %s failed: %s", name, e)
        return default if default is not None else {}


# ── Source 1+2: Massive gappers/losers + per-ticker snapshot ────────────
def _pull_movers() -> dict[str, dict]:
    """Returns {ticker: {gap_pct, price, vol_x?}} for gappers/losers."""
    from api.services.massive import get_movers
    movers = get_movers() or {}
    out: dict[str, dict] = {}
    for item in (movers.get("ripping") or []):
        sym = (item.get("sym") or "").upper()
        if sym:
            out[sym] = {"gap_pct": float(item.get("pct", "0").rstrip("%") or 0)}
    for item in (movers.get("drilling") or []):
        sym = (item.get("sym") or "").upper()
        if sym:
            out[sym] = {"gap_pct": -abs(float(item.get("pct", "0").rstrip("%") or 0))}
    return out


def _enrich_with_snapshot(tickers: list[str]) -> dict[str, dict]:
    """Get price + vol_x for the tickers (uses Massive batch snapshot)."""
    from api.services.massive import get_snapshot_batch
    out = {}
    try:
        snaps = get_snapshot_batch(tickers) or {}
    except Exception as e:
        logger.warning("[catalyst-sources] snapshot batch failed: %s", e)
        return out
    for ticker, snap in snaps.items():
        if not snap:
            continue
        price = snap.get("price") or snap.get("last") or 0
        vol = snap.get("day_volume") or 0
        adv = snap.get("avg_volume_30d") or snap.get("adv") or vol
        out[ticker.upper()] = {
            "price": float(price),
            "vol_x": (float(vol) / float(adv)) if adv else 0.0,
            "market_cap": float(snap.get("market_cap") or 0),
            "sector": snap.get("sector"),
        }
    return out


# ── Source 3: Earnings calendar ─────────────────────────────────────────
def _pull_earnings() -> dict[str, dict]:
    """Returns {ticker: earnings_meta} for AMC/BMO reporters in next 36h
    AND for tickers reported in last 36h (covers AMC + this morning)."""
    from api.services import engine
    cal = _safe(lambda: engine.get_calendar() or {}, default={}, name="earnings_cal")
    today = (cal.get("today") or {}).get("earnings") or []
    yest_amc = cal.get("yesterday_amc") or []
    out: dict[str, dict] = {}
    for entry in (today + yest_amc):
        sym = (entry.get("sym") or "").upper()
        if not sym:
            continue
        out[sym] = {
            "ticker": sym,
            "timing": entry.get("when"),  # 'bmo', 'amc'
            "eps_actual": entry.get("eps_actual") or entry.get("reported_eps"),
            "eps_estimate": entry.get("eps_estimate"),
            "revenue_actual_m": entry.get("revenue_m") or entry.get("rev_actual"),
            "quarter": entry.get("quarter"),
            "year": entry.get("year"),
            "reported_recently": entry.get("eps_actual") is not None
                                  or entry.get("reported_eps") is not None,
        }
    return out


# ── Source 4: Tweets (from our tweet_store) ─────────────────────────────
def _pull_tweet_signals() -> dict[str, list[dict]]:
    """Returns {ticker: [tweet, ...]} for recently cashtagged tickers."""
    from api.services import tweet_store
    out: dict[str, list[dict]] = defaultdict(list)
    try:
        tape_rows = tweet_store.tape(hours=24, limit=200)
    except Exception as e:
        logger.warning("[catalyst-sources] tweet tape failed: %s", e)
        return out
    for row in tape_rows:
        ticker = (row.get("ticker") or "").upper()
        if not ticker:
            continue
        try:
            tweets = tweet_store.tweets_for_ticker(ticker, hours=24)
        except Exception:
            continue
        for t in tweets[:5]:
            out[ticker].append({
                "author_handle": t.get("author_handle"),
                "text": t.get("text", ""),
                "url": t.get("url"),
                "id": t.get("id"),
            })
    return out


# ── Source 5: RSS news ──────────────────────────────────────────────────
def _pull_rss_signals() -> dict[str, list[dict]]:
    """Pull recent RSS items; extract ticker mentions via cashtag regex."""
    from api.services.news_aggregator import fetch_rss_news
    out: dict[str, list[dict]] = defaultdict(list)
    today = _today_market_date()
    items = _safe(lambda: fetch_rss_news(today, limit=80) or [],
                  default=[], name="rss_news")
    for item in items:
        title = item.get("title") or item.get("headline") or ""
        summary = item.get("summary") or ""
        text = f"{title} {summary}"
        tickers = set(_CASHTAG_RE.findall(text.upper()))
        # Also use explicit ticker field if present
        for t in (item.get("tickers") or []):
            if t:
                tickers.add(t.upper())
        for ticker in tickers:
            if len(ticker) > 5:
                continue
            out[ticker].append({
                "source": item.get("source") or item.get("category") or "RSS",
                "title": title,
                "url": item.get("url"),
            })
    return out


# ── Source 6: UCT scanner candidates ────────────────────────────────────
def _pull_scanner_setups() -> dict[str, dict]:
    """Pull from wire_data.candidates (PB / Remount / Gapper setups)."""
    from api.services import engine
    candidates = _safe(lambda: engine.get_candidates() or {},
                       default={}, name="scanner")
    out: dict[str, dict] = {}
    for bucket_name in ("pullback_ma", "remount", "gapper_news"):
        for entry in (candidates.get(bucket_name) or []):
            sym = (entry.get("ticker") or entry.get("sym") or "").upper()
            if sym:
                out[sym] = {
                    "setup_type": entry.get("alert_state") or bucket_name.upper(),
                    "candle_score": entry.get("candle_score"),
                    "adr_pct": entry.get("adr_pct"),
                }
    return out


# ── Orchestrator ────────────────────────────────────────────────────────
def collect_all() -> list[dict]:
    """Runs all source pulls in parallel; merges into Candidate dicts
    keyed by ticker. Returns list of candidates (one per ticker)."""
    tasks: dict[str, callable] = {
        "movers": _pull_movers,
        "earnings": _pull_earnings,
        "tweets": _pull_tweet_signals,
        "rss": _pull_rss_signals,
        "scanner": _pull_scanner_setups,
    }
    results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=5, thread_name_prefix="cat-src") as ex:
        futures = {ex.submit(_safe, fn, {}, name): name
                   for name, fn in tasks.items()}
        for fut in as_completed(futures, timeout=30):
            name = futures[fut]
            try:
                results[name] = fut.result()
            except Exception as e:
                logger.warning("[catalyst-sources] %s exception: %s", name, e)
                results[name] = {}

    # Universe = union of tickers from all sources
    universe: set[str] = set()
    universe.update(results.get("movers", {}).keys())
    universe.update(results.get("earnings", {}).keys())
    universe.update(results.get("tweets", {}).keys())
    universe.update(results.get("rss", {}).keys())
    universe.update(results.get("scanner", {}).keys())

    if not universe:
        return []

    # Enrich with snapshot (price + vol_x + sector) for the union
    snapshot = _enrich_with_snapshot(sorted(universe))

    # Build candidates with sector momentum calculated last
    sector_counts: dict[str, int] = defaultdict(int)
    candidates: list[dict] = []
    for ticker in sorted(universe):
        movers_data = results["movers"].get(ticker, {})
        snap = snapshot.get(ticker, {})
        em = results["earnings"].get(ticker)
        tweets = results["tweets"].get(ticker, [])
        rss = results["rss"].get(ticker, [])
        setup = results["scanner"].get(ticker)

        sector = snap.get("sector")
        if sector:
            sector_counts[sector] += 1

        candidates.append({
            "ticker": ticker,
            "company": None,  # filled by Opus prompt if needed
            "price": snap.get("price"),
            "gap_pct": movers_data.get("gap_pct", 0.0),
            "vol_x": snap.get("vol_x", 0.0),
            "market_cap": snap.get("market_cap"),
            "sector": sector,
            "tweets": tweets,
            "rss": rss,
            "earnings_meta": em,
            "earnings_reported_recently": bool(em and em.get("reported_recently")),
            "earnings_just_reported": bool(em and em.get("reported_recently")),
            "tweet_mention_count": len(tweets),
            "rss_headline_count": len(rss),
            "scanner_setup": setup,
        })

    # Second pass: assign sector momentum counts
    for c in candidates:
        c["sector_momentum_count"] = max(0, sector_counts.get(c.get("sector"), 0) - 1)

    return candidates
```

- [ ] **Step 2: Quick smoke check that the module imports**

```bash
cd C:/Users/Patrick/uct-dashboard && python -c "from api.services.catalyst import sources; print('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add api/services/catalyst/sources.py
git commit -m "feat: catalyst parallel source pulls (movers, snapshot, earnings, tweets, RSS, scanner)"
```

---

## Task 8: Engine orchestrator

**Files:**
- Create: `api/services/catalyst/engine.py`
- Create: `tests/test_catalyst_engine.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_catalyst_engine.py
import os
import tempfile
from unittest.mock import patch

import pytest

from api.services.catalyst import engine, store


@pytest.fixture
def s(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(store, "_DB_PATH", os.path.join(d, "catalysts.db"))
        store._init_db()
        yield


def _candidate(ticker, gap_pct=5.0, vol_x=2.0, tweets=None, rss=None,
               earnings_meta=None):
    return {
        "ticker": ticker,
        "company": ticker,
        "price": 50.0,
        "gap_pct": gap_pct,
        "vol_x": vol_x,
        "market_cap": 1_000_000_000,
        "sector": "Tech",
        "tweets": tweets or [],
        "rss": rss or [],
        "earnings_meta": earnings_meta,
        "earnings_reported_recently": bool(earnings_meta),
        "earnings_just_reported": bool(earnings_meta),
        "tweet_mention_count": len(tweets or []),
        "rss_headline_count": len(rss or []),
        "scanner_setup": None,
        "sector_momentum_count": 0,
    }


def test_run_refresh_writes_top_12_to_store(s):
    cands = (
        [_candidate(f"CAT{i}", gap_pct=10 + i, tweets=[{"id": str(i), "text": "x", "author_handle": "h", "url": "u"}, {"id": str(i)+"b", "text": "y", "author_handle": "h", "url": "u"}]) for i in range(10)]
        + [_candidate(f"ERN{i}", gap_pct=5 + i, earnings_meta={"reported_recently": True, "eps_actual": 1.0, "eps_estimate": 0.9}) for i in range(5)]
        + [_candidate(f"GAP{i}", gap_pct=15 + i, vol_x=5.0) for i in range(5)]
    )
    fake_thesis = {
        "thesis_text": "test thesis",
        "thesis_model": "claude-opus-4-7",
        "thesis_at": 1000,
        "thesis_sources": "[]",
        "signals_hash": "hash",
        "was_cached": False,
        "input_tokens": 100,
        "output_tokens": 50,
    }
    with patch("api.services.catalyst.engine.sources.collect_all",
               return_value=cands), \
         patch("api.services.catalyst.engine.synthesize.synthesize_ticker",
               return_value=fake_thesis):
        engine.run_refresh()

    rows = store.get_for_date(engine._today_market_date())
    assert len(rows) == 12
    tags = {r["tag"] for r in rows}
    assert "Catalyst" in tags
    assert "Earnings" in tags
    assert "Gapper" in tags


def test_run_refresh_handles_empty_candidates(s):
    with patch("api.services.catalyst.engine.sources.collect_all",
               return_value=[]):
        engine.run_refresh()  # should not raise
    rows = store.get_for_date(engine._today_market_date())
    assert rows == []


def test_run_refresh_unranks_dropped_tickers(s):
    """If yesterday's top 12 had ticker X but today X drops below,
    X should remain in DB with rank=NULL for historical browsing."""
    md = engine._today_market_date()
    # Pre-seed yesterday's top spot
    store.upsert_catalyst({
        "market_date": md, "ticker": "OLD_STAR", "rank": 1,
        "score": 100.0, "tag": "Catalyst", "price": 100.0, "gap_pct": 10.0,
        "vol_x": 5.0, "market_cap": 1e9, "sector": "Tech",
        "thesis_text": "old", "thesis_model": "claude-opus-4-7",
        "thesis_at": 1, "thesis_sources": "[]", "signals_hash": "old",
        "raw_signals": "{}",
    })
    cands = [_candidate(f"NEW{i}", gap_pct=10 + i,
                        tweets=[{"id": str(i), "text": "x", "author_handle": "h", "url": "u"},
                                {"id": str(i)+"b", "text": "y", "author_handle": "h", "url": "u"}])
             for i in range(15)]
    fake_thesis = {
        "thesis_text": "test", "thesis_model": "claude-opus-4-7",
        "thesis_at": 2, "thesis_sources": "[]",
        "signals_hash": "new", "was_cached": False,
        "input_tokens": 100, "output_tokens": 50,
    }
    with patch("api.services.catalyst.engine.sources.collect_all",
               return_value=cands), \
         patch("api.services.catalyst.engine.synthesize.synthesize_ticker",
               return_value=fake_thesis):
        engine.run_refresh()

    # OLD_STAR should still exist but rank=None
    old = store.get_ticker_for_date("OLD_STAR", md)
    assert old is not None
    assert old["rank"] is None
```

- [ ] **Step 2: Run, expect failure**

```bash
pytest tests/test_catalyst_engine.py -v
```

- [ ] **Step 3: Implement engine**

```python
# api/services/catalyst/engine.py
"""Orchestrator: collect → score → tag → select → synthesize → store.

Called by APScheduler cron jobs in api/main.py. Each call is independent
and safe to run concurrently across pods because store writes are
idempotent on (market_date, ticker)."""
from __future__ import annotations

import datetime as dt
import json
import logging
from zoneinfo import ZoneInfo

from api.services.catalyst import (
    selection,
    scoring,
    sources,
    store,
    synthesize,
    tagging,
)

logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")


def _today_market_date() -> str:
    return dt.datetime.now(_ET).date().isoformat()


def run_refresh() -> dict:
    """Single full pass. Returns summary dict for logging.
    Never raises — all errors swallowed + logged."""
    md = _today_market_date()
    summary = {"market_date": md, "candidates": 0, "scored": 0,
               "selected": 0, "synthesized": 0, "errors": []}

    try:
        candidates = sources.collect_all()
    except Exception as e:
        logger.exception("[catalyst-engine] source collection failed")
        summary["errors"].append(f"collect: {e}")
        return summary

    summary["candidates"] = len(candidates)
    if not candidates:
        logger.info("[catalyst-engine] no candidates this tick")
        return summary

    # Tag, score
    for c in candidates:
        c["tag"] = tagging.assign_tag(c)
        c["score"] = scoring.score(c)
    scored = [c for c in candidates if c.get("tag")]
    summary["scored"] = len(scored)

    # Select top 12
    top_12 = selection.select_top_12(scored)
    summary["selected"] = len(top_12)

    # Clear previous ranks (dropped tickers stay in DB with rank=NULL)
    store.clear_ranks_for_date(md)

    # Synthesize each + persist
    for rank, c in enumerate(top_12, start=1):
        try:
            thesis = synthesize.synthesize_ticker(c, md)
        except Exception as e:
            logger.exception("[catalyst-engine] synthesize failed for %s",
                             c.get("ticker"))
            summary["errors"].append(f"synth_{c.get('ticker')}: {e}")
            continue

        try:
            store.upsert_catalyst({
                "market_date": md,
                "ticker": c["ticker"],
                "rank": rank,
                "score": c["score"],
                "tag": c["tag"],
                "price": c.get("price"),
                "gap_pct": c.get("gap_pct"),
                "vol_x": c.get("vol_x"),
                "market_cap": c.get("market_cap"),
                "sector": c.get("sector"),
                "thesis_text": thesis["thesis_text"],
                "thesis_model": thesis["thesis_model"],
                "thesis_at": thesis["thesis_at"],
                "thesis_sources": thesis["thesis_sources"],
                "signals_hash": thesis["signals_hash"],
                "raw_signals": json.dumps({
                    "tweets": c.get("tweets", []),
                    "rss": c.get("rss", []),
                    "earnings_meta": c.get("earnings_meta"),
                    "scanner_setup": c.get("scanner_setup"),
                }, default=str),
            })
            summary["synthesized"] += 1
        except Exception as e:
            logger.exception("[catalyst-engine] store upsert failed for %s",
                             c.get("ticker"))
            summary["errors"].append(f"store_{c.get('ticker')}: {e}")

    # Also store the unranked scored candidates (rank=NULL) for retro analysis
    selected_tickers = {c["ticker"] for c in top_12}
    for c in scored:
        if c["ticker"] in selected_tickers:
            continue
        existing = store.get_ticker_for_date(c["ticker"], md)
        if existing:
            # Already in DB from prior tick — leave it (rank already cleared)
            continue
        # Persist a stub row so historical view can include also-rans
        try:
            store.upsert_catalyst({
                "market_date": md,
                "ticker": c["ticker"],
                "rank": None,
                "score": c["score"],
                "tag": c["tag"],
                "price": c.get("price"),
                "gap_pct": c.get("gap_pct"),
                "vol_x": c.get("vol_x"),
                "market_cap": c.get("market_cap"),
                "sector": c.get("sector"),
                "thesis_text": None,
                "thesis_model": None,
                "thesis_at": None,
                "thesis_sources": "[]",
                "signals_hash": None,
                "raw_signals": "{}",
            })
        except Exception:
            pass  # non-critical

    logger.info("[catalyst-engine] refresh done: %s", summary)
    return summary
```

- [ ] **Step 4: Run, verify pass**

```bash
pytest tests/test_catalyst_engine.py -v
```

- [ ] **Step 5: Commit**

```bash
git add api/services/catalyst/engine.py tests/test_catalyst_engine.py
git commit -m "feat: catalyst engine orchestrator (collect → score → tag → select → synth → store)"
```

---

## Task 9: API router

**Files:**
- Create: `api/routers/catalysts.py`

No separate test file — endpoints are thin shells around store reads and the engine call. The store and engine are already tested.

- [ ] **Step 1: Implement router**

```python
# api/routers/catalysts.py
"""Catalyst read endpoints (logged-in users) + admin force-refresh + stats."""
from __future__ import annotations

import datetime as dt
import logging
import re
import threading
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Path

from api.middleware.auth_middleware import get_current_user, require_admin
from api.services.catalyst import engine, store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["catalysts"])

_ET = ZoneInfo("America/New_York")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _today() -> str:
    return dt.datetime.now(_ET).date().isoformat()


@router.get("/catalysts/today")
def catalysts_today(user=Depends(get_current_user)):
    rows = store.get_for_date(_today(), ranked_only=True)
    return {
        "market_date": _today(),
        "generated_at": rows[0]["thesis_at"] if rows else None,
        "rows": rows,
    }


@router.get("/catalysts/by-date/{ymd}")
def catalysts_by_date(ymd: str = Path(...), user=Depends(get_current_user)):
    if not _DATE_RE.match(ymd):
        raise HTTPException(400, "date must be YYYY-MM-DD")
    rows = store.get_for_date(ymd, ranked_only=True)
    return {"market_date": ymd, "rows": rows}


@router.post("/catalysts/refresh")
def catalysts_refresh(user=Depends(require_admin)):
    """Trigger an immediate refresh. Runs in a background thread so the HTTP
    response returns immediately — refreshes can take 5–10s."""
    threading.Thread(target=engine.run_refresh, daemon=True,
                     name="catalyst-force-refresh").start()
    return {"ok": True, "message": "Refresh started in background."}


@router.get("/admin/catalyst-stats")
def catalyst_stats(user=Depends(require_admin)):
    today = _today()
    daily = store.cost_stats_for_date(today)
    ym = today[:7]
    mtd = store.cost_stats_mtd(ym)
    today_rows = store.get_for_date(today, ranked_only=False)
    last_refresh_at = max((r["thesis_at"] for r in today_rows
                           if r.get("thesis_at")), default=None)
    return {
        "today": daily,
        "mtd_cost_usd": round(mtd["total_cost_usd"], 4),
        "mtd_call_count": mtd["call_count"],
        "today_rows": len(today_rows),
        "today_ranked": len([r for r in today_rows if r["rank"] is not None]),
        "last_refresh_at": last_refresh_at,
    }
```

- [ ] **Step 2: Verify imports cleanly**

```bash
cd C:/Users/Patrick/uct-dashboard && python -c "from api.routers import catalysts; print('ok')"
```

- [ ] **Step 3: Commit**

```bash
git add api/routers/catalysts.py
git commit -m "feat: catalyst router (today, by-date, admin refresh + stats)"
```

---

# PHASE 1B: Scheduler + deploy (Tasks 10–11)

## Task 10: Wire scheduler + lifespan init + router in api/main.py

**Files:**
- Modify: `api/main.py`

- [ ] **Step 1: Add catalyst router import alongside existing router imports**

Find the existing imports block in `api/main.py` (search for `from api.routers import admin_twitter`) and add right after it:

```python
from api.routers import catalysts as catalysts_router
```

- [ ] **Step 2: Register the router**

Find the existing `app.include_router(admin_twitter_router.router)` line and add right after:

```python
app.include_router(catalysts_router.router)
```

- [ ] **Step 3: Init catalysts.db in lifespan (unconditional — same pattern as tweets.db)**

Find the existing `if os.environ.get("TWITTERAPI_IO_ENABLED"...` block in lifespan that calls `tweet_store._init_db()`. Right after that whole try/except block, add:

```python
    # Initialize catalysts.db schema unconditionally (same pattern as tweets.db).
    # Frontend tile fires /api/catalysts/today on every page load; without
    # schema, it would 500 on missing table.
    try:
        from api.services.catalyst import store as _cat_store
        _cat_store._init_db()
        print("[startup] catalysts.db initialized")
    except Exception as e:
        print(f"[startup] catalyst_store init failed (non-fatal): {e}")
```

- [ ] **Step 4: Add scheduler block inside `if acquire_scheduler_lock():`**

Find the existing `if os.environ.get("TWITTERAPI_IO_ENABLED"...` block inside the scheduler (the one that adds tweet_poll jobs). Right after that whole block (after the `print("[scheduler] tweet poll jobs registered")` line), add:

```python
        # ── Morning Catalyst Engine (spec 2026-05-25) ─────────────────────
        if os.environ.get("CATALYST_ENGINE_ENABLED", "").lower() in ("1", "true", "yes"):
            from api.services.catalyst.engine import run_refresh as _cat_refresh

            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="4-9", minute="*/5"),
                id="catalyst_premarket", max_instances=1, replace_existing=True)
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="9", minute="30-59/5"),
                id="catalyst_open", max_instances=1, replace_existing=True)
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="15", minute="30-59/5"),
                id="catalyst_close", max_instances=1, replace_existing=True)
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="16-19", minute="*/5"),
                id="catalyst_amc", max_instances=1, replace_existing=True)
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(day_of_week="mon-fri", hour="10-15", minute="*/30"),
                id="catalyst_midday", max_instances=1, replace_existing=True)
            _scheduler.add_job(_cat_refresh,
                trigger=CronTrigger(minute="0"),
                id="catalyst_slow", max_instances=1, replace_existing=True)
            print("[scheduler] catalyst engine jobs registered")
```

- [ ] **Step 5: Syntax check + regression test**

```bash
cd C:/Users/Patrick/uct-dashboard && python -c "import ast; ast.parse(open('api/main.py').read()); print('parse ok')"
python -m pytest tests/test_catalyst_store.py tests/test_catalyst_scoring.py tests/test_catalyst_tagging.py tests/test_catalyst_selection.py tests/test_catalyst_cost_guard.py tests/test_catalyst_synthesize.py tests/test_catalyst_engine.py -q
```
Expected: parse ok + all catalyst tests pass.

- [ ] **Step 6: Commit**

```bash
git add api/main.py
git commit -m "feat: wire catalyst engine scheduler + router + db init in main.py"
```

---

## Task 11: Deploy Phase 1A+1B to Railway

- [ ] **Step 1: Push to Railway**

```bash
git push origin master
```

- [ ] **Step 2: Wait for Railway redeploy.** Visit Railway dashboard, confirm new deployment goes ACTIVE (~2 min). Catalyst code is live but dormant (no env var set).

- [ ] **Step 3: Set Railway env vars** (via Railway dashboard → web service → Variables):
  - `CATALYST_ENGINE_ENABLED=1`
  - `CATALYST_OPUS_MODEL=claude-opus-4-7` (optional, this is the default)
  - `CATALYST_COST_CAP_DAILY=5.00` (optional)
  - `CATALYST_COST_HARD_CAP=10.00` (optional)

Save → Railway redeploys.

- [ ] **Step 4: Verify scheduler started.** Watch deploy logs for:

```
[startup] catalysts.db initialized
[scheduler] catalyst engine jobs registered
```

- [ ] **Step 5: Force a refresh via admin endpoint** (requires admin login):

```bash
curl -X POST https://uctintelligence.com/api/catalysts/refresh \
  -H "Cookie: uct_session=<your-session>"
```

Or via the admin Twitter Accounts page that already exists — we'll add a button later. For now, wait for the next 5-min cron tick.

- [ ] **Step 6: Verify data is flowing**

```bash
curl https://uctintelligence.com/api/catalysts/today \
  -H "Cookie: uct_session=<your-session>"
```

Expect: `{"market_date": "2026-05-26", "rows": [...]}` with up to 12 rows. If `rows: []`, give the scheduler 5 minutes to fire.

---

# PHASE 1C: Frontend (Tasks 12–15)

## Task 12: Shared `highlightThesis` util

**Files:**
- Create: `app/src/utils/highlightThesis.jsx`

- [ ] **Step 1: Implement util**

```jsx
// app/src/utils/highlightThesis.jsx
//
// Renders a thesis string with:
//   - **bold** markdown converted to <strong>
//   - $CASHTAGS styled gold
//   - $123.45 amounts and +12% percentages styled bold
import React from 'react'

const CASHTAG_RE = /\$([A-Z]{1,5})\b/g
const AMOUNT_RE = /\$\d[\d,]*\.?\d*[BMK]?/g
const PCT_RE = /[+-]?\d+(?:\.\d+)?%/g

// Combine: bold markdown OR cashtag OR amount OR pct
const SPLIT_RE = /(\*\*[^*]+\*\*|\$[A-Z]{1,5}\b|\$\d[\d,]*\.?\d*[BMK]?|[+-]?\d+(?:\.\d+)?%)/g

const GOLD = 'var(--ut-gold, #c9a84c)'

export default function HighlightThesis({ text }) {
  if (!text) return null
  const parts = text.split(SPLIT_RE).filter(p => p !== '')
  return (
    <>
      {parts.map((p, i) => {
        if (/^\*\*[^*]+\*\*$/.test(p)) {
          return <strong key={i}>{p.slice(2, -2)}</strong>
        }
        if (CASHTAG_RE.test(p)) {
          CASHTAG_RE.lastIndex = 0
          return <span key={i} style={{ color: GOLD, fontWeight: 600 }}>{p}</span>
        }
        if (AMOUNT_RE.test(p)) {
          AMOUNT_RE.lastIndex = 0
          return <strong key={i}>{p}</strong>
        }
        if (PCT_RE.test(p)) {
          PCT_RE.lastIndex = 0
          const sign = p[0]
          const color = sign === '-' ? 'var(--loss)' : sign === '+' ? 'var(--gain)' : 'inherit'
          return <strong key={i} style={{ color }}>{p}</strong>
        }
        return <span key={i}>{p}</span>
      })}
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/utils/highlightThesis.jsx
git commit -m "feat: highlightThesis util — bold markdown + gold cashtags + colored pcts"
```

---

## Task 13: `useCatalysts` SWR hook

**Files:**
- Create: `app/src/hooks/useCatalysts.js`

- [ ] **Step 1: Implement hook**

```js
// app/src/hooks/useCatalysts.js
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : { rows: [] }))

export default function useCatalysts({ refreshIntervalMs = 30000 } = {}) {
  return useSWR('/api/catalysts/today', fetcher, {
    refreshInterval: refreshIntervalMs,
    revalidateOnFocus: true,
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/hooks/useCatalysts.js
git commit -m "feat: useCatalysts SWR hook polling /api/catalysts/today every 30s"
```

---

## Task 14: `CatalystTable` component + styles

**Files:**
- Create: `app/src/components/tiles/CatalystTable.jsx`
- Create: `app/src/components/tiles/CatalystTable.module.css`

- [ ] **Step 1: Implement component**

```jsx
// app/src/components/tiles/CatalystTable.jsx
import { useState } from 'react'
import useCatalysts from '../../hooks/useCatalysts'
import HighlightThesis from '../../utils/highlightThesis'
import { timeAgo } from '../../utils/timeAgo'
import TickerPopup from '../TickerPopup'
import { useAuth } from '../../context/AuthContext'
import styles from './CatalystTable.module.css'

const UI_ENABLED = (import.meta.env.VITE_CATALYST_UI_ENABLED ?? '1') !== '0'

function TagChip({ tag }) {
  const cls = {
    Catalyst: styles.tagCatalyst,
    Earnings: styles.tagEarnings,
    Gapper:   styles.tagGapper,
    News:     styles.tagNews,
  }[tag] || styles.tagDefault
  return <span className={`${styles.tag} ${cls}`}>{tag || '—'}</span>
}

function fmtPct(v) {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function fmtVolX(v) {
  if (v == null || v === 0) return '—'
  if (v >= 100) return `${v.toFixed(0)}×`
  if (v >= 10) return `${v.toFixed(1)}×`
  return `${v.toFixed(2)}×`
}

function fmtPrice(v) {
  if (v == null) return '—'
  return `$${v.toFixed(2)}`
}

export default function CatalystTable() {
  const { data, mutate, isValidating } = useCatalysts()
  const { user } = useAuth() || {}
  const isAdmin = user?.role === 'admin'
  const [refreshing, setRefreshing] = useState(false)

  if (!UI_ENABLED) return null

  const rows = data?.rows || []
  const generatedAt = data?.generated_at

  async function forceRefresh() {
    if (!isAdmin) return
    setRefreshing(true)
    try {
      await fetch('/api/catalysts/refresh', { method: 'POST' })
      setTimeout(() => mutate(), 3000)  // give engine ~3s to start writing
    } finally {
      setTimeout(() => setRefreshing(false), 4000)
    }
  }

  const updatedText = generatedAt ? `updated ${timeAgo(generatedAt)}` : 'no data yet'

  return (
    <div className={styles.tile}>
      <div className={styles.header}>
        <span className={styles.title}>🎯 MORNING CATALYSTS</span>
        <span className={styles.meta}>
          <span className={styles.updated}>{updatedText}</span>
          {isAdmin && (
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={forceRefresh}
              disabled={refreshing || isValidating}
            >
              {refreshing ? '…' : '↻ Refresh'}
            </button>
          )}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>
          No catalysts yet. Engine refreshes every 5 min during market hours.
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.colSym}>Sym</th>
              <th className={styles.colPrice}>Price</th>
              <th className={styles.colGap}>Gap %</th>
              <th className={styles.colVol}>Vol×</th>
              <th className={styles.colTag}>Tag</th>
              <th className={styles.colThesis}>Catalyst</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.ticker}>
                <td className={styles.colSym}>
                  <TickerPopup sym={r.ticker}>
                    <span className={styles.ticker}>{r.ticker}</span>
                  </TickerPopup>
                </td>
                <td className={styles.colPrice}>{fmtPrice(r.price)}</td>
                <td className={`${styles.colGap} ${(r.gap_pct ?? 0) >= 0 ? styles.gain : styles.loss}`}>
                  {fmtPct(r.gap_pct)}
                </td>
                <td className={styles.colVol}>{fmtVolX(r.vol_x)}</td>
                <td className={styles.colTag}><TagChip tag={r.tag} /></td>
                <td className={styles.colThesis}>
                  <HighlightThesis text={r.thesis_text} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className={styles.footer}>
        Informational only — not investment advice. Synthesized by Claude Opus 4.7.
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Implement styles**

```css
/* app/src/components/tiles/CatalystTable.module.css */
.tile {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 20px;
  margin-bottom: 16px;
  width: 100%;
  overflow-x: auto;
  position: relative;
}
.tile::before {
  content: '';
  position: absolute;
  top: 10px; bottom: 10px; left: 0;
  width: 2px;
  background: linear-gradient(180deg, var(--ut-green), var(--ut-gold), var(--ut-green));
  opacity: 0.4;
  border-radius: 2px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-family: var(--font-sans);
}
.title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: var(--text-bright);
}
.meta {
  display: flex; align-items: center; gap: 12px;
  font-size: 11px; color: var(--text-muted);
}
.updated { opacity: 0.7; }
.refreshBtn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-bright);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 11px;
  cursor: pointer;
}
.refreshBtn:hover { background: var(--bg-hover, rgba(255,255,255,0.03)); }
.refreshBtn:disabled { opacity: 0.4; cursor: wait; }

.empty {
  text-align: center;
  padding: 24px 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-family: var(--font-sans);
}
.table th {
  text-align: left;
  padding: 8px 10px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}
.table td {
  padding: 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.table tr:last-child td { border-bottom: none; }
.table tr:hover { background: var(--bg-hover, rgba(255,255,255,0.02)); }

.colSym    { width: 70px; }
.colPrice  { width: 80px; }
.colGap    { width: 80px; font-weight: 600; }
.colVol    { width: 70px; }
.colTag    { width: 100px; }
.colThesis { width: auto; line-height: 1.5; }

.ticker {
  color: var(--ut-cream);
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
}
.gain { color: var(--gain); }
.loss { color: var(--loss); }

.tag {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.tagCatalyst { background: rgba(56, 132, 255, 0.12); color: #60a5fa; }
.tagEarnings { background: rgba(74, 222, 128, 0.12); color: #4ade80; }
.tagGapper   { background: rgba(251, 191, 36, 0.12); color: #fbbf24; }
.tagNews     { background: rgba(180, 180, 180, 0.12); color: #cbd5e1; }
.tagDefault  { background: rgba(255,255,255,0.06); color: var(--text-muted); }

.footer {
  margin-top: 12px;
  text-align: right;
  font-size: 10px;
  opacity: 0.5;
  font-style: italic;
}

@media (max-width: 768px) {
  .colSym    { width: auto; }
  .colPrice, .colVol, .colTag { display: none; }
  .table { font-size: 11px; }
  .table td { padding: 8px 6px; }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/components/tiles/CatalystTable.jsx app/src/components/tiles/CatalystTable.module.css
git commit -m "feat: CatalystTable tile — 6-col table with tag chips, color-coded gap/pct"
```

---

## Task 15: Mount in Dashboard

**Files:**
- Modify: `app/src/pages/Dashboard.jsx`

- [ ] **Step 1: Add import**

Search Dashboard.jsx for existing tile imports (e.g. `import TopMovers from`). Add:

```jsx
import CatalystTable from '../components/tiles/CatalystTable'
```

- [ ] **Step 2: Mount above the tile grid**

Search Dashboard.jsx for the return statement of `export default function Dashboard()`. At the top of the rendered JSX (immediately inside the outermost wrapper div), add:

```jsx
<CatalystTable />
```

So the structure becomes:

```jsx
return (
  <div className={styles.dashboard}>
    <CatalystTable />
    {/* ... existing layout unchanged ... */}
  </div>
)
```

If Dashboard has a separate desktop+mobile branch (it does — search for `mobile` / `useIsMobile`), add `<CatalystTable />` in the desktop branch only for Phase 1. Mobile gets the tile in Phase 4 polish.

- [ ] **Step 3: Commit**

```bash
git add app/src/pages/Dashboard.jsx
git commit -m "feat: mount CatalystTable at top of Dashboard (desktop only Phase 1)"
```

---

## Task 16: Push frontend + verify end-to-end

- [ ] **Step 1: Push to Railway**

```bash
git push origin master
```

- [ ] **Step 2: After Railway redeploy goes ACTIVE**, open `https://uctintelligence.com` and confirm:
  - 🎯 MORNING CATALYSTS tile appears at the top of Dashboard
  - Either rows are populated (if the engine has run) or "No catalysts yet" message
  - Header shows "updated Nm ago" timestamp
  - Admin: ↻ Refresh button visible; clicking it triggers a background refresh

- [ ] **Step 3: If rows are empty after 10 min**, hit admin force-refresh from Settings (or via curl) and watch Railway Deploy Logs for:

```
[catalyst-engine] refresh done: {'market_date': '2026-05-26', 'candidates': N, ...}
```

If `candidates: 0`, one of the source pulls is failing — check the warning logs above for `[catalyst-sources] X failed: ...`.

---

# PHASE 1D: Documentation

## Task 17: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add section above "Known Issues / Gotchas"**

Find the existing `## Twitter News Ingestion (built 2026-05-25)` block. Right after it ends (before `## Known Issues / Gotchas`), insert:

```markdown
## Morning Catalyst Table (built 2026-05-25)

Pre-market intelligence engine that pulls candidates from 7 existing project sources, composite-scores them, picks the top 12 with a forced 6/3/2/1 category mix, and uses Claude Opus 4.7 to synthesize a 2–3 sentence catalyst description per entry. Surfaces as a full-width tile at the top of Dashboard.

### Architecture
- **Database:** SQLite at `/data/catalysts.db` (web service Railway volume). Indefinite retention for historical browsing.
- **Synthesis:** Claude Opus 4.7 via `api/services/engine._get_anthropic_client()` (same client pattern as earnings_enrichment + transcripts). Haiku fallback on Opus 5xx. Skip-if-stable SHA1 hash of source signals — re-uses prior thesis when nothing changed.
- **Scheduler:** APScheduler in `api/main.py` next to COT + Twitter — burst 5min pre-market + AMC, 30min midday, hourly safety net. Gated on `CATALYST_ENGINE_ENABLED=1`.
- **Cost cap:** $5/day soft (logs warning), $10/day hard (disables synthesis for remainder of day). Per-call USD recorded in `catalyst_cost_log` table.

### Files
- `api/services/catalyst/sources.py` — parallel pulls from movers, snapshot, earnings, tweet_store, RSS, scanner
- `api/services/catalyst/scoring.py` — composite formula (env-tunable weights)
- `api/services/catalyst/tagging.py` — deterministic tag (Earnings > Catalyst > Gapper > News)
- `api/services/catalyst/selection.py` — 6/3/2/1 quota selector with redistribution
- `api/services/catalyst/cost_guard.py` — daily spend tracking + caps
- `api/services/catalyst/synthesize.py` — Opus call + skip-if-stable + Haiku fallback + JSON validation + "no clear catalyst" enforcement
- `api/services/catalyst/store.py` — SQLite CRUD
- `api/services/catalyst/engine.py` — orchestrator
- `api/routers/catalysts.py` — `/api/catalysts/today`, `/api/catalysts/by-date/{ymd}`, `POST /api/catalysts/refresh` (admin), `GET /api/admin/catalyst-stats`
- `app/src/components/tiles/CatalystTable.jsx` + `.module.css` — 6-col table tile
- `app/src/utils/highlightThesis.jsx` — bold markdown + gold cashtags + colored pcts
- `app/src/hooks/useCatalysts.js` — SWR hook polling /today every 30s

### Env vars
- `CATALYST_ENGINE_ENABLED=1` — master switch for scheduler
- `CATALYST_OPUS_MODEL=claude-opus-4-7` (default)
- `CATALYST_HAIKU_FALLBACK_MODEL=claude-haiku-4-5` (default)
- `CATALYST_COST_CAP_DAILY=5.00` (USD; soft cap)
- `CATALYST_COST_HARD_CAP=10.00` (USD; hard cutoff)
- `CATALYST_PRICE_FLOOR=2.00` (below this, score penalty -30)
- `CATALYST_QUOTA_CATALYST=6` (forced category mix slots)
- `CATALYST_QUOTA_EARNINGS=3`
- `CATALYST_QUOTA_GAPPER=2`
- `CATALYST_QUOTA_NEWS=1`
- `VITE_CATALYST_UI_ENABLED=1` (frontend kill-switch, default ON)

### Spec + plan
- Spec: `docs/superpowers/specs/2026-05-25-morning-catalyst-table-design.md`
- Plan: `docs/superpowers/plans/2026-05-25-morning-catalyst-table-phase-1.md`

### Deferred to later phases
- **Phase 2:** Twitter advanced_search + AlphaVantage NEWS_SENTIMENT + Perplexity finance_search + Finviz Elite per-ticker news
- **Phase 3:** Watchlist highlight + catalyst-triggered alerts + tag chip filter UI
- **Phase 4:** History browser at `/catalysts/history`, earnings list split, Dashboard restyle, Compass 🧭 integration per row
```

- [ ] **Step 2: Commit + push**

```bash
git add CLAUDE.md
git commit -m "docs: add Morning Catalyst Table section to CLAUDE.md"
git push origin master
```

---

# Done — Phase 1 complete

Verification checklist:

- [ ] All 7 catalyst test files pass: `pytest tests/test_catalyst_*.py -v`
- [ ] Railway deploy ACTIVE with the latest commit
- [ ] `CATALYST_ENGINE_ENABLED=1` set in Railway env vars
- [ ] Railway logs show `[startup] catalysts.db initialized` + `[scheduler] catalyst engine jobs registered`
- [ ] `/api/admin/catalyst-stats` returns nonzero `today_rows` after first scheduled refresh fires (or after `POST /api/catalysts/refresh`)
- [ ] Dashboard shows the 🎯 MORNING CATALYSTS tile at the top with 12 rows
- [ ] Each row has a colored TAG chip (blue/green/amber/gray) and a thesis with bolded amounts + gold cashtags
- [ ] Admin sees the ↻ Refresh button; non-admin doesn't
- [ ] Click a ticker → TickerPopup opens (existing behavior, no change needed)

Use it for a morning open (Tuesday 2026-05-26 if shipping today). Then re-evaluate whether to start Phase 2 source expansion or polish Phase 1 first.

"""SQLite store for catalyst rows + cost log.

DB path: /data/catalysts.db (web service Railway volume).
WAL mode for concurrent reads during background refresh.
All connections wrapped in contextlib.closing — same pattern as
tweet_store.py (Windows teardown requires explicit close).
"""
from __future__ import annotations

import contextlib
import datetime
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
  catalyst_at     INTEGER,
  raw_signals     TEXT,
  grade           TEXT,
  catalyst_type   TEXT,
  is_new          INTEGER,
  refreshed_at    INTEGER,
  pre_move        INTEGER,
  PRIMARY KEY (market_date, ticker)
);
CREATE INDEX IF NOT EXISTS idx_catalysts_date_rank  ON catalysts(market_date, rank);
CREATE INDEX IF NOT EXISTS idx_catalysts_date_score ON catalysts(market_date, score DESC);

-- User feedback on catalyst rows. The structured replacement for "screenshot
-- the lame ones": a 👎 captures the full feature vector so we can mine the
-- shared characteristics of what the trader considers garbage. PK on
-- (user_id, ticker, market_date) so a row's verdict is updatable, not dupable.
CREATE TABLE IF NOT EXISTS catalyst_feedback (
  user_id      TEXT NOT NULL,
  market_date  TEXT NOT NULL,
  ticker       TEXT NOT NULL,
  verdict      TEXT NOT NULL,          -- 'bad' | 'good'
  tag          TEXT,
  grade        TEXT,
  catalyst_type TEXT,
  gap_pct      REAL,
  vol_x        REAL,
  price        REAL,
  market_cap   REAL,
  sector       TEXT,
  thesis_text  TEXT,
  dollar_vol   REAL,
  float_shares INTEGER,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, ticker, market_date)
);
CREATE INDEX IF NOT EXISTS idx_catalyst_feedback_verdict ON catalyst_feedback(verdict, created_at DESC);

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

-- Dedup table for catalyst-triggered alerts. PK on (user_id, ticker, market_date)
-- means each (user, ticker) gets at most one alert per day, regardless of how
-- many refreshes the ticker stays in the top-20.
CREATE TABLE IF NOT EXISTS catalyst_alerts_fired (
  user_id      TEXT NOT NULL,
  ticker       TEXT NOT NULL,
  market_date  TEXT NOT NULL,
  fired_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, ticker, market_date)
);

CREATE TABLE IF NOT EXISTS catalyst_gate_rejections (
  ts            INTEGER NOT NULL,
  market_date   TEXT NOT NULL,
  ticker        TEXT NOT NULL,
  reason        TEXT NOT NULL,
  price         REAL,
  dollar_vol    REAL,
  float_shares  INTEGER,
  market_cap    REAL
);
CREATE INDEX IF NOT EXISTS idx_gate_rej_date ON catalyst_gate_rejections(market_date, ts DESC);
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
        # Backwards-compat: add catalyst_at column to existing DBs that were
        # created before this column was added to the schema. SQLite doesn't
        # support IF NOT EXISTS on columns, so we try + swallow duplicate-column.
        for col, decl in (("catalyst_at", "INTEGER"),
                          ("grade", "TEXT"),
                          ("catalyst_type", "TEXT"),
                          ("is_new", "INTEGER"),
                          ("refreshed_at", "INTEGER"),
                          ("pre_move", "INTEGER")):
            try:
                c.execute(f"ALTER TABLE catalysts ADD COLUMN {col} {decl}")
            except sqlite3.OperationalError as e:
                if "duplicate column name" not in str(e).lower():
                    raise
        # Backwards-compat for the catalyst_feedback enrichment columns
        # (float/dollar_vol added for evidence-based auto-tuning).
        for col, decl in (("dollar_vol", "REAL"),
                          ("float_shares", "INTEGER")):
            try:
                c.execute(f"ALTER TABLE catalyst_feedback ADD COLUMN {col} {decl}")
            except sqlite3.OperationalError as e:
                if "duplicate column name" not in str(e).lower():
                    raise
        c.commit()


def upsert_catalyst(row: dict) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        # refreshed_at = wall-clock time of THIS write, stamped on every upsert
        # (including skip-if-stable cache reuse, where thesis_at stays pinned to
        # the original synthesis). This is the honest "last time the engine
        # looked" timestamp the tile shows, so a quiet morning where the 9:10 /
        # 9:20 runs reuse the 6 AM thesis no longer reads as "3h ago · stale".
        row = {"grade": None, "catalyst_type": None, "is_new": None,
               "pre_move": None, "refreshed_at": int(time.time()), **row}
        c.execute(
            """INSERT INTO catalysts
               (market_date, ticker, rank, score, tag, price, gap_pct, vol_x,
                market_cap, sector, thesis_text, thesis_model, thesis_at,
                thesis_sources, signals_hash, catalyst_at, raw_signals,
                grade, catalyst_type, is_new, refreshed_at, pre_move)
               VALUES (:market_date, :ticker, :rank, :score, :tag, :price, :gap_pct,
                       :vol_x, :market_cap, :sector, :thesis_text, :thesis_model,
                       :thesis_at, :thesis_sources, :signals_hash, :catalyst_at, :raw_signals,
                       :grade, :catalyst_type, :is_new, :refreshed_at, :pre_move)
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
                 catalyst_at    = excluded.catalyst_at,
                 raw_signals    = excluded.raw_signals,
                 grade          = excluded.grade,
                 catalyst_type  = excluded.catalyst_type,
                 is_new         = excluded.is_new,
                 refreshed_at   = excluded.refreshed_at,
                 pre_move       = excluded.pre_move""",
            row,
        )
        c.commit()


def record_feedback(*, user_id: str, market_date: str, ticker: str,
                    verdict: str, row: Optional[dict] = None) -> None:
    """Upsert a user's 👍/👎 on a catalyst row, capturing its feature vector.
    `row` is the stored catalyst dict (from get_ticker_for_date) so we snapshot
    the numbers as they were when flagged."""
    row = row or {}
    price = row.get("price")
    # Best-effort metadata enrichment so the auto-tuner can mine the float +
    # dollar-volume profile of 👎 rows. Never raise out of feedback recording.
    float_shares = None
    dollar_vol = None
    try:
        from api.services.catalyst import ticker_metadata
        m = ticker_metadata.get_metadata(ticker) or {}
        float_shares = m.get("float_shares") or m.get("shares_outstanding")
        dollar_vol = (price or 0) * (m.get("avg_volume_30d") or 0) or None
    except Exception:
        pass
    payload = {
        "user_id": user_id,
        "market_date": market_date,
        "ticker": ticker.upper(),
        "verdict": verdict,
        "tag": row.get("tag"),
        "grade": row.get("grade"),
        "catalyst_type": row.get("catalyst_type"),
        "gap_pct": row.get("gap_pct"),
        "vol_x": row.get("vol_x"),
        "price": price,
        "market_cap": row.get("market_cap"),
        "sector": row.get("sector"),
        "thesis_text": row.get("thesis_text"),
        "dollar_vol": dollar_vol,
        "float_shares": float_shares,
        "created_at": int(time.time()),
    }
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO catalyst_feedback
               (user_id, market_date, ticker, verdict, tag, grade, catalyst_type,
                gap_pct, vol_x, price, market_cap, sector, thesis_text,
                dollar_vol, float_shares, created_at)
               VALUES (:user_id, :market_date, :ticker, :verdict, :tag, :grade,
                       :catalyst_type, :gap_pct, :vol_x, :price, :market_cap,
                       :sector, :thesis_text, :dollar_vol, :float_shares,
                       :created_at)
               ON CONFLICT(user_id, ticker, market_date) DO UPDATE SET
                 verdict       = excluded.verdict,
                 tag           = excluded.tag,
                 grade         = excluded.grade,
                 catalyst_type = excluded.catalyst_type,
                 gap_pct       = excluded.gap_pct,
                 vol_x         = excluded.vol_x,
                 price         = excluded.price,
                 market_cap    = excluded.market_cap,
                 sector        = excluded.sector,
                 thesis_text   = excluded.thesis_text,
                 dollar_vol    = excluded.dollar_vol,
                 float_shares  = excluded.float_shares,
                 created_at    = excluded.created_at""",
            payload,
        )
        c.commit()


def recent_feedback(verdict: str, days: int = 30) -> list[dict]:
    """Return feedback rows of a given verdict created within the last `days`,
    as a list of dicts. Used by the evidence-based auto-tuner to mine the
    feature profile of 👎 / 👍 rows."""
    cutoff = int(time.time()) - int(days) * 86400
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            """SELECT * FROM catalyst_feedback
               WHERE verdict = ? AND created_at >= ?
               ORDER BY created_at DESC""",
            (verdict, cutoff),
        ).fetchall()
        return [dict(r) for r in rows]


def get_recent_bad_examples(limit: int = 6) -> list[dict]:
    """Most-recently flagged 'bad' rows, deduped by ticker, for few-shot
    steering of the grader."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            """SELECT ticker, tag, grade, catalyst_type, gap_pct, vol_x,
                      thesis_text, MAX(created_at) AS created_at
               FROM catalyst_feedback
               WHERE verdict = 'bad'
               GROUP BY ticker
               ORDER BY created_at DESC
               LIMIT ?""",
            (int(limit),),
        ).fetchall()
        return [dict(r) for r in rows]


def feedback_summary() -> dict:
    """Aggregate characteristics of 👎 rows so the operator can spot the shared
    traits of 'lame' catalysts and harden the gates accordingly."""
    with contextlib.closing(_connect()) as c:
        totals = dict(c.execute(
            """SELECT
                 SUM(CASE WHEN verdict='bad'  THEN 1 ELSE 0 END) AS bad_count,
                 SUM(CASE WHEN verdict='good' THEN 1 ELSE 0 END) AS good_count,
                 AVG(CASE WHEN verdict='bad'  THEN ABS(gap_pct) END) AS bad_avg_abs_gap,
                 AVG(CASE WHEN verdict='bad'  THEN vol_x END)        AS bad_avg_volx
               FROM catalyst_feedback""").fetchone())
        by_tag = [dict(r) for r in c.execute(
            """SELECT tag, COUNT(*) AS n FROM catalyst_feedback
               WHERE verdict='bad' GROUP BY tag ORDER BY n DESC""").fetchall()]
        by_type = [dict(r) for r in c.execute(
            """SELECT catalyst_type, COUNT(*) AS n FROM catalyst_feedback
               WHERE verdict='bad' GROUP BY catalyst_type ORDER BY n DESC""").fetchall()]
        recent = [dict(r) for r in c.execute(
            """SELECT ticker, market_date, tag, grade, catalyst_type, gap_pct,
                      vol_x, thesis_text
               FROM catalyst_feedback WHERE verdict='bad'
               ORDER BY created_at DESC LIMIT 30""").fetchall()]
        return {"totals": totals, "bad_by_tag": by_tag,
                "bad_by_type": by_type, "recent_bad": recent}


def get_for_date(market_date: str, ranked_only: bool = True) -> list[dict]:
    sql = "SELECT * FROM catalysts WHERE market_date = ?"
    if ranked_only:
        sql += " AND rank IS NOT NULL"
    sql += " ORDER BY rank ASC NULLS LAST, score DESC"
    with contextlib.closing(_connect()) as c:
        return [dict(r) for r in c.execute(sql, (market_date,)).fetchall()]


def recent_ranked_tickers(market_date: str, days: int = 3) -> set[str]:
    """Return the set of tickers that were RANKED (rank IS NOT NULL) on any
    market_date STRICTLY BEFORE `market_date`, within the prior `days` calendar
    days — i.e. in the window [market_date - days, market_date - 1].

    Used to flag "new" vs "developing" catalysts: a ticker absent from this set
    is breaking today (new); one present is a multi-day continuation.

    Never raises — returns an empty set on any error.
    """
    try:
        lower = (datetime.date.fromisoformat(market_date)
                 - datetime.timedelta(days=int(days))).isoformat()
        with contextlib.closing(_connect()) as c:
            rows = c.execute(
                """SELECT DISTINCT ticker FROM catalysts
                   WHERE rank IS NOT NULL AND market_date < ? AND market_date >= ?""",
                (market_date, lower),
            ).fetchall()
            return {(r["ticker"] or "").upper() for r in rows}
    except Exception:
        return set()


def last_refresh_for_date(market_date: str) -> Optional[int]:
    """Wall-clock unix time of the most recent engine write for this date —
    the honest 'last refreshed' moment, independent of thesis_at (which
    skip-if-stable freezes at first synthesis). None if the date has no rows."""
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT MAX(refreshed_at) AS r FROM catalysts WHERE market_date = ?",
            (market_date,),
        ).fetchone()
        return row["r"] if row and row["r"] is not None else None


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


def try_record_alert(user_id: str, ticker: str, market_date: str) -> bool:
    """Atomically dedupe a catalyst alert. Returns True if newly recorded
    (caller should fire alert), False if already fired today for this
    (user, ticker, market_date)."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        try:
            c.execute(
                """INSERT INTO catalyst_alerts_fired
                   (user_id, ticker, market_date, fired_at)
                   VALUES (?, ?, ?, ?)""",
                (user_id, ticker.upper(), market_date, int(time.time())),
            )
            c.commit()
            return True
        except sqlite3.IntegrityError:
            return False


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


def log_rejection(*, market_date: str, ticker: str, reason: str,
                  price: Optional[float] = None, dollar_vol: Optional[float] = None,
                  float_shares: Optional[int] = None,
                  market_cap: Optional[float] = None) -> None:
    """Persist a quality-gate rejection so thresholds can be tuned from evidence
    instead of guesswork. Rolling — pruned to the last 14 days on write."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO catalyst_gate_rejections
               (ts, market_date, ticker, reason, price, dollar_vol,
                float_shares, market_cap)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (int(time.time()), market_date, ticker.upper(), reason, price,
             dollar_vol, float_shares, market_cap),
        )
        c.execute(
            "DELETE FROM catalyst_gate_rejections WHERE ts < ?",
            (int(time.time()) - 14 * 86400,),
        )
        c.commit()


def recent_rejections(limit: int = 200, market_date: Optional[str] = None) -> list[dict]:
    sql = "SELECT * FROM catalyst_gate_rejections"
    params: tuple = ()
    if market_date:
        sql += " WHERE market_date = ?"
        params = (market_date,)
    sql += " ORDER BY ts DESC LIMIT ?"
    params = params + (int(limit),)
    with contextlib.closing(_connect()) as c:
        return [dict(r) for r in c.execute(sql, params).fetchall()]


def rejection_summary(market_date: Optional[str] = None) -> dict:
    """Counts of rejections grouped by the reason's leading phrase (so
    'float ... below' and 'liquidity ... below' aggregate)."""
    rows = recent_rejections(limit=2000, market_date=market_date)
    by_kind: dict[str, int] = {}
    for r in rows:
        kind = (r.get("reason") or "").split(" ")[0] or "other"
        by_kind[kind] = by_kind.get(kind, 0) + 1
    return {"total": len(rows), "by_kind": by_kind}

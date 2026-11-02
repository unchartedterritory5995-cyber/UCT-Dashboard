"""Chart IQ member feedback: one vote (useful / partly / noise) and an optional note per member, per ticker, per as-of day.

Its own SQLite file (``<DATA_DIR>/chart_iq_feedback.db``, ``CHART_IQ_FEEDBACK_DB`` overrides), so it shares no lock with auth.db
or bars.db. A member re-voting the same chart REPLACES their vote (one row per member/ticker/day), which bounds the table by
what members actually look at; ``DAILY_CAP`` bounds how many different charts one member can vote on in a day. The export
carries a one-way hash of the member id, never the id or the email: the reader of the export only needs to tell members apart.
Never imports the engine.
"""
from __future__ import annotations

import hashlib
import os
import sqlite3
import threading
import time

VOTES = ("useful", "partly", "noise")
NOTE_MAX = 2000
DAILY_CAP = 300
_LOCK = threading.Lock()
_INIT: set = set()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS chart_iq_feedback (
    user_id   TEXT NOT NULL,
    ticker    TEXT NOT NULL,
    asof      TEXT NOT NULL,
    vote      TEXT NOT NULL,
    note      TEXT NOT NULL DEFAULT '',
    version   TEXT NOT NULL DEFAULT '',
    is_admin  INTEGER NOT NULL DEFAULT 0,
    created   REAL NOT NULL,
    updated   REAL NOT NULL,
    PRIMARY KEY (user_id, ticker, asof)
);
CREATE INDEX IF NOT EXISTS ix_ciqfb_updated ON chart_iq_feedback(updated);
CREATE INDEX IF NOT EXISTS ix_ciqfb_user_created ON chart_iq_feedback(user_id, created);
"""


def db_path() -> str:
    return os.environ.get("CHART_IQ_FEEDBACK_DB") or os.path.join(os.environ.get("DATA_DIR", "/data"), "chart_iq_feedback.db")


def _conn() -> sqlite3.Connection:
    p = db_path()
    c = sqlite3.connect(p, timeout=2.0)
    c.execute("PRAGMA busy_timeout=2000")
    if p not in _INIT:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(_SCHEMA)
        _INIT.add(p)
    return c


def member_hash(user_id: str) -> str:
    return hashlib.sha256(("chart-iq:" + str(user_id)).encode("utf-8")).hexdigest()[:16]


class CapReached(Exception):
    pass


def save(user_id: str, ticker: str, asof: str, vote: str, note: str = "", version: str = "", is_admin: bool = False) -> dict:
    """Insert or replace this member's vote on this chart. Raises ValueError on a bad vote, CapReached past DAILY_CAP new charts
    in 24 h (re-voting a chart already voted on is always allowed)."""
    if vote not in VOTES:
        raise ValueError("vote must be one of %s" % ", ".join(VOTES))
    note = (note or "").strip()[:NOTE_MAX]
    now = time.time()
    with _LOCK:
        c = _conn()
        try:
            had = c.execute("SELECT 1 FROM chart_iq_feedback WHERE user_id=? AND ticker=? AND asof=?",
                            (user_id, ticker, asof)).fetchone()
            if not had:
                n = c.execute("SELECT count(*) FROM chart_iq_feedback WHERE user_id=? AND created>=?",
                              (user_id, now - 86400)).fetchone()[0]
                if n >= DAILY_CAP:
                    raise CapReached()
            c.execute(
                "INSERT INTO chart_iq_feedback (user_id,ticker,asof,vote,note,version,is_admin,created,updated) VALUES (?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(user_id,ticker,asof) DO UPDATE SET vote=excluded.vote, note=excluded.note, version=excluded.version, "
                "updated=excluded.updated",
                (user_id, ticker, asof, vote, note, version or "", 1 if is_admin else 0, now, now))
            c.commit()
        finally:
            c.close()
    return {"vote": vote, "note": note}


def mine(user_id: str, ticker: str, asof: str) -> dict | None:
    """This member's vote on this chart, or None. Never raises: a broken feedback file must not break the chart read."""
    try:
        c = _conn()
        try:
            r = c.execute("SELECT vote, note FROM chart_iq_feedback WHERE user_id=? AND ticker=? AND asof=?",
                          (user_id, ticker, asof)).fetchone()
        finally:
            c.close()
        return {"vote": r[0], "note": r[1]} if r else None
    except Exception:  # noqa: BLE001
        return None


def export(since: float = 0.0, limit: int = 5000) -> list[dict]:
    """Every vote updated after ``since`` (epoch seconds), oldest first, member ids hashed."""
    c = _conn()
    try:
        rows = c.execute("SELECT user_id,ticker,asof,vote,note,version,is_admin,created,updated FROM chart_iq_feedback "
                         "WHERE updated>? ORDER BY updated LIMIT ?", (float(since), int(limit))).fetchall()
    finally:
        c.close()
    return [{"member": member_hash(r[0]), "ticker": r[1], "asof": r[2], "vote": r[3], "note": r[4], "version": r[5],
             "is_admin": bool(r[6]), "created": r[7], "updated": r[8]} for r in rows]

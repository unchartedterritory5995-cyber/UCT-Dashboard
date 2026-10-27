"""The bounded headline history and the delivery ledger -- ``trade_exchange_news.db``.

Two tables, because a DELIVERY and a HEADLINE are different things:

* ``deliveries`` -- one row per journal record ever ingested (event id is the
  key). This is the idempotency ledger: a push and a recovery of the same
  record are one delivery. Pruned by AGE only, never by count, so the
  reconciler can never resurrect a headline the count bound removed.
* ``headlines``  -- what members see. ``seq`` (AUTOINCREMENT: never reused, even
  after pruning) is the ONE order every subscriber receives and every replay
  resumes from.

⭐ THE DUPLICATE POLICY (owner: "do not silently discard potentially legitimate
news without an explicit policy"). Trade Exchange sends no delivery id, so a
sender RETRY and a legitimate REPEAT publication are indistinguishable on the
wire. The policy is therefore lossless and visible:
  * every delivery is journaled and ledgered -- nothing is dropped anywhere;
  * a delivery whose (source, normalized content) matches a headline received
    within ``TXN_DEDUPE_WINDOW_S`` (default 60 s, either side -- recovery can
    deliver out of order) is COLLAPSED onto it: ``repeat_count`` goes up and a
    ``repeat`` event is published, so the widget can show "×2";
  * ``TXN_DEDUPE_WINDOW_S=0`` turns collapsing off (every delivery a headline).

Single writer: only ``pipeline``'s one writer thread calls ``ingest`` and
``prune``; readers use their own per-thread connections (WAL).
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS headlines (
    seq             INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id        TEXT NOT NULL UNIQUE,
    source          TEXT NOT NULL,
    content         TEXT NOT NULL,
    received_at_ms  INTEGER NOT NULL,
    dedupe_key      TEXT NOT NULL,
    repeat_count    INTEGER NOT NULL DEFAULT 0,
    last_repeat_ms  INTEGER,
    tickers         TEXT NOT NULL DEFAULT '[]',
    ingested_at_ms  INTEGER NOT NULL,
    via             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_txn_headlines_dedupe ON headlines(dedupe_key, received_at_ms);
CREATE INDEX IF NOT EXISTS ix_txn_headlines_received ON headlines(received_at_ms);
CREATE TABLE IF NOT EXISTS deliveries (
    event_id        TEXT PRIMARY KEY,
    headline_seq    INTEGER NOT NULL,
    received_at_ms  INTEGER NOT NULL,
    kind            TEXT NOT NULL,          -- 'headline' | 'repeat'
    via             TEXT NOT NULL,          -- 'push' | 'reconcile'
    ingested_at_ms  INTEGER NOT NULL,
    header_names    TEXT NOT NULL DEFAULT '[]',
    extra_keys      TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS ix_txn_deliveries_received ON deliveries(received_at_ms);
CREATE TABLE IF NOT EXISTS state (k TEXT PRIMARY KEY, v TEXT NOT NULL);
"""

NEW, REPEAT, KNOWN = "new", "repeat", "known"

_COLS = ("seq", "event_id", "source", "content", "received_at_ms", "repeat_count",
         "last_repeat_ms", "tickers", "via", "ingested_at_ms")


def _row(r: sqlite3.Row | tuple) -> dict[str, Any]:
    d = dict(zip(_COLS, r))
    d["tickers"] = json.loads(d["tickers"] or "[]")
    return d


class Store:
    def __init__(self, path: str) -> None:
        self.path = path
        self._local = threading.local()
        with self._conn() as c:
            c.executescript(_SCHEMA)
        # ⭐ THE EPOCH: a random id minted once per database file. seq is only
        # meaningful within one epoch -- if the file is ever recreated, seq
        # restarts at 1 and a client holding cursor 4,812 must not read "nothing
        # new". Every event and every replay carries the epoch; a client whose
        # epoch differs discards its cursor and reloads.
        if self.get_state("epoch") is None:
            import secrets
            self.set_state("epoch", secrets.token_hex(8))
        self.epoch = self.get_state("epoch")

    def _conn(self) -> sqlite3.Connection:
        c = getattr(self._local, "conn", None)
        if c is None:
            c = sqlite3.connect(self.path, timeout=5, isolation_level=None,
                                check_same_thread=False)
            c.execute("PRAGMA journal_mode=WAL")
            # ⛔ FULL, not NORMAL: web's commit is one of the two stores the
            # receiver may acknowledge on (the other is R2), so it must survive
            # an OS crash / power loss, not only a process crash. The fsync this
            # costs is measured in tests/test_trade_exchange_news_handoff.py.
            c.execute("PRAGMA synchronous=FULL")
            self._local.conn = c
        return c

    # ── the writer side ──────────────────────────────────────────────────────

    def ingest(self, rec: dict[str, Any], *, via: str, dedupe_key: str, window_ms: int,
               tickers: list[str], now_ms: int | None = None) -> dict[str, Any]:
        """Record one delivery. Returns ``{"kind", "seq", "headline"}``.

        ``kind`` is NEW (a headline was created), REPEAT (collapsed onto an
        existing headline, whose updated row is returned) or KNOWN (this event
        id was already ingested -- push and recovery raced; nothing changes).
        """
        now = int(time.time() * 1000) if now_ms is None else now_ms
        c = self._conn()
        c.execute("BEGIN IMMEDIATE")
        try:
            hit = c.execute("SELECT headline_seq FROM deliveries WHERE event_id=?",
                            (rec["id"],)).fetchone()
            if hit:
                c.execute("COMMIT")
                return {"kind": KNOWN, "seq": hit[0], "headline": None}
            target = None
            if window_ms > 0:
                target = c.execute(
                    "SELECT seq FROM headlines WHERE dedupe_key=? AND received_at_ms BETWEEN ? AND ? "
                    "ORDER BY seq LIMIT 1",
                    (dedupe_key, rec["received_at_ms"] - window_ms,
                     rec["received_at_ms"] + window_ms)).fetchone()
            if target:
                seq, kind = target[0], REPEAT
                c.execute("UPDATE headlines SET repeat_count=repeat_count+1, "
                          "last_repeat_ms=MAX(COALESCE(last_repeat_ms,0), ?) WHERE seq=?",
                          (rec["received_at_ms"], seq))
            else:
                kind = NEW
                cur = c.execute(
                    "INSERT INTO headlines(event_id, source, content, received_at_ms, dedupe_key, "
                    "tickers, ingested_at_ms, via) VALUES (?,?,?,?,?,?,?,?)",
                    (rec["id"], rec["source"], rec["content"], rec["received_at_ms"], dedupe_key,
                     json.dumps(tickers), now, via))
                seq = cur.lastrowid
            c.execute("INSERT INTO deliveries(event_id, headline_seq, received_at_ms, kind, via, "
                      "ingested_at_ms, header_names, extra_keys) VALUES (?,?,?,?,?,?,?,?)",
                      (rec["id"], seq, rec["received_at_ms"], "headline" if kind == NEW else "repeat",
                       via, now, json.dumps(rec.get("header_names", [])),
                       json.dumps(rec.get("extra_keys", []))))
            row = c.execute(f"SELECT {','.join(_COLS)} FROM headlines WHERE seq=?", (seq,)).fetchone()
            c.execute("COMMIT")
        except BaseException:
            c.execute("ROLLBACK")
            raise
        return {"kind": kind, "seq": seq, "headline": _row(row)}

    def prune(self, *, max_age_ms: int, max_items: int, now_ms: int | None = None) -> dict[str, int]:
        now = int(time.time() * 1000) if now_ms is None else now_ms
        cutoff = now - max_age_ms
        c = self._conn()
        c.execute("BEGIN IMMEDIATE")
        try:
            by_age = c.execute("DELETE FROM headlines WHERE received_at_ms < ?", (cutoff,)).rowcount
            by_count = c.execute(
                "DELETE FROM headlines WHERE seq <= (SELECT seq FROM headlines "
                "ORDER BY seq DESC LIMIT 1 OFFSET ?)", (max_items,)).rowcount
            ledger = c.execute("DELETE FROM deliveries WHERE received_at_ms < ?", (cutoff,)).rowcount
            c.execute("COMMIT")
        except BaseException:
            c.execute("ROLLBACK")
            raise
        return {"by_age": by_age, "by_count": by_count, "ledger": ledger}

    # ── small durable state (epoch, heartbeat, coverage gaps) ────────────────

    def get_state(self, k: str) -> str | None:
        r = self._conn().execute("SELECT v FROM state WHERE k=?", (k,)).fetchone()
        return r[0] if r else None

    def set_state(self, k: str, v: str) -> None:
        self._conn().execute("INSERT INTO state(k, v) VALUES (?, ?) "
                             "ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v))

    # ── the reader side ──────────────────────────────────────────────────────

    def after(self, seq: int, limit: int = 500) -> list[dict[str, Any]]:
        rows = self._conn().execute(
            f"SELECT {','.join(_COLS)} FROM headlines WHERE seq > ? ORDER BY seq LIMIT ?",
            (int(seq), int(limit))).fetchall()
        return [_row(r) for r in rows]

    def before(self, seq: int, limit: int = 200) -> list[dict[str, Any]]:
        rows = self._conn().execute(
            f"SELECT {','.join(_COLS)} FROM headlines WHERE seq < ? ORDER BY seq DESC LIMIT ?",
            (int(seq), int(limit))).fetchall()
        return [_row(r) for r in reversed(rows)]

    def first_seq(self) -> int:
        r = self._conn().execute("SELECT MIN(seq) FROM headlines").fetchone()
        return int(r[0] or 0)

    def recent(self, limit: int = 200) -> list[dict[str, Any]]:
        rows = self._conn().execute(
            f"SELECT {','.join(_COLS)} FROM headlines ORDER BY seq DESC LIMIT ?",
            (int(limit),)).fetchall()
        return [_row(r) for r in reversed(rows)]

    def known(self, event_id: str) -> bool:
        return self._conn().execute("SELECT 1 FROM deliveries WHERE event_id=?",
                                    (event_id,)).fetchone() is not None

    def cursor_ms(self) -> int | None:
        r = self._conn().execute("SELECT MAX(received_at_ms) FROM deliveries").fetchone()
        return r[0] if r and r[0] is not None else None

    def last_seq(self) -> int:
        r = self._conn().execute("SELECT MAX(seq) FROM headlines").fetchone()
        return int(r[0] or 0)

    def stats(self) -> dict[str, Any]:
        """Counts and times only -- never content."""
        c = self._conn()
        h = c.execute("SELECT COUNT(*), MIN(received_at_ms), MAX(received_at_ms), MAX(seq), "
                      "COALESCE(SUM(repeat_count),0) FROM headlines").fetchone()
        d = c.execute("SELECT COUNT(*), SUM(via='reconcile'), SUM(kind='repeat') FROM deliveries").fetchone()
        names: dict[str, int] = {}
        for (blob,) in c.execute("SELECT header_names FROM deliveries ORDER BY received_at_ms DESC LIMIT 200"):
            for n in json.loads(blob or "[]"):
                names[n] = names.get(n, 0) + 1
        extra: dict[str, int] = {}
        for (blob,) in c.execute("SELECT extra_keys FROM deliveries WHERE extra_keys != '[]' LIMIT 200"):
            for n in json.loads(blob or "[]"):
                extra[n] = extra.get(n, 0) + 1
        return {"headlines": h[0], "oldest_ms": h[1], "newest_ms": h[2], "last_seq": h[3] or 0,
                "repeats": h[4], "deliveries": d[0], "recovered": d[1] or 0,
                "collapsed": d[2] or 0, "header_names_recent": names, "extra_keys_seen": extra}

"""The PERMANENT headline archive and the delivery ledger -- ``trade_exchange_news.db``.

Two tables, because a DELIVERY and a HEADLINE are different things:

* ``deliveries`` -- one row per journal record ever ingested (event id is the
  key). This is the idempotency ledger: a push and a recovery of the same
  record are one delivery, and it keeps the record exactly as received.
* ``headlines``  -- what members see. ``seq`` (AUTOINCREMENT: never reused) is the
  ONE order every subscriber receives and every replay resumes from.

⛔⛔ PERMANENT RETENTION (owner, 2026-10-31; Trade Exchange authorized indefinite
storage). NOTHING here deletes a headline or a delivery -- not by age, not by
count, not ever. There is no prune, and ``tests/test_trade_exchange_news_retention.py``
fails if a DELETE against either table appears anywhere in the News code. Only
in-memory CACHES are bounded (archive.py), and evicting one never touches a row.

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

Single writer: only ``pipeline``'s one writer thread calls ``ingest``; readers use their own per-thread connections (WAL).
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
    extra_keys      TEXT NOT NULL DEFAULT '[]',
    record_json     TEXT,                   -- the journal record exactly as received
    journaled       INTEGER NOT NULL DEFAULT 0  -- 1 once the R2 journal is CONFIRMED to hold it
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
            have = {r[1] for r in c.execute("PRAGMA table_info(deliveries)")}
            # Additive migration for a store created before Checkpoint D1.
            if "record_json" not in have:
                c.execute("ALTER TABLE deliveries ADD COLUMN record_json TEXT")
            if "journaled" not in have:
                c.execute("ALTER TABLE deliveries ADD COLUMN journaled INTEGER NOT NULL DEFAULT 0")
            c.execute("CREATE INDEX IF NOT EXISTS ix_txn_deliveries_unjournaled "
                      "ON deliveries(journaled, received_at_ms)")
            # The daily integrity check's per-headline repeat accounting (integrity.py).
            c.execute("CREATE INDEX IF NOT EXISTS ix_txn_deliveries_headline ON deliveries(headline_seq)")
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
               tickers: list[str], now_ms: int | None = None,
               record_json: str | None = None) -> dict[str, Any]:
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
            # A record recovered FROM the journal is in it by definition; a pushed
            # one is unconfirmed until the repair pass sees it there (reconcile.py).
            c.execute("INSERT INTO deliveries(event_id, headline_seq, received_at_ms, kind, via, "
                      "ingested_at_ms, header_names, extra_keys, record_json, journaled) "
                      "VALUES (?,?,?,?,?,?,?,?,?,?)",
                      (rec["id"], seq, rec["received_at_ms"], "headline" if kind == NEW else "repeat",
                       via, now, json.dumps(rec.get("header_names", [])),
                       json.dumps(rec.get("extra_keys", [])), record_json,
                       1 if via == "reconcile" else 0))
            row = c.execute(f"SELECT {','.join(_COLS)} FROM headlines WHERE seq=?", (seq,)).fetchone()
            c.execute("COMMIT")
        except BaseException:
            c.execute("ROLLBACK")
            raise
        return {"kind": kind, "seq": seq, "headline": _row(row)}

    # ── small durable state (epoch, heartbeat, coverage gaps) ────────────────

    def get_state(self, k: str) -> str | None:
        r = self._conn().execute("SELECT v FROM state WHERE k=?", (k,)).fetchone()
        return r[0] if r else None

    def set_state(self, k: str, v: str) -> None:
        self._conn().execute("INSERT INTO state(k, v) VALUES (?, ?) "
                             "ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v))

    # ── journal confirmation (the R2 repair ledger) ──────────────────────────

    def unjournaled(self, limit: int = 500, older_than_ms: int | None = None) -> list[tuple[str, int, str | None]]:
        """(event_id, received_at_ms, record_json) for deliveries the journal is
        not yet confirmed to hold, oldest first. Persistent: survives restarts of
        web AND of the receiver, so no repair work is ever held only in memory."""
        q = "SELECT event_id, received_at_ms, record_json FROM deliveries WHERE journaled=0"
        args: tuple = ()
        if older_than_ms is not None:
            q += " AND ingested_at_ms <= ?"
            args = (int(older_than_ms),)
        q += " ORDER BY received_at_ms, event_id LIMIT ?"
        return list(self._conn().execute(q, (*args, int(limit))).fetchall())

    def mark_journaled(self, event_ids: list[str]) -> int:
        if not event_ids:
            return 0
        c = self._conn()
        n = 0
        for i in range(0, len(event_ids), 500):
            chunk = event_ids[i:i + 500]
            n += c.execute(f"UPDATE deliveries SET journaled=1 WHERE journaled=0 AND event_id IN "
                           f"({','.join('?' * len(chunk))})", chunk).rowcount
        return n

    def journal_backlog(self) -> dict[str, Any]:
        r = self._conn().execute(
            "SELECT COUNT(*), MIN(received_at_ms) FROM deliveries WHERE journaled=0").fetchone()
        return {"count": r[0], "oldest_ms": r[1]}

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

    def index_after(self, seq: int, limit: int) -> list[tuple]:
        """(seq, source, content, received_at_ms, event_id, via, ingested_at_ms) --
        every column that never changes once written -- for ``seq > seq``, oldest
        first: the archive index's increment (archive.py holds a rebuildable copy)."""
        return self._conn().execute(
            "SELECT seq, source, content, received_at_ms, event_id, via, ingested_at_ms FROM headlines "
            "WHERE seq > ? ORDER BY seq LIMIT ?", (int(seq), int(limit))).fetchall()

    def index_between(self, start_ms: int, end_ms: int) -> list[tuple]:
        """The same index tuples for ``start_ms <= received_at_ms < end_ms`` (one
        calendar day): a range read on ``ix_txn_headlines_received``, so its cost is
        the day's size, never the archive's."""
        return self._conn().execute(
            "SELECT seq, source, content, received_at_ms, event_id, via, ingested_at_ms FROM headlines "
            "WHERE received_at_ms >= ? AND received_at_ms < ? ORDER BY seq", (int(start_ms), int(end_ms))).fetchall()

    def index_before(self, seq: int, limit: int) -> list[tuple]:
        """Index tuples for the ``limit`` headlines just below ``seq``, seq ascending."""
        rows = self._conn().execute(
            "SELECT seq, source, content, received_at_ms, event_id, via, ingested_at_ms FROM headlines "
            "WHERE seq < ? ORDER BY seq DESC LIMIT ?", (int(seq), int(limit))).fetchall()
        return rows[::-1]

    def count_between(self, start_ms: int, end_ms: int) -> int:
        """Headlines received in ``[start_ms, end_ms)``: one aggregate row off the
        index -- a cached day's consistency check."""
        return int(self._conn().execute(
            "SELECT COUNT(*) FROM headlines WHERE received_at_ms >= ? AND received_at_ms < ?",
            (int(start_ms), int(end_ms))).fetchone()[0])

    def hour_counts(self, after_seq: int = 0) -> tuple[dict[int, int], int]:
        """({UTC hour -> headlines received in it}, the highest seq counted) for
        ``seq > after_seq``. The calendar's availability: built once per process
        from the index, then extended by new seqs only."""
        c = self._conn()
        top = int(c.execute("SELECT COALESCE(MAX(seq), 0) FROM headlines").fetchone()[0])
        rows = c.execute("SELECT received_at_ms / 3600000, COUNT(*) FROM headlines "
                         "WHERE seq > ? AND seq <= ? GROUP BY 1", (int(after_seq), top)).fetchall()
        return {int(h): int(n) for h, n in rows}, top

    def repeats_for(self, seqs: list[int]) -> dict[int, int]:
        """seq -> repeat_count for just these rows (where it is above zero)."""
        out: dict[int, int] = {}
        for i in range(0, len(seqs), 500):
            chunk = [int(s) for s in seqs[i:i + 500]]
            out.update(self._conn().execute(
                f"SELECT seq, repeat_count FROM headlines WHERE repeat_count > 0 AND seq IN "
                f"({','.join('?' * len(chunk))})", chunk).fetchall())
        return out

    def repeats(self) -> dict[int, int]:
        """seq -> repeat_count for EVERY headline received more than once (grows
        with the archive: readers of one page use ``repeats_for``)."""
        return dict(self._conn().execute("SELECT seq, repeat_count FROM headlines WHERE repeat_count > 0"))

    def count_upto(self, seq: int) -> int:
        """How many headlines have ``seq <= seq``: one aggregate row, the page
        index's consistency check."""
        return int(self._conn().execute("SELECT COUNT(*) FROM headlines WHERE seq <= ?",
                                        (int(seq),)).fetchone()[0])

    def present(self, seqs: list[int]) -> set[int]:
        """Which of ``seqs`` exist."""
        out: set[int] = set()
        for i in range(0, len(seqs), 500):
            chunk = [int(s) for s in seqs[i:i + 500]]
            out.update(r[0] for r in self._conn().execute(
                f"SELECT seq FROM headlines WHERE seq IN ({','.join('?' * len(chunk))})", chunk))
        return out

    def first_seq(self) -> int:
        r = self._conn().execute("SELECT MIN(seq) FROM headlines").fetchone()
        return int(r[0] or 0)

    def recent(self, limit: int = 200) -> list[dict[str, Any]]:
        rows = self._conn().execute(
            f"SELECT {','.join(_COLS)} FROM headlines ORDER BY seq DESC LIMIT ?",
            (int(limit),)).fetchall()
        return [_row(r) for r in reversed(rows)]

    def by_event_id(self, event_id: str) -> dict[str, Any] | None:
        """The stored headline for this ``event_id`` (the receiver's ULID: stable
        across epochs and recovery), or None. A read; explain.py's source. Any
        delivery's id finds its headline (``resolve_events``)."""
        return self.resolve_events([str(event_id)]).get(str(event_id))

    def resolve_events(self, event_ids: list[str]) -> dict[str, dict[str, Any]]:
        """{event_id: its headline row} for every id the store knows. Resolved through
        ``deliveries`` (one row per delivery, each naming its headline), so a reference
        kept outside this database -- a member's bookmark -- still finds its story after
        an R2 rebuild, even if a DIFFERENT delivery of that story became the headline's
        first. ⛔ Never by ``seq``: a rebuild renumbers it. A read."""
        ids = [str(i) for i in dict.fromkeys(event_ids or [])]
        out: dict[str, dict[str, Any]] = {}
        cols = ",".join("h." + c for c in _COLS)
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            marks = ",".join("?" * len(chunk))
            for r in self._conn().execute(
                    f"SELECT d.event_id, {cols} FROM deliveries d JOIN headlines h ON h.seq = d.headline_seq"
                    f" WHERE d.event_id IN ({marks})", chunk).fetchall():
                out[r[0]] = _row(r[1:])
            # A headline row with no delivery row (a pre-ledger store) still answers for its own id.
            missing = [e for e in chunk if e not in out]
            if missing:
                marks = ",".join("?" * len(missing))
                for r in self._conn().execute(f"SELECT {','.join(_COLS)} FROM headlines WHERE event_id IN ({marks})",
                                              missing).fetchall():
                    row = _row(r)
                    out[row["event_id"]] = row
        return out

    def story_ids(self, event_id: str) -> list[str]:
        """Every delivery id of the headline ``event_id`` belongs to, the headline's own id
        first -- [] when the store does not know it. Which delivery is a story's FIRST can
        change in a rebuild (recovery ingests late deliveries; a rebuild replays in event-id
        order), so a reference kept outside this database is matched against all of them.
        A read."""
        c = self._conn()
        hit = c.execute("SELECT headline_seq FROM deliveries WHERE event_id=?", (str(event_id),)).fetchone()
        if not hit:
            hit = c.execute("SELECT seq FROM headlines WHERE event_id=?", (str(event_id),)).fetchone()
        if not hit:
            return []
        head = c.execute("SELECT event_id FROM headlines WHERE seq=?", (hit[0],)).fetchone()
        ids = [head[0]] if head else []
        ids += [r[0] for r in c.execute("SELECT event_id FROM deliveries WHERE headline_seq=? ORDER BY event_id",
                                        (hit[0],)).fetchall()]
        return list(dict.fromkeys(ids))

    def known(self, event_id: str) -> bool:
        return self._conn().execute("SELECT 1 FROM deliveries WHERE event_id=?",
                                    (event_id,)).fetchone() is not None

    def cursor_ms(self) -> int | None:
        r = self._conn().execute("SELECT MAX(received_at_ms) FROM deliveries").fetchone()
        return r[0] if r and r[0] is not None else None

    def received_range(self) -> tuple[int | None, int | None]:
        """(oldest, newest) receipt time in the archive: two index probes."""
        r = self._conn().execute("SELECT (SELECT MIN(received_at_ms) FROM headlines), "
                                 "(SELECT MAX(received_at_ms) FROM headlines)").fetchone()
        return (r[0], r[1]) if r else (None, None)

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

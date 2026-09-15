"""Permanent daily OHLC for breadth metrics — the data behind candle WICKS.

The EOD `breadth_snapshots` store keeps ONE value per metric per day, so a breadth
candle can only be a body (open=high=low=close). A real wick needs the day's HIGH and
LOW of the breadth value, which only exists if the metric is sampled through the day.

This module keeps that. Two writers:
  1. LIVE accumulator (`update_intraday`) — hooked into the intraday breadth sampler
     that already runs every ~55s. Each sample rolls today's row: open = first sample,
     high = running max, low = running min, close = latest. → real wicks GOING FORWARD.
  2. RECONSTRUCTION (`set_ohlc`) — a backfill that estimates a past day's intraday
     high/low from stored daily stock bars (see breadth_ohlc_reconstruct).

`build_breadth_bars` reads this store for wicks where a day has a row and falls back to
close-to-close bodies for older days that predate it.

Permanent (no retention sweep — ~40 metrics × ~250 sessions/yr is tiny). Separate DB so
it never contends with the EOD snapshot writer.
"""
from __future__ import annotations

import json
import logging
import math
import os
import sqlite3
import threading
from typing import Optional

from api.services.breadth_universes import DEFAULT_UNIVERSE, normalize as _uni

_WRITE_LOCK = threading.Lock()


def _db_path() -> str:
    # Override escape hatch (mirrors BREADTH_MONITOR_DB / BREADTH_INTRADAY_DB) — also what
    # the test conftest pins so this never touches the shared /data (C:\data) volume.
    override = os.environ.get("BREADTH_OHLC_DB")
    if override:
        return override
    if os.path.exists("/data"):
        return "/data/breadth_daily_ohlc.db"
    local = os.path.join(os.path.dirname(__file__), "..", "..", "data", "breadth_daily_ohlc.db")
    os.makedirs(os.path.dirname(local), exist_ok=True)
    return local


#: ⛔ DEFAULT OFF IN CODE, ON in production since 2026-09-15 (Session 9 V1, D-049).
#: Unset or anything but 1/true/yes/on leaves the connection exactly as it has always been
#: opened. It shipped as an experiment with a measurement attached; the measurement came
#: back x9.05 on the deep-read tail, so the flag is now a live setting with a record.
#:
#: ⚰️ THE NAME CARRIES THE `_ENABLED` SUFFIX FOR A REASON, AND IT IS NOT STYLE.
#: `feature_flag_index.is_gate()` matches only names containing a gate marker or ending
#: `_ON`, so the previous name `BREADTH_OHLC_PAGECACHE` was invisible to the flag ledger:
#: it could not be given a row (the row would have been classed as rot by
#: `test_the_ledger_does_not_describe_gates_that_no_longer_exist` and would have turned the
#: master deploy gate red). That is the same two-reason blindness that let
#: `DESK_PUBLIC_SHOWS` sit on a wildcard for 25 days while it published 27 paid sessions.
#: Renaming it is what makes `test_every_off_by_default_gate_is_declared` REQUIRE the
#: ledger row — the rail now enforces the record instead of being unable to see it.
#:
#: ⛔ NO FALLBACK TO THE OLD NAME. A fallback would be a second authority over one value:
#: two variables could disagree and the loser would be invisible. `tests/
#: test_breadth_pagecache_flag.py` fails if the old name is read anywhere under api/.
def _pagecache_on() -> bool:
    return (os.environ.get("BREADTH_OHLC_PAGECACHE_ENABLED", "").strip().lower()
            in ("1", "true", "yes", "on"))


#: 64 MB against a 39.9 MB file. The table grows ~251 rows/yr at ~995 B/row = 0.24 MB/yr,
#: so this is ~101 years of headroom — sized from the measured growth, not guessed.
_MMAP_BYTES = 67108864
#: Negative = KiB. 16 MB, for the reason in `_apply_pagecache`.
_CACHE_KIB = -16000


def _apply_pagecache(c: sqlite3.Connection) -> None:
    """The H1 experiment: map the file, and give the connection a cache big enough to
    survive its own 12 statements.

    ⭐ WHAT EACH ONE CAN AND CANNOT DO, because the difference decides what the
    measurement is allowed to claim:

    `mmap_size` turns page reads into memory accesses **when the OS page cache is warm**.
    It does NOT remove the 4,700 lookups, it does NOT stop the OS evicting those pages
    under memory pressure, and it therefore does NOT fix the ordinary 3-12x range. It
    attacks exactly one thing: the tail, where a request read 540,057,600 bytes — 12.9x
    the whole file — because every evicted page came back through a syscall.

    `cache_size` does NOT persist across requests: ⛔ this module opens a connection per
    call and closes it, so the connection's cache is allocated and freed inside one
    request. But **one request issues 12 chunked statements over ~4.5 MB**, and the
    default is `-2000` — a 2 MB cache, ~500 pages. Pages read by chunk 1 are evicted
    before chunk 8 needs them again. So it is expected to matter WITHIN a request and
    not at all BETWEEN them, and the measurement should show exactly that shape.
    """
    if not _pagecache_on():
        return
    c.execute(f"PRAGMA mmap_size={_MMAP_BYTES}")
    c.execute(f"PRAGMA cache_size={_CACHE_KIB}")


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(_db_path(), timeout=5.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=3000")
    _apply_pagecache(c)
    return c


_INIT_DONE = False


def _ensure_init() -> None:
    global _INIT_DONE
    if _INIT_DONE:
        return
    with _WRITE_LOCK:
        if _INIT_DONE:
            return
        try:
            with _conn() as c:
                c.execute(
                    """CREATE TABLE IF NOT EXISTS breadth_daily_ohlc (
                        universe TEXT NOT NULL DEFAULT 'uct',  -- breadth_universes id
                        date    TEXT NOT NULL,   -- 'YYYY-MM-DD' (ET session)
                        metric  TEXT NOT NULL,   -- breadth metric key, e.g. pct_above_50sma
                        o REAL, h REAL, l REAL, c REAL,
                        source  TEXT DEFAULT 'live',   -- 'live' | 'reconstruct'
                        updated_at TEXT DEFAULT (datetime('now')),
                        PRIMARY KEY (universe, date, metric)
                    )"""
                )
                migrated = _migrate_universe_column(c)
                # ⭐ THE MATERIALISED RECONSTRUCTED SIDE (Session 3). One row per
                # reconstructed session, holding exactly what `closes_for_dates` +
                # `values_asof` produce for it, so a deep window no longer assembles
                # 174,187 OHLC rows into 4,529 rows on every cold request.
                #
                # ⛔ IT LIVES IN *THIS* DATABASE, NOT BESIDE THE COLLECTOR PROJECTION,
                # and the reason is the one requirement that cannot be negotiated: the
                # writers must update it IN THE SAME TRANSACTION as the OHLC rows it is
                # derived from, and a transaction cannot span two SQLite files. Putting
                # it in breadth_monitor.db would have made "same transaction" a phrase
                # in a document rather than a property of the code.
                #
                # ⛔ AND IT IS A SEPARATE TABLE FROM breadth_snapshot_numeric, not a
                # `source='reconstructed'` row in it. That table is keyed by date alone,
                # so a collector row and a reconstructed row for one date could not
                # coexist — whichever wrote last would silently win, and the precedence
                # rule (collector beats reconstructed) would be enforced by write order
                # instead of by code. Two tables let the merge ASSERT precedence.
                c.execute(
                    """CREATE TABLE IF NOT EXISTS breadth_reconstructed_daily (
                        date           TEXT PRIMARY KEY,
                        metrics        TEXT NOT NULL,   -- the pre-derivation row, as the reader builds it
                        ohlc_watermark TEXT,            -- MAX(updated_at) of the trusted OHLC rows it was built from
                        sentiment_watermark TEXT,       -- GLOBAL MAX(updated_at) of the sentiment store
                        built_at       TEXT DEFAULT (datetime('now'))
                    )"""
                )
                c.execute("CREATE INDEX IF NOT EXISTS idx_brd_watermark "
                          "ON breadth_reconstructed_daily(ohlc_watermark)")
                c.execute("CREATE INDEX IF NOT EXISTS idx_bdo_metric "
                          "ON breadth_daily_ohlc(universe, metric, date)")
                # ⭐ (c) + (d) of the reader ranking, in ONE index. Both hot deep-read
                # queries filter on `source`, which nothing indexed: `distinct_dates`
                # scanned the whole table for a DISTINCT, and `closes_for_dates` used
                # the (date, metric) primary key and then re-tested `source` per row —
                # 174,187 rows examined for one 8,000-day window.
                #
                # ⛔ IT CARRIES `metric` AND `c` SO IT COVERS, and that is the point
                # rather than tidiness: a non-covering index still walks the table's
                # b-tree for every row, which is precisely the part that is slow on a
                # volume-backed filesystem. Measured on the production copy the plans
                # become "SEARCH ... USING COVERING INDEX" for both queries.
                #
                # ⚠️ Locally this is only 1.2x (distinct_dates) and 1.4x
                # (closes_for_dates) — a 26 MB database on NVMe with a warm page cache
                # has little to gain. It is shipped for the case local hardware cannot
                # show, and D-045's rule stands: no local number is quoted as a
                # production improvement. Cost: 8.6 MB of index, 135 ms to build once.
                c.execute("CREATE INDEX IF NOT EXISTS idx_bdo_source_date "
                          "ON breadth_daily_ohlc(universe, source, date, metric, c)")
            if migrated:
                _vacuum_after_migration()
            _INIT_DONE = True
        except Exception:
            # Leave uninitialized; callers are all best-effort and no-op on failure.
            pass


def _migrate_universe_column(c) -> bool:
    """Widen `(date, metric)` to `(universe, date, metric)`, once, in place.

    ⭐⭐ IT COPIES COLUMNS AND INVENTS NOTHING. Every pre-existing row becomes
    `universe='uct'` and keeps its o/h/l/c/source/updated_at byte for byte — this
    is a KEY widening, not a reinterpretation. The published UCT history (174,263
    rows back to 2008-01-02) must read identically after this runs, and the only
    way to promise that is to never touch a value.

    ⛔ SQLite CANNOT ALTER A PRIMARY KEY, so `ADD COLUMN universe` alone would
    leave the old `PRIMARY KEY (date, metric)` in force — and that key makes two
    universes sharing a date and metric a CONFLICT. The second universe's rows
    would silently overwrite the first's through the existing
    `ON CONFLICT(...) DO UPDATE`, which is the worst available failure: no error,
    right shape, wrong numbers. Hence the table rebuild.

    Idempotent: the presence of the column IS the migration marker, so a restart
    mid-way either finds the old table (and redoes the whole copy in one
    transaction) or the new one (and does nothing). No separate version row to
    drift from reality.
    """
    cols = {r[1] for r in c.execute("PRAGMA table_info(breadth_daily_ohlc)").fetchall()}
    if "universe" in cols or not cols:
        return False
    c.execute("""CREATE TABLE breadth_daily_ohlc__v2 (
                    universe TEXT NOT NULL DEFAULT 'uct',
                    date    TEXT NOT NULL,
                    metric  TEXT NOT NULL,
                    o REAL, h REAL, l REAL, c REAL,
                    source  TEXT DEFAULT 'live',
                    updated_at TEXT DEFAULT (datetime('now')),
                    PRIMARY KEY (universe, date, metric)
                 )""")
    c.execute("""INSERT INTO breadth_daily_ohlc__v2
                    (universe, date, metric, o, h, l, c, source, updated_at)
                 SELECT 'uct', date, metric, o, h, l, c, source, updated_at
                 FROM breadth_daily_ohlc""")
    moved = c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc__v2").fetchone()[0]
    c.execute("DROP TABLE breadth_daily_ohlc")
    c.execute("ALTER TABLE breadth_daily_ohlc__v2 RENAME TO breadth_daily_ohlc")
    logging.getLogger("breadth_daily_ohlc").info(
        "[breadth_daily_ohlc] universe migration: %s rows -> universe='uct'", moved)
    return True


def _vacuum_after_migration() -> None:
    """Reclaim the dropped table's pages, ONCE, right after the rebuild.

    ⚠️ MEASURED, NOT PRECAUTIONARY: at production scale (173,937 rows) the rebuild
    took 0.80s and grew the file from 33.7 MB to 55.6 MB, because `DROP TABLE`
    frees pages into the freelist rather than returning them. That matters here
    more than it usually would — `breadth_ohlc_sync` ships this ENTIRE database
    over R2 on every upload, so the bloat would be paid on every transfer forever.

    ⛔ OUTSIDE THE MIGRATION'S TRANSACTION, on its own connection, because VACUUM
    cannot run inside one. And best-effort: a VACUUM that fails (a reader holding
    the file, no room for the temp copy) leaves a CORRECT database that is merely
    larger, so it must never turn a successful migration into a failed init.
    """
    try:
        conn = sqlite3.connect(_db_path(), timeout=30, isolation_level=None)
        try:
            conn.execute("PRAGMA busy_timeout=30000")
            conn.execute("VACUUM")
        finally:
            conn.close()
    except Exception as e:
        logging.getLogger("breadth_daily_ohlc").warning(
            "[breadth_daily_ohlc] post-migration VACUUM skipped: %s", e)


def _finite(v) -> Optional[float]:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def update_intraday(session_date: str, metrics: dict,
                    universe: str = DEFAULT_UNIVERSE) -> int:
    """Roll today's OHLC from one live sample. For each finite metric value: first sample
    of the day seeds o=h=l=c; later samples extend h/l and set c (o is frozen). LIVE rows
    never overwrite a 'reconstruct' row's open — but reconstruct only writes PAST days, so
    they never collide with today. Returns the number of metrics updated."""
    if not session_date or not isinstance(metrics, dict):
        return 0
    u = _uni(universe)
    _ensure_init()
    rows = [(k, _finite(v)) for k, v in metrics.items()]
    rows = [(k, v) for (k, v) in rows if v is not None]
    if not rows:
        return 0
    n = 0
    with _WRITE_LOCK:
        try:
            with _conn() as c:
                for (metric, v) in rows:
                    cur = c.execute(
                        "SELECT o, h, l FROM breadth_daily_ohlc "
                        "WHERE universe=? AND date=? AND metric=?",
                        (u, session_date, metric),
                    ).fetchone()
                    if cur is None:
                        c.execute(
                            "INSERT INTO breadth_daily_ohlc"
                            "(universe, date, metric, o, h, l, c, source, updated_at) "
                            "VALUES(?,?,?,?,?,?,?, 'live', datetime('now'))",
                            (u, session_date, metric, v, v, v, v),
                        )
                    else:
                        o, h, l = cur
                        nh = v if (h is None or v > h) else h
                        nl = v if (l is None or v < l) else l
                        c.execute(
                            "UPDATE breadth_daily_ohlc SET h=?, l=?, c=?, updated_at=datetime('now') "
                            "WHERE universe=? AND date=? AND metric=?",
                            (nh, nl, v, u, session_date, metric),
                        )
                    n += 1
                if n and u == DEFAULT_UNIVERSE:
                    _rebuild_after_write(c, [session_date])
        except Exception:
            return 0
    return n


def set_ohlc(date: str, metric: str, o: float, h: float, l: float, c: float,
             source: str = "reconstruct", overwrite_live: bool = False,
             universe: str = DEFAULT_UNIVERSE) -> bool:
    """Write one metric's OHLC for one PAST day (reconstruction). By default will NOT
    clobber a row already written by the live accumulator (`overwrite_live=False`), so a
    re-run can't stomp real intraday data with an estimate."""
    o, h, l, c = (_finite(o), _finite(h), _finite(l), _finite(c))
    if None in (o, h, l, c) or not date or not metric:
        return False
    u = _uni(universe)
    _ensure_init()
    with _WRITE_LOCK:
        try:
            with _conn() as conn:
                if not overwrite_live:
                    ex = conn.execute(
                        "SELECT source FROM breadth_daily_ohlc "
                        "WHERE universe=? AND date=? AND metric=?",
                        (u, date, metric),
                    ).fetchone()
                    if ex is not None and ex[0] == "live":
                        return False
                conn.execute(
                    "INSERT INTO breadth_daily_ohlc"
                    "(universe, date, metric, o, h, l, c, source, updated_at) "
                    "VALUES(?,?,?,?,?,?,?,?, datetime('now')) "
                    "ON CONFLICT(universe, date, metric) DO UPDATE SET o=excluded.o, h=excluded.h, "
                    "l=excluded.l, c=excluded.c, source=excluded.source, updated_at=datetime('now')",
                    (u, date, metric, o, h, l, c, source),
                )
                # ⚠️ Only a TRUSTED source can move the derivation. `set_ohlc`
                # defaults to source='reconstruct', which `_TRUSTED_SOURCES` excludes
                # — rebuilding on it would be work for a write the reader cannot see.
                if source in _TRUSTED_SOURCES and u == DEFAULT_UNIVERSE:
                    _rebuild_after_write(conn, [date])
            return True
        except Exception:
            return False


# Sources the chart trusts: 'live' = real intraday-sampled wicks; 'close_recon' = accurate
# deep close-basis history recomputed from daily bars (bodies, validated to textbook extremes
# e.g. COVID low 2% / rally 77% above 50MA). NOT 'reconstruct' (the old synchronized-extreme
# daily-bar WICK guess, which was wrong).
_TRUSTED_SOURCES = ("live", "intraday_recon", "close_recon")


def write_bulk(rows: list, source: str = "close_recon", overwrite_live: bool = False,
               universe: str = DEFAULT_UNIVERSE) -> int:
    """Bulk-write reconstructed rows in ONE transaction (a sweep does 100k+). `rows` =
    [(date, metric, o, h, l, c)]. By default never overwrites a real 'live' wick row.
    Returns the number written."""
    u = _uni(universe)
    _ensure_init()
    clean = []
    for r in rows:
        try:
            d, m, o, h, l, c = r
        except (TypeError, ValueError):
            continue
        o, h, l, c = _finite(o), _finite(h), _finite(l), _finite(c)
        if None in (o, h, l, c) or not d or not m:
            continue
        clean.append((u, d, m, o, h, l, c, source))
    if not clean:
        return 0
    n = 0
    with _WRITE_LOCK:
        try:
            with _conn() as conn:
                if not overwrite_live:
                    # skip any (date,metric) already carrying a real 'live' row
                    live_keys = {(row[0], row[1]) for row in conn.execute(
                        "SELECT date, metric FROM breadth_daily_ohlc "
                        "WHERE universe=? AND source='live'", (u,)
                    ).fetchall()}
                    clean = [r for r in clean if (r[1], r[2]) not in live_keys]
                conn.executemany(
                    "INSERT INTO breadth_daily_ohlc"
                    "(universe, date, metric, o, h, l, c, source, updated_at) "
                    "VALUES(?,?,?,?,?,?,?,?, datetime('now')) "
                    "ON CONFLICT(universe, date, metric) DO UPDATE SET o=excluded.o, h=excluded.h, "
                    "l=excluded.l, c=excluded.c, source=excluded.source, updated_at=datetime('now')",
                    clean,
                )
                n = len(clean)
                if n and source in _TRUSTED_SOURCES and u == DEFAULT_UNIVERSE:
                    _rebuild_after_write(conn, {r[1] for r in clean})
        except Exception:
            return 0
    return n



# ── The materialised reconstructed side (Session 3) ───────────────────────────

def sentiment_watermark() -> str:
    """GLOBAL MAX(updated_at) across the sentiment store, or "" if unreadable.

    ⛔ GLOBAL, NOT PER-DATE, and that is a correctness requirement rather than a
    shortcut. `values_asof` FORWARD-FILLS: one weekly survey reading dated the 15th
    is the value every session after it carries until the next reading. So a single
    sentiment write can change the correct content of an unbounded range of
    reconstructed rows, and a per-date watermark would mark exactly one of them
    stale and quietly leave the rest wrong.

    ⚰️ This was found by an existing rail, not by review. `test_sentiment_is_
    overlaid_onto_reconstructed_rows` seeds OHLC first and sentiment second — the
    materialised row was built before the survey existed and served without it.
    The first version of this table watermarked only the OHLC side, which is the
    input the design started from; sentiment is the second input and was missed.
    """
    try:
        from api.services import breadth_sentiment_history as sent
        with sent._conn() as c:
            row = c.execute("SELECT MAX(updated_at) FROM breadth_sentiment").fetchone()
        return (row[0] if row and row[0] else "") or ""
    except Exception:
        return ""


def _sentiment_for(dates):
    """Sentiment overlay for these dates, or {} if the store is unavailable.

    Lazy import, matching the reader's own idiom, and it cannot cycle:
    `breadth_sentiment_history` imports nothing from this module."""
    try:
        from api.services import breadth_sentiment_history as sent
        return sent.values_asof(list(dates)) or {}
    except Exception:
        return {}


def watermarks_for(c, dates) -> dict:
    """{date: MAX(updated_at) over that date's TRUSTED rows}.

    ⭐ THIS IS WHAT MAKES STALENESS DETECTABLE RATHER THAN HOPED-FOR. A derived
    table whose only guarantee is "every writer remembered to call the rebuild" is
    a table that is correct until somebody adds a seventh writer. The watermark
    lets `stale_reconstructed_dates()` find a row whose inputs moved underneath it
    no matter how it happened — including a write that bypassed this module
    entirely, which is a real path (`breadth_ohlc_sync` INSERTs directly).
    """
    out = {}
    ds = list(dates)
    qs = ",".join("?" * len(_TRUSTED_SOURCES))
    for i in range(0, len(ds), 400):
        chunk = ds[i:i + 400]
        dq = ",".join("?" * len(chunk))
        for (d, w) in c.execute(
            f"SELECT date, MAX(updated_at) FROM breadth_daily_ohlc "
            f"WHERE universe=? AND date IN ({dq}) AND source IN ({qs}) GROUP BY date",
            (DEFAULT_UNIVERSE, *chunk, *_TRUSTED_SOURCES),
        ).fetchall():
            out[d] = w
    return out


def derive_reconstructed(c, dates) -> dict:
    """{date: pre-derivation row} built FROM the OHLC store — the builder, and the
    audit's reference. ⛔ Never the request path (`test_the_request_path_never_derives`).

    It reproduces exactly what `_history_deep_uncached` used to assemble inline:
    the trusted closes for the date, the sentiment overlay on top, and the
    `_reconstructed` flag. Rolling metrics are deliberately NOT included — they are
    a property of the WINDOW, not of the date, so `_derive_ascending` still runs
    per request over the merged rows.
    """
    ds = [d for d in dates]
    if not ds:
        return {}
    closes = {}
    qs = ",".join("?" * len(_TRUSTED_SOURCES))
    for i in range(0, len(ds), 400):
        chunk = ds[i:i + 400]
        dq = ",".join("?" * len(chunk))
        for (d, m, cl) in c.execute(
            f"SELECT date, metric, c FROM breadth_daily_ohlc "
            f"WHERE universe=? AND date IN ({dq}) AND source IN ({qs})",
            (DEFAULT_UNIVERSE, *chunk, *_TRUSTED_SOURCES),
        ).fetchall():
            closes.setdefault(d, {})[m] = cl
    sent = _sentiment_for(ds)
    out = {}
    for d in ds:
        if d not in closes:
            continue
        row = dict(closes[d])
        if sent.get(d):
            row.update(sent[d])
        row["_reconstructed"] = True
        out[d] = row
    return out


def build_reconstructed(dates, c=None) -> int:
    """Materialise these dates. Pass `c` to run INSIDE the caller's transaction."""
    ds = [d for d in dates if d]
    if not ds:
        return 0

    def _work(conn):
        rows = derive_reconstructed(conn, ds)
        if not rows:
            return 0
        marks = watermarks_for(conn, list(rows))
        sw = sentiment_watermark()
        conn.executemany(
            "INSERT INTO breadth_reconstructed_daily "
            "(date, metrics, ohlc_watermark, sentiment_watermark, built_at) "
            "VALUES (?, ?, ?, ?, datetime('now')) "
            "ON CONFLICT(date) DO UPDATE SET metrics=excluded.metrics, "
            "ohlc_watermark=excluded.ohlc_watermark, "
            "sentiment_watermark=excluded.sentiment_watermark, built_at=datetime('now')",
            [(d, json.dumps(r), marks.get(d), sw) for d, r in rows.items()],
        )
        return len(rows)

    if c is not None:
        return _work(c)
    _ensure_init()
    with _WRITE_LOCK:
        try:
            with _conn() as conn:
                n = _work(conn)
                conn.commit()
                return n
        except Exception:
            return 0


def reconstructed_for_dates(dates) -> tuple:
    """`({date: row}, misses)` read from the materialised table. No derivation."""
    ds = [d for d in dates if d]
    if not ds:
        return {}, 0
    _ensure_init()
    out = {}
    # ⭐ SPLIT BECAUSE "VOLUME I/O" IS A HYPOTHESIS, NOT A MEASUREMENT. Session 7
    # showed this phase moving 50.2x while `derive` (pure CPU) moved 1.0x. That
    # rules CPU out and leaves at least four sub-causes with different fixes —
    # page-cache eviction, lock wait behind a writer, connection/plan variance, and
    # row-materialisation cost. One number cannot separate them; these five can.
    import sqlite3 as _sq
    import time as _t
    from api.services import breadth_timing as _bt
    rows = 0
    nbytes = 0
    busy_retries = 0
    stmts = 0
    st_min = None
    st_max = None
    st_sum = 0.0
    try:
        t0 = _t.perf_counter()
        c = _sq.connect(_db_path(), timeout=5.0)
        _bt.add_phase("rf_open", (_t.perf_counter() - t0) * 1000.0)
        t0 = _t.perf_counter()
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA busy_timeout=3000")
        _apply_pagecache(c)
        _bt.add_phase("rf_pragma", (_t.perf_counter() - t0) * 1000.0)
        # ⛔ The connection is opened HERE and closed in the `finally` below — there is
        # no pooling and no thread-local anywhere in this module. `rf_conn_reused` is
        # therefore always 0 today; it exists so that if connection reuse ever lands,
        # the measurement can tell the two regimes apart instead of being re-derived.
        _bt.note(rf_conn_id=id(c) & 0xFFFFFF, rf_conn_reused=0,
                 rf_pagecache=1 if _pagecache_on() else 0)
        try:
            for i in range(0, len(ds), 400):
                chunk = ds[i:i + 400]
                dq = ",".join("?" * len(chunk))
                q = f"SELECT date, metrics FROM breadth_reconstructed_daily WHERE date IN ({dq})"
                t0 = _t.perf_counter()
                try:
                    cur = c.execute(q, chunk)
                except _sq.OperationalError as e:
                    # ⚠️ BLIND SPOT, STATED RATHER THAN PAPERED OVER: with
                    # busy_timeout=3000 SQLite waits INSIDE the C call, so ordinary
                    # lock contention never reaches here — it is charged to
                    # rf_execute and is indistinguishable from execution time from
                    # Python. This counter only fires once a wait has EXCEEDED the
                    # timeout, i.e. it detects severe contention, not any contention.
                    if "locked" in str(e).lower() or "busy" in str(e).lower():
                        busy_retries += 1
                    raise
                _st = (_t.perf_counter() - t0) * 1000.0
                _bt.add_phase("rf_execute", _st)
                t0 = _t.perf_counter()
                got = cur.fetchall()
                _fe = (_t.perf_counter() - t0) * 1000.0
                _bt.add_phase("rf_fetch", _fe)
                # ⛔ min/max/sum, NOT twelve fields. The [breadth-timing] buffer is ~500
                # lines / ~10 minutes and a line per chunk would push the useful line out
                # of it. Three numbers answer the question a per-chunk dump would: is one
                # statement pathological, or are all twelve uniformly slow?
                stmts += 1
                _one = _st + _fe
                st_min = _one if st_min is None else min(st_min, _one)
                st_max = _one if st_max is None else max(st_max, _one)
                st_sum += _one
                t0 = _t.perf_counter()
                for (d, mj) in got:
                    nbytes += len(mj)
                    out[d] = json.loads(mj)
                rows += len(got)
                _bt.add_phase("rf_materialise", (_t.perf_counter() - t0) * 1000.0)
        finally:
            c.close()
    except Exception:
        _bt.note(rf_rows=rows, rf_bytes=nbytes, rf_busy_retries=busy_retries,
                 rf_stmts=stmts, rf_stmt_min=round(st_min or 0.0, 3),
                 rf_stmt_max=round(st_max or 0.0, 3), rf_stmt_sum=round(st_sum, 1))
        return {}, len(ds)
    _bt.note(rf_rows=rows, rf_bytes=nbytes, rf_busy_retries=busy_retries,
                 rf_stmts=stmts, rf_stmt_min=round(st_min or 0.0, 3),
                 rf_stmt_max=round(st_max or 0.0, 3), rf_stmt_sum=round(st_sum, 1))
    return out, 0


def stale_reconstructed_dates(limit: int = 0, c=None) -> list:
    """Dates whose stored watermark disagrees with the OHLC store's current one,
    plus trusted dates with no materialised row at all. Sorted.

    `c` runs the query on the caller's connection, which is what lets the ONE
    writer that bypasses this module — `breadth_ohlc_sync._merge_from`, a direct
    INSERT over an ATTACHed snapshot — keep its rebuild inside its own transaction
    instead of racing it afterwards.
    """
    def _q(c):
        return c.execute(
            f"""SELECT o.date, MAX(o.updated_at) AS w, r.ohlc_watermark
                FROM breadth_daily_ohlc o
                LEFT JOIN breadth_reconstructed_daily r ON r.date = o.date
                WHERE o.universe = '{DEFAULT_UNIVERSE}' AND o.source IN ({qs})
                GROUP BY o.date
                HAVING r.ohlc_watermark IS NULL
                    OR r.ohlc_watermark <> MAX(o.updated_at)
                    OR COALESCE(r.sentiment_watermark, '') <> ?
                ORDER BY o.date""",
            (*_TRUSTED_SOURCES, sw),
        ).fetchall()

    qs = ",".join("?" * len(_TRUSTED_SOURCES))
    sw = sentiment_watermark()
    try:
        if c is not None:
            rows = _q(c)
        else:
            _ensure_init()
            with _conn() as own:
                rows = _q(own)
    except Exception:
        return []
    out = [r[0] for r in rows]
    return out[:limit] if limit else out


def rebuild_stale(limit: int = 0) -> dict:
    """Bring the materialised table back in step. Idempotent; safe to call often."""
    stale = stale_reconstructed_dates(limit=limit)
    if not stale:
        return {"stale": 0, "built": 0}
    return {"stale": len(stale), "built": build_reconstructed(stale)}


def _rebuild_after_write(conn, dates) -> None:
    """Writer hook: keep the derived table in step INSIDE the writer's transaction.

    ⛔ Swallows its own exceptions. The OHLC write is the product; the derived
    table is an optimisation with a watermark that makes any miss detectable and
    `rebuild_stale()` to repair it. Failing a real breadth write to protect a cache
    would be the wrong way round.
    """
    try:
        ds = sorted({d for d in dates if d})
        if ds:
            build_reconstructed(ds, c=conn)
    except Exception:
        pass


def history(metric: str, limit: int = 6000,
            universe: str = DEFAULT_UNIVERSE) -> dict:
    """{ 'YYYY-MM-DD': {o,h,l,c} } for a metric, newest `limit` days — TRUSTED sources
    only. A breadth metric's true intraday high/low can only come from sampling the actual
    value through the day (the live accumulator); daily-bar 'reconstruct' rows assume every
    stock hits its extreme at once and are wildly too wide, so they are NOT served. Empty on
    any error (callers fall back to close-to-close bodies)."""
    if not metric:
        return {}
    _ensure_init()
    out: dict = {}
    qmarks = ",".join("?" * len(_TRUSTED_SOURCES))
    try:
        with _conn() as c:
            for (d, o, h, l, cl) in c.execute(
                f"SELECT date, o, h, l, c FROM breadth_daily_ohlc "
                f"WHERE universe=? AND metric=? AND source IN ({qmarks}) "
                f"ORDER BY date DESC LIMIT ?",
                (_uni(universe), metric, *_TRUSTED_SOURCES, int(limit)),
            ).fetchall():
                out[d] = {"o": o, "h": h, "l": l, "c": cl}
    except Exception:
        return {}
    return out


def distinct_dates_by_scan(universe: str = DEFAULT_UNIVERSE) -> list:
    """The original definition: DISTINCT over the OHLC table. Kept as the FALLBACK
    and as the parity reference — `test_the_materialised_date_set_equals_the_scan`
    compares the two on the real production copy."""
    _ensure_init()
    qmarks = ",".join("?" * len(_TRUSTED_SOURCES))
    try:
        with _conn() as c:
            return [r[0] for r in c.execute(
                f"SELECT DISTINCT date FROM breadth_daily_ohlc "
                f"WHERE universe=? AND source IN ({qmarks}) ORDER BY date ASC",
                (_uni(universe), *_TRUSTED_SOURCES),
            ).fetchall()]
    except Exception:
        return []


def distinct_dates() -> list:
    """Sorted-ASC list of every session date carrying at least one TRUSTED-source
    metric row. Feeds the Monitor's deep-history merge.

    ⭐ IT READS THE MATERIALISED TABLE, AND THAT IS THE BIGGEST REMAINING WIN ON THE
    DEEP PATH. Measured on the production copy, Session 4: this call read
    **11,329,088 bytes** — MORE than the materialised reconstructed table it exists
    to index into (6,090,852) — because `SELECT DISTINCT date` still walked all
    174,263 OHLC rows. Even the covering index has to scan every entry to produce a
    DISTINCT. `breadth_reconstructed_daily` has exactly one row per such date, so
    its PRIMARY KEY answers the same question over 4,701 rows.

    ⛔ THE EQUIVALENCE IS PROVEN, NOT ASSUMED. Both sets are "dates with at least one
    trusted row" — the builder writes a row precisely when `derive_reconstructed`
    found closes, which is the same predicate — but same-predicate-by-reading is an
    argument, and `test_the_materialised_date_set_equals_the_scan` is a measurement
    against the real copy.

    ⚠️ It falls back to the scan when the table is EMPTY (a store the migration has
    not reached), never when it is merely short. A short table means a trusted write
    bypassed the writer hooks AND the boot rebuild has not run, which the watermark
    reports through `stale_reconstructed_dates()` and the audit names by date — that
    is the mechanism for a gap, not a silent per-request re-scan.
    """
    _ensure_init()
    try:
        with _conn() as c:
            rows = [r[0] for r in c.execute(
                "SELECT date FROM breadth_reconstructed_daily ORDER BY date ASC").fetchall()]
        if rows:
            return rows
    except Exception:
        pass
    return distinct_dates_by_scan()


def closes_for_dates(dates, universe: str = DEFAULT_UNIVERSE) -> dict:
    """{ 'YYYY-MM-DD': {metric: close} } for the given dates — TRUSTED sources
    only, the CLOSE value of each metric's daily body (the reconstructed EOD
    reading). This is how a past Monitor row is reassembled: every metric the
    deep sweep stored for that date, as one row. Empty on any error."""
    if not dates:
        return {}
    _ensure_init()
    out: dict = {}
    ds = list(dates)
    qs = ",".join("?" * len(_TRUSTED_SOURCES))
    try:
        with _conn() as c:
            # Chunk the date IN-list well under SQLite's 999-variable limit.
            for i in range(0, len(ds), 400):
                chunk = ds[i:i + 400]
                dq = ",".join("?" * len(chunk))
                for (d, m, cl) in c.execute(
                    f"SELECT date, metric, c FROM breadth_daily_ohlc "
                    f"WHERE universe=? AND date IN ({dq}) AND source IN ({qs})",
                    (_uni(universe), *chunk, *_TRUSTED_SOURCES),
                ).fetchall():
                    out.setdefault(d, {})[m] = cl
    except Exception:
        return {}
    return out


def metric_before(metric: str, before: str,
                  universe: str = DEFAULT_UNIVERSE) -> dict:
    """{ 'YYYY-MM-DD': close } for one metric, every TRUSTED date strictly before
    `before`. Used to seed the cumulative A/D line for a deep window from the
    reconstructed history that precedes it."""
    if not metric or not before:
        return {}
    _ensure_init()
    qmarks = ",".join("?" * len(_TRUSTED_SOURCES))
    try:
        with _conn() as c:
            return {d: cl for (d, cl) in c.execute(
                f"SELECT date, c FROM breadth_daily_ohlc "
                f"WHERE universe=? AND metric=? AND date < ? AND source IN ({qmarks})",
                (_uni(universe), metric, before, *_TRUSTED_SOURCES),
            ).fetchall()}
    except Exception:
        return {}


def backfill_from_intraday(days: int = 8) -> dict:
    """Aggregate REAL intraday breadth samples into daily OHLC — the ACCURATE historical
    wick source. `breadth_intraday` stores the full-universe live snapshot (all metrics)
    every ~55s with ~7-day retention; per session_date we take open=first sample, high=max,
    low=min, close=last, over the actual sampled values. Written source='live' (real data).
    Cheap: a few thousand JSON rows, no recompute. Returns a summary."""
    import json as _json
    from collections import defaultdict
    _ensure_init()
    try:
        from api.services import breadth_intraday as bi
        with bi._conn() as ic:
            rows = ic.execute(
                "SELECT session_date, as_of, metrics FROM breadth_intraday ORDER BY session_date, as_of"
            ).fetchall()
    except Exception as e:
        return {"ok": False, "reason": f"intraday unreadable: {e}"}

    per_day = defaultdict(list)   # date -> [(as_of, metrics_dict)]
    for (d, as_of, mjson) in rows:
        try:
            per_day[d].append((int(as_of), _json.loads(mjson)))
        except Exception:
            continue
    target = sorted(per_day.keys())
    if days:
        target = target[-days:]

    written_days, written_rows, done = 0, 0, []
    for d in target:
        agg = {}   # metric -> [o, h, l, c]
        for (_as_of, m) in sorted(per_day[d], key=lambda x: x[0]):
            for k, v in m.items():
                fv = _finite(v)
                if fv is None:
                    continue
                a = agg.get(k)
                if a is None:
                    agg[k] = [fv, fv, fv, fv]
                else:
                    if fv > a[1]:
                        a[1] = fv
                    if fv < a[2]:
                        a[2] = fv
                    a[3] = fv
        n = 0
        for metric, (o, h, l, c) in agg.items():
            if set_ohlc(d, metric, o, h, l, c, source="live", overwrite_live=True):
                n += 1
        if n:
            written_days += 1
            written_rows += n
            done.append(d)
    return {"ok": True, "days": written_days, "rows": written_rows, "dates": done[-10:]}


def purge_reconstructed() -> int:
    """Delete all daily-bar 'reconstruct' rows (they were inaccurate). Returns the count."""
    _ensure_init()
    with _WRITE_LOCK:
        try:
            with _conn() as c:
                cur = c.execute("DELETE FROM breadth_daily_ohlc "
                                "WHERE universe=? AND source='reconstruct'",
                                (DEFAULT_UNIVERSE,))
                return cur.rowcount or 0
        except Exception:
            return 0


def stats(universe: str = DEFAULT_UNIVERSE) -> dict:
    """Coverage summary for the admin/status surface.

    ⚠️ SCOPED TO ONE UNIVERSE, defaulting to UCT — so `/api/breadth-monitor/ohlc/status`
    keeps answering exactly what it answered before universes existed. A total across
    universes would silently change `first` the day a PIT sweep lands a 2008 US row,
    and `backfill_tick` reads `first` to decide where to sweep next.
    `by_universe` carries the wider picture beside it rather than inside those keys.
    """
    _ensure_init()
    u = _uni(universe)
    try:
        with _conn() as c:
            total = c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc WHERE universe=?",
                              (u,)).fetchone()[0]
            days = c.execute("SELECT COUNT(DISTINCT date) FROM breadth_daily_ohlc "
                             "WHERE universe=?", (u,)).fetchone()[0]
            live = c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc "
                             "WHERE universe=? AND source='live'", (u,)).fetchone()[0]
            rng = c.execute("SELECT MIN(date), MAX(date) FROM breadth_daily_ohlc "
                            "WHERE universe=?", (u,)).fetchone()
            by_uni = {row[0]: {"rows": row[1], "first": row[2], "last": row[3]}
                      for row in c.execute(
                          "SELECT universe, COUNT(*), MIN(date), MAX(date) "
                          "FROM breadth_daily_ohlc GROUP BY universe").fetchall()}
        return {"rows": total, "days": days, "live_rows": live,
                "recon_rows": total - live, "first": rng[0], "last": rng[1],
                "universe": u, "by_universe": by_uni}
    except Exception:
        return {"rows": 0, "days": 0}

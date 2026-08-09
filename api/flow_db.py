"""
flow_db.py — SQLite persistence layer for UCT Intelligence options flow data.

Handles:
- Inserting CSV uploads (stocks + indexes) with automatic deduplication
- Querying by date range, serving as CSV to the frontend
- Streaming CSV responses (avoids building 27MB+ strings in memory)
- Retention: dropping WHOLE trading days past the window (never partial days —
  see prune_old_trade_days for what the old expiry-based prune was doing)
- Stats for admin visibility

Usage:
    from flow_db import FlowDB
    db = FlowDB("/data/flow.db")
    inserted, skipped = db.insert_csv(csv_content, source="stocks")
    csv_string = db.query_csv(source="stocks", days=20)
    for chunk in db.stream_csv(source="stocks", days=20):
        send(chunk)
    pruned = db.prune_expired()
"""

import sqlite3
import csv
import io
import os
from datetime import datetime, timedelta
from contextlib import contextmanager

# How many CALENDAR days of TRADE DATE to retain. Days are dropped whole, so the
# tape never contains a partial session presented as a complete one.
#
# Default 90 covers the widest UI range chip.
#
# Sizing (production, 2026-07-26). Careful with the obvious arithmetic here:
# db_size_mb/rows = 2725.8MB / 2,107,351 = ~1,293 B/row is an ARTIFACT, not a
# measurement. flow.db is never VACUUMed (nothing in the repo vacuums it — the
# one VACUUM, admin_purge.py, targets patterns.db), and auto_vacuum is unset, so
# that figure is a high-water mark carrying every page freed by the millions of
# rows the old expiry prune deleted. The dense cost is ~526 B/row (27 TEXT
# columns + the duplicated dedup_key); the exported CSV is 135 B/row.
#
# At ~526 B/row and ~140k rows/day (stocks+indexes), 90 days is ~6.6GB and
# retaining ALL 138 available days would be ~10GB — against a flow-worker volume
# of 50GB with ~35GB free. Retention here is a product choice about how far back
# the calendar goes, NOT a disk constraint. Nothing was ever gained by the
# destruction this replaces.
#
# <= 0 disables pruning entirely. For a delete path the fail-safe reading of a
# misconfigured value is "keep", never "delete everything".
FLOW_RETAIN_TRADE_DAYS = int(os.environ.get("FLOW_RETAIN_TRADE_DAYS", "90"))

# Retention is UNARMED until this is set. Shipping the scoping fix stops the
# hollowing immediately; actually DELETING history is a separate decision, and
# there is no restore path (R2 backups run at 02:30 ET, after the 20:00 ET
# prune, so every snapshot is already post-prune, and flow_backup.py has no
# restore function at all). Unarmed, the nightly job reports precisely what it
# would remove.
FLOW_PRUNE_ENABLED = os.environ.get("FLOW_PRUNE_ENABLED", "0").lower() in ("1", "true", "yes")

# Blast radius: the most WHOLE DAYS one run may delete, oldest first. Bounds a
# misconfigured retain_days to a slow bleed that is visible in the logs for many
# nights, rather than a single catastrophic tick.
FLOW_PRUNE_MAX_DAYS_PER_RUN = int(os.environ.get("FLOW_PRUNE_MAX_DAYS_PER_RUN", "5"))

# CSV columns in BBS export order
COLUMNS = [
    "CreatedDate", "CreatedTime", "Symbol", "Type", "Volume", "Price",
    "Side", "CallPut", "Strike", "Spot", "Premium", "ExpirationDate",
    "Color", "ImpliedVolatility", "Dte", "ER", "StockEtf", "Sector",
    "Uoa", "Weekly", "MktCap", "OI"
]

# Pre-computed header line and column select clause
_HEADER_LINE = ",".join(COLUMNS) + "\n"
_SELECT_COLS = ", ".join(COLUMNS)

# The projection allow-list. `cols=` is user input that lands in a SELECT list,
# so it is resolved against this set BY MEMBERSHIP and never interpolated raw.
_COLUMN_SET = frozenset(COLUMNS)


def parse_columns(raw):
    """Resolve a `cols=` request into a validated projection, or None for ALL.

    Blank/absent means every column — the shape every existing caller gets and
    the reason this parameter is additive rather than a change.

    ⛔ AN UNKNOWN NAME IS REFUSED, NEVER DROPPED. Silently skipping it would
    narrow the header, and the readers on this surface resolve their fields BY
    NAME from that header (`signature.flow_breakout.flow_by_date` looks up
    CreatedDate/CallPut/Premium and RAISES when one is missing). A dropped
    column therefore turns into either a raised parse — recoverable, because the
    caller scores it as a FAILED read — or, on a reader that tolerated the gap,
    a join that matches nothing and reports a quiet tape. The whole point of
    this module's date/symbol scoping is that an empty result and a wrong
    question must never look alike, so the wrong question gets an error.

    Duplicates are collapsed (a repeated name would emit a repeated column);
    ORDER IS THE CALLER'S, because the header it receives has to describe the
    rows it receives.
    """
    if raw is None:
        return None
    names = [n.strip() for n in str(raw).split(",")]
    names = [n for n in names if n]
    if not names:
        return None
    unknown = [n for n in names if n not in _COLUMN_SET]
    if unknown:
        raise ValueError(
            f"unknown flow column(s) requested: {unknown} — the flow table "
            f"exports {COLUMNS}")
    seen, out = set(), []
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out

# Dedup key — uniquely identifies a single trade
DEDUP_COLS = [
    "CreatedDate", "CreatedTime", "Symbol", "Type", "Volume",
    "Price", "CallPut", "Strike", "ExpirationDate", "Premium"
]

# How many rows to batch into a single chunk when streaming CSV.
# Larger = fewer Python→ASGI round-trips, smaller = lower memory.
_STREAM_BATCH = 2000


# 🔴 THIS DEFAULT USED TO BE THE BARE LITERAL, AND THE SUITE FOUND IT THE HARD WAY.
# `massive_ws_worker`'s `q_pool_log_flusher` / `worker_metrics_flusher` construct
# `FlowDB()` with no argument from a background thread (`massive-ws-consumer`),
# so `tests/test_massive_ws_stop.py` `os.makedirs`'d and opened the REAL
# `C:\data\flow.db` — 14-17 attempts a run, on a thread the test was no longer
# watching, with every test in the chunk passing.
#
# ⚠️ `FLOW_DB_PATH` was already "pinned" by twenty other flow modules and it did
# not help: a pin moves an ENV READ, and this site had none. That is the
# distinction `tests/test_shared_data_root_guard.py::
# test_no_shared_root_literal_sits_in_a_function_that_reads_no_env_var` now
# holds — a literal being pinned SOMEWHERE is not the same as every SITE that
# spells it being reachable.
#
# The default is unchanged with the variable unset, so production resolves
# exactly as before, and set (as the flow-worker sets it) this now agrees with
# `flow_router`, `flow_summary`, `oi_snapshots` and the rest instead of
# hard-coding past them.
_DEFAULT_DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")


class FlowDB:
    def __init__(self, db_path: str = _DEFAULT_DB_PATH):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._init_db()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_db(self):
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS flow (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source TEXT NOT NULL DEFAULT 'stocks',
                    CreatedDate TEXT,
                    CreatedTime TEXT,
                    Symbol TEXT,
                    Type TEXT,
                    Volume TEXT,
                    Price TEXT,
                    Side TEXT,
                    CallPut TEXT,
                    Strike TEXT,
                    Spot TEXT,
                    Premium TEXT,
                    ExpirationDate TEXT,
                    Color TEXT,
                    ImpliedVolatility TEXT,
                    Dte TEXT,
                    ER TEXT,
                    StockEtf TEXT,
                    Sector TEXT,
                    Uoa TEXT,
                    Weekly TEXT,
                    MktCap TEXT,
                    OI TEXT,
                    dedup_key TEXT UNIQUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # ts_ns migration (2026-07-25): persist the trade's nanosecond
            # timestamp so the nightly side-heal can query the exact-ns NBBO
            # (flow.db previously kept only second-precision CreatedTime).
            # Guarded ALTER covers the existing DB; harmless on a fresh one.
            try:
                conn.execute("ALTER TABLE flow ADD COLUMN ts_ns INTEGER")
            except sqlite3.OperationalError:
                pass  # column already exists
            # Index for fast queries
            conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_source ON flow(source)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_date ON flow(CreatedDate)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_symbol ON flow(Symbol)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_exp ON flow(ExpirationDate)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_source_date ON flow(source, CreatedDate)")
            # Covering index for the live-tape hot path (T1-1): /recent's
            # `WHERE source=? AND CreatedDate=? ... ORDER BY id DESC LIMIT ?`
            # otherwise degrades to a reverse rowid scan over the whole table
            # (measured 43s on 774MB, 2026-07-01). With (source, CreatedDate,
            # id) SQLite walks the index backwards touching only today's rows.
            # One-time build on a large existing DB takes ~30-60s at boot.
            conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_source_date_id ON flow(source, CreatedDate, id)")
            # Color-aware index (2026-07-09): /recent + /day-stats scan for the
            # latest N *classified* (MAGENTA/YELLOW + premium-WHITE) rows. With
            # only (source,CreatedDate,id) SQLite walks backward through every
            # unclassified WHITE row to find them — by midday (~400K rows/day)
            # that's a 8-30s scan/timeout. Adding Color lets the planner jump
            # straight to MAGENTA/YELLOW ranges. One-time build at boot.
            conn.execute("CREATE INDEX IF NOT EXISTS idx_flow_classified ON flow(source, CreatedDate, Color, id)")

    @staticmethod
    def _make_dedup_key(row: dict, source: str) -> str:
        """Build a unique key for deduplication."""
        parts = [source]
        for col in DEDUP_COLS:
            val = (row.get(col) or "").strip()
            parts.append(val)
        return "|".join(parts)

    @staticmethod
    def _parse_date_mdy(date_str: str):
        """Parse M/D/YYYY to a sortable date object."""
        try:
            parts = date_str.strip().split("/")
            if len(parts) == 3:
                m, d, y = int(parts[0]), int(parts[1]), int(parts[2])
                return datetime(y, m, d)
        except (ValueError, IndexError):
            pass
        return None

    def _resolve_dates(self, conn, source: str, days: int | None = None) -> list[str]:
        """Get the date strings for the last N trading days, or all if days is None."""
        cursor = conn.execute(
            "SELECT DISTINCT CreatedDate FROM flow WHERE source = ?",
            (source,),
        )
        all_dates_raw = [r[0] for r in cursor.fetchall()]

        dated = []
        for d in all_dates_raw:
            parsed = self._parse_date_mdy(d)
            if parsed:
                dated.append((parsed, d))
        dated.sort(key=lambda x: x[0], reverse=True)

        if days is not None:
            return [d[1] for d in dated[:days]]
        return [d[1] for d in dated]

    def dates_in_range(self, source: str, iso_from: str, iso_to: str) -> list[str]:
        """CreatedDate strings (M/D/YYYY) inside an inclusive ISO date range.

        The DateRail calendar emits ISO (YYYY-MM-DD); CreatedDate is stored as
        M/D/YYYY TEXT, so a string BETWEEN is meaningless ("7/9/2026" > "7/10/2026"
        lexically) and the range has to be resolved by parsing. Only DISTINCT
        dates are parsed (~133 rows), so this is cheap despite not using an index.

        Returned newest-first, matching _resolve_dates' contract. Empty list when
        the range is unparseable or covers no trading days — callers treat that
        as "header only", never as "all dates".
        """
        try:
            f = datetime.strptime(iso_from.strip(), "%Y-%m-%d")
            t = datetime.strptime(iso_to.strip(), "%Y-%m-%d")
        except (ValueError, TypeError, AttributeError):
            return []
        if t < f:
            f, t = t, f
        with self._conn() as conn:
            cursor = conn.execute(
                "SELECT DISTINCT CreatedDate FROM flow WHERE source = ?", (source,)
            )
            raw = [r[0] for r in cursor.fetchall()]
        dated = []
        for d in raw:
            parsed = self._parse_date_mdy(d)
            if parsed and f <= parsed <= t:
                dated.append((parsed, d))
        dated.sort(key=lambda x: x[0], reverse=True)
        return [d[1] for d in dated]

    def insert_csv(self, csv_content: str, source: str = "stocks") -> dict:
        """
        Insert CSV rows into the database. Skips duplicates automatically.

        Returns: { "inserted": int, "skipped": int, "dates": list[str] }
        """
        # Handle BOM and normalize line endings
        csv_content = csv_content.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")

        reader = csv.DictReader(io.StringIO(csv_content))
        inserted = 0
        skipped = 0
        dates_seen = set()

        with self._conn() as conn:
            for row in reader:
                # ts_ns (2026-07-25): optional 23rd column = the trade's nanosecond
                # timestamp (worker emits it; BBS/gap-fill CSVs omit it -> NULL).
                # Read BEFORE the COLUMNS filter strips unknown keys.
                _ts_raw = (row.get("ts_ns") or "").strip()
                try:
                    _ts_ns = int(_ts_raw) if _ts_raw else None
                except ValueError:
                    _ts_ns = None
                # Normalize: strip whitespace from all values
                row = {k: (v or "").strip() for k, v in row.items() if k in COLUMNS}
                if not row.get("Symbol") or not row.get("CreatedDate"):
                    skipped += 1
                    continue

                dedup_key = self._make_dedup_key(row, source)
                dates_seen.add(row["CreatedDate"])

                try:
                    conn.execute(
                        """INSERT INTO flow (
                            source, CreatedDate, CreatedTime, Symbol, Type, Volume,
                            Price, Side, CallPut, Strike, Spot, Premium,
                            ExpirationDate, Color, ImpliedVolatility, Dte, ER,
                            StockEtf, Sector, Uoa, Weekly, MktCap, OI, ts_ns, dedup_key
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            source,
                            row.get("CreatedDate", ""),
                            row.get("CreatedTime", ""),
                            row.get("Symbol", ""),
                            row.get("Type", ""),
                            row.get("Volume", ""),
                            row.get("Price", ""),
                            row.get("Side", ""),
                            row.get("CallPut", ""),
                            row.get("Strike", ""),
                            row.get("Spot", ""),
                            row.get("Premium", ""),
                            row.get("ExpirationDate", ""),
                            row.get("Color", ""),
                            row.get("ImpliedVolatility", ""),
                            row.get("Dte", ""),
                            row.get("ER", ""),
                            row.get("StockEtf", ""),
                            row.get("Sector", ""),
                            row.get("Uoa", ""),
                            row.get("Weekly", ""),
                            row.get("MktCap", ""),
                            row.get("OI", ""),
                            _ts_ns,
                            dedup_key,
                        ),
                    )
                    inserted += 1
                except sqlite3.IntegrityError:
                    # Duplicate — dedup_key already exists
                    skipped += 1

        return {
            "inserted": inserted,
            "skipped": skipped,
            "dates": sorted(dates_seen),
        }

    def update_sides_by_dedup(self, updates: list) -> int:
        """Reclassify Side in place for already-inserted rows (post-NBBO recovery).

        `updates`: list of (dedup_key, new_side, only_if_side) tuples. Each row's
        Side is overwritten ONLY when its stored value still equals
        `only_if_side` — the tick/empty value the worker recorded at emit time.

        This guard makes the update both idempotent (a second pass is a no-op)
        and incapable of clobbering an NBBO-derived side: rows are write-once
        (insert_csv skips duplicates), so a buffered tick/empty row's stored
        Side is still exactly what we recorded, and an NBBO row's Side never
        matches `only_if_side`. `dedup_key` is UNIQUE and excludes Side, so the
        match targets exactly one row without disturbing the key.

        Returns the number of rows actually updated.
        """
        if not updates:
            return 0
        n = 0
        with self._conn() as conn:
            for dedup_key, new_side, only_if_side in updates:
                if not dedup_key or new_side == only_if_side:
                    continue
                cur = conn.execute(
                    "UPDATE flow SET Side = ? WHERE dedup_key = ? AND Side = ?",
                    (new_side, dedup_key, only_if_side),
                )
                n += cur.rowcount
        return n

    # ── Streaming CSV (preferred for /api/flow/data) ────────────────────

    def stream_csv(self, source: str = "stocks", days: int | None = None,
                   cap_rows: int | None = None, dates: list | None = None):
        """
        Generator that yields CSV chunks from the database.

        Uses cursor iteration (no fetchall) so memory stays flat regardless
        of result size, and the first chunk ships as soon as the first batch
        of rows is read — no 50-second server-side wait.

        ``days=None`` means all data.

        ``cap_rows`` (optional): when set to a positive int, the query keeps
        only the top-``cap_rows`` rows by Premium (descending) and drops the
        rest. This pushes the premium-ranked cap into SQLite so the router no
        longer has to collect + sort 770K Python rows for the "All" range —
        SQLite does the top-N selection in C. Leave as ``None`` (default) for
        an uncapped stream: small ranges and the delta-merge ``days=1``
        refetch MUST stay uncapped so a heavy day's low-premium tail is never
        truncated. NOTE: the capped stream is Premium-DESC ordered, not
        chronological/rowid order like the uncapped path.
        """
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        try:
            # Resolve target dates. An explicit `dates` list (from the DateRail
            # calendar, via dates_in_range) wins over the days-back path. Note
            # `dates is not None` rather than a truthiness check: an EMPTY list
            # means "the range contains no trading days" and must yield a bare
            # header — falling through to _resolve_dates there would silently
            # serve the entire table.
            selected_dates = (dates if dates is not None
                              else self._resolve_dates(conn, source, days))
            if not selected_dates:
                yield _HEADER_LINE
                return

            placeholders = ",".join(["?"] * len(selected_dates))
            sql = (
                f"SELECT {_SELECT_COLS} FROM flow "
                f"WHERE source = ? AND CreatedDate IN ({placeholders})"
            )
            params = [source] + selected_dates

            # Premium-ranked cap for large ranges. Premium is stored as TEXT,
            # so the ORDER BY MUST cast to a number — a lexical sort would rank
            # "9" above "1000000". CAST(... AS REAL) tolerates decimals and
            # treats blank/NULL as 0/NULL, both of which sort to the bottom
            # under DESC, so empty-premium rows are correctly the first to be
            # dropped. SQLite selects the top-N in C over the scanned rows;
            # the router no longer collects + sorts 770K Python rows (the
            # 14.7s "All" build). Uncapped path is unchanged: no ORDER BY, so
            # rows still come out in rowid order for small ranges / days=1.
            if cap_rows and cap_rows > 0:
                sql += " ORDER BY CAST(Premium AS REAL) DESC LIMIT ?"
                params.append(cap_rows)

            cursor = conn.execute(sql, params)

            # Yield header
            yield _HEADER_LINE

            # Yield rows in batches — csv.writer into a small StringIO buffer
            buf = io.StringIO()
            writer = csv.writer(buf)
            count = 0

            for row in cursor:
                writer.writerow(row)
                count += 1
                if count % _STREAM_BATCH == 0:
                    yield buf.getvalue()
                    buf.seek(0)
                    buf.truncate(0)

            # Flush remaining
            remainder = buf.getvalue()
            if remainder:
                yield remainder
        finally:
            conn.close()

    def stream_csv_symbol(self, symbol: str, source: str = "stocks", columns=None):
        """Stream ALL flow rows for a single SYMBOL, uncapped, across every date.

        The bulk stream_csv caps large ranges to the top-N rows by premium, which
        silently drops most of a small-cap ticker\'s low-premium prints — so its
        Search-tab totals can understate the real flow many-fold (ACI: 5 of 68
        rows, $1.5M of $3.84M). The Search deep-dive uses THIS instead: one symbol
        is a tiny, indexed result set (tens of rows via idx_flow_symbol), so it is
        never capped and always reflects the ticker\'s complete flow.

        ⚠️ "TENS OF ROWS" WAS TRUE OF AN UPLOADED BBS CSV AND IS NOT TRUE OF THE
        LIVE OPRA TAPE. Measured against production 2026-08-06: SPY/indexes is
        349,203 rows = 40.9 MB of CSV over 22 columns, NVDA 141,639 rows /
        19.9 MB, AAPL 68,018 / 9.5 MB — all built into memory before a byte
        ships. `columns` lets a caller that reads three fields ask for three
        fields: the same rows, the same order, a header that describes them.
        Measured on a replica of those exact rows, SPY 40.9 MB -> 7.3 MB and the
        build 2585 ms -> 678 ms.

        `columns=None` is every column, so every existing caller is untouched.
        """
        cols = list(columns) if columns else COLUMNS
        bad = [c for c in cols if c not in _COLUMN_SET]
        if bad:
            # Deliberately NOT worded like `parse_columns`' refusal: these are
            # two different gates on two different surfaces (a request boundary
            # and a store method), and a test that pins one by message must not
            # be able to pass while the other is deleted.
            raise ValueError(
                f"stream_csv_symbol projection is not in the flow schema: {bad}")
        header_line = ",".join(cols) + "\n"
        select_cols = ", ".join(cols)
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        try:
            cursor = conn.execute(
                f"SELECT {select_cols} FROM flow WHERE source = ? AND Symbol = ?",
                (source, symbol),
            )
            yield header_line
            buf = io.StringIO()
            writer = csv.writer(buf)
            count = 0
            for row in cursor:
                writer.writerow(row)
                count += 1
                if count % _STREAM_BATCH == 0:
                    yield buf.getvalue()
                    buf.seek(0)
                    buf.truncate(0)
            remainder = buf.getvalue()
            if remainder:
                yield remainder
        finally:
            conn.close()

    # ── Legacy full-string methods (kept for backward compat / startup seed) ─

    def query_csv(self, source: str = "stocks", days: int = 20) -> str:
        """
        Query the last N trading days of data for the given source.
        Returns a CSV string with the same headers as BBS exports.
        """
        return "".join(self.stream_csv(source=source, days=days))

    def query_all_csv(self, source: str = "stocks") -> str:
        """Query ALL data for the given source. Use with caution on large DBs."""
        return "".join(self.stream_csv(source=source, days=None))

    def prune_old_trade_days(self, retain_days: int | None = None,
                             dry_run: bool | None = None,
                             max_days: int | None = None) -> dict:
        """Delete WHOLE trading days older than the retention window.

        REPLACES the old expiry-based prune (2026-07-26). That version ran

            DELETE FROM flow WHERE ExpirationDate IN (<everything expired>)

        with NO CreatedDate scoping, so a trade PRINTED on 7/16 on a contract
        EXPIRING 7/18 was deleted once 7/18 passed. Historical days therefore
        hollowed out to only their still-unexpired contracts — while
        get_available_dates() kept advertising them, because SOME rows survived.
        The day rendered as a complete session.

        Measured on production before the fix (rows returned for one trade day,
        against a full session of ~96,178):

            Fri 7/24   96,179   100%
            Fri 7/10   54,043    56%
            Wed 6/24   13,022    14%
            Fri 5/22    3,909     4%
            Fri 3/13    1,205   1.3%
            Thu 1/15      986   1.0%

        Short-dated flow dies first, and 0DTE/weeklies are the majority of the
        tape on index and megacap names — so the surviving rows were also the
        least representative. Every one of those days was pickable in the
        calendar and captioned as a full day.

        There was never a disk reason for it. Production density is ~1,293
        bytes/row including indexes; retaining EVERY row of all 138 days is
        ~25GB, and 90 days is ~16GB, on a 50GB volume that had ~35GB free.

        Pruning by trade date instead means a day is either wholly present or
        wholly absent — never a plausible-looking fraction.

        SAFETY (this is a DELETE on the production tape):
          - retain_days <= 0 DISABLES pruning. A misconfigured "0" must never
            read as "delete everything"; for a delete path the fail-safe
            direction is always to keep.
          - The newest trade date is NEVER deletable, whatever the config says.
          - A CreatedDate that will not parse is never deleted. Skipping a row
            keeps data; the old code's equivalent skip on ExpirationDate made
            those rows immortal, which is the harmless direction of the same
            coin.
          - dry_run reports exactly what would go without touching anything.

        Returns {"pruned", "days_removed", "days_kept", "backlog_days",
        "cutoff", "dry_run", "armed"}. `backlog_days` is the FULL count past the
        window before the per-run cap, so an undrained backlog stays visible
        instead of looking like steady state.
        """
        if retain_days is None:
            retain_days = FLOW_RETAIN_TRADE_DAYS
        if max_days is None:
            max_days = FLOW_PRUNE_MAX_DAYS_PER_RUN
        if dry_run is None:
            # UNARMED BY DEFAULT. Deploying this stops the hollowing — that is
            # the actual bug fix — and deletes nothing. Arming retention is a
            # SECOND, deliberate act, because there is no restore path and the
            # first armed run would otherwise be the largest delete this table
            # has ever seen, executed by a deploy rather than by a decision.
            dry_run = not FLOW_PRUNE_ENABLED

        result = {"pruned": 0, "days_removed": [], "days_kept": 0,
                  "backlog_days": 0, "cutoff": None, "dry_run": dry_run,
                  "armed": FLOW_PRUNE_ENABLED}

        if retain_days is None or retain_days <= 0:
            result["cutoff"] = "disabled"
            return result

        cutoff = datetime.now() - timedelta(days=retain_days)
        result["cutoff"] = cutoff.strftime("%Y-%m-%d")

        with self._conn() as conn:
            rows = conn.execute("SELECT DISTINCT CreatedDate FROM flow").fetchall()

            parsed = []
            for (raw,) in rows:
                d = self._parse_date_mdy(raw or "")
                if d is not None:                   # unparseable => never delete
                    parsed.append((d, raw))

            result["days_kept"] = len(parsed)
            if not parsed:
                return result

            # Never prune the newest session, regardless of retention config.
            newest = max(d for d, _ in parsed)
            # Sort on the PARSED date, never the raw string: "M/D/YYYY" sorts
            # lexically, so "11/3/2026" lands before "5/1/2026". Everything below
            # is oldest-first, and the per-run cap slices this list — on a
            # lexical order the cap would delete the wrong days.
            doomed_all = sorted((d, raw) for d, raw in parsed
                                if d < cutoff and d != newest)
            result["backlog_days"] = len(doomed_all)

            # Blast radius. A wrong retain_days can only take max_days per run,
            # so a misconfiguration is visible for many nights before it becomes
            # expensive, instead of emptying the tape on the first tick.
            if max_days and max_days > 0:
                doomed_all = doomed_all[:max_days]
            doomed = [raw for _, raw in doomed_all]

            if not doomed:
                return result

            result["days_removed"] = [raw for _, raw in doomed_all]
            result["days_kept"] = len(parsed) - len(doomed)

            if dry_run:
                placeholders = ",".join(["?"] * len(doomed))
                result["pruned"] = conn.execute(
                    f"SELECT COUNT(*) FROM flow WHERE CreatedDate IN ({placeholders})",
                    doomed,
                ).fetchone()[0]
                return result

            placeholders = ",".join(["?"] * len(doomed))
            cursor = conn.execute(
                f"DELETE FROM flow WHERE CreatedDate IN ({placeholders})",
                doomed,
            )
            result["pruned"] = cursor.rowcount

        return result

    def prune_expired(self, buffer_days: int = 7) -> int:
        """DEPRECATED NAME — kept so the six existing callers keep working.

        The expiry-based delete this used to perform was destroying historical
        trading days (see prune_old_trade_days). `buffer_days` is intentionally
        IGNORED: it described a contract-expiry buffer, a concept that no longer
        exists here, and silently reinterpreting it as a trade-date retention
        would turn `buffer_days=1` — what the nightly cron passes — into "keep
        one day of tape and delete everything else".

        Returns the row count, as before, so callers that log it are unaffected.
        """
        return self.prune_old_trade_days()["pruned"]

    def data_signature(self) -> tuple:
        """(max_rowid, row_count) — a cheap 'has anything changed' fingerprint.

        Used by flow_router._current_version() to gate the cache version on the
        data actually changing, so a quiet tape stops costing every client a
        full CSV refetch every 60s. Deliberately NOT stats(): that does 3×
        COUNT(*) plus a DISTINCT scan (~300ms on the production table) and is
        far too heavy for the request path — that cost is what the 60s bucket
        was introduced to escape.

        Both halves are needed. MAX(rowid) is what SQLite special-cases to a
        seek of the rowid btree's rightmost leaf (0.003 ms measured) and it
        catches inserts, but it does NOT move when the prune job deletes OLD
        rows — that alone would freeze the version and serve pruned rows
        forever. COUNT(*) (0.006 ms measured) closes that.
        """
        with self._conn() as conn:
            mx = conn.execute("SELECT MAX(rowid) FROM flow").fetchone()[0]
            ct = conn.execute("SELECT COUNT(*) FROM flow").fetchone()[0]
        return (mx, ct)

    def stats(self) -> dict:
        """Get database statistics for admin display."""
        with self._conn() as conn:
            total = conn.execute("SELECT COUNT(*) FROM flow").fetchone()[0]
            stocks = conn.execute(
                "SELECT COUNT(*) FROM flow WHERE source='stocks'"
            ).fetchone()[0]
            indexes = conn.execute(
                "SELECT COUNT(*) FROM flow WHERE source='indexes'"
            ).fetchone()[0]

            # Date range
            cursor = conn.execute(
                "SELECT DISTINCT CreatedDate FROM flow ORDER BY CreatedDate"
            )
            all_dates_raw = [r[0] for r in cursor.fetchall()]
            dated = []
            for d in all_dates_raw:
                parsed = self._parse_date_mdy(d)
                if parsed:
                    dated.append((parsed, d))
            dated.sort(key=lambda x: x[0])

            # Trading days by source
            stock_days = conn.execute(
                "SELECT COUNT(DISTINCT CreatedDate) FROM flow WHERE source='stocks'"
            ).fetchone()[0]
            index_days = conn.execute(
                "SELECT COUNT(DISTINCT CreatedDate) FROM flow WHERE source='indexes'"
            ).fetchone()[0]

            # DB file size
            db_size = os.path.getsize(self.db_path) if os.path.exists(self.db_path) else 0

            return {
                "total_rows": total,
                "stocks_rows": stocks,
                "indexes_rows": indexes,
                "stock_days": stock_days,
                "index_days": index_days,
                "date_range": {
                    "earliest": dated[0][1] if dated else None,
                    "latest": dated[-1][1] if dated else None,
                },
                "trading_days": len(dated),
                "db_size_mb": round(db_size / 1e6, 1),
            }

    def get_available_dates(self, source: str = "stocks") -> list:
        """Get all available trading dates for a source, sorted chronologically."""
        with self._conn() as conn:
            cursor = conn.execute(
                "SELECT DISTINCT CreatedDate FROM flow WHERE source = ?",
                (source,),
            )
            all_dates_raw = [r[0] for r in cursor.fetchall()]

        dated = []
        for d in all_dates_raw:
            parsed = self._parse_date_mdy(d)
            if parsed:
                dated.append((parsed, d))
        dated.sort(key=lambda x: x[0])
        return [d[1] for d in dated]

    def get_mktcap_batch(self, symbols: list[str]) -> dict[str, int]:
        """Return the most recent non-zero MktCap value seen in flow data
        for each requested symbol. Stored as TEXT in the flow table because
        BBS exports it that way; we parse to int here and skip blanks/zeros.

        Used by /api/schwab/mktcap-batch as the first lookup layer so the
        dark pool view can resolve mkt caps without hitting Schwab or Yahoo
        for every ticker. The flow CSV ships MktCap as a column, so for any
        ticker that's appeared in options flow this is a free, instant,
        offline lookup.

        Picks the MAX(id) row per symbol — the most recently ingested print
        for that ticker — which is also the freshest market-cap snapshot.
        BBS occasionally stamps wildly wrong values (e.g. MU at $1.2T),
        but we don't try to validate here; the caller can sanity-check if
        needed.
        """
        if not symbols:
            return {}
        # Normalize: upper-case, dedupe, drop empties
        clean = sorted({s.strip().upper() for s in symbols if s and s.strip()})
        if not clean:
            return {}
        placeholders = ",".join("?" for _ in clean)
        # Subquery picks the max(id) per symbol where MktCap is usable, then
        # joins back to get the actual MktCap text. Single query, scales fine
        # at hundreds of symbols.
        sql = f"""
            SELECT f.Symbol, f.MktCap
            FROM flow f
            INNER JOIN (
                SELECT Symbol, MAX(id) AS max_id
                FROM flow
                WHERE Symbol IN ({placeholders})
                  AND MktCap IS NOT NULL
                  AND MktCap != ''
                  AND MktCap != '0'
                GROUP BY Symbol
            ) latest ON f.id = latest.max_id
        """
        out: dict[str, int] = {}
        try:
            with self._conn() as conn:
                cursor = conn.execute(sql, clean)
                for row in cursor.fetchall():
                    sym = (row[0] or "").strip().upper()
                    raw = (row[1] or "").strip()
                    if not sym or not raw:
                        continue
                    try:
                        # MktCap is stored as TEXT; values look like
                        # "340897000000" (raw dollars). Cast through float
                        # to tolerate any stray decimal points.
                        v = int(float(raw))
                        if v > 0:
                            out[sym] = v
                    except (ValueError, TypeError):
                        continue
        except Exception as e:
            print(f"[flow_db] get_mktcap_batch failed: {e}")
        return out

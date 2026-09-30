"""The economic-data store: `econ.db` (SQLite, WAL), owned by the econ service.

THREE KINDS OF TABLE, THREE RULES

  RAW TRUTH -- append-only, enforced BY THE DATABASE:
    observation   one row per (series, period, release) VINTAGE. Triggers RAISE
                  on UPDATE and on DELETE, and (migration 3) on any INSERT over
                  an existing (series, period, release) row -- so INSERT OR
                  REPLACE is refused even on a raw connection without
                  `recursive_triggers` (connect() also sets it). A row is
                  written only when (value, flag) differs from the period's
                  current latest vintage, so a re-sighting is a no-op and a
                  revision is a NEW row; the original is never lost.
    acquisition   one row per provider request (outcome + hashes, error REDACTED).
    release       one row per release_key (UNIQUE; INSERT OR IGNORE -> idempotent).
    validation_event  what a validator refused, and why (reasons are secret-free).

  SCHEDULE -- calendar_event: a re-fetched event for the same (calendar_key,
    period_label) with a different date/time SUPERSEDES the old row
    (superseded_at is stamped; the old row is kept).

  STATE -- series_state, http_validator, lease: mutable bookkeeping.

LATEST vs AS-OF (the two reads every consumer needs):
  latest vintage of a period = max(available_at, release_id)
  as-of T                    = the same, restricted to available_at <= T
  first availability         = min(available_at) of the period's vintages (<= T)
The serving contract places a point at its FIRST availability carrying its
latest(-as-of) value, so `latest_rows` returns both times in one pass.

Numbered migrations recorded in PRAGMA user_version; a database written by a
NEWER build is refused rather than silently downgraded.
"""
from __future__ import annotations

import json
import math
import os
import sqlite3
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterable, NamedTuple, Optional, Sequence

from .model import EconError

MIGRATIONS: tuple[str, ...] = (
    # 1 -- initial schema (docs/economic-data/PHASE1-DESIGN.md "Store")
    """
    CREATE TABLE acquisition (
        acq_id              INTEGER PRIMARY KEY,
        adapter             TEXT NOT NULL,
        request_key         TEXT NOT NULL,          -- REDACTED request identity
        started_at          INTEGER NOT NULL,
        finished_at         INTEGER,
        http_status         INTEGER,
        outcome             TEXT,                   -- ok|not_modified|error|rejected|...
        payload_sha256      TEXT,
        payload_bytes       INTEGER,
        source_published_at INTEGER,
        archive_ref         TEXT,
        error               TEXT                    -- REDACTED
    );
    CREATE INDEX acquisition_adapter ON acquisition(adapter, started_at);
    CREATE INDEX acquisition_request ON acquisition(request_key, started_at);

    CREATE TABLE release (
        release_id    INTEGER PRIMARY KEY,
        release_key   TEXT NOT NULL UNIQUE,
        calendar_key  TEXT,
        kind          TEXT NOT NULL CHECK (kind IN ('live','backfill','derived')),
        scheduled_at  INTEGER,
        created_at    INTEGER NOT NULL,
        acq_id        INTEGER
    );

    CREATE TABLE observation (
        series_id        TEXT NOT NULL,
        period_start     TEXT NOT NULL,            -- ISO date
        release_id       INTEGER NOT NULL,
        period_end       TEXT NOT NULL,            -- ISO date
        value            REAL,                     -- NULL = explicit NA
        flag             TEXT NOT NULL DEFAULT '',
        available_at     INTEGER NOT NULL,         -- unix s UTC
        available_method TEXT NOT NULL,            -- model.AvailableAtMethod (derived: 'derived:<op>@<v>')
        pit_class        TEXT NOT NULL CHECK (pit_class IN ('V','U','L','X')),
        acq_id           INTEGER,
        inputs           TEXT,                     -- derived: compact JSON [[series, period_start, release_id], ...]
        ingested_at      INTEGER NOT NULL,
        validated_at     INTEGER,
        PRIMARY KEY (series_id, period_start, release_id)
    ) WITHOUT ROWID;
    CREATE INDEX observation_vintage ON observation(series_id, period_start, available_at, release_id);
    CREATE INDEX observation_avail ON observation(series_id, available_at);
    CREATE TRIGGER observation_no_update BEFORE UPDATE ON observation
    BEGIN SELECT RAISE(ABORT, 'observation is append-only: UPDATE refused'); END;
    CREATE TRIGGER observation_no_delete BEFORE DELETE ON observation
    BEGIN SELECT RAISE(ABORT, 'observation is append-only: DELETE refused'); END;

    CREATE TABLE calendar_event (
        event_id      INTEGER PRIMARY KEY,
        calendar_key  TEXT NOT NULL,
        period_label  TEXT NOT NULL,
        sched_date    TEXT NOT NULL,               -- ISO date (ET)
        sched_time    TEXT,                        -- 'HH:MM' ET, NULL when date-only
        tz            TEXT NOT NULL DEFAULT 'America/New_York',
        precision     TEXT NOT NULL,               -- model.SchedulePrecision
        source        TEXT NOT NULL,               -- model.ScheduleSource
        provenance    TEXT,
        fetched_at    INTEGER NOT NULL,
        superseded_at INTEGER
    );
    CREATE UNIQUE INDEX calendar_event_active ON calendar_event(calendar_key, period_label)
        WHERE superseded_at IS NULL;
    CREATE INDEX calendar_event_date ON calendar_event(sched_date, calendar_key);

    CREATE TABLE series_state (
        series_id           TEXT PRIMARY KEY,
        state               TEXT NOT NULL,
        latest_period       TEXT,
        latest_available_at INTEGER,
        expected_period     TEXT,
        expected_by         INTEGER,
        next_event_id       INTEGER,
        last_success_at     INTEGER,
        last_attempt_at     INTEGER,
        failures            INTEGER NOT NULL DEFAULT 0,
        reason              TEXT,
        updated_at          INTEGER NOT NULL
    );

    CREATE TABLE http_validator (
        request_key   TEXT PRIMARY KEY,
        etag          TEXT,
        last_modified TEXT,
        updated_at    INTEGER NOT NULL
    );

    CREATE TABLE lease (
        name       TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,
        expires_at INTEGER NOT NULL
    );

    CREATE TABLE validation_event (
        id        INTEGER PRIMARY KEY,
        series_id TEXT NOT NULL,
        at        INTEGER NOT NULL,
        severity  TEXT NOT NULL,                   -- reject|quarantine|warn
        reasons   TEXT NOT NULL,                   -- JSON list of secret-free strings
        acq_id    INTEGER
    );
    CREATE INDEX validation_event_series ON validation_event(series_id, at);
    """,
    # 2 -- adopt the release system's side tables (RELEASE-SYSTEM.md "Side tables").
    # They were first created ad hoc by currentness.py / calendar.py with
    # CREATE TABLE IF NOT EXISTS, so a v1 database may already hold them: IF NOT
    # EXISTS keeps this migration a no-op there and the owners' ensure_* stay
    # harmless. The DDL must stay column-identical to currentness._OPS_DDL and
    # calendar._COVERAGE_DDL (tests/econ/test_store.py pins it).
    """
    CREATE TABLE IF NOT EXISTS series_ops (
        series_id                  TEXT PRIMARY KEY,
        last_attempt_at            INTEGER,
        last_success_at            INTEGER,
        last_published_at          INTEGER,
        consecutive_failures       INTEGER NOT NULL DEFAULT 0,
        last_failure_kind          TEXT,
        last_failure_at            INTEGER,
        last_error                 TEXT,
        last_validation_failure_at INTEGER,
        blocked_until              INTEGER,
        last_reconcile_at          INTEGER,
        last_backfill_at           INTEGER,
        publish_pending_at         INTEGER,
        updated_at                 INTEGER
    );
    CREATE TABLE IF NOT EXISTS provider_ops (
        provider             TEXT PRIMARY KEY,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_error           TEXT,
        last_error_at        INTEGER,
        last_success_at      INTEGER,
        backoff_until        INTEGER,
        updated_at           INTEGER
    );
    CREATE TABLE IF NOT EXISTS provider_quota (
        provider TEXT NOT NULL,
        day      TEXT NOT NULL,
        used     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (provider, day)
    );
    CREATE TABLE IF NOT EXISTS calendar_coverage (
        calendar_key   TEXT PRIMARY KEY,
        provider       TEXT NOT NULL,
        source         TEXT NOT NULL,
        coverage_start TEXT,
        coverage_end   TEXT,
        refreshed_at   INTEGER NOT NULL,
        detail         TEXT
    );
    """,
    # 3 -- append-only hardening (2026-09-30). `INSERT OR REPLACE` resolves a PK
    # conflict by DELETING the old row; that delete fires observation_no_delete
    # ONLY when the connection has PRAGMA recursive_triggers=ON (connect() sets it,
    # a raw sqlite3/CLI connection does not). A BEFORE INSERT trigger runs before
    # conflict resolution on EVERY connection, so an insert over an existing
    # (series_id, period_start, release_id) is refused whatever the pragma or the
    # ON CONFLICT clause (REPLACE / IGNORE / plain). write_observations and
    # append_vintages already look for an existing PK row first and use a plain
    # INSERT, so normal writes are unchanged. Schema-only: no row is touched, and
    # IF NOT EXISTS keeps it safe to apply in place on any v2 DB.
    """
    CREATE TRIGGER IF NOT EXISTS observation_no_replace BEFORE INSERT ON observation
    WHEN EXISTS (SELECT 1 FROM observation WHERE series_id = NEW.series_id
                 AND period_start = NEW.period_start AND release_id = NEW.release_id)
    BEGIN SELECT RAISE(ABORT, 'observation is append-only: insert over an existing vintage refused'); END;
    """,
)
SCHEMA_VERSION = len(MIGRATIONS)
# A READ-ONLY reader (the web serving path) never migrates. Migration 3 only adds a
# write-side trigger, so a v2 database reads identically: accept it, so the web and
# the econ service (which migrates) can deploy in either order.
READ_COMPATIBLE_FROM = 2
RELEASE_KINDS = ("live", "backfill", "derived")


class SchemaTooNew(EconError):
    """The database was written by a newer build; refusing to touch it."""


class StoreConflict(EconError):
    """The same (series, period, release) was re-written with a DIFFERENT value.
    A release is immutable; this is a caller bug or a reused release_key."""


class WriteStats(NamedTuple):
    inserted: int      # first-ever vintage of a period
    unchanged: int     # re-sighting identical to the current latest vintage (no-op)
    revised: int       # new vintage of a period that already had one

    @property
    def written(self) -> int:
        return self.inserted + self.revised


class ObsRow(NamedTuple):
    """One stored vintage."""
    series_id: str
    period_start: str
    period_end: str
    value: Optional[float]
    flag: str
    available_at: int
    available_method: str
    pit_class: str
    release_id: int
    acq_id: Optional[int]
    inputs: Optional[str]


class LatestRow(NamedTuple):
    """A period's latest(-as-of) vintage plus its FIRST availability time."""
    period_start: str
    period_end: str
    value: Optional[float]
    flag: str
    available_at: int            # the chosen vintage's available_at
    first_available_at: int      # min(available_at) over the period's vintages (<= asof)
    available_method: str
    pit_class: str
    release_id: int
    n_versions: int              # vintages visible (<= asof)


# Row tuple accepted by write_observations (positional, order is the contract):
#   (period_start, period_end, value, flag, available_at, available_method,
#    pit_class, acq_id, inputs)


def default_path() -> str:
    env = os.environ.get("ECON_DB_PATH")
    if env:
        return env
    return "/data/econ.db" if os.path.isdir("/data") else "./econ.db"


def _now() -> int:
    return int(time.time())


def _same(a: Optional[float], b: Optional[float]) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return float(a) == float(b)


def _redact(text: Optional[str]) -> Optional[str]:
    """Best-effort scrub through econ.secrets (owned elsewhere); ALWAYS bounded."""
    if text is None:
        return None
    s = str(text)
    try:
        from .secrets import redact  # noqa: WPS433 -- optional sibling module
        s = redact(s)
    except Exception:  # noqa: BLE001 -- a missing/broken redactor must not hide the error row
        pass
    return s[:2000]


class Store:
    """Thin, explicit wrapper over one sqlite3 connection (autocommit mode;
    multi-statement writes go through `tx()` = BEGIN IMMEDIATE)."""

    def __init__(self, conn: sqlite3.Connection, path: str):
        self.conn = conn
        self.path = path

    # ── lifecycle ────────────────────────────────────────────────────────────
    def close(self) -> None:
        self.conn.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    @contextmanager
    def tx(self):
        if self.conn.in_transaction:          # nested: join the outer transaction
            yield self.conn
            return
        self.conn.execute("BEGIN IMMEDIATE")
        try:
            yield self.conn
            self.conn.execute("COMMIT")
        except BaseException:
            self.conn.execute("ROLLBACK")
            raise

    # ── acquisitions ─────────────────────────────────────────────────────────
    def record_acquisition(self, adapter: str, request_key: str, *,
                           started_at: Optional[int] = None) -> int:
        cur = self.conn.execute(
            "INSERT INTO acquisition(adapter, request_key, started_at) VALUES (?,?,?)",
            (adapter, request_key, started_at if started_at is not None else _now()))
        return int(cur.lastrowid)

    def finish_acquisition(self, acq_id: int, *, outcome: str, http_status: Optional[int] = None,
                           payload_sha256: Optional[str] = None, payload_bytes: Optional[int] = None,
                           source_published_at: Optional[int] = None, archive_ref: Optional[str] = None,
                           error: Optional[str] = None, finished_at: Optional[int] = None) -> None:
        self.conn.execute(
            "UPDATE acquisition SET finished_at=?, http_status=?, outcome=?, payload_sha256=?,"
            " payload_bytes=?, source_published_at=?, archive_ref=?, error=? WHERE acq_id=?",
            (finished_at if finished_at is not None else _now(), http_status, outcome, payload_sha256,
             payload_bytes, source_published_at, archive_ref, _redact(error), acq_id))

    def get_acquisition(self, acq_id: int) -> Optional[dict]:
        r = self._dicts("SELECT * FROM acquisition WHERE acq_id=?", (acq_id,))
        return r[0] if r else None

    def list_acquisitions(self, adapter: Optional[str] = None, *, request_key: Optional[str] = None,
                          limit: int = 50) -> list[dict]:
        q, a = "SELECT * FROM acquisition WHERE 1=1", []
        if adapter:
            q += " AND adapter=?"; a.append(adapter)
        if request_key:
            q += " AND request_key=?"; a.append(request_key)
        q += " ORDER BY started_at DESC, acq_id DESC LIMIT ?"; a.append(int(limit))
        return self._dicts(q, a)

    # ── releases ─────────────────────────────────────────────────────────────
    def upsert_release(self, release_key: str, calendar_key: Optional[str], kind: str,
                       scheduled_at: Optional[int] = None, acq_id: Optional[int] = None) -> int:
        """Idempotent: the same release_key always maps to the same release_id
        (first writer's metadata wins)."""
        if kind not in RELEASE_KINDS:            # OR IGNORE would swallow the CHECK
            raise ValueError(f"unknown release kind {kind!r}")
        self.conn.execute(
            "INSERT OR IGNORE INTO release(release_key, calendar_key, kind, scheduled_at, created_at, acq_id)"
            " VALUES (?,?,?,?,?,?)", (release_key, calendar_key, kind, scheduled_at, _now(), acq_id))
        return int(self.conn.execute("SELECT release_id FROM release WHERE release_key=?",
                                     (release_key,)).fetchone()[0])

    def get_release(self, release_id: int) -> Optional[dict]:
        r = self._dicts("SELECT * FROM release WHERE release_id=?", (release_id,))
        return r[0] if r else None

    # ── observations: write ──────────────────────────────────────────────────
    def _latest_map(self, series_id: str, periods: Optional[set] = None) -> dict:
        """{period_start: (value, flag)} of each period's current latest vintage."""
        rows = self.conn.execute(
            "SELECT period_start, value, flag FROM ("
            " SELECT period_start, value, flag, ROW_NUMBER() OVER ("
            "   PARTITION BY period_start ORDER BY available_at DESC, release_id DESC) rn"
            " FROM observation WHERE series_id=?) WHERE rn=1", (series_id,)).fetchall()
        return {p: (v, f) for p, v, f in rows if periods is None or p in periods}

    def write_observations(self, series_id: str, release_id: int, rows: Sequence[tuple],
                           *, now: Optional[int] = None) -> WriteStats:
        """Append the vintages that CHANGE something; one transaction.

        A row is inserted only when its (value, flag) differs from the period's
        current latest vintage (None == None; floats compared exactly as stored).
        Re-running the same release is a no-op. Rows are applied in the given
        order, so a payload that names a period twice is diffed against itself.
        """
        now = _now() if now is None else now
        ins = unch = rev = 0
        with self.tx():
            latest = self._latest_map(series_id)
            batch = []
            staged: dict = {}          # period -> (value, flag) written earlier in THIS call
            for r in rows:
                (ps, pe, value, flag, avail, method, pit, acq, inputs) = r
                flag = flag or ""
                if value is not None:
                    value = float(value)
                    if not math.isfinite(value):
                        raise ValueError(f"{series_id} {ps}: non-finite value refused by the store")
                prev = staged.get(ps, latest.get(ps))
                if prev is not None and _same(prev[0], value) and prev[1] == flag:
                    unch += 1
                    continue
                if ps in staged:
                    raise StoreConflict(f"{series_id} {ps}: one release names the period twice with different values")
                if prev is not None:
                    # an older release being replayed after a newer one: identical = no-op
                    ex = self.conn.execute(
                        "SELECT value, flag FROM observation WHERE series_id=? AND period_start=? AND release_id=?",
                        (series_id, ps, release_id)).fetchone()
                    if ex is not None:
                        if _same(ex[0], value) and ex[1] == flag:
                            unch += 1
                            continue
                        raise StoreConflict(f"{series_id} {ps}: release {release_id} already holds a different value")
                batch.append((series_id, ps, release_id, pe, value, flag, int(avail), str(method),
                              str(getattr(pit, "value", pit)), acq, inputs, now, now))
                if prev is None:
                    ins += 1
                else:
                    rev += 1
                staged[ps] = (value, flag)
            if batch:
                self.conn.executemany(
                    "INSERT INTO observation(series_id, period_start, release_id, period_end, value, flag,"
                    " available_at, available_method, pit_class, acq_id, inputs, ingested_at, validated_at)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
        return WriteStats(ins, unch, rev)

    def append_vintages(self, series_id: str, rows: Sequence[tuple], *,
                        now: Optional[int] = None) -> int:
        """Raw append for callers that did their OWN diff (derive.py reconciles a
        whole vintage timeline). rows = (period_start, period_end, value, flag,
        available_at, available_method, pit_class, acq_id, inputs, release_id).
        An identical existing PK row is skipped; a different one raises."""
        now = _now() if now is None else now
        n = 0
        with self.tx():
            for (ps, pe, value, flag, avail, method, pit, acq, inputs, rid) in rows:
                value = None if value is None else float(value)
                if value is not None and not math.isfinite(value):
                    raise ValueError(f"{series_id} {ps}: non-finite value refused by the store")
                ex = self.conn.execute(
                    "SELECT value, flag FROM observation WHERE series_id=? AND period_start=? AND release_id=?",
                    (series_id, ps, rid)).fetchone()
                if ex is not None:
                    if _same(ex[0], value) and ex[1] == (flag or ""):
                        continue
                    raise StoreConflict(f"{series_id} {ps}: release {rid} already holds a different value")
                self.conn.execute(
                    "INSERT INTO observation(series_id, period_start, release_id, period_end, value, flag,"
                    " available_at, available_method, pit_class, acq_id, inputs, ingested_at, validated_at)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (series_id, ps, rid, pe, value, flag or "", int(avail), str(method),
                     str(getattr(pit, "value", pit)), acq, inputs, now, now))
                n += 1
        return n

    # ── observations: read ───────────────────────────────────────────────────
    _OBS_COLS = ("series_id, period_start, period_end, value, flag, available_at, available_method,"
                 " pit_class, release_id, acq_id, inputs")

    def latest_rows(self, series_id: str, asof: Optional[int] = None, start: Optional[str] = None,
                    end: Optional[str] = None) -> list[LatestRow]:
        """Per period (period_start in [start, end]) the latest vintage visible at
        `asof` (all vintages when None), ordered by period_start, with the period's
        FIRST availability (min available_at of its visible vintages)."""
        where, a = ["series_id=:s"], {"s": series_id}
        if asof is not None:
            where.append("available_at<=:t"); a["t"] = int(asof)
        if start is not None:
            where.append("period_start>=:lo"); a["lo"] = start
        if end is not None:
            where.append("period_start<=:hi"); a["hi"] = end
        # GROUP BY for first availability + count, then an index-ordered probe
        # for the latest vintage (measured ~2x faster than window functions).
        q = ("SELECT g.period_start, o.period_end, o.value, o.flag, o.available_at, g.f,"
             " o.available_method, o.pit_class, o.release_id, g.n"
             " FROM (SELECT period_start, MIN(available_at) f, COUNT(*) n FROM observation"
             " WHERE " + " AND ".join(where) + " GROUP BY period_start) g"
             " JOIN observation o ON o.series_id=:s AND o.period_start=g.period_start AND o.release_id=("
             "  SELECT release_id FROM observation WHERE series_id=:s AND period_start=g.period_start"
             + (" AND available_at<=:t" if asof is not None else "") +
             "  ORDER BY available_at DESC, release_id DESC LIMIT 1)"
             " ORDER BY g.period_start")
        return [LatestRow(*r) for r in self.conn.execute(q, a)]

    history = latest_rows          # design-doc name

    def latest_point(self, series_id: str, asof: Optional[int] = None) -> Optional[LatestRow]:
        """The newest period visible at `asof`, with its latest-as-of vintage."""
        q, a = "SELECT MAX(period_start) FROM observation WHERE series_id=?", [series_id]
        if asof is not None:
            q += " AND available_at<=?"; a.append(int(asof))
        p = self.conn.execute(q, a).fetchone()[0]
        if p is None:
            return None
        rows = self.latest_rows(series_id, asof=asof, start=p, end=p)
        return rows[0] if rows else None

    latest = latest_point          # design-doc name

    def versions(self, series_id: str, period_start: str) -> list[ObsRow]:
        """Every vintage of one period, oldest first."""
        return [ObsRow(*r) for r in self.conn.execute(
            f"SELECT {self._OBS_COLS} FROM observation WHERE series_id=? AND period_start=?"
            " ORDER BY available_at, release_id", (series_id, period_start))]

    def vintages(self, series_id: str) -> list[ObsRow]:
        """Every vintage of every period, by (period_start, available_at, release_id)."""
        return [ObsRow(*r) for r in self.conn.execute(
            f"SELECT {self._OBS_COLS} FROM observation WHERE series_id=?"
            " ORDER BY period_start, available_at, release_id", (series_id,))]

    def since(self, series_id: str, available_after: int) -> list[ObsRow]:
        """Vintages that became available strictly after `available_after`."""
        return [ObsRow(*r) for r in self.conn.execute(
            f"SELECT {self._OBS_COLS} FROM observation WHERE series_id=? AND available_at>?"
            " ORDER BY available_at, period_start, release_id", (series_id, int(available_after)))]

    def period_bounds(self, series_id: str, asof: Optional[int] = None) -> dict:
        """{'oldest', 'newest', 'count'} over distinct periods (visible at asof)."""
        q, a = ("SELECT MIN(period_start), MAX(period_start), COUNT(DISTINCT period_start)"
                " FROM observation WHERE series_id=?"), [series_id]
        if asof is not None:
            q += " AND available_at<=?"; a.append(int(asof))
        lo, hi, n = self.conn.execute(q, a).fetchone()
        return {"oldest": lo, "newest": hi, "count": int(n or 0)}

    def series_ids(self) -> list[str]:
        return [r[0] for r in self.conn.execute("SELECT DISTINCT series_id FROM observation ORDER BY 1")]

    # ── series_state ─────────────────────────────────────────────────────────
    _STATE_FIELDS = ("state", "latest_period", "latest_available_at", "expected_period", "expected_by",
                     "next_event_id", "last_success_at", "last_attempt_at", "failures", "reason")

    def get_state(self, series_id: str) -> Optional[dict]:
        r = self._dicts("SELECT * FROM series_state WHERE series_id=?", (series_id,))
        return r[0] if r else None

    state = get_state              # design-doc name

    def put_state(self, series_id: str, **fields) -> dict:
        """Merge `fields` into the series' state row (creating it; `state`
        is required on create). Unknown field names are refused."""
        bad = set(fields) - set(self._STATE_FIELDS)
        if bad:
            raise ValueError(f"unknown series_state fields: {sorted(bad)}")
        for k in ("state",):
            if k in fields:
                fields[k] = str(getattr(fields[k], "value", fields[k]))
        with self.tx():
            cur = self.get_state(series_id)
            if cur is None:
                if "state" not in fields:
                    raise ValueError("series_state create needs `state`")
                row = {k: None for k in self._STATE_FIELDS}
                row["failures"] = 0
            else:
                row = {k: cur[k] for k in self._STATE_FIELDS}
            row.update(fields)
            cols = ("series_id",) + self._STATE_FIELDS + ("updated_at",)
            self.conn.execute(
                f"INSERT OR REPLACE INTO series_state({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                (series_id, *[row[k] for k in self._STATE_FIELDS], _now()))
        return self.get_state(series_id)

    def all_states(self) -> list[dict]:
        return self._dicts("SELECT * FROM series_state ORDER BY series_id")

    # ── calendar events ──────────────────────────────────────────────────────
    def put_event(self, calendar_key: str, period_label: str, sched_date: str, *,
                  sched_time: Optional[str] = None, tz: str = "America/New_York",
                  precision: str = "unknown", source: str = "configured",
                  provenance: Optional[str] = None, fetched_at: Optional[int] = None) -> int:
        """Insert-or-supersede. Same (calendar_key, period_label) with the same
        date/time/tz -> the existing event_id (no new row). A different date or
        time -> the old row gets superseded_at and a new row is inserted."""
        fetched_at = _now() if fetched_at is None else fetched_at
        precision = str(getattr(precision, "value", precision))
        source = str(getattr(source, "value", source))
        with self.tx():
            cur = self.conn.execute(
                "SELECT event_id, sched_date, sched_time, tz FROM calendar_event"
                " WHERE calendar_key=? AND period_label=? AND superseded_at IS NULL",
                (calendar_key, period_label)).fetchone()
            if cur is not None:
                if (cur[1], cur[2], cur[3]) == (sched_date, sched_time, tz):
                    return int(cur[0])
                self.conn.execute("UPDATE calendar_event SET superseded_at=? WHERE event_id=?",
                                  (fetched_at, cur[0]))
            c = self.conn.execute(
                "INSERT INTO calendar_event(calendar_key, period_label, sched_date, sched_time, tz,"
                " precision, source, provenance, fetched_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (calendar_key, period_label, sched_date, sched_time, tz, precision, source,
                 provenance, fetched_at))
            return int(c.lastrowid)

    def get_event(self, event_id: int) -> Optional[dict]:
        r = self._dicts("SELECT * FROM calendar_event WHERE event_id=?", (event_id,))
        return r[0] if r else None

    def events(self, calendar_key: Optional[str] = None, *, start: Optional[str] = None,
               end: Optional[str] = None, include_superseded: bool = False) -> list[dict]:
        q, a = "SELECT * FROM calendar_event WHERE 1=1", []
        if calendar_key:
            q += " AND calendar_key=?"; a.append(calendar_key)
        if start:
            q += " AND sched_date>=?"; a.append(start)
        if end:
            q += " AND sched_date<=?"; a.append(end)
        if not include_superseded:
            q += " AND superseded_at IS NULL"
        q += " ORDER BY sched_date, COALESCE(sched_time,''), calendar_key, event_id"
        return self._dicts(q, a)

    def next_event(self, calendar_key: str, on_or_after: str) -> Optional[dict]:
        r = self._dicts(
            "SELECT * FROM calendar_event WHERE calendar_key=? AND superseded_at IS NULL AND sched_date>=?"
            " ORDER BY sched_date, COALESCE(sched_time,'') LIMIT 1", (calendar_key, on_or_after))
        return r[0] if r else None

    def delete_event(self, event_id: int, *, at: Optional[int] = None) -> None:
        """Events are never physically deleted: withdrawing one supersedes it."""
        self.conn.execute("UPDATE calendar_event SET superseded_at=? WHERE event_id=? AND superseded_at IS NULL",
                          (_now() if at is None else at, event_id))

    # ── http validators ──────────────────────────────────────────────────────
    def get_validator(self, request_key: str) -> Optional[dict]:
        r = self._dicts("SELECT * FROM http_validator WHERE request_key=?", (request_key,))
        return r[0] if r else None

    def put_validator(self, request_key: str, etag: Optional[str], last_modified: Optional[str]) -> None:
        self.conn.execute(
            "INSERT INTO http_validator(request_key, etag, last_modified, updated_at) VALUES (?,?,?,?)"
            " ON CONFLICT(request_key) DO UPDATE SET etag=excluded.etag,"
            " last_modified=excluded.last_modified, updated_at=excluded.updated_at",
            (request_key, etag, last_modified, _now()))

    # ── leases (duplicate-worker protection) ─────────────────────────────────
    def acquire_lease(self, name: str, owner: str, ttl_s: int, *, now: Optional[int] = None) -> bool:
        """Atomic: take the lease if free, expired, or already ours (extends it)."""
        now = _now() if now is None else now
        with self.tx():
            self.conn.execute(
                "INSERT INTO lease(name, owner, expires_at) VALUES (?,?,?)"
                " ON CONFLICT(name) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at"
                " WHERE lease.expires_at<=? OR lease.owner=excluded.owner",
                (name, owner, now + int(ttl_s), now))
            r = self.conn.execute("SELECT owner FROM lease WHERE name=?", (name,)).fetchone()
        return r is not None and r[0] == owner

    def renew_lease(self, name: str, owner: str, ttl_s: int, *, now: Optional[int] = None) -> bool:
        """Extend only while still held (not expired) by `owner`."""
        now = _now() if now is None else now
        c = self.conn.execute("UPDATE lease SET expires_at=? WHERE name=? AND owner=? AND expires_at>?",
                              (now + int(ttl_s), name, owner, now))
        return c.rowcount == 1

    def release_lease(self, name: str, owner: str) -> bool:
        c = self.conn.execute("DELETE FROM lease WHERE name=? AND owner=?", (name, owner))
        return c.rowcount == 1

    def lease_holder(self, name: str, *, now: Optional[int] = None) -> Optional[str]:
        now = _now() if now is None else now
        r = self.conn.execute("SELECT owner FROM lease WHERE name=? AND expires_at>?", (name, now)).fetchone()
        return r[0] if r else None

    # ── validation events ────────────────────────────────────────────────────
    def add_validation_event(self, series_id: str, severity: str, reasons: Iterable[str], *,
                             acq_id: Optional[int] = None, at: Optional[int] = None) -> int:
        c = self.conn.execute(
            "INSERT INTO validation_event(series_id, at, severity, reasons, acq_id) VALUES (?,?,?,?,?)",
            (series_id, _now() if at is None else at, severity,
             json.dumps([_redact(r) for r in reasons]), acq_id))
        return int(c.lastrowid)

    def validation_events(self, series_id: Optional[str] = None, *, limit: int = 50) -> list[dict]:
        q, a = "SELECT * FROM validation_event", []
        if series_id:
            q += " WHERE series_id=?"; a.append(series_id)
        q += " ORDER BY at DESC, id DESC LIMIT ?"; a.append(int(limit))
        out = self._dicts(q, a)
        for d in out:
            d["reasons"] = json.loads(d["reasons"])
        return out

    # ── helpers ──────────────────────────────────────────────────────────────
    def _dicts(self, q: str, a=()) -> list[dict]:
        cur = self.conn.execute(q, a)
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def migrate(conn: sqlite3.Connection) -> int:
    have = conn.execute("PRAGMA user_version").fetchone()[0]
    if have > SCHEMA_VERSION:
        raise SchemaTooNew(f"econ.db schema v{have} is newer than this build (v{SCHEMA_VERSION})")
    for i in range(have, SCHEMA_VERSION):
        # executescript COMMITs anything pending first; BEGIN..COMMIT inside the
        # script makes each migration + its version stamp one atomic unit.
        conn.executescript(f"BEGIN IMMEDIATE;\n{MIGRATIONS[i]}\nPRAGMA user_version = {i + 1};\nCOMMIT;")
    return SCHEMA_VERSION


def connect(path: Optional[str] = None, *, readonly: bool = False) -> Store:
    p = path or default_path()
    if readonly:
        conn = sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=30, isolation_level=None)
        have = conn.execute("PRAGMA user_version").fetchone()[0]
        if not READ_COMPATIBLE_FROM <= have <= SCHEMA_VERSION:
            conn.close()
            raise SchemaTooNew(f"econ.db schema v{have}, build reads v{READ_COMPATIBLE_FROM}..v{SCHEMA_VERSION}")
        return Store(conn, p)
    d = os.path.dirname(os.path.abspath(p))
    os.makedirs(d, exist_ok=True)
    conn = sqlite3.connect(p, timeout=30, isolation_level=None)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        # INSERT OR REPLACE deletes the old row; with recursive_triggers ON that
        # delete fires observation_no_delete, so REPLACE cannot bypass append-only.
        conn.execute("PRAGMA recursive_triggers=ON")
        migrate(conn)
    except BaseException:
        conn.close()
        raise
    return Store(conn, p)

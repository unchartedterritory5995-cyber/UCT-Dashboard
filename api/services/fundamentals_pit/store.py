"""The point-in-time fundamentals store (SQLite, worker-owned).

TWO KINDS OF TABLE, TWO RULES:

  RAW TRUTH — append-only. Never UPDATE, never DELETE.
    filing          one row per accession; metadata frozen at first sight. A
                    later sighting that disagrees is recorded in
                    filing_anomaly, never written over the original.
    fact            one row per (cik, tag, unit, period, accession, value).
                    INSERT OR IGNORE: re-ingesting the same companyfacts
                    document is a no-op, a restated value is a NEW row.
    filing_signal   restatement evidence from the filing's own XBRL
                    (dimensional facts companyfacts does not carry).
    split_event     split ledger rows per source; a disagreeing source is a
                    new row, never an overwrite.
    snapshot_capture  forward/analyst values captured going forward (a
                    separate dataset -- NOT point-in-time SEC fundamentals).

  DERIVED — rebuildable from raw truth at any time.
    series_point    sparse PIT observations, keyed by derivation_version so a
                    new derivation never overwrites the one being served.
    series_build    one row per (cik, derivation_version): input hash, status,
                    diagnostics (e.g. split-basis verification).

  STATE — bookkeeping for idempotent, resumable ingestion.
    security, ticker_map, ingest_state.

Schema changes are numbered migrations applied in order and recorded in
PRAGMA user_version; a database written by a NEWER build is refused rather
than silently downgraded.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from contextlib import contextmanager
from datetime import date, datetime, timezone

from .facts import Fact
from .filings import Filing

MIGRATIONS: tuple[str, ...] = (
    # 1 — initial schema
    """
    CREATE TABLE filing (
        accn         TEXT PRIMARY KEY,
        cik          INTEGER NOT NULL,
        form         TEXT NOT NULL,
        filing_date  TEXT NOT NULL,
        report_date  TEXT,
        accepted_at  INTEGER,             -- unix seconds UTC, NULL if unknown
        public_at    INTEGER NOT NULL,    -- unix seconds UTC (filings.public_at)
        source       TEXT NOT NULL,       -- 'submissions'
        first_seen_at REAL NOT NULL
    );
    CREATE INDEX filing_cik ON filing(cik, public_at);
    CREATE TABLE filing_anomaly (
        accn TEXT NOT NULL, seen_at REAL NOT NULL, detail TEXT NOT NULL
    );
    CREATE TABLE fact (
        cik          INTEGER NOT NULL,
        tag          TEXT NOT NULL,       -- 'us-gaap:Revenues'
        unit         TEXT NOT NULL,
        period_start TEXT NOT NULL,       -- '' for an instant
        period_end   TEXT NOT NULL,
        val          REAL NOT NULL,
        accn         TEXT NOT NULL,
        form         TEXT NOT NULL,
        filed        TEXT NOT NULL,
        fy           INTEGER,
        fp           TEXT,
        frame        TEXT,
        first_seen_at REAL NOT NULL,
        PRIMARY KEY (cik, tag, unit, period_end, period_start, accn, val)
    ) WITHOUT ROWID;
    CREATE TABLE filing_signal (
        accn         TEXT NOT NULL,
        tag          TEXT NOT NULL,       -- '*' = whole filing
        period_start TEXT NOT NULL,
        period_end   TEXT NOT NULL,
        kind         TEXT NOT NULL,       -- 'restatement_axis'
        source       TEXT NOT NULL,       -- 'fs_dataset:2022q1' | 'instance'
        first_seen_at REAL NOT NULL,
        PRIMARY KEY (accn, tag, period_start, period_end, kind)
    ) WITHOUT ROWID;
    CREATE TABLE split_event (
        ticker       TEXT NOT NULL,
        ex_date      TEXT NOT NULL,
        ratio        REAL NOT NULL,       -- new shares per old share
        source       TEXT NOT NULL,       -- 'massive' (production) | fixture sources in tests
        source_ref   TEXT,
        first_seen_at REAL NOT NULL,
        PRIMARY KEY (ticker, ex_date, ratio, source)
    ) WITHOUT ROWID;
    CREATE TABLE security (
        cik          INTEGER PRIMARY KEY,
        name         TEXT,
        tickers      TEXT NOT NULL,       -- JSON list, current per SEC submissions
        fye          TEXT,
        updated_at   REAL NOT NULL
    );
    CREATE TABLE ticker_map (
        ticker TEXT NOT NULL, cik INTEGER NOT NULL,
        first_seen_at REAL NOT NULL, last_seen_at REAL NOT NULL,
        PRIMARY KEY (ticker, cik)
    ) WITHOUT ROWID;
    CREATE TABLE ingest_state (
        cik                INTEGER PRIMARY KEY,
        companyfacts_sha   TEXT,
        submissions_sha    TEXT,
        facts_seen         INTEGER,
        last_ingested_at   REAL,
        last_error         TEXT
    );
    CREATE TABLE series_point (
        cik                INTEGER NOT NULL,
        metric             TEXT NOT NULL,
        derivation_version INTEGER NOT NULL,
        t_eff              INTEGER NOT NULL,   -- unix seconds UTC: filing public_at
        v                  REAL NOT NULL,
        period_end         TEXT NOT NULL,
        method             TEXT NOT NULL,
        sources            TEXT NOT NULL,      -- JSON [[tag, start, end, accn], ...]
        PRIMARY KEY (cik, metric, derivation_version, t_eff)
    ) WITHOUT ROWID;
    CREATE TABLE series_build (
        cik                INTEGER NOT NULL,
        derivation_version INTEGER NOT NULL,
        built_at           REAL NOT NULL,
        input_hash         TEXT NOT NULL,
        status             TEXT NOT NULL,      -- 'ok' | 'error'
        detail             TEXT NOT NULL,      -- JSON diagnostics
        PRIMARY KEY (cik, derivation_version)
    );
    CREATE TABLE snapshot_capture (
        day          TEXT NOT NULL,          -- session date the value describes (ET)
        symbol       TEXT NOT NULL,
        metric       TEXT NOT NULL,
        provider     TEXT NOT NULL,
        value        REAL NOT NULL,
        retrieved_at REAL NOT NULL,
        capture_version INTEGER NOT NULL,
        PRIMARY KEY (day, symbol, metric, provider)
    ) WITHOUT ROWID;
    """,
)

SCHEMA_VERSION = len(MIGRATIONS)


def default_path() -> str:
    p = os.environ.get("FUNDAMENTALS_PIT_DB_PATH")
    if p:
        return p
    if os.path.isdir("/data"):
        return "/data/fundamentals_pit.db"
    return os.path.join(os.getcwd(), "fundamentals_pit.db")


class SchemaTooNew(RuntimeError):
    pass


def connect(path: str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or default_path(), timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    migrate(conn)
    return conn


def migrate(conn: sqlite3.Connection) -> int:
    have = conn.execute("PRAGMA user_version").fetchone()[0]
    if have > SCHEMA_VERSION:
        raise SchemaTooNew(f"database schema v{have} is newer than this build (v{SCHEMA_VERSION})")
    for i in range(have, SCHEMA_VERSION):
        with conn:                               # one transaction per migration
            conn.executescript(MIGRATIONS[i])
            conn.execute(f"PRAGMA user_version = {i + 1}")
    return SCHEMA_VERSION


@contextmanager
def tx(conn: sqlite3.Connection):
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


def _ts(dt: datetime | None) -> int | None:
    return None if dt is None else int(dt.timestamp())


def _dt(ts: int | None) -> datetime | None:
    return None if ts is None else datetime.fromtimestamp(ts, tz=timezone.utc)


# ── raw truth: writes ───────────────────────────────────────────────────────
def put_filings(conn, cik: int, filings: dict[str, Filing], now: float | None = None) -> int:
    """Insert unseen accessions. A known accession whose metadata now differs
    is logged to filing_anomaly and the ORIGINAL row stands."""
    now = time.time() if now is None else now
    new = 0
    existing = {r[0]: r for r in conn.execute(
        "SELECT accn, form, filing_date, accepted_at, public_at FROM filing WHERE cik=?", (cik,))}
    for accn, f in filings.items():
        row = (accn, f.form, f.filing_date.isoformat(), _ts(f.accepted_at), _ts(f.public_at))
        old = existing.get(accn)
        if old is None:
            conn.execute("INSERT OR IGNORE INTO filing VALUES (?,?,?,?,?,?,?,?,?)",
                         (accn, cik, f.form, f.filing_date.isoformat(),
                          f.report_date.isoformat() if f.report_date else None,
                          _ts(f.accepted_at), _ts(f.public_at), "submissions", now))
            new += 1
        elif tuple(old) != row:
            conn.execute("INSERT INTO filing_anomaly VALUES (?,?,?)",
                         (accn, now, json.dumps({"stored": list(old), "seen": list(row)})))
    return new


def put_facts(conn, cik: int, facts: list[Fact], now: float | None = None) -> int:
    now = time.time() if now is None else now
    before = conn.total_changes
    conn.executemany(
        "INSERT OR IGNORE INTO fact VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [(cik, f.tag, f.unit, f.start.isoformat() if f.start else "", f.end.isoformat(), f.val,
          f.accn, f.form, f.filed.isoformat(), f.fy, f.fp, f.frame, now) for f in facts])
    return conn.total_changes - before


def put_signals(conn, rows: list[tuple], source: str, now: float | None = None) -> int:
    """rows: (accn, tag, period_start_iso, period_end_iso, kind)."""
    now = time.time() if now is None else now
    before = conn.total_changes
    conn.executemany("INSERT OR IGNORE INTO filing_signal VALUES (?,?,?,?,?,?,?)",
                     [(a, t, s, e, k, source, now) for a, t, s, e, k in rows])
    return conn.total_changes - before


def put_splits(conn, rows: list[tuple], source: str, now: float | None = None) -> int:
    """rows: (ticker, ex_date_iso, ratio, source_ref)."""
    now = time.time() if now is None else now
    before = conn.total_changes
    conn.executemany("INSERT OR IGNORE INTO split_event VALUES (?,?,?,?,?,?)",
                     [(t.upper(), d, float(r), source, ref, now) for t, d, r, ref in rows])
    return conn.total_changes - before


def put_security(conn, cik: int, name: str | None, tickers: list[str], fye: str | None,
                 now: float | None = None) -> None:
    now = time.time() if now is None else now
    conn.execute("INSERT INTO security VALUES (?,?,?,?,?) ON CONFLICT(cik) DO UPDATE SET "
                 "name=excluded.name, tickers=excluded.tickers, fye=excluded.fye, updated_at=excluded.updated_at",
                 (cik, name, json.dumps([t.upper() for t in tickers]), fye, now))
    for t in tickers:
        conn.execute("INSERT INTO ticker_map VALUES (?,?,?,?) ON CONFLICT(ticker, cik) DO UPDATE SET "
                     "last_seen_at=excluded.last_seen_at", (t.upper(), cik, now, now))


def set_ingest_state(conn, cik: int, cf_sha: str | None, sub_sha: str | None, facts_seen: int,
                     error: str | None = None, now: float | None = None) -> None:
    now = time.time() if now is None else now
    conn.execute("INSERT INTO ingest_state VALUES (?,?,?,?,?,?) ON CONFLICT(cik) DO UPDATE SET "
                 "companyfacts_sha=excluded.companyfacts_sha, submissions_sha=excluded.submissions_sha, "
                 "facts_seen=excluded.facts_seen, last_ingested_at=excluded.last_ingested_at, "
                 "last_error=excluded.last_error", (cik, cf_sha, sub_sha, facts_seen, now, error))


# ── raw truth: reads ────────────────────────────────────────────────────────
def get_ingest_state(conn, cik: int) -> dict | None:
    r = conn.execute("SELECT companyfacts_sha, submissions_sha, facts_seen, last_ingested_at, last_error "
                     "FROM ingest_state WHERE cik=?", (cik,)).fetchone()
    return None if r is None else dict(zip(("companyfacts_sha", "submissions_sha", "facts_seen",
                                            "last_ingested_at", "last_error"), r))


def load_filings(conn, cik: int) -> dict[str, Filing]:
    out = {}
    for accn, form, fd, rd, acc, pub in conn.execute(
            "SELECT accn, form, filing_date, report_date, accepted_at, public_at FROM filing WHERE cik=?", (cik,)):
        out[accn] = Filing(accn=accn, form=form, filing_date=date.fromisoformat(fd),
                           report_date=date.fromisoformat(rd) if rd else None,
                           accepted_at=_dt(acc), public_at=_dt(pub))
    return out


def load_facts(conn, cik: int, tags: set[str] | None = None) -> list[Fact]:
    out = []
    for tag, unit, ps, pe, val, accn, form, filed, fy, fp, frame in conn.execute(
            "SELECT tag, unit, period_start, period_end, val, accn, form, filed, fy, fp, frame "
            "FROM fact WHERE cik=?", (cik,)):
        if tags is not None and tag not in tags:
            continue
        tax, _, concept = tag.partition(":")
        out.append(Fact(taxonomy=tax, concept=concept, unit=unit,
                        start=date.fromisoformat(ps) if ps else None, end=date.fromisoformat(pe),
                        val=val, accn=accn, form=form, filed=date.fromisoformat(filed),
                        fy=fy, fp=fp, frame=frame))
    return out


def load_signals(conn, cik: int) -> list[tuple]:
    """[(public_at, start, end, tag|None)] -- epochs for knowledge.filing_epochs."""
    out = []
    for tag, ps, pe, pub in conn.execute(
            "SELECT s.tag, s.period_start, s.period_end, f.public_at FROM filing_signal s "
            "JOIN filing f ON f.accn = s.accn WHERE f.cik=?", (cik,)):
        out.append((_dt(pub), date.fromisoformat(ps), date.fromisoformat(pe), None if tag == "*" else tag))
    return out


def load_splits(conn, tickers: list[str], sources: tuple[str, ...]) -> list[tuple]:
    if not tickers:
        return []
    q = ",".join("?" * len(tickers))
    s = ",".join("?" * len(sources))
    return conn.execute(f"SELECT ticker, ex_date, ratio, source FROM split_event WHERE ticker IN ({q}) "
                        f"AND source IN ({s}) ORDER BY ex_date", (*[t.upper() for t in tickers], *sources)).fetchall()


def security(conn, cik: int) -> dict | None:
    r = conn.execute("SELECT name, tickers, fye FROM security WHERE cik=?", (cik,)).fetchone()
    return None if r is None else {"cik": cik, "name": r[0], "tickers": json.loads(r[1]), "fye": r[2]}


def cik_for_ticker(conn, ticker: str) -> int | None:
    """The CIK whose CURRENT SEC ticker list contains `ticker` (most recently
    confirmed wins if a ticker was reused)."""
    r = conn.execute("SELECT cik FROM ticker_map WHERE ticker=? ORDER BY last_seen_at DESC LIMIT 1",
                     (ticker.upper(),)).fetchone()
    return None if r is None else r[0]


# ── derived: writes/reads ───────────────────────────────────────────────────
def replace_series(conn, cik: int, version: int, series: dict, input_hash: str, detail: dict,
                   status: str = "ok", now: float | None = None) -> int:
    """Atomically replace ONE derivation version's points for a CIK. Other
    versions -- including the one currently served -- are untouched."""
    now = time.time() if now is None else now
    conn.execute("DELETE FROM series_point WHERE cik=? AND derivation_version=?", (cik, version))
    rows = []
    for metric, pts in series.items():
        for p in pts:
            rows.append((cik, metric, version, int(p.t_eff.timestamp()), float(p.v), p.period_end.isoformat(),
                         p.method, json.dumps([[s[0], s[1].isoformat() if s[1] else None,
                                                s[2].isoformat() if s[2] else None, s[3]] for s in p.sources])))
    conn.executemany("INSERT OR REPLACE INTO series_point VALUES (?,?,?,?,?,?,?,?)", rows)
    conn.execute("INSERT INTO series_build VALUES (?,?,?,?,?,?) ON CONFLICT(cik, derivation_version) DO UPDATE SET "
                 "built_at=excluded.built_at, input_hash=excluded.input_hash, status=excluded.status, "
                 "detail=excluded.detail", (cik, version, now, input_hash, status, json.dumps(detail, default=str)))
    return len(rows)


def read_series(conn, cik: int, version: int, metrics: list[str] | None = None) -> dict[str, list[tuple]]:
    """{metric: [(t_eff, v, period_end, method)]} ascending by t_eff."""
    out: dict[str, list[tuple]] = {}
    if metrics:
        q = ",".join("?" * len(metrics))
        cur = conn.execute(f"SELECT metric, t_eff, v, period_end, method FROM series_point WHERE cik=? "
                           f"AND derivation_version=? AND metric IN ({q}) ORDER BY metric, t_eff",
                           (cik, version, *metrics))
    else:
        cur = conn.execute("SELECT metric, t_eff, v, period_end, method FROM series_point WHERE cik=? "
                           "AND derivation_version=? ORDER BY metric, t_eff", (cik, version))
    for m, t, v, pe, meth in cur:
        out.setdefault(m, []).append((t, v, pe, meth))
    return out


def build_info(conn, cik: int, version: int) -> dict | None:
    r = conn.execute("SELECT built_at, input_hash, status, detail FROM series_build WHERE cik=? AND "
                     "derivation_version=?", (cik, version)).fetchone()
    return None if r is None else {"built_at": r[0], "input_hash": r[1], "status": r[2], "detail": json.loads(r[3])}

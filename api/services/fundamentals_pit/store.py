"""The point-in-time fundamentals store (SQLite, worker-owned).

TWO KINDS OF TABLE, TWO RULES:

  RAW TRUTH -- append-only. Never UPDATE, never DELETE.
    filing          one row per accession (10-K/10-Q family, or any filing that
                    carries a retained fact); metadata frozen at first sight. A
                    later sighting that disagrees goes to filing_anomaly.
    fact            one row per (cik, concept, unit, period, filing, value).
                    INSERT OR IGNORE: re-ingesting a document is a no-op, a
                    restated value is a NEW row, the original is never lost.
    filing_signal   restatement evidence from a filing's own XBRL dimensions.
    split_event     split rows per source; a disagreeing source is a new row.
    snapshot_capture  provider snapshot values captured going forward (a
                    separate dataset -- NOT point-in-time SEC fundamentals).

  DERIVED -- rebuildable from raw truth at any time.
    series_point    sparse PIT observations keyed by derivation_version; a new
                    derivation never overwrites the one being served. `sources`
                    is the compact list of accessions the value came from; the
                    full fact-level provenance is reproduced on demand by
                    re-deriving (derive.explain), which also proves determinism.
    series_build    per (cik, derivation_version): input hash, status, detail.

  STATE -- security, ticker_map, ingest_state, signal_check, pending_refresh,
           publish_log.

Compact on purpose (MEASURED on the UCT universe, 3,503 companies): text-keyed
facts + JSON provenance per point took 2.86 GB; integer concept/filing ids and
integer dates are the difference.

Numbered migrations recorded in PRAGMA user_version; a database written by a
NEWER build is refused rather than silently downgraded.
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
    # 1 -- initial schema
    """
    CREATE TABLE filing (
        filing_id    INTEGER PRIMARY KEY,
        accn         TEXT NOT NULL UNIQUE,
        cik          INTEGER NOT NULL,
        form         TEXT NOT NULL,
        filing_date  INTEGER NOT NULL,    -- yyyymmdd
        report_date  INTEGER,             -- yyyymmdd
        accepted_at  INTEGER,             -- unix seconds UTC, NULL if unknown
        public_at    INTEGER NOT NULL,    -- unix seconds UTC (filings.public_at)
        first_seen_at INTEGER NOT NULL
    );
    CREATE INDEX filing_cik ON filing(cik, public_at);
    CREATE TABLE filing_anomaly (accn TEXT NOT NULL, seen_at INTEGER NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE concept (concept_id INTEGER PRIMARY KEY, tag TEXT NOT NULL UNIQUE);
    CREATE TABLE fact (
        cik          INTEGER NOT NULL,
        concept_id   INTEGER NOT NULL,
        unit         TEXT NOT NULL,
        period_end   INTEGER NOT NULL,    -- yyyymmdd
        period_start INTEGER NOT NULL,    -- yyyymmdd; 0 = instant
        filing_id    INTEGER NOT NULL,
        val          REAL NOT NULL,
        first_seen_at INTEGER NOT NULL,
        PRIMARY KEY (cik, concept_id, unit, period_end, period_start, filing_id, val)
    ) WITHOUT ROWID;
    CREATE TABLE filing_signal (
        accn         TEXT NOT NULL,
        tag          TEXT NOT NULL,       -- '*' = whole filing
        period_start INTEGER NOT NULL,
        period_end   INTEGER NOT NULL,
        kind         TEXT NOT NULL,       -- 'restatement_axis'
        source       TEXT NOT NULL,       -- 'fs_dataset:2022q1.zip' | 'instance'
        first_seen_at INTEGER NOT NULL,
        PRIMARY KEY (accn, tag, period_start, period_end, kind)
    ) WITHOUT ROWID;
    CREATE TABLE split_event (
        ticker       TEXT NOT NULL,
        ex_date      TEXT NOT NULL,
        ratio        REAL NOT NULL,       -- new shares per old share
        source       TEXT NOT NULL,       -- 'massive' (production) | named fixture sources
        source_ref   TEXT,
        first_seen_at INTEGER NOT NULL,
        PRIMARY KEY (ticker, ex_date, ratio, source)
    ) WITHOUT ROWID;
    CREATE TABLE security (
        cik INTEGER PRIMARY KEY, name TEXT, tickers TEXT NOT NULL, fye TEXT, updated_at INTEGER NOT NULL
    );
    CREATE TABLE ticker_map (
        ticker TEXT NOT NULL, cik INTEGER NOT NULL,
        first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
        PRIMARY KEY (ticker, cik)
    ) WITHOUT ROWID;
    CREATE TABLE ingest_state (
        cik INTEGER PRIMARY KEY, companyfacts_sha TEXT, submissions_sha TEXT,
        facts_seen INTEGER, unjoined INTEGER, last_ingested_at INTEGER, last_error TEXT
    );
    CREATE TABLE series_point (
        cik                INTEGER NOT NULL,
        metric             TEXT NOT NULL,
        derivation_version INTEGER NOT NULL,
        t_eff              INTEGER NOT NULL,   -- unix seconds UTC: filing public_at
        v                  REAL NOT NULL,
        period_end         INTEGER NOT NULL,   -- yyyymmdd
        method             TEXT NOT NULL,
        sources            TEXT NOT NULL,      -- accessions, comma-separated
        PRIMARY KEY (cik, metric, derivation_version, t_eff)
    ) WITHOUT ROWID;
    CREATE TABLE series_build (
        cik INTEGER NOT NULL, derivation_version INTEGER NOT NULL, built_at INTEGER NOT NULL,
        input_hash TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL,
        PRIMARY KEY (cik, derivation_version)
    );
    CREATE TABLE snapshot_capture (
        day TEXT NOT NULL, symbol TEXT NOT NULL, metric TEXT NOT NULL, provider TEXT NOT NULL,
        value REAL NOT NULL, retrieved_at INTEGER NOT NULL, capture_version INTEGER NOT NULL,
        PRIMARY KEY (day, symbol, metric, provider)
    ) WITHOUT ROWID;
    """,
    # 2 -- incremental ingestion bookkeeping
    """
    CREATE TABLE signal_check (
        accn TEXT PRIMARY KEY, checked_at INTEGER NOT NULL, n_signals INTEGER NOT NULL, source TEXT NOT NULL
    );
    CREATE TABLE pending_refresh (
        cik INTEGER NOT NULL, accn TEXT NOT NULL, first_seen_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL, last_error TEXT, PRIMARY KEY (cik, accn)
    );
    CREATE TABLE publish_log (
        cik INTEGER NOT NULL, derivation_version INTEGER NOT NULL, etag TEXT NOT NULL,
        published_at INTEGER NOT NULL, target TEXT NOT NULL, PRIMARY KEY (cik, derivation_version, target)
    );
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


def connect(path: str | None = None, readonly: bool = False) -> sqlite3.Connection:
    p = path or default_path()
    if readonly:
        conn = sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=30)
        have = conn.execute("PRAGMA user_version").fetchone()[0]
        if have != SCHEMA_VERSION:
            raise SchemaTooNew(f"database schema v{have}, build expects v{SCHEMA_VERSION}")
        return conn
    conn = sqlite3.connect(p, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
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


# ── encoding helpers ────────────────────────────────────────────────────────
def _ts(dt: datetime | None) -> int | None:
    return None if dt is None else int(dt.timestamp())


def _dt(ts: int | None) -> datetime | None:
    return None if ts is None else datetime.fromtimestamp(ts, tz=timezone.utc)


def ymd(d: date | None) -> int:
    return 0 if d is None else d.year * 10000 + d.month * 100 + d.day


def from_ymd(n: int | None) -> date | None:
    return None if not n else date(n // 10000, n // 100 % 100, n % 100)


def _concept_ids(conn, tags) -> dict[str, int]:
    tags = set(tags)
    conn.executemany("INSERT OR IGNORE INTO concept(tag) VALUES (?)", [(t,) for t in tags])
    q = ",".join("?" * len(tags)) or "''"
    return dict(conn.execute(f"SELECT tag, concept_id FROM concept WHERE tag IN ({q})", tuple(tags)))


# ── raw truth: writes ───────────────────────────────────────────────────────
def put_filings(conn, cik: int, filings: dict[str, Filing], now: float | None = None) -> int:
    """Insert unseen accessions. A known accession whose metadata now differs
    is logged to filing_anomaly and the ORIGINAL row stands."""
    now = int(time.time() if now is None else now)
    new = 0
    existing = {r[0]: tuple(r) for r in conn.execute(
        "SELECT accn, form, filing_date, accepted_at, public_at FROM filing WHERE cik=?", (cik,))}
    rows = []
    for accn, f in filings.items():
        row = (accn, f.form, ymd(f.filing_date), _ts(f.accepted_at), _ts(f.public_at))
        old = existing.get(accn)
        if old is None:
            rows.append((accn, cik, f.form, ymd(f.filing_date), ymd(f.report_date) or None,
                         _ts(f.accepted_at), _ts(f.public_at), now))
        elif old != row:
            conn.execute("INSERT INTO filing_anomaly VALUES (?,?,?)",
                         (accn, now, json.dumps({"stored": list(old), "seen": list(row)})))
    before = conn.total_changes
    conn.executemany("INSERT OR IGNORE INTO filing(accn, cik, form, filing_date, report_date, accepted_at, "
                     "public_at, first_seen_at) VALUES (?,?,?,?,?,?,?,?)", rows)
    new = conn.total_changes - before
    return new


def put_facts(conn, cik: int, facts: list[Fact], now: float | None = None) -> int:
    """Facts whose accession is not a stored filing cannot be dated and are
    NOT stored (counted as unjoined by the caller)."""
    now = int(time.time() if now is None else now)
    fid = dict(conn.execute("SELECT accn, filing_id FROM filing WHERE cik=?", (cik,)))
    cid = _concept_ids(conn, {f.tag for f in facts})
    before = conn.total_changes
    conn.executemany("INSERT OR IGNORE INTO fact VALUES (?,?,?,?,?,?,?,?)",
                     [(cik, cid[f.tag], f.unit, ymd(f.end), ymd(f.start), fid[f.accn], f.val, now)
                      for f in facts if f.accn in fid])
    return conn.total_changes - before


def put_signals(conn, rows: list[tuple], source: str, now: float | None = None) -> int:
    """rows: (accn, tag, period_start_iso, period_end_iso, kind)."""
    now = int(time.time() if now is None else now)
    before = conn.total_changes
    conn.executemany("INSERT OR IGNORE INTO filing_signal VALUES (?,?,?,?,?,?,?)",
                     [(a, t, ymd(date.fromisoformat(s)), ymd(date.fromisoformat(e)), k, source, now)
                      for a, t, s, e, k in rows])
    return conn.total_changes - before


def put_splits(conn, rows: list[tuple], source: str, now: float | None = None) -> int:
    """rows: (ticker, ex_date_iso, ratio, source_ref)."""
    now = int(time.time() if now is None else now)
    before = conn.total_changes
    conn.executemany("INSERT OR IGNORE INTO split_event VALUES (?,?,?,?,?,?)",
                     [(t.upper(), d, float(r), source, ref, now) for t, d, r, ref in rows])
    return conn.total_changes - before


def put_security(conn, cik: int, name: str | None, tickers: list[str], fye: str | None,
                 now: float | None = None) -> None:
    now = int(time.time() if now is None else now)
    conn.execute("INSERT INTO security VALUES (?,?,?,?,?) ON CONFLICT(cik) DO UPDATE SET "
                 "name=excluded.name, tickers=excluded.tickers, fye=excluded.fye, updated_at=excluded.updated_at",
                 (cik, name, json.dumps([t.upper() for t in tickers]), fye, now))
    for t in tickers:
        conn.execute("INSERT INTO ticker_map VALUES (?,?,?,?) ON CONFLICT(ticker, cik) DO UPDATE SET "
                     "last_seen_at=excluded.last_seen_at", (t.upper(), cik, now, now))


def set_ingest_state(conn, cik: int, cf_sha: str | None, sub_sha: str | None, facts_seen: int,
                     error: str | None = None, now: float | None = None, unjoined: int = 0) -> None:
    now = int(time.time() if now is None else now)
    conn.execute("INSERT INTO ingest_state VALUES (?,?,?,?,?,?,?) ON CONFLICT(cik) DO UPDATE SET "
                 "companyfacts_sha=excluded.companyfacts_sha, submissions_sha=excluded.submissions_sha, "
                 "facts_seen=excluded.facts_seen, unjoined=excluded.unjoined, "
                 "last_ingested_at=excluded.last_ingested_at, last_error=excluded.last_error",
                 (cik, cf_sha, sub_sha, facts_seen, unjoined, now, error))


# ── raw truth: reads ────────────────────────────────────────────────────────
def get_ingest_state(conn, cik: int) -> dict | None:
    r = conn.execute("SELECT companyfacts_sha, submissions_sha, facts_seen, last_ingested_at, last_error "
                     "FROM ingest_state WHERE cik=?", (cik,)).fetchone()
    return None if r is None else dict(zip(("companyfacts_sha", "submissions_sha", "facts_seen",
                                            "last_ingested_at", "last_error"), r))


def _filing(accn, form, fd, rd, acc, pub) -> Filing:
    return Filing(accn=accn, form=form, filing_date=from_ymd(fd), report_date=from_ymd(rd),
                  accepted_at=_dt(acc), public_at=_dt(pub))


def load_filings(conn, cik: int) -> dict[str, Filing]:
    return {r[0]: _filing(*r) for r in conn.execute(
        "SELECT accn, form, filing_date, report_date, accepted_at, public_at FROM filing WHERE cik=?", (cik,))}


def load_facts(conn, cik: int, tags: set[str] | None = None) -> list[Fact]:
    out = []
    for tag, unit, ps, pe, val, accn, form, fd in conn.execute(
            "SELECT c.tag, f.unit, f.period_start, f.period_end, f.val, g.accn, g.form, g.filing_date "
            "FROM fact f JOIN concept c ON c.concept_id=f.concept_id JOIN filing g ON g.filing_id=f.filing_id "
            "WHERE f.cik=?", (cik,)):
        if tags is not None and tag not in tags:
            continue
        tax, _, concept = tag.partition(":")
        out.append(Fact(taxonomy=tax, concept=concept, unit=unit, start=from_ymd(ps), end=from_ymd(pe),
                        val=val, accn=accn, form=form, filed=from_ymd(fd), fy=None, fp=None, frame=None))
    return out


def load_signals(conn, cik: int) -> list[tuple]:
    """[(public_at, start, end, tag|None)] -- epochs for knowledge.filing_epochs."""
    return [(_dt(pub), from_ymd(ps), from_ymd(pe), None if tag == "*" else tag)
            for tag, ps, pe, pub in conn.execute(
                "SELECT s.tag, s.period_start, s.period_end, f.public_at FROM filing_signal s "
                "JOIN filing f ON f.accn = s.accn WHERE f.cik=?", (cik,))]


def load_splits(conn, tickers: list[str], sources: tuple[str, ...]) -> list[tuple]:
    if not tickers or not sources:
        return []
    q = ",".join("?" * len(tickers))
    s = ",".join("?" * len(sources))
    return conn.execute(f"SELECT ticker, ex_date, ratio, source FROM split_event WHERE ticker IN ({q}) "
                        f"AND source IN ({s}) ORDER BY ex_date, ticker",
                        (*[t.upper() for t in tickers], *sources)).fetchall()


def security(conn, cik: int) -> dict | None:
    r = conn.execute("SELECT name, tickers, fye FROM security WHERE cik=?", (cik,)).fetchone()
    return None if r is None else {"cik": cik, "name": r[0], "tickers": json.loads(r[1]), "fye": r[2]}


def cik_for_ticker(conn, ticker: str) -> int | None:
    """The CIK whose CURRENT SEC ticker list contains `ticker` (most recently
    confirmed wins if a ticker was reused)."""
    r = conn.execute("SELECT cik FROM ticker_map WHERE ticker=? ORDER BY last_seen_at DESC LIMIT 1",
                     (ticker.upper(),)).fetchone()
    return None if r is None else r[0]


# ── derived ─────────────────────────────────────────────────────────────────
def replace_series(conn, cik: int, version: int, series: dict, input_hash: str, detail: dict,
                   status: str = "ok", now: float | None = None) -> int:
    """Atomically replace ONE derivation version's points for a CIK. Other
    versions -- including the one currently served -- are untouched."""
    now = int(time.time() if now is None else now)
    conn.execute("DELETE FROM series_point WHERE cik=? AND derivation_version=?", (cik, version))
    rows = []
    for metric, pts in series.items():
        for p in pts:
            accns = sorted({s[3] for s in p.sources if s[3]})
            # A GAP (series.GAP) is stored as 0.0 because `v` is NOT NULL; it is
            # decoded back to None in `read_series`, the ONE reader -- never read
            # `v` without `method`.
            v = 0.0 if p.method == "gap" else float(p.v)
            rows.append((cik, metric, version, int(p.t_eff.timestamp()), v, ymd(p.period_end),
                         p.method, ",".join(accns)))
    conn.executemany("INSERT OR REPLACE INTO series_point VALUES (?,?,?,?,?,?,?,?)", rows)
    conn.execute("INSERT INTO series_build VALUES (?,?,?,?,?,?) ON CONFLICT(cik, derivation_version) DO UPDATE SET "
                 "built_at=excluded.built_at, input_hash=excluded.input_hash, status=excluded.status, "
                 "detail=excluded.detail", (cik, version, now, input_hash, status, json.dumps(detail, default=str)))
    return len(rows)


def read_series(conn, cik: int, version: int, metrics: list[str] | None = None) -> dict[str, list[tuple]]:
    """{metric: [(t_eff, v, period_end_iso, method)]} ascending by t_eff. A gap has v None."""
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
        out.setdefault(m, []).append((t, None if meth == "gap" else v, from_ymd(pe).isoformat(), meth))
    return out


def point_sources(conn, cik: int, metric: str, version: int, t_eff: int) -> list[str]:
    r = conn.execute("SELECT sources FROM series_point WHERE cik=? AND metric=? AND derivation_version=? "
                     "AND t_eff=?", (cik, metric, version, t_eff)).fetchone()
    return [] if r is None or not r[0] else r[0].split(",")


def build_info(conn, cik: int, version: int) -> dict | None:
    r = conn.execute("SELECT built_at, input_hash, status, detail FROM series_build WHERE cik=? AND "
                     "derivation_version=?", (cik, version)).fetchone()
    return None if r is None else {"built_at": r[0], "input_hash": r[1], "status": r[2], "detail": json.loads(r[3])}

"""Universe percentile store for UCT Ratings (Phase 2).

Owns ``/data/research_ratings.db``: the per-ticker raw rankable metric values
gathered nightly across ``cap_universe`` plus the resulting universe
distributions. ``ratings.py`` reads the distributions to turn each ticker's raw
metric into a TRUE 1-99 percentile rank vs the universe (IBD/MarketSmith-style),
falling back to absolute bands when no distribution exists.

Design notes:
- WAL + ``contextlib.closing`` on every connection (Windows-safe teardown,
  mirrors ``tweet_store``); reads stay lock-free.
- Never raises to callers — read helpers degrade to ``None``/empty so the
  rating read-path always has a safe absolute-band fallback.
- Distributions are parsed once and memoized in-process for 10 min so the hot
  request path never re-reads/re-parses SQLite per rating.

Metric columns stored per ticker (all "higher = stronger" EXCEPT ``peg`` /
``pe_fwd`` which are ranked inverted by the reader):
  earnings_growth, rev_growth, blended_growth, rs_return, peg, pe_fwd,
  op_margin, roe, inst_pct, accdis_ratio
"""
from __future__ import annotations

import bisect
import contextlib
import json
import logging
import os
import sqlite3
import threading
import time

_logger = logging.getLogger(__name__)

_DEFAULT_DB_PATH = (
    "/data/research_ratings.db" if os.path.isdir("/data")
    else os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "research_ratings.db")
)
DB_PATH = os.environ.get("RESEARCH_RATINGS_DB_PATH", _DEFAULT_DB_PATH)

# Raw metric columns persisted per ticker.
METRIC_COLUMNS = (
    "earnings_growth", "rev_growth", "blended_growth", "rs_return",
    "peg", "pe_fwd", "op_margin", "roe", "inst_pct", "accdis_ratio",
)

# Distributions to build (column -> ranked ascending). The reader inverts the
# orientation for value metrics (lower peg = stronger).
_DIST_COLUMNS = (
    "earnings_growth", "rev_growth", "blended_growth", "rs_return",
    "peg", "op_margin", "roe", "inst_pct", "accdis_ratio",
)

# Per-sector distributions (Sector RS): metrics ranked WITHIN each GICS sector.
_SECTOR_DIST_COLUMNS = ("rs_return",)

# A distribution needs at least this many real samples to be trusted.
MIN_SAMPLE = int(os.environ.get("RATINGS_PERCENTILE_MIN_SAMPLE", "200"))
# Sectors are smaller pools (~11 GICS buckets) so the gate is lower.
SECTOR_MIN_SAMPLE = int(os.environ.get("RATINGS_SECTOR_MIN_SAMPLE", "15"))

_DIST_MEMO_TTL = 600  # 10 min in-process memo for the parsed distributions
_memo_lock = threading.Lock()
_memo: dict | None = None
_memo_at: float = 0.0
_sector_memo: dict | None = None
_sector_memo_at: float = 0.0
# monotonic clock is import-safe (unlike Date.now-style wall clock concerns);
# time.time is used only for human-readable stamps written to the DB.


@contextlib.contextmanager
def _conn():
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=30)
    try:
        c.row_factory = sqlite3.Row
        with contextlib.closing(c):
            yield c
    finally:
        pass


def init_db() -> None:
    """Idempotent schema init. Safe to call on every startup."""
    cols = ",\n        ".join(f"{c} REAL" for c in METRIC_COLUMNS)
    with _conn() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        c.executescript(
            f"""
            CREATE TABLE IF NOT EXISTS ticker_metrics (
                sym TEXT PRIMARY KEY,
                {cols},
                updated_at REAL
            );
            CREATE TABLE IF NOT EXISTS metric_distributions (
                metric TEXT PRIMARY KEY,
                sorted_values TEXT,   -- JSON array of floats, ascending
                n INTEGER,
                computed_at REAL
            );
            CREATE TABLE IF NOT EXISTS sector_distributions (
                sector TEXT,
                metric TEXT,
                sorted_values TEXT,   -- JSON array of floats, ascending
                n INTEGER,
                computed_at REAL,
                PRIMARY KEY (sector, metric)
            );
            """
        )
        # Migration: add the `sector` column to an existing ticker_metrics table.
        cols = {r["name"] for r in c.execute("PRAGMA table_info(ticker_metrics)").fetchall()}
        if "sector" not in cols:
            c.execute("ALTER TABLE ticker_metrics ADD COLUMN sector TEXT")
        c.commit()


def upsert_metrics(sym: str, metrics: dict) -> None:
    """Insert/replace one ticker's raw metric values. Never raises."""
    sym = (sym or "").upper().strip()
    if not sym:
        return
    try:
        vals = [metrics.get(col) for col in METRIC_COLUMNS]
        sector = metrics.get("sector")
        placeholders = ", ".join(["?"] * (len(METRIC_COLUMNS) + 3))
        collist = ", ".join(("sym", *METRIC_COLUMNS, "sector", "updated_at"))
        with _conn() as c:
            c.execute(
                f"INSERT OR REPLACE INTO ticker_metrics ({collist}) VALUES ({placeholders})",
                [sym, *vals, sector, time.time()],
            )
            c.commit()
    except Exception as exc:  # pragma: no cover - defensive
        _logger.warning("ratings_db upsert failed for %s: %s", sym, exc)


def get_fresh_syms(max_age_seconds: float) -> set[str]:
    """Symbols whose metrics were refreshed within max_age_seconds (skip set)."""
    cutoff = time.time() - max_age_seconds
    try:
        with _conn() as c:
            rows = c.execute(
                "SELECT sym FROM ticker_metrics WHERE updated_at >= ?", (cutoff,)
            ).fetchall()
        return {r["sym"] for r in rows}
    except Exception:
        return set()


def rebuild_distributions() -> dict:
    """Recompute every metric distribution from all stored ticker rows.

    Returns a per-metric ``{n}`` summary. Distributions with fewer than
    MIN_SAMPLE real values are still written (n recorded) but the reader treats
    them as unusable. Invalidates the in-process memo.
    """
    summary: dict = {}
    try:
        with _conn() as c:
            for col in _DIST_COLUMNS:
                rows = c.execute(
                    f"SELECT {col} AS v FROM ticker_metrics WHERE {col} IS NOT NULL"
                ).fetchall()
                values = sorted(float(r["v"]) for r in rows)
                c.execute(
                    "INSERT OR REPLACE INTO metric_distributions (metric, sorted_values, n, computed_at) "
                    "VALUES (?, ?, ?, ?)",
                    (col, json.dumps(values), len(values), time.time()),
                )
                summary[col] = len(values)

            # Per-sector distributions (Sector RS): group each metric by sector.
            for col in _SECTOR_DIST_COLUMNS:
                rows = c.execute(
                    f"SELECT sector, {col} AS v FROM ticker_metrics "
                    f"WHERE sector IS NOT NULL AND {col} IS NOT NULL"
                ).fetchall()
                by_sector: dict[str, list[float]] = {}
                for r in rows:
                    by_sector.setdefault(r["sector"], []).append(float(r["v"]))
                for sector, vals in by_sector.items():
                    vals.sort()
                    c.execute(
                        "INSERT OR REPLACE INTO sector_distributions "
                        "(sector, metric, sorted_values, n, computed_at) VALUES (?, ?, ?, ?, ?)",
                        (sector, col, json.dumps(vals), len(vals), time.time()),
                    )
                summary[f"sectors::{col}"] = len(by_sector)
            c.commit()
    except Exception as exc:
        _logger.warning("ratings_db rebuild_distributions failed: %s", exc)
        return {}
    _invalidate_memo()
    return summary


def _invalidate_memo() -> None:
    global _memo, _memo_at, _sector_memo, _sector_memo_at
    with _memo_lock:
        _memo = None
        _memo_at = 0.0
        _sector_memo = None
        _sector_memo_at = 0.0


def get_distributions() -> dict:
    """Parsed distributions ``{metric: {"values": [...], "n": int, "computed_at": float}}``.

    Memoized in-process for _DIST_MEMO_TTL so the request path is cheap. Returns
    {} if the DB is missing/empty — callers must treat {} as "use absolute bands".
    """
    global _memo, _memo_at
    now = time.monotonic()
    with _memo_lock:
        if _memo is not None and (now - _memo_at) < _DIST_MEMO_TTL:
            return _memo
    parsed: dict = {}
    try:
        with _conn() as c:
            rows = c.execute(
                "SELECT metric, sorted_values, n, computed_at FROM metric_distributions"
            ).fetchall()
        for r in rows:
            try:
                values = json.loads(r["sorted_values"]) or []
            except (TypeError, ValueError):
                values = []
            parsed[r["metric"]] = {"values": values, "n": int(r["n"] or 0), "computed_at": r["computed_at"]}
    except Exception:
        parsed = {}
    with _memo_lock:
        _memo = parsed
        _memo_at = now
    return parsed


def _rank(values: list, value: float) -> int:
    """1-99 percentile of ``value`` within ascending ``values`` (higher = higher rank)."""
    n = len(values)
    # position = how many universe values are <= value (midpoint of equal band)
    lo = bisect.bisect_left(values, value)
    hi = bisect.bisect_right(values, value)
    pos = (lo + hi) / 2.0
    pct = pos / n  # 0..1
    return max(1, min(99, round(pct * 98 + 1)))


def percentile(metric: str, value, dists: dict | None = None, invert: bool = False):
    """True 1-99 universe percentile for ``value`` on ``metric``.

    Returns ``None`` when no usable distribution exists (caller falls back to
    absolute bands). ``invert=True`` ranks lower-is-better metrics (e.g. PEG).
    Pass ``dists`` from ``get_distributions()`` to avoid a per-call DB read.
    """
    if value is None:
        return None
    if dists is None:
        dists = get_distributions()
    d = dists.get(metric)
    if not d:
        return None
    values = d.get("values") or []
    if len(values) < MIN_SAMPLE:
        return None
    try:
        rank = _rank(values, float(value))
    except (TypeError, ValueError):
        return None
    if invert:
        return max(1, min(99, 100 - rank))
    return rank


def get_sector_distributions() -> dict:
    """Parsed per-sector distributions ``{sector: {metric: {"values","n"}}}``.

    Memoized for _DIST_MEMO_TTL. Returns {} if none — caller skips Sector RS.
    """
    global _sector_memo, _sector_memo_at
    now = time.monotonic()
    with _memo_lock:
        if _sector_memo is not None and (now - _sector_memo_at) < _DIST_MEMO_TTL:
            return _sector_memo
    parsed: dict = {}
    try:
        with _conn() as c:
            rows = c.execute(
                "SELECT sector, metric, sorted_values, n FROM sector_distributions"
            ).fetchall()
        for r in rows:
            try:
                values = json.loads(r["sorted_values"]) or []
            except (TypeError, ValueError):
                values = []
            parsed.setdefault(r["sector"], {})[r["metric"]] = {"values": values, "n": int(r["n"] or 0)}
    except Exception:
        parsed = {}
    with _memo_lock:
        _sector_memo = parsed
        _sector_memo_at = now
    return parsed


def sector_percentile(sector: str, metric: str, value, sdists: dict | None = None):
    """1-99 rank of ``value`` for ``metric`` WITHIN its sector. None if the
    sector pool is missing or below SECTOR_MIN_SAMPLE."""
    if value is None or not sector:
        return None
    if sdists is None:
        sdists = get_sector_distributions()
    d = (sdists.get(sector) or {}).get(metric)
    if not d:
        return None
    values = d.get("values") or []
    if len(values) < SECTOR_MIN_SAMPLE:
        return None
    try:
        return _rank(values, float(value))
    except (TypeError, ValueError):
        return None


def sector_count(sector: str, metric: str = "rs_return", sdists: dict | None = None):
    """How many universe names populate this sector's distribution (the 'of N')."""
    if not sector:
        return None
    if sdists is None:
        sdists = get_sector_distributions()
    d = (sdists.get(sector) or {}).get(metric)
    return d.get("n") if d else None


def status() -> dict:
    """Coverage summary for the admin endpoint. Never raises."""
    try:
        with _conn() as c:
            total = c.execute("SELECT COUNT(*) AS n FROM ticker_metrics").fetchone()["n"]
            dist_rows = c.execute(
                "SELECT metric, n, computed_at FROM metric_distributions ORDER BY metric"
            ).fetchall()
        dists = {r["metric"]: {"n": r["n"], "computed_at": r["computed_at"]} for r in dist_rows}
        computed_ats = [r["computed_at"] for r in dist_rows if r["computed_at"]]
        with _conn() as c:
            sec_rows = c.execute(
                "SELECT sector, n FROM sector_distributions WHERE metric='rs_return' ORDER BY n DESC"
            ).fetchall()
        sectors = {r["sector"]: r["n"] for r in sec_rows}
        return {
            "tickers_stored": total,
            "min_sample": MIN_SAMPLE,
            "sector_min_sample": SECTOR_MIN_SAMPLE,
            "distributions": dists,
            "sectors": sectors,
            "sectors_usable": sum(1 for n in sectors.values() if (n or 0) >= SECTOR_MIN_SAMPLE),
            "last_computed_at": max(computed_ats) if computed_ats else None,
            "usable": any((v["n"] or 0) >= MIN_SAMPLE for v in dists.values()),
            "db_path": DB_PATH,
        }
    except Exception as exc:
        return {"tickers_stored": 0, "distributions": {}, "usable": False, "error": str(exc)}

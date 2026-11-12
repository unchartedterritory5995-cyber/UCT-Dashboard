"""Real-user speed measurement (desktop speed plan Step 10.1, owner OK 2026-11-11).

Every page load in a browser or the desktop app may send ONE small report
(`app/src/lib/perfBeacon.js`): how long the page took to become usable and how
long each `/api/*` call took, measured by the member's own browser. This is the
instrument that tells us which pages are slow for which members, so speed work
is aimed at what members actually feel instead of at the owner's PC.

NUMBERS AND ENUMS ONLY, so there is nothing to scrub
----------------------------------------------------
A field is either a whole number of milliseconds in a sane range, a member of a
fixed set, or matches a short anchored pattern of lowercase words. Anything else
REFUSES the report (counted `invalid`), never cleans it:

  * `page`     `/` + the first path segment only (`/charts`, `/options-flow`);
               never a ticker, id or query string
  * `client`   `browser` or `desktop`
  * timings    `ttfb`, `fcp`, `lcp`, `dom_ready`, `load`, `long_task_ms`
               (0..MAX_MS), `long_tasks` (count)
  * `api`      up to MAX_API entries of `{route, ms, ok}`: `route` is
               `/api/<word>` or `/api/<word>/<word>` where a word is lowercase
               letters, digits after the first letter, `-` or `_` in the first
               segment and letters and `-` only in the second (no digits, so no
               ids); `ms` 0..MAX_MS; `ok` true/false
  * country    from Cloudflare's `CF-IPCountry` header (two letters), never from
               the body; nothing finer than a country is stored

No member id, no IP, no URL ever reaches a row. The rate limit keys on a salted
hash of the IP, stored only to count.

Storage and bounds
------------------
Own SQLite file `PERF_BEACON_DB_PATH` (default `<DATA_DIR>/perf_beacon.db`,
read at call time). Rows kept RETENTION_DAYS, pruned on write at most hourly;
loads hard-capped at MAX_LOADS (oldest deleted in the same transaction).

Kill switch
-----------
`PERF_BEACON_ENABLED`: unset or anything but `0/false/no/off` means ON. OFF
answers `{enabled: false}` (the page stops sending) and never deletes a row.
"""
from __future__ import annotations

import hashlib
import math
import os
import re
import sqlite3
import threading
import time
from typing import Any

KILL_SWITCH = "PERF_BEACON_ENABLED"
_OFF_VALUES = frozenset({"0", "false", "no", "off"})

CLIENTS = frozenset({"browser", "desktop"})
# `candles` = when the page's first chart had its bars (the `uct:first-chart-paint` mark); absent on
# pages without a chart. Added after the first deploy: `_connect` adds the column to an older store.
TIMINGS = ("ttfb", "fcp", "lcp", "dom_ready", "load", "long_task_ms", "candles")
MAX_MS = 120_000
MAX_LONG_TASKS = 10_000
MAX_API = 40
MAX_BODY_BYTES = 8 * 1024
RATE_LIMIT = 60                # loads per IP hash per hour
GLOBAL_LIMIT_PER_HOUR = 50_000
MAX_LOADS = 300_000
RETENTION_DAYS = 30
PRUNE_EVERY_S = 3600
_SALT = "perf_beacon"

_PAGE_RE = re.compile(r"/[a-z0-9-]{0,40}")
_API_RE = re.compile(r"/api/[a-z][a-z0-9_-]{0,40}(?:/[a-z][a-z-]{0,40})?")
_COUNTRY_RE = re.compile(r"[A-Z]{2}")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS perf_loads (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   REAL NOT NULL,
    page         TEXT NOT NULL,
    client       TEXT NOT NULL,
    country      TEXT NOT NULL DEFAULT '',
    ttfb         INTEGER, fcp INTEGER, lcp INTEGER, dom_ready INTEGER, load INTEGER,
    long_task_ms INTEGER, long_tasks INTEGER, candles INTEGER,
    rate_key     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_perf_loads_created ON perf_loads(created_at);
CREATE INDEX IF NOT EXISTS ix_perf_loads_rate ON perf_loads(rate_key, created_at);
CREATE TABLE IF NOT EXISTS perf_api (
    load_id  INTEGER NOT NULL REFERENCES perf_loads(id) ON DELETE CASCADE,
    route    TEXT NOT NULL,
    ms       INTEGER NOT NULL,
    ok       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_perf_api_load ON perf_api(load_id);
"""

_lock = threading.Lock()
_last_prune = 0.0
_migrated: set[str] = set()  # store paths already checked for columns added after the first deploy


def enabled() -> bool:
    return (os.environ.get(KILL_SWITCH) or "").strip().lower() not in _OFF_VALUES


def _db_path() -> str:
    explicit = os.environ.get("PERF_BEACON_DB_PATH")
    if explicit:
        return explicit
    return os.path.join(os.environ.get("DATA_DIR") or "/data", "perf_beacon.db")


def _connect() -> sqlite3.Connection:
    path = _db_path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    conn = sqlite3.connect(path, timeout=2.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=2000")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(_SCHEMA)
    if path not in _migrated:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(perf_loads)")}
        if "candles" not in cols:
            conn.execute("ALTER TABLE perf_loads ADD COLUMN candles INTEGER")
        _migrated.add(path)
    return conn


def _ms(v: Any, cap: int = MAX_MS) -> int | None:
    """A whole number of ms in range, None when absent; raises ValueError on anything else."""
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ValueError("not a number")
    if v < 0 or v > cap:
        raise ValueError("out of range")
    return int(round(v))


def validate(report: Any) -> dict[str, Any]:
    """The stored shape, or ValueError. Pure: no I/O."""
    if not isinstance(report, dict):
        raise ValueError("not an object")
    page = report.get("page")
    if not isinstance(page, str) or not _PAGE_RE.fullmatch(page):
        raise ValueError("page")
    client = report.get("client")
    if client not in CLIENTS:
        raise ValueError("client")
    out: dict[str, Any] = {"page": page, "client": client}
    for k in TIMINGS:
        out[k] = _ms(report.get(k))
    out["long_tasks"] = _ms(report.get("long_tasks"), MAX_LONG_TASKS)
    api = report.get("api") or []
    if not isinstance(api, list) or len(api) > MAX_API:
        raise ValueError("api")
    calls = []
    for a in api:
        if not isinstance(a, dict):
            raise ValueError("api entry")
        route = a.get("route")
        if not isinstance(route, str) or not _API_RE.fullmatch(route):
            raise ValueError("api route")
        ms = _ms(a.get("ms"))
        if ms is None or not isinstance(a.get("ok"), bool):
            raise ValueError("api entry")
        calls.append((route, ms, 1 if a["ok"] else 0))
    out["api"] = calls
    return out


def country_from(header: str | None) -> str:
    v = (header or "").strip().upper()
    return v if _COUNTRY_RE.fullmatch(v) else ""


def _rate_key(ip: str | None) -> str:
    return hashlib.sha256(f"{_SALT}:{ip or 'unknown'}".encode()).hexdigest()[:24]


def record(report: Any, *, ip: str | None, country_header: str | None, now: float | None = None) -> dict[str, int]:
    """Store one page-load report. {'stored','dropped','invalid'}; never raises for bad input."""
    global _last_prune
    now = time.time() if now is None else now
    try:
        row = validate(report)
    except ValueError:
        return {"stored": 0, "dropped": 0, "invalid": 1}
    key = _rate_key(ip)
    with _lock:
        conn = _connect()
        try:
            hour_ago = now - 3600
            mine = conn.execute("SELECT COUNT(*) FROM perf_loads WHERE rate_key=? AND created_at>?", (key, hour_ago)).fetchone()[0]
            if mine >= RATE_LIMIT:
                return {"stored": 0, "dropped": 1, "invalid": 0}
            total = conn.execute("SELECT COUNT(*) FROM perf_loads WHERE created_at>?", (hour_ago,)).fetchone()[0]
            if total >= GLOBAL_LIMIT_PER_HOUR:
                return {"stored": 0, "dropped": 1, "invalid": 0}
            with conn:
                cur = conn.execute(
                    f"INSERT INTO perf_loads (created_at,page,client,country,{','.join(TIMINGS)},long_tasks,rate_key)"
                    f" VALUES (?,?,?,?,{','.join('?' * len(TIMINGS))},?,?)",
                    (now, row["page"], row["client"], country_from(country_header), *(row[k] for k in TIMINGS),
                     row["long_tasks"], key))
                load_id = cur.lastrowid
                conn.executemany("INSERT INTO perf_api (load_id,route,ms,ok) VALUES (?,?,?,?)",
                                 [(load_id, r, ms, ok) for r, ms, ok in row["api"]])
                over = conn.execute("SELECT COUNT(*) FROM perf_loads").fetchone()[0] - MAX_LOADS
                if over > 0:
                    conn.execute("DELETE FROM perf_loads WHERE id IN (SELECT id FROM perf_loads ORDER BY id LIMIT ?)", (over,))
                if now - _last_prune > PRUNE_EVERY_S:
                    conn.execute("DELETE FROM perf_loads WHERE created_at < ?", (now - RETENTION_DAYS * 86400,))
                    _last_prune = now
            return {"stored": 1, "dropped": 0, "invalid": 0}
        finally:
            conn.close()


def _pct(values: list[int], p: float) -> int | None:
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    k = max(0, min(len(vals) - 1, math.ceil(p / 100 * len(vals)) - 1))
    return vals[k]


def summary(hours: int = 24, now: float | None = None) -> dict[str, Any]:
    """Per page and client: count and p50/p75/p95 of each timing; per API route: count, p50, p95, failure share;
    per country: count and p75 lcp. The admin read of 10.1."""
    now = time.time() if now is None else now
    since = now - hours * 3600
    conn = _connect()
    try:
        loads = conn.execute(
            f"SELECT page, client, country, {', '.join(TIMINGS)} FROM perf_loads WHERE created_at > ?",
            (since,)).fetchall()
        api = conn.execute(
            "SELECT a.route, a.ms, a.ok FROM perf_api a JOIN perf_loads l ON l.id = a.load_id WHERE l.created_at > ?",
            (since,)).fetchall()
    finally:
        conn.close()
    pages: dict[tuple[str, str], list] = {}
    countries: dict[str, list] = {}
    for page, client, country, *t in loads:
        pages.setdefault((page, client), []).append(t)
        countries.setdefault(country or "??", []).append(t[2])
    page_rows = []
    for (page, client), rows in sorted(pages.items(), key=lambda kv: -len(kv[1])):
        entry: dict[str, Any] = {"page": page, "client": client, "loads": len(rows)}
        for i, name in enumerate(TIMINGS):
            col = [r[i] for r in rows]
            entry[name] = {"p50": _pct(col, 50), "p75": _pct(col, 75), "p95": _pct(col, 95)}
        page_rows.append(entry)
    routes: dict[str, list] = {}
    for route, ms, ok in api:
        routes.setdefault(route, []).append((ms, ok))
    api_rows = sorted(
        ({"route": r, "calls": len(v), "p50": _pct([m for m, _ in v], 50), "p95": _pct([m for m, _ in v], 95),
          "failed_pct": round(100 * sum(1 for _, ok in v if not ok) / len(v), 1)} for r, v in routes.items()),
        key=lambda x: -(x["p95"] or 0))
    country_rows = sorted(({"country": c, "loads": len(v), "lcp_p75": _pct(v, 75)} for c, v in countries.items()),
                          key=lambda x: -x["loads"])
    return {"hours": hours, "loads": len(loads), "pages": page_rows, "api": api_rows, "countries": country_rows}

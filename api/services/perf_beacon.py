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

Chart-switch speed: the second kind of report (2026-11-23)
----------------------------------------------------------
The goal is "key press to the charts drawn in under 40 ms for every member", and
nothing measured it outside a test rig. The page now counts it
(`app/src/lib/switchSpeed.js`) and sends the COUNTS when it is hidden or left:
`{page, client, kind: "switches", switches: {v, cells, counters}}`, where

  * `cells`     up to MAX_SWITCH_CELLS lists of exactly 16 whole numbers: five
                indexes (timeframe class, device store on, trigger, route, inside
                the regular session: SWITCH_TF / 0-1 / SWITCH_TRIGGER /
                SWITCH_ROUTE / 0-1) and one count per time bucket
                (SWITCH_BUCKET_EDGES_MS: 0-16, 16-25, 25-33, 33-40, 40-50 ... 500+)
  * `counters`  one whole number per SWITCH_COUNTERS: switches that gave no
                sample, by why

INTEGERS ONLY. No ticker, no list, nothing typed: there is no field a string
could sit in. An unknown key, a string, a fraction, a count over
MAX_SWITCH_COUNT, more than MAX_SWITCH_TOTAL switches in all, an index outside
its list, a cell twice or too many cells REFUSES the whole report. The lists
here are the page's own, pinned equal by tests/test_perf_beacon.py.

The door is anonymous, so a sender can invent counts. What bounds one sender's
weight in a pooled share: SWITCH_RATE_LIMIT reports an hour, each of at most
MAX_SWITCH_TOTAL switches. `reports` / `reports_all_under` count each report
once whatever it claims, so they are the read that an inflated report cannot move.

What is kept is a MERGE, never a report: per ET day, client and combination, the
summed counts, how many reports added to them and in how many of those every
switch was under 40 ms (`perf_switch_days`), and the summed counters
(`perf_switch_counters`). Nothing per page load, per member or per switch
exists to be read back. `perf_switch_sends` holds a time and the salted hash for
one hour, only to count the quota (SWITCH_RATE_LIMIT).

Storage and bounds
------------------
Own SQLite file `PERF_BEACON_DB_PATH` (default `<DATA_DIR>/perf_beacon.db`,
read at call time). Rows kept RETENTION_DAYS, pruned on write at most hourly;
loads hard-capped at MAX_LOADS (oldest deleted in the same transaction). The
switch days are kept SWITCH_RETENTION_DAYS (at most one row per day, client and
combination, so they are bounded by the calendar).

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
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

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

# -- chart-switch speed (the module docstring says what each is; app/src/lib/switchSpeed.js holds the same lists) --
KINDS = frozenset({"load", "switches"})
SWITCH_VERSION = 1
SWITCH_TF = ("intraday-1m", "intraday-other", "daily-plus")
SWITCH_TRIGGER = ("list-key", "click", "typed", "other")
SWITCH_ROUTE = ("other", "decision", "now", "deferred", "daily-hold", "prepare")
SWITCH_BUCKET_EDGES_MS = (16, 25, 33, 40, 50, 66, 100, 150, 250, 500)
SWITCH_UNDER_MS = 40
SWITCH_COUNTERS = ("superseded", "abandoned", "unpressed", "untracked", "unclocked", "overflow")
MAX_SWITCH_CELLS = 64
MAX_SWITCH_COUNT = 100_000
MAX_SWITCH_TOTAL = 20_000      # every count of one report together: more than a page can make between two sends
SWITCH_RATE_LIMIT = 30         # switch reports per IP hash per hour (the page sends at most one per 5 minutes)
SWITCH_RETENTION_DAYS = 90
_SWITCH_DIMS = (len(SWITCH_TF), 2, len(SWITCH_TRIGGER), len(SWITCH_ROUTE), 2)
_SWITCH_NB = len(SWITCH_BUCKET_EDGES_MS) + 1
_SWITCH_UNDER = SWITCH_BUCKET_EDGES_MS.index(SWITCH_UNDER_MS) + 1   # the buckets wholly under SWITCH_UNDER_MS
_SWITCH_B = tuple(f"b{i}" for i in range(_SWITCH_NB))
_SWITCH_KEY = ("day", "client", "tf", "dev_store", "trig", "route", "rth")
_ET = ZoneInfo("America/New_York")

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
""" + f"""
CREATE TABLE IF NOT EXISTS perf_switch_days (
    day        TEXT NOT NULL,
    client     TEXT NOT NULL,
    tf         INTEGER NOT NULL,
    dev_store  INTEGER NOT NULL,
    trig       INTEGER NOT NULL,
    route      INTEGER NOT NULL,
    rth        INTEGER NOT NULL,
    {", ".join(f"{b} INTEGER NOT NULL" for b in _SWITCH_B)},
    reports    INTEGER NOT NULL,
    reports_all_under INTEGER NOT NULL,
    PRIMARY KEY ({", ".join(_SWITCH_KEY)})
);
CREATE TABLE IF NOT EXISTS perf_switch_counters (
    day     TEXT NOT NULL,
    client  TEXT NOT NULL,
    name    TEXT NOT NULL,
    n       INTEGER NOT NULL,
    PRIMARY KEY (day, client, name)
);
CREATE TABLE IF NOT EXISTS perf_switch_sends (
    created_at REAL NOT NULL,
    rate_key   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_perf_switch_sends ON perf_switch_sends(rate_key, created_at);
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


def _whole(v: Any, cap: int) -> int:
    """A whole number 0..cap exactly as JSON carried it (never a bool, a fraction or a string), or ValueError."""
    if type(v) is not int or v < 0 or v > cap:
        raise ValueError("not a whole number in range")
    return v


def validate_switches(sw: Any) -> dict[str, Any]:
    """The `switches` field as {'cells': [(key, counts)], 'counters': [...]}, or ValueError. Pure: no I/O.
    Exactly the keys v / cells / counters, and whole numbers in range everywhere: there is nothing to clean."""
    if not isinstance(sw, dict) or set(sw) != {"v", "cells", "counters"}:
        raise ValueError("switches keys")
    if type(sw["v"]) is not int or sw["v"] != SWITCH_VERSION:
        raise ValueError("switches version")
    cells, counters = sw["cells"], sw["counters"]
    if not isinstance(cells, list) or len(cells) > MAX_SWITCH_CELLS:
        raise ValueError("switches cells")
    if not isinstance(counters, list) or len(counters) != len(SWITCH_COUNTERS):
        raise ValueError("switches counters")
    out, seen = [], set()
    for c in cells:
        if not isinstance(c, list) or len(c) != len(_SWITCH_DIMS) + _SWITCH_NB:
            raise ValueError("switch cell")
        key = tuple(_whole(v, size - 1) for v, size in zip(c, _SWITCH_DIMS))
        counts = [_whole(v, MAX_SWITCH_COUNT) for v in c[len(_SWITCH_DIMS):]]
        if key in seen or not any(counts):
            raise ValueError("switch cell twice or empty")
        seen.add(key)
        out.append((key, counts))
    if sum(sum(counts) for _, counts in out) > MAX_SWITCH_TOTAL:
        raise ValueError("switches total")
    totals = [_whole(v, MAX_SWITCH_COUNT) for v in counters]
    if not out and not any(totals):
        raise ValueError("switches empty")
    return {"cells": out, "counters": totals}


def validate_switch_report(report: Any) -> dict[str, Any]:
    """A `kind: "switches"` report, or ValueError: page, client, kind and switches, and nothing else."""
    if not isinstance(report, dict) or set(report) != {"page", "client", "kind", "switches"}:
        raise ValueError("switch report keys")
    page = report["page"]
    if not isinstance(page, str) or not _PAGE_RE.fullmatch(page):
        raise ValueError("page")
    client = report["client"]
    if not isinstance(client, str) or client not in CLIENTS:
        raise ValueError("client")
    return {"client": client, **validate_switches(report["switches"])}


def report_kind(report: Any) -> str:
    """'load' (no `kind`: every page-load report) or 'switches'; ValueError for anything else."""
    if not isinstance(report, dict):
        raise ValueError("not an object")
    kind = report.get("kind", "load")
    if not isinstance(kind, str) or kind not in KINDS:
        raise ValueError("kind")
    return kind


def switch_day(now: float) -> str:
    """The ET calendar day a report is merged under (when it ARRIVED: a session's switches land on its day)."""
    return datetime.fromtimestamp(now, _ET).strftime("%Y-%m-%d")


def country_from(header: str | None) -> str:
    v = (header or "").strip().upper()
    return v if _COUNTRY_RE.fullmatch(v) else ""


def _rate_key(ip: str | None) -> str:
    return hashlib.sha256(f"{_SALT}:{ip or 'unknown'}".encode()).hexdigest()[:24]


def _prune(conn: sqlite3.Connection, now: float) -> None:
    conn.execute("DELETE FROM perf_loads WHERE created_at < ?", (now - RETENTION_DAYS * 86400,))
    first = switch_day(now - SWITCH_RETENTION_DAYS * 86400)
    conn.execute("DELETE FROM perf_switch_days WHERE day < ?", (first,))
    conn.execute("DELETE FROM perf_switch_counters WHERE day < ?", (first,))


_SWITCH_UPSERT = (
    f"INSERT INTO perf_switch_days ({', '.join(_SWITCH_KEY)}, {', '.join(_SWITCH_B)}, reports, reports_all_under)"
    f" VALUES ({', '.join('?' * (len(_SWITCH_KEY) + _SWITCH_NB))}, 1, ?)"
    f" ON CONFLICT({', '.join(_SWITCH_KEY)}) DO UPDATE SET "
    + ", ".join(f"{b} = {b} + excluded.{b}" for b in _SWITCH_B)
    + ", reports = reports + 1, reports_all_under = reports_all_under + excluded.reports_all_under"
)


def _record_switches(row: dict[str, Any], key: str, now: float) -> dict[str, int]:
    """Merge one switches report into its day. Its own hourly quota per IP hash, and the global one."""
    global _last_prune
    with _lock:
        conn = _connect()
        try:
            hour_ago = now - 3600
            mine = conn.execute("SELECT COUNT(*) FROM perf_switch_sends WHERE rate_key=? AND created_at>?", (key, hour_ago)).fetchone()[0]
            if mine >= SWITCH_RATE_LIMIT:
                return {"stored": 0, "dropped": 1, "invalid": 0}
            total = conn.execute("SELECT COUNT(*) FROM perf_switch_sends WHERE created_at>?", (hour_ago,)).fetchone()[0]
            if total >= GLOBAL_LIMIT_PER_HOUR:
                return {"stored": 0, "dropped": 1, "invalid": 0}
            day, client = switch_day(now), row["client"]
            with conn:
                conn.execute("DELETE FROM perf_switch_sends WHERE created_at <= ?", (hour_ago,))
                conn.execute("INSERT INTO perf_switch_sends (created_at, rate_key) VALUES (?,?)", (now, key))
                for cell, counts in row["cells"]:
                    all_under = 0 if any(counts[_SWITCH_UNDER:]) else 1
                    conn.execute(_SWITCH_UPSERT, (day, client, *cell, *counts, all_under))
                conn.executemany(
                    "INSERT INTO perf_switch_counters (day, client, name, n) VALUES (?,?,?,?)"
                    " ON CONFLICT(day, client, name) DO UPDATE SET n = n + excluded.n",
                    [(day, client, name, n) for name, n in zip(SWITCH_COUNTERS, row["counters"]) if n])
                if now - _last_prune > PRUNE_EVERY_S:
                    _prune(conn, now)
                    _last_prune = now
            return {"stored": 1, "dropped": 0, "invalid": 0}
        finally:
            conn.close()


def record(report: Any, *, ip: str | None, country_header: str | None, now: float | None = None) -> dict[str, int]:
    """Store one report: a page load, or the chart-switch counts (`kind`). {'stored','dropped','invalid'};
    never raises for bad input."""
    global _last_prune
    now = time.time() if now is None else now
    try:
        kind = report_kind(report)
        row = validate_switch_report(report) if kind == "switches" else validate(report)
    except ValueError:
        return {"stored": 0, "dropped": 0, "invalid": 1}
    key = _rate_key(ip)
    if kind == "switches":
        return _record_switches(row, key, now)
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
                    _prune(conn, now)
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


def _under(counts: list[int]) -> tuple[int, int, float | None]:
    total, under = sum(counts), sum(counts[:_SWITCH_UNDER])
    return total, under, (round(100 * under / total, 1) if total else None)


def switch_summary(days: int = 7, now: float | None = None) -> dict[str, Any]:
    """The chart-switch read: for each of the last `days` ET days (today included), the merged histogram of every
    combination with its share under SWITCH_UNDER_MS, and the day's totals and counters.

    `cells[]`: day, client, tf, store, trigger, route, rth (the names, never the indexes), `n` (a count per bucket of
    `bucket_edges_ms`, the last being "that and above"), `switches`, `under_40`, `under_40_pct`, `reports` (how many
    reports added to the cell) and `reports_all_under_40` (in how many of them EVERY switch of the cell was under).
    `by_day[]`: the same totals over every combination and client, and each SWITCH_COUNTERS sum."""
    now = time.time() if now is None else now
    first = switch_day(now - (max(1, days) - 1) * 86400)
    conn = _connect()
    try:
        rows = conn.execute(
            f"SELECT {', '.join(_SWITCH_KEY)}, {', '.join(_SWITCH_B)}, reports, reports_all_under FROM perf_switch_days"
            f" WHERE day >= ? ORDER BY day DESC, {', '.join(_SWITCH_KEY[1:])}", (first,)).fetchall()
        counter_rows = conn.execute(
            "SELECT day, name, SUM(n) FROM perf_switch_counters WHERE day >= ? GROUP BY day, name", (first,)).fetchall()
    finally:
        conn.close()
    cells: list[dict[str, Any]] = []
    day_counts: dict[str, list[int]] = {}
    for day, client, tf, dev_store, trig, route, rth, *rest in rows:
        counts, reports, all_under = list(rest[:_SWITCH_NB]), rest[_SWITCH_NB], rest[_SWITCH_NB + 1]
        total, under, pct = _under(counts)
        cells.append({
            "day": day, "client": client, "tf": SWITCH_TF[tf], "store": bool(dev_store), "trigger": SWITCH_TRIGGER[trig],
            "route": SWITCH_ROUTE[route], "rth": bool(rth), "n": counts, "switches": total, "under_40": under,
            "under_40_pct": pct, "reports": reports, "reports_all_under_40": all_under})
        merged = day_counts.setdefault(day, [0] * _SWITCH_NB)
        for i, n in enumerate(counts):
            merged[i] += n
    counters: dict[str, dict[str, int]] = {}
    for day, name, n in counter_rows:
        counters.setdefault(day, {})[name] = n
    by_day = []
    for day in sorted(set(day_counts) | set(counters), reverse=True):
        total, under, pct = _under(day_counts.get(day, [0] * _SWITCH_NB))
        by_day.append({"day": day, "switches": total, "under_40": under, "under_40_pct": pct,
                       **{name: counters.get(day, {}).get(name, 0) for name in SWITCH_COUNTERS}})
    return {"days": days, "bucket_edges_ms": list(SWITCH_BUCKET_EDGES_MS), "under_ms": SWITCH_UNDER_MS,
            "by_day": by_day, "cells": cells}

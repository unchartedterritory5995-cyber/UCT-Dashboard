"""Single-stock leveraged/inverse ETF family map.

Spec: docs/superpowers/specs/2026-07-21-single-stock-etf-switcher-design.md.
Shape mirrors industry_map.py (bulk Finviz export -> /data SQLite) with
deliberate divergences: fail-closed validation gates, per-run meta record,
no empty-table self-heal cooldown bypass, and auth-token log redaction.
"""
from __future__ import annotations

import contextlib
import csv
import io
import json
import logging
import os
import re
import sqlite3
import threading
import time
from typing import Optional

import httpx

from api.services import chart_health_alerts
from api.services.ssetf_parser import parse_etf_name

logger = logging.getLogger(__name__)

# Exact header names asserted on EVERY rebuild (spec §3.4 gate 1).
EXPECTED_HEADERS = ["Ticker", "Company", "Sector", "Industry", "Average Volume", "Price"]
_EXPORT_COLS = "1,2,3,4,63,65"  # ids config; headers are the runtime contract

# Finviz export "Average Volume" is in THOUSANDS of shares (probe-pinned
# 2026-07-22: SPY=52138.11, NVDL=22100.86 — the decimals prove the unit; raw
# share counts would be ~1000x larger integers). Scale to real shares so
# avg_dollar_vol is real DOLLARS — required for ranking consistency with the
# §3.3 bars backfill (close×volume = real $); with mixed units one
# bars_fallback row would out-rank every finviz-sourced row ~1000x.
_FINVIZ_AVG_VOL_SCALE = 1000.0


def _num(v) -> Optional[float]:
    """Finviz numeric: '1,234,567' | '12.34' | '-' | '' -> float | None.
    Unparseable NEVER coerces to 0 — zeros feed the liquidity gate (spec §3.4)."""
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if not s or s in ("-", "n/a", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _fetch_finviz_market() -> list[dict]:
    """Whole-market export (~11k rows) — ETF rows + stock membership in one call.
    Token passed via params and NEVER logged (redaction test-pinned)."""
    token = os.environ.get("FINVIZ_API_KEY", "")
    if not token:
        logger.warning("[ssetf] FINVIZ_API_KEY not set — fetch skipped")
        return []
    url = "https://elite.finviz.com/export.ashx"
    try:
        r = httpx.get(
            url,
            params={"v": "152", "c": _EXPORT_COLS, "auth": token},
            headers={"User-Agent": "Mozilla/5.0", "Accept": "text/csv"},
            timeout=90.0,
            follow_redirects=True,
        )
        r.raise_for_status()
        return list(csv.DictReader(io.StringIO(r.text)))
    except httpx.HTTPStatusError as e:
        logger.warning("[ssetf] Finviz fetch failed: HTTP %s (url redacted)",
                       e.response.status_code)
        return []
    except Exception as e:
        logger.warning("[ssetf] Finviz fetch failed: %s", type(e).__name__)
        return []


# ── Store ────────────────────────────────────────────────────────────────────

def _resolve_db_path() -> str:
    """`SSETF_DB_PATH` wins; else the shared volume; else repo-relative.

    ⭐ SHAPE, NOT DESTINATION. The shared-volume literal is now the env
    read's DEFAULT instead of a bare `return` one statement later. That is
    the one shape `conftest.shared_data_root_census` pairs on its own
    (derivation A, which needs no shared word), so this path is pinned by
    DERIVATION rather than by a hand-written `EXPLICIT_ENV_PINS` entry.
    Unset, both branches return exactly the strings the two-statement
    version returned. The one behavioural delta is deliberate and matches
    every other pinned path in this repo (`WIRE_DATA_FILE`,
    `DESK_PHOTO_DIR`, `DORMANT_TICKERS_PATH`): `SSETF_DB_PATH=""` is now an
    empty override rather than a silent fall-through to the default.
    """
    if os.path.isdir("/data"):
        return os.environ.get("SSETF_DB_PATH", "/data/single_stock_etfs.db")
    here = os.path.join(os.path.dirname(__file__), "..", "..", "data")
    return os.environ.get(
        "SSETF_DB_PATH", os.path.join(here, "single_stock_etfs.db"))


_WRITE_LOCK = threading.Lock()
_REBUILD_LOCK = threading.Lock()          # single-flight across ALL triggers
_INIT_DONE = False
_INIT_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS etfs (
  etf_ticker TEXT PRIMARY KEY, underlying TEXT NOT NULL, direction TEXT NOT NULL,
  factor REAL NOT NULL, name TEXT NOT NULL, price REAL, avg_volume REAL,
  avg_dollar_vol REAL, vol_source TEXT, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_etfs_underlying ON etfs(underlying);
CREATE TABLE IF NOT EXISTS overrides (
  etf_ticker TEXT PRIMARY KEY, action TEXT NOT NULL,
  underlying TEXT, direction TEXT, factor REAL, note TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS quarantine (
  etf_ticker TEXT PRIMARY KEY, name TEXT, reason TEXT, seen_at INTEGER
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
"""


def _db_path() -> str:
    return _resolve_db_path()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_init() -> None:
    global _INIT_DONE
    with _INIT_LOCK:
        if _INIT_DONE and os.path.exists(_db_path()):
            return
        parent = os.path.dirname(_db_path())
        if parent:
            os.makedirs(parent, exist_ok=True)
        with contextlib.closing(_connect()) as c:
            c.executescript(_SCHEMA)
            c.commit()
        _INIT_DONE = True


@contextlib.contextmanager
def _write_conn():
    _ensure_init()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        yield c
        c.commit()


def _meta_set(k: str, v) -> None:
    with _write_conn() as c:
        c.execute("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
                  (k, json.dumps(v)))


def _meta_get(k: str, default=None):
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    if row is None:
        return default
    try:
        return json.loads(row["v"])
    except Exception:
        return default


# ── Lookup (hot path: every chart symbol change) ────────────────────────

_LOOKUP_CACHE: dict[str, tuple[float, dict]] = {}
_LOOKUP_TTL = 600.0
# Hard size cap on the module-level cache. lookup() runs on the per-request path
# keyed on the (get_current_user-authed but otherwise unvalidated) {symbol}, and
# caches MISSES too, so an odd symbol stream could grow it unbounded on the single
# 512MB pod. The real key space is the ~3,742-ticker universe + their ETF tickers
# (~4-5k), so 20k leaves generous headroom for legitimate traffic while bounding
# the worst case. On overflow we drop the whole cache (simple, correct — the next
# lookups re-warm from SQLite in ~1ms) rather than track per-entry LRU.
_LOOKUP_CACHE_MAX = 20_000
_EMPTY_FAMILY = {"underlying": None, "long": [], "short": [], "best_long": None, "best_short": None}


def invalidate_cache() -> None:
    _LOOKUP_CACHE.clear()


def _row_out(r) -> dict:
    return {"ticker": r["etf_ticker"], "name": r["name"], "factor": r["factor"],
            "avg_dollar_vol": r["avg_dollar_vol"]}


def _copy_family(fam: dict) -> dict:
    """Return a fresh copy of a family dict with deep-copied lists to prevent mutation."""
    return {**fam, "long": [dict(r) for r in fam["long"]], "short": [dict(r) for r in fam["short"]]}


def lookup(symbol: str) -> dict:
    sym = (symbol or "").strip().upper()
    if not sym:
        return _copy_family(_EMPTY_FAMILY)
    hit = _LOOKUP_CACHE.get(sym)
    now = time.time()
    if hit and now - hit[0] < _LOOKUP_TTL:
        return _copy_family(hit[1])
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT underlying FROM etfs WHERE etf_ticker=?", (sym,)).fetchone()
        underlying = row["underlying"] if row else sym
        try:
            rows = c.execute(
                "SELECT * FROM etfs WHERE underlying=? "
                "ORDER BY avg_dollar_vol DESC NULLS LAST, etf_ticker",
                (underlying,),
            ).fetchall()
        except sqlite3.OperationalError:
            # Fallback for SQLite < 3.30 that doesn't support NULLS LAST
            rows = c.execute(
                "SELECT * FROM etfs WHERE underlying=? "
                "ORDER BY avg_dollar_vol IS NULL, avg_dollar_vol DESC, etf_ticker",
                (underlying,),
            ).fetchall()
    if not rows:
        out = dict(_EMPTY_FAMILY)
    else:
        longs = [_row_out(r) for r in rows if r["direction"] == "long"]
        shorts = [_row_out(r) for r in rows if r["direction"] == "short"]
        out = {"underlying": underlying, "long": longs, "short": shorts,
               "best_long": longs[0]["ticker"] if longs else None,
               "best_short": shorts[0]["ticker"] if shorts else None}
    if len(_LOOKUP_CACHE) >= _LOOKUP_CACHE_MAX:
        _LOOKUP_CACHE.clear()   # bounded worst case; re-warms from SQLite in ~1ms
    _LOOKUP_CACHE[sym] = (now, out)
    try:
        _maybe_self_heal()
    except Exception:
        pass
    return _copy_family(out)


def status() -> dict:
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        etf_count = c.execute("SELECT COUNT(*) FROM etfs").fetchone()[0]
        family_count = c.execute("SELECT COUNT(DISTINCT underlying) FROM etfs").fetchone()[0]
        quarantine = [dict(r) for r in c.execute(
            "SELECT etf_ticker, name, reason, seen_at FROM quarantine ORDER BY etf_ticker").fetchall()]
    out = {"etf_count": etf_count, "family_count": family_count, "quarantine": quarantine}
    for k in ("last_attempt_at", "last_success_at", "last_status", "last_error",
              "last_counts", "last_diff", "refusals_consecutive", "last_refusal"):
        out[k] = _meta_get(k)
    return out


# ── Self-heal constants ──────────────────────────────────────────────────────
_HEAL_STALE_SECONDS = 48 * 3600
_HEAL_COOLDOWN = 30 * 60
_HEAL_MIN_COOLDOWN = 5 * 60   # applies even when the table is EMPTY (spec §3.4)


def _enabled() -> bool:
    return os.environ.get("SINGLE_STOCK_ETFS_ENABLED", "1") == "1"


def _spawn_rebuild(trigger: str) -> None:
    threading.Thread(target=lambda: rebuild(trigger=trigger),
                     daemon=True, name="ssetf-heal").start()


def _maybe_self_heal() -> None:
    if not _enabled() or _REBUILD_LOCK.locked():
        return
    try:
        _ensure_init()
        with contextlib.closing(_connect()) as c:
            empty = c.execute("SELECT COUNT(*) FROM etfs").fetchone()[0] == 0
        last_ok = _meta_get("last_success_at", 0) or 0
        stale = (time.time() - last_ok) > _HEAL_STALE_SECONDS
        if not (empty or stale):
            return
        last_attempt = _meta_get("last_attempt_at", 0) or 0
        cooldown = _HEAL_MIN_COOLDOWN if empty else _HEAL_COOLDOWN
        if (time.time() - last_attempt) < cooldown:
            return   # NO empty-table bypass — hot lookup path (spec §3.4)
        _spawn_rebuild("self_heal")
    except Exception:
        pass


# ── Rebuild ──────────────────────────────────────────────────────────────────

_ETF_INDUSTRY = "Exchange Traded Fund"
_SHRINK_FLOOR = 0.60
_LIQ_BAD_FRACTION = 0.20


def _backfill_dollar_vol(ticker: str) -> Optional[float]:
    """Mean close*volume over the last <=20 cached daily bars; None if unknown."""
    try:
        from api.services import bars_sqlite
        bars = bars_sqlite.get_bars(ticker, "D", 20)
        if not bars:
            return None
        vals = [float(b[4]) * float(b[5]) for b in bars if b[4] and b[5]]
        return sum(vals) / len(vals) if vals else None
    except Exception:
        return None


def rebuild(force_shrink: bool = False, trigger: str = "manual") -> dict:
    if not _REBUILD_LOCK.acquire(blocking=False):
        return {"status": "already_running", "trigger": trigger}
    try:
        return _rebuild_locked(force_shrink, trigger)
    finally:
        _REBUILD_LOCK.release()


def _finish(record: dict) -> dict:
    """Stamp meta from a completed attempt; handle refusal counters + alert."""
    st = record["status"]
    _meta_set("last_status", st)
    _meta_set("last_error", record.get("error"))
    if record.get("counts") is not None:  # refusals/errors keep the prior run's counts visible
        _meta_set("last_counts", record.get("counts"))
    if st == "ok":
        _meta_set("last_success_at", record["attempt_at"])
        _meta_set("last_diff", record.get("diff"))
        _meta_set("refusals_consecutive", 0)
        invalidate_cache()
    elif st.startswith("refused"):
        n = int(_meta_get("refusals_consecutive", 0) or 0) + 1
        _meta_set("refusals_consecutive", n)
        _meta_set("last_refusal", {"ts": record["attempt_at"], "reason": st,
                                   "new_count": record.get("new_count"),
                                   "prev_count": record.get("prev_count")})
        if n == 2:  # transition-only alert (spec §3.5)
            chart_health_alerts.emit(
                "ssetf_rebuild_refused", "warning",
                f"single-stock ETF rebuild refused {n}x consecutively ({st})",
                {"reason": st, "new_count": record.get("new_count"),
                 "prev_count": record.get("prev_count")})
    logger.info("[ssetf] rebuild %s trigger=%s counts=%s",
                st, record.get("trigger"), record.get("counts"))
    return record


def _rebuild_locked(force_shrink: bool, trigger: str) -> dict:
    now = int(time.time())
    _meta_set("last_attempt_at", now)  # stamped at START of EVERY attempt
    rec: dict = {"status": "error", "trigger": trigger, "attempt_at": now}

    try:
        rows = _fetch_finviz_market()
        if not rows:
            rec["status"] = "fetch_empty"
            return _finish(rec)

        # Gate 1: header assert (catches wrong column ids AND 200-HTML login pages).
        headers = list(rows[0].keys())
        missing = [h for h in EXPECTED_HEADERS if h not in headers]
        if missing:
            rec.update(status="refused_headers", error=f"missing headers: {missing}")
            return _finish(rec)

        stock_set: dict[str, str] = {}
        etf_rows: list[dict] = []
        for r in rows:
            t = (r.get("Ticker") or "").strip().upper()
            if not t:
                continue
            if (r.get("Industry") or "").strip() == _ETF_INDUSTRY:
                etf_rows.append(r)
            else:
                stock_set[t] = (r.get("Company") or "").strip()
        if len(stock_set) < 2000:  # fail-soft membership fallback (spec §3.1)
            try:
                path = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
                with open(path, encoding="utf-8") as fh:
                    for t in json.load(fh):
                        stock_set.setdefault(str(t).upper(), "")
                logger.warning("[ssetf] stock set thin (%d) — merged cap_universe fallback", len(stock_set))
            except Exception:
                pass

        # Load overrides.
        _ensure_init()
        with contextlib.closing(_connect()) as c:
            ovr = {r["etf_ticker"]: dict(r) for r in c.execute("SELECT * FROM overrides").fetchall()}
            prev_count = c.execute("SELECT COUNT(*) FROM etfs").fetchone()[0]
            prev_map = {r["etf_ticker"]: dict(r) for r in c.execute("SELECT * FROM etfs").fetchall()}
            prev_median = _median([r["avg_dollar_vol"] for r in prev_map.values()
                                   if r["avg_dollar_vol"]])

        parsed: dict[str, dict] = {}
        quarantined: list[tuple] = []
        skipped_zero = 0
        overrides_applied = 0
        for r in etf_rows:
            t = (r.get("Ticker") or "").strip().upper()
            name = (r.get("Company") or "").strip()
            o = ovr.get(t)
            if o and o["action"] == "exclude":
                overrides_applied += 1
                continue
            res = parse_etf_name(name, t, stock_set)
            if o and o["action"] == "remap":
                overrides_applied += 1
                und, direc, fac = o["underlying"], o["direction"], o["factor"]
            elif res.status == "parsed":
                und, direc, fac = res.underlying, res.direction, res.factor
            elif res.status == "quarantine":
                quarantined.append((t, name, res.reason, now))
                continue
            else:
                if res.reason == "zero_candidates":
                    skipped_zero += 1
                continue
            price = _num(r.get("Price"))
            avg_vol = _num(r.get("Average Volume"))
            if avg_vol is not None:
                avg_vol *= _FINVIZ_AVG_VOL_SCALE  # thousands -> shares
            adv = price * avg_vol if (price and avg_vol) else None
            parsed[t] = {"etf_ticker": t, "underlying": und, "direction": direc, "factor": fac,
                         "name": name, "price": price, "avg_volume": avg_vol,
                         "avg_dollar_vol": adv, "vol_source": "finviz" if adv else "none",
                         "updated_at": now}

        # 'add' overrides: inject rows absent from the export (spec §3.5).
        for t, o in ovr.items():
            if o["action"] == "add" and t not in parsed:
                overrides_applied += 1
                parsed[t] = {"etf_ticker": t, "underlying": o["underlying"],
                             "direction": o["direction"], "factor": o["factor"],
                             "name": o["note"] or f"{t} (manual add)", "price": None,
                             "avg_volume": None, "avg_dollar_vol": None,
                             "vol_source": "none", "updated_at": now}
            elif o["action"] == "add" and t in parsed:
                overrides_applied += 1
                parsed[t].update(underlying=o["underlying"], direction=o["direction"],
                                 factor=o["factor"])  # export row wins name/price/vol

        # An 'add' override may inject a ticker this run's parser had already
        # routed to quarantine — drop it there so it never double-lands in
        # both the etfs table and the quarantine table.
        if quarantined:
            quarantined = [q for q in quarantined if q[0] not in parsed]

        new_count = len(parsed)
        rec.update(new_count=new_count, prev_count=prev_count)

        # Gate 2: liquidity (skip backfill entirely when it trips — spec §3.3).
        bad = [p for p in parsed.values() if not p["avg_dollar_vol"]]
        median_new = _median([p["avg_dollar_vol"] for p in parsed.values() if p["avg_dollar_vol"]])
        liq_tripped = (new_count > 0 and len(bad) / new_count > _LIQ_BAD_FRACTION) or \
                      (median_new == 0 and (prev_median or 0) > 0)
        if liq_tripped and not force_shrink:
            rec["status"] = "refused_liquidity"
            return _finish(rec)

        # Bounded fresh-listing backfill (Task 5 wires the real impl).
        backfilled = 0
        if not liq_tripped:
            for p in list(parsed.values()):
                if backfilled >= 25:
                    break
                if p["avg_dollar_vol"] is None:
                    adv = _backfill_dollar_vol(p["etf_ticker"])
                    if adv:
                        p["avg_dollar_vol"] = adv
                        p["vol_source"] = "bars_fallback"
                    backfilled += 1

        # Gate 3: shrink guard.
        if prev_count and new_count < prev_count * _SHRINK_FLOOR and not force_shrink:
            rec["status"] = "refused_shrink"
            return _finish(rec)

        # Diff vs previous table.
        added = sorted(set(parsed) - set(prev_map))
        removed = sorted(set(prev_map) - set(parsed))
        def _bests(m):
            out = {}
            for r in m.values():
                key = (r["underlying"], r["direction"])
                cur = out.get(key)
                if cur is None or (r["avg_dollar_vol"] or 0) > (cur[1] or 0):
                    out[key] = (r["etf_ticker"], r["avg_dollar_vol"])
            return {k: v[0] for k, v in out.items()}
        b_old, b_new = _bests(prev_map), _bests(parsed)
        best_changes = [f"{u}/{d}: {b_old.get((u, d))} -> {t}"
                        for (u, d), t in b_new.items() if b_old.get((u, d)) not in (None, t)]
        diff = {"added": added, "removed": removed, "best_changes": best_changes,
                "skipped_zero_candidate": skipped_zero,
                "new_families": sorted({p["underlying"] for p in parsed.values()} -
                                       {r["underlying"] for r in prev_map.values()})}

        # Atomic swap + quarantine rewrite in ONE transaction (spec §3.4).
        with _write_conn() as c:
            c.execute("DELETE FROM etfs")
            c.executemany(
                "INSERT INTO etfs (etf_ticker, underlying, direction, factor, name, price,"
                " avg_volume, avg_dollar_vol, vol_source, updated_at)"
                " VALUES (:etf_ticker,:underlying,:direction,:factor,:name,:price,"
                ":avg_volume,:avg_dollar_vol,:vol_source,:updated_at)",
                list(parsed.values()))
            c.execute("DELETE FROM quarantine")
            c.executemany("INSERT INTO quarantine VALUES (?,?,?,?)", quarantined)

        rec.update(status="ok", diff=diff, counts={
            "csv_rows": len(rows), "etf_rows": len(etf_rows), "parsed": len(parsed),
            "skipped_zero_candidate": skipped_zero, "quarantined": len(quarantined),
            "overrides_applied": overrides_applied, "backfilled": backfilled,
            "etfs_written": new_count,
            "families": len({p["underlying"] for p in parsed.values()})})
        return _finish(rec)
    except Exception as e:
        rec.update(status="error", error=f"{type(e).__name__}: {e}")
        return _finish(rec)


def _median(vals: list) -> float:
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return 0.0
    mid = len(vals) // 2
    return vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2

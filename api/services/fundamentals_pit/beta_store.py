"""Beta, precomputed on the WORKER -- never on a member request.

Owner ruling (2026-09-23): the historical rolling Beta is computed during
worker processing (backfill / the daily incremental pass) and member requests
only READ the result. Measured before this module: a cold AAPL request rebuilt
33 years of rolling Beta synchronously on the web pod in 589 ms.

    id           beta_1y_spy                (methodology-specific; label "Beta")
    methodology  see beta.py -- 1Y (252 aligned daily returns, >=200 required),
                 OLS slope vs SPY, split-adjusted price returns, point in time
    stored       beta_series (this store), one row per CIK
    published    fundamentals_pit/beta/v{BETA_METHOD_VERSION}/<cik>.json

IDEMPOTENT + INCREMENTAL. The input hash covers the methodology version and the
stock's and SPY's (count, last date, last close). An unchanged hash is a no-op;
a new session changes it and the row is rebuilt from the closes -- an O(n) pass
over at most BETA_MAX_BARS closes, on the worker.

MISSING PRICES are deterministic: returns are taken only on the INTERSECTION of
the two symbols' trading days (beta.aligned_returns), so a gap never fabricates
a zero return, and a window with fewer than 200 aligned returns has no value.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import time
from datetime import date

from . import store as S
from .asof import close_utc
from .beta import MIN_OBS, WINDOW, rolling_beta

BETA_ID = "beta_1y_spy"
BENCHMARK = "SPY"
BETA_METHOD_VERSION = 1
METHOD = "rolling_252d"
BETA_MAX_BARS = 8000
METHODOLOGY = {
    "id": BETA_ID, "label": "Beta", "subtitle": "1Y daily · Benchmark: SPY",
    "benchmark": BENCHMARK, "window_returns": WINDOW, "min_returns": MIN_OBS,
    "estimator": "OLS slope cov(r_s, r_b) / var(r_b)", "returns": "simple daily, aligned trading days",
    "price_basis": "split-adjusted, not dividend-adjusted", "method_version": BETA_METHOD_VERSION,
}


def bars_closes(symbol: str) -> list[tuple]:
    """[(date, close)] ascending from the process's own bars store (worker)."""
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars(symbol.upper(), "D", BETA_MAX_BARS) or []
    out = []
    for ts, _o, _h, _l, c, _v in rows:
        if c:
            n = int(ts)
            out.append((date(n // 10000, n // 100 % 100, n % 100), float(c)))
    return out


def _sig(closes: list[tuple]) -> list:
    return [len(closes), closes[-1][0].isoformat(), round(closes[-1][1], 6)] if closes else [0, None, None]


def input_hash(stock: list[tuple], bench: list[tuple]) -> str:
    return hashlib.sha256(json.dumps([BETA_METHOD_VERSION, WINDOW, MIN_OBS, _sig(stock), _sig(bench)])
                          .encode()).hexdigest()[:32]


def compute_points(stock: list[tuple], bench: list[tuple]) -> list[list]:
    """[[t_close_utc, beta], ...] -- a value is known at its session's close
    (16:00 ET), never earlier. ⚠️ TWO columns on purpose: the session date and the
    method are constant/derivable, and carrying them per point made the store
    760 MB for the universe (the SEC store is 604 MB). The client already treats
    both as optional; the method rides the document (`methodology`)."""
    if not stock or not bench:
        return []
    return [[int(close_utc(d).timestamp()), round(b, 6)]
            for d, b in rolling_beta(stock, bench) if b is not None]


def pack(points: list[list]) -> bytes:
    return gzip.compress(json.dumps(points, separators=(",", ":")).encode(), mtime=0)


def unpack(blob: bytes) -> list[list]:
    return json.loads(gzip.decompress(blob))


def primary_ticker(conn, cik: int) -> str | None:
    sec = S.security(conn, cik)
    t = (sec or {}).get("tickers") or []
    return t[0] if t else None


def refresh(conn, ciks: list[int], closes_fn=bars_closes, now: float | None = None) -> dict:
    """Recompute Beta for these companies where the inputs moved. Returns counts."""
    now = int(time.time() if now is None else now)
    bench = closes_fn(BENCHMARK)
    out = {"built": 0, "unchanged": 0, "no_ticker": 0, "no_prices": 0}
    if not bench:
        out["error"] = f"no {BENCHMARK} closes"
        return out
    for cik in ciks:
        sym = primary_ticker(conn, cik)
        if not sym:
            out["no_ticker"] += 1
            continue
        stock = closes_fn(sym)
        h = input_hash(stock, bench)
        prev = conn.execute("SELECT input_hash FROM beta_series WHERE cik=?", (cik,)).fetchone()
        if prev and prev[0] == h:
            out["unchanged"] += 1
            continue
        pts = compute_points(stock, bench)
        if not stock:
            out["no_prices"] += 1
        with S.tx(conn):
            conn.execute(
                "INSERT INTO beta_series VALUES (?,?,?,?,?,?) ON CONFLICT(cik) DO UPDATE SET "
                "symbol=excluded.symbol, through=excluded.through, input_hash=excluded.input_hash, "
                "built_at=excluded.built_at, points=excluded.points",
                (cik, sym, _day(pts[-1][0]) if pts else None, h, now, pack(pts)))
        out["built"] += 1
    return out


def read(conn, cik: int) -> dict | None:
    r = conn.execute("SELECT symbol, through, input_hash, built_at, points FROM beta_series WHERE cik=?",
                     (cik,)).fetchone()
    if not r:
        return None
    return {"v": 1, "cik": cik, "symbol": r[0], "through": r[1], "input_hash": r[2], "built_at": r[3],
            "methodology": METHODOLOGY, "method": METHOD, "points": unpack(r[4])}


def _day(t: int) -> str:
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return datetime.fromtimestamp(t, ZoneInfo("America/New_York")).date().isoformat()


def key_for(cik: int) -> str:
    """The published object is GZIP-compressed JSON (publish_beta / serving)."""
    return f"fundamentals_pit/beta/v{BETA_METHOD_VERSION}/cik/{cik}.json.gz"

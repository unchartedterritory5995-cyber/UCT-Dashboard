"""READ ONLY: UCT's published economic series (the ECON, LIQ and OIL panels) as this server's economics serving cache
already holds them.

The three panels read `GET /api/econ/latest` and `GET /api/econ/series/{symbol}` (`api/services/econ/serving.py`). On a
cold serving cache those read the econ service's published files from the data bucket (`data_sync.get_bytes`, a request
off the server) or, in the dev mode, open the econ database. A reader that must never cause a request (the UCT Agent's
`econ.latest`, `market.liquidity` and `market.oil` data kinds, MD-1 §4.22) reads through the functions below instead:
only the serving cache's own entries (the full series body `serving.latest` and a plain `serving.series` read keep under
`series:<SYMBOL>:None:None:None`, and the status heartbeat under `status`), never a load. A series the cache does not
hold is `not_held`, said; a series the store answered with nothing is `no_data`; a symbol the registry does not serve is
`not_found`. It never reads the bucket, never opens the database and never writes the cache.

  held_body(symbol)          (the full series body, how, the time the serving cache read it)
  held_latest(symbols)       `serving.latest(symbols)`'s answer built from the held bodies only, with `not_held` rows
                             (and each row's `read_at`) beside the route's own states
  held_history(symbol, days) the held body's points whose period ends within `days` of its newest

It lives beside the service and not inside it, so the service's own calls are unchanged. A rail fills the cache through
`serving.latest` itself over invented series bodies and checks `held_latest` then gives the route's own rows, and nothing
before. (`fed_watch_held.held_point` reads the same cache entry for the Fed watch's rates, MD-1 §4.18.)
"""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional


def enabled() -> bool:
    """The econ routes' own switch (`api/routers/econ.py` `_enabled`: 404 unless ECON_ENABLED=1), read per call."""
    return os.environ.get("ECON_ENABLED", "0") == "1"


def _peek(key: str):
    from api.services.econ import serving
    with serving._lock:
        return serving._cache.get(key)


def _iso(at: Optional[float]) -> Optional[str]:
    if not isinstance(at, (int, float)) or isinstance(at, bool):
        return None
    return datetime.fromtimestamp(at, tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def held_body(symbol: str) -> tuple[Optional[dict], str, Optional[float]]:
    """READ ONLY: `(body, how, cached_at)` for one series. how: `held` | `no_data` (the store answered with nothing; the
    cache keeps its miss marker) | `not_held` (the cache holds no entry) | `not_found` (the registry does not serve it).
    Never loads the series."""
    from api.services.econ import publish as P
    entry = P.resolve(symbol) if isinstance(symbol, str) else None
    if entry is None:
        return None, "not_found", None
    hit = _peek(f"series:{entry['symbol']}:None:None:None")
    if hit is None:
        return None, "not_held", None
    body = hit[1]
    if not isinstance(body, dict):
        return None, "no_data", hit[0]
    return body, "held", hit[0]


def held_status() -> dict:
    """READ ONLY: `{symbol: status row}` from the status heartbeat the serving cache holds (sanitized as the route
    sanitizes it), or {} when it holds none."""
    from api.services.econ import serving
    hit = _peek("status")
    if hit is None or not isinstance(hit[1], dict):
        return {}
    doc = serving._sanitize_status(hit[1])
    return {r["symbol"]: r for r in doc.get("series") or [] if isinstance(r, dict)}


def held_latest(symbols: Iterable[str]) -> dict:
    """READ ONLY: the answer `serving.latest(symbols)` gives, from held bodies only. Each row says `ok`, `no_data`,
    `not_found` (as the route) or `not_held` (this reader's own state: the serving cache holds no entry), with `read_at`
    (when the serving cache read it, null when not held). Never a load, never a write."""
    from api.services.econ import publish as P
    from api.services.econ import serving
    by_status = held_status()
    rows, seen, keys = [], set(), []
    for raw in list(symbols)[:serving.LATEST_MAX_SYMBOLS]:
        entry = P.resolve(raw) if isinstance(raw, str) else None
        if entry is None:
            rows.append({"symbol": str(raw).strip().upper()[:64], "state": "not_found"})
            continue
        sym = entry["symbol"]
        if sym in seen:
            continue
        seen.add(sym)
        body, how, at = held_body(sym)
        st = by_status.get(sym)
        if how == "not_held":
            rows.append({"symbol": sym, "state": "not_held", "meta": P.meta_for(entry), "points": [], "currentness":
                         serving._currentness_view(st) if st else None, "retrieved_at": None, "read_at": None})
            continue
        body = body if isinstance(body, dict) else {}
        cur = serving._currentness_view(st) if st else serving._currentness_view(body.get("currentness"))
        pts = [list(p) for p in (body.get("points") or [])[-serving.LATEST_POINTS:]]
        for k in P.attribution_keys(entry):
            if k not in keys:
                keys.append(k)
        ret = (st or {}).get("last_success_at")
        rows.append({"symbol": sym, "state": "ok" if pts else "no_data", "meta": P.meta_for(entry), "points": pts,
                     "currentness": cur, "retrieved_at": ret if isinstance(ret, int) and not isinstance(ret, bool) else None,
                     "read_at": _iso(at)})
    return {"columns": list(P.COLUMNS), "points_per_series": serving.LATEST_POINTS, "series": rows,
            "attributions": P.notices(sorted(keys))}


def held_history(symbol: str, days: int) -> Optional[list]:
    """READ ONLY: the held body's points (as stored, oldest first) whose period end is within `days` calendar days of its
    newest period end, or None when the body is not held."""
    from api.services.econ import publish as P
    body, how, _at = held_body(symbol)
    if how != "held":
        return None
    ipe = list(P.COLUMNS).index("pe")
    pts = [list(p) for p in body.get("points") or [] if isinstance(p, (list, tuple)) and len(p) > ipe]
    ends = [str(p[ipe])[:10] for p in pts if isinstance(p[ipe], str)]
    if not ends:
        return []
    try:
        floor = (date.fromisoformat(max(ends)) - timedelta(days=int(days))).isoformat()
    except ValueError:
        return []
    return [p for p in pts if isinstance(p[ipe], str) and str(p[ipe])[:10] >= floor]

"""Economic data -- the web tier's READ path.

The member door (api/routers/econ.py) never opens a writable econ.db, never
calls a provider, and never computes currentness: it reads what the econ
service published, through a small in-process TTL cache.

SOURCE (env ECON_SERVING_SOURCE):
  r2     production -- data_sync.get_bytes(publish.*_key(...))  [default]
  local  dev -- ECON_ARTIFACT_DIR (the publisher's local root)
  db     dev/tests -- ECON_DB_PATH opened READ-ONLY; payloads built by the SAME
         publish.build_series_payload the publisher uses

EVERY answer re-checks `publish.servable` against the registry shipped with the
web build (belt and braces): a series disabled after its artifact was published
is refused at the door, whole -- never partial data.

Public functions return (http_status, body, etag|None):
  catalog()                       -> 200 always (falls back to the registry)
  series(symbol, asof, start, end) -> 200 | 404 not_found | 404 no_data | 503
  status()                        -> 200 | 503 status_unavailable
"""
from __future__ import annotations

import os
import threading
import time
from typing import Callable, Optional

from . import publish as P

TTL = float(os.environ.get("ECON_CACHE_TTL", "120"))
_MAX_ENTRIES = 2048
_MISS = object()

_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()


def _cached(key: str, loader: Callable[[], object]):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < TTL:
            return hit[1]
    val = loader()
    with _lock:
        _cache[key] = (now, val)
        if len(_cache) > _MAX_ENTRIES:                   # bounded: drop the oldest quarter
            for k, _ in sorted(_cache.items(), key=lambda kv: kv[1][0])[:_MAX_ENTRIES // 4]:
                _cache.pop(k, None)
    return val


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def mode() -> str:
    m = os.environ.get("ECON_SERVING_SOURCE", "r2").strip().lower()
    return m if m in ("r2", "local", "db") else "r2"


def _read_key(key: str) -> Optional[bytes]:
    m = mode()
    if m == "local":
        root = P.artifact_dir()
        if not root:
            return None
        return P._read_local(root, key)
    from api.services import data_sync
    return data_sync.get_bytes(key)


def _artifact(key: str):
    def load():
        try:
            return P.decode(_read_key(key))
        except Exception:  # noqa: BLE001 -- a corrupt object is a miss, never a 500
            return None
    return _cached("art:" + key, load)


def _open_db():
    from . import store as S
    return S.connect(os.environ.get("ECON_DB_PATH") or S.default_path(), readonly=True)


def _etag(doc) -> str:
    return '"' + P.etag_of(P.canonical_json(doc)) + '"'


# ─────────────────────────────────────────────────────────────── catalog

def catalog() -> tuple[int, dict, str]:
    def load():
        doc = None
        if mode() != "db":
            doc = _artifact(P.CATALOG_KEY)
        if not isinstance(doc, dict) or not isinstance(doc.get("series"), list):
            doc = P.catalog_payload()
        # serve-time re-check: only rows the web build's registry says are servable,
        # with meta rebuilt from that registry (whitelist), never the artifact's dict
        rows = []
        for r in doc["series"]:
            e = P.resolve(r.get("symbol", "")) if isinstance(r, dict) else None
            if e is not None:
                rows.append(P.meta_for(e))
        keys = sorted({k for r in rows for k in (r["source"].get("attribution_keys")
                                                 or [r["source"]["attribution_key"]]) if k})
        body = {"series": rows, "attributions": P.notices(keys)}
        return body, _etag(body)
    body, tag = _cached("catalog", load)
    return 200, body, tag


# ─────────────────────────────────────────────────────────────── series

def _filter_period(points: list, start: Optional[str], end: Optional[str]) -> list:
    if start is None and end is None:
        return points
    return [p for p in points if (start is None or p[2] >= start) and (end is None or p[2] <= end)]


def _from_db(sym: str, asof, start, end) -> Optional[dict]:
    try:
        s = _open_db()
    except Exception:  # noqa: BLE001 -- no database = nothing published
        return None
    try:
        return P.build_series_payload(s, sym, asof=asof, start=start, end=end)
    finally:
        s.close()


def _from_artifacts(sym: str, asof, start, end) -> Optional[dict]:
    latest = _artifact(P.series_key(sym))
    if not isinstance(latest, dict) or latest.get("symbol") != sym:
        return None
    body = dict(latest)
    if asof is None:
        body["points"] = _filter_period(list(latest.get("points") or []), start, end)
        return body
    vint = _artifact(P.vintages_key(sym))
    if not isinstance(vint, dict) or vint.get("symbol") != sym:
        return None
    body["view"], body["asof"] = "asof", int(asof)
    body["currentness"] = P.historical_currentness()      # the latest artifact's block describes NOW
    body["points"] = P.points_from_vintages(vint.get("rows") or [], asof=asof, start=start, end=end)
    return body


def series(symbol: str, asof: Optional[int] = None, start: Optional[str] = None,
           end: Optional[str] = None) -> tuple[int, dict, Optional[str]]:
    entry = P.resolve(symbol)
    if entry is None:
        return 404, {"detail": "not_found"}, None
    sym = entry["symbol"]

    def load():
        body = _from_db(sym, asof, start, end) if mode() == "db" else _from_artifacts(sym, asof, start, end)
        return body if body is not None else _MISS

    body = _cached(f"series:{sym}:{asof}:{start}:{end}", load)
    if body is _MISS:
        return 404, {"detail": "no_data", "symbol": sym}, None
    # ⛔ belt and braces: meta always from the web build's registry (the whitelist),
    # never whatever dict the artifact happened to carry
    body = dict(body)
    if asof is not None:
        body["currentness"] = P.historical_currentness()   # never overlay NOW onto history
    elif mode() != "db":
        cur = _status_currentness(sym)
        if cur is not None:
            body["currentness"] = cur
    body["meta"] = P.meta_for(entry)
    body["id"], body["symbol"], body["columns"] = P.canonical_id(sym), sym, list(P.COLUMNS)
    if asof is None and not body.get("points"):
        return 404, {"detail": "no_data", "symbol": sym}, None
    return 200, body, _etag(body)


# ─────────────────────────────────────────────────────────────── status

_STATUS_ROW = ("symbol", "state", "latest_period", "expected_period", "next_release", "last_success_at")
_NEXT_RELEASE = ("date", "time", "tz", "precision")


def _sanitize_status(doc: dict) -> dict:
    """Whitelist every field: dates and states only -- this route is unauthenticated."""
    rows = []
    for r in doc.get("series") or []:
        if not isinstance(r, dict) or P.resolve(str(r.get("symbol", ""))) is None:
            continue
        row = {k: r.get(k) for k in _STATUS_ROW}
        nr = row["next_release"]
        row["next_release"] = {k: nr.get(k) for k in _NEXT_RELEASE} if isinstance(nr, dict) else None
        rows.append(row)
    svc = doc.get("service") if isinstance(doc.get("service"), dict) else {}
    svc = {k: v for k, v in svc.items() if isinstance(v, (int, float, str, bool)) or v is None}
    return {"service": svc, "series": rows}


def _status_currentness(sym: str) -> Optional[dict]:
    """The series artifact is re-written only when its DATA changes, so the
    currentness baked into it goes stale between releases (CURRENT long after a
    release window opened, a next_release that has passed). The status artifact
    is the service heartbeat (re-published every tick), so artifact-mode serving
    takes currentness from it. None (keep the artifact's) when it is unavailable."""
    try:
        code, doc, _ = status()
    except Exception:  # noqa: BLE001 -- currentness overlay must never break a payload
        return None
    if code != 200:
        return None
    for r in doc.get("series") or []:
        if r.get("symbol") == sym:
            return {"state": r.get("state"), "latest_period": r.get("latest_period"),
                    "expected_period": r.get("expected_period"), "next_release": r.get("next_release")}
    return None


def status() -> tuple[int, dict, Optional[str]]:
    def load():
        if mode() == "db":
            try:
                s = _open_db()
            except Exception:  # noqa: BLE001
                return _MISS
            try:
                return P.status_payload(s)
            finally:
                s.close()
        doc = _artifact(P.STATUS_KEY)
        return doc if isinstance(doc, dict) else _MISS

    doc = _cached("status", load)
    if doc is _MISS:
        return 503, {"detail": "status_unavailable"}, None
    body = _sanitize_status(doc)
    return 200, body, _etag(body)

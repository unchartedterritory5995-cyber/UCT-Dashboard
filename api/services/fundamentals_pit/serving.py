"""Serving: published artifacts -> the fundamental-series API payload.

The member path NEVER calls SEC and never opens the worker's database in
production: it reads the per-company artifact the worker published (R2 via the
existing data_sync client), through a small in-process TTL cache. Beta is a
price statistic the WORKER precomputes (beta_store.py) and publishes beside the
artifact; this module only reads it.

SOURCE (env FUNDAMENTALS_PIT_SOURCE):
  r2     production -- data_sync.get_bytes(publish.key_for(cik))
  local  dev -- FUNDAMENTALS_PIT_ARTIFACT_DIR (the publish local_root)
  db     dev/tests -- read the store directly (FUNDAMENTALS_PIT_DB_PATH), read-only
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time

from . import catalog as C
from . import publish as P
from .derive import DERIVATION_VERSION

TTL = float(os.environ.get("FUNDAMENTALS_PIT_CACHE_TTL", "300"))
BETA_ID = "beta_1y_spy"

_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()


def _cached(key: str, loader):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < TTL:
            return hit[1]
    val = loader()
    with _lock:
        _cache[key] = (now, val)
        if len(_cache) > 4096:                           # bounded: drop the oldest quarter
            for k, _ in sorted(_cache.items(), key=lambda kv: kv[1][0])[:1024]:
                _cache.pop(k, None)
    return val


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def _mode() -> str:
    return os.environ.get("FUNDAMENTALS_PIT_SOURCE", "r2")


def _read_key(key: str) -> bytes | None:
    mode = _mode()
    if mode == "local":
        path = os.path.join(os.environ.get("FUNDAMENTALS_PIT_ARTIFACT_DIR", ""), *key.split("/"))
        if not os.path.exists(path):
            return None
        with open(path, "rb") as f:
            return f.read()
    if mode == "r2":
        from api.services import data_sync
        return data_sync.get_bytes(key)
    raise ValueError(f"_read_key unsupported in mode {mode}")


def _db_conn():
    from . import store as S
    return S.connect(os.environ.get("FUNDAMENTALS_PIT_DB_PATH"), readonly=True)


def cik_for(symbol: str, version: int = DERIVATION_VERSION) -> int | None:
    sym = symbol.upper()
    if _mode() == "db":
        from . import store as S
        def load():
            c = _db_conn()
            try:
                return S.cik_for_ticker(c, sym)
            finally:
                c.close()
        return _cached(f"cik:{sym}", load)
    idx = _cached(f"index:{version}", lambda: json.loads(_read_key(P.index_key(version)) or b"{}"))
    return (idx.get("tickers") or {}).get(sym)


def artifact_for(cik: int, version: int = DERIVATION_VERSION) -> dict | None:
    if _mode() == "db":
        def load():
            c = _db_conn()
            try:
                return P.artifact(c, cik, version)
            finally:
                c.close()
        return _cached(f"art:{cik}:{version}", load)
    return _cached(f"art:{cik}:{version}",
                   lambda: (lambda b: json.loads(b) if b else None)(_read_key(P.key_for(cik, version))))


def beta_artifact(cik: int) -> dict | None:
    """The worker-precomputed Beta for one company (beta_store). READ ONLY."""
    from . import beta_store as B
    if _mode() == "db":
        def load():
            c = _db_conn()
            try:
                return B.read(c, cik)
            finally:
                c.close()
        return _cached(f"beta:{cik}", load)
    import gzip
    return _cached(f"beta:{cik}",
                   lambda: (lambda b: json.loads(gzip.decompress(b)) if b else None)(_read_key(B.key_for(cik))))


def beta_points(symbol: str, version: int = DERIVATION_VERSION, *, cik: int | None = None) -> list[list]:
    """[[t_close_utc, beta], ...], as the WORKER
    computed them. ⛔ Never computed here: a member request only reads (owner
    ruling; a cold AAPL rebuild cost 589 ms on the web pod). A symbol with no
    precomputed Beta is simply missing."""
    if cik is None:
        cik = cik_for(symbol, version)
    doc = beta_artifact(cik) if cik is not None else None
    return list(doc.get("points") or []) if doc else []


def allowed_series() -> set[str]:
    return C.stored_series_ids() | {BETA_ID}


# ── THE version seam ────────────────────────────────────────────────────────
# ONE place decides what members are served: env FUNDAMENTALS_PIT_SERVE (emergency override) > the ops-written
# control object fundamentals_pit/serving.json > V4 (the default, and today's behaviour). Everything below reads
# through a Source; nothing else in the codebase branches on the version.
CONTROL_TTL = float(os.environ.get("FUNDAMENTALS_PIT_CONTROL_TTL", "30"))


class Source:
    """What one request reads. v4: the untouched per-company keys. v5: one immutable version manifest."""

    def __init__(self, kind: str, version: int, version_id: str | None = None, manifest: dict | None = None,
                 fallback_reason: str | None = None):
        self.kind, self.version, self.version_id, self.manifest = kind, version, version_id, manifest
        self.fallback_reason = fallback_reason

    def cik_for(self, symbol: str) -> int | None:
        if self.kind == "v4" or _mode() == "db":
            return cik_for(symbol, self.version)
        return (self.manifest.get("tickers") or {}).get(symbol.upper())

    def object_sha(self, cik: int) -> str | None:
        return None if self.manifest is None else self.manifest["companies"].get(str(cik))

    def artifact_for(self, cik: int) -> dict | None:
        if self.kind == "v4" or _mode() == "db":
            return artifact_for(cik, self.version)
        s = self.object_sha(cik)
        if s is None:
            return None
        from . import v5_publish as VP
        return _cached(f"v5o:{s}", lambda: (lambda b: json.loads(b) if b else None)(_read_key(VP.obj_key(s))))

    def tag(self) -> str:
        return self.kind if self.kind == "v4" else f"v5:{self.version_id}"


def _cached_ttl(key: str, loader, ttl: float):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = loader()
    with _lock:
        _cache[key] = (now, val)
    return val


def _control(key: str) -> dict | None:
    if _mode() == "db":
        return None
    return _cached_ttl(f"ctl:{key}", lambda: (lambda b: json.loads(b) if b else None)(_read_key(key)), CONTROL_TTL)


def v4_source() -> Source:
    return Source("v4", DERIVATION_VERSION)


def selection() -> dict:
    """{"serve": "v4"|"v5", "pin": ..., "by": "env"|"control"|"default"} -- the member selection, unresolved."""
    from . import v5_publish as VP
    env = os.environ.get("FUNDAMENTALS_PIT_SERVE", "").strip().lower()
    if env in ("v4", "v5"):
        return {"serve": env, "pin": None, "by": "env"}
    ctl = _control(VP.SERVING_KEY)
    if ctl and ctl.get("serve") in ("v4", "v5"):
        return {"serve": ctl["serve"], "pin": ctl.get("v5_pin"), "by": "control"}
    return {"serve": "v4", "pin": None, "by": "default"}


def v5_source(version_id: str | None = None) -> Source:
    """The V5 version (the pin, else CURRENT), bound to its immutable manifest. Raises LookupError if absent."""
    from . import v5_publish as VP
    if _mode() == "db":
        return Source("v5", 5, version_id or "db")
    vid = version_id
    if vid is None:
        cur = _control(VP.CURRENT_KEY)
        vid = (cur or {}).get("version")
    if not vid:
        raise LookupError("no V5 version published")
    man = _cached(f"v5m:{vid}", lambda: (lambda b: json.loads(b) if b else None)(_read_key(VP.version_key(vid))))
    if not man or man.get("version") != vid:
        raise LookupError(f"V5 manifest {vid} missing")
    return Source("v5", 5, vid, man)


def current_source() -> Source:
    """FAIL SAFE: a V5 selection that cannot be resolved serves V4 (and says why)."""
    sel = selection()
    if sel["serve"] == "v5":
        try:
            return v5_source(sel.get("pin"))
        except LookupError as e:
            print(f"[fundamentals_pit] V5 selected but unresolvable ({e}); serving V4")
            return Source("v4", DERIVATION_VERSION, fallback_reason=str(e))
    return v4_source()


def series_response(symbol: str, series_ids: list[str], *, version: int | None = None,
                    source: Source | None = None) -> tuple[int, dict, str | None]:
    """(http_status, body, etag). 400 unknown series; 404 unknown symbol."""
    bad = [s for s in series_ids if s not in allowed_series()]
    if bad:
        return 400, {"detail": "unknown_series", "series": bad}, None
    if source is None:
        source = Source("v4", version) if version is not None else current_source()
    sym = symbol.upper()
    out: dict = {"symbol": sym, "derivation_version": source.version, "metrics": {}, "missing": []}
    if source.kind == "v5":
        out["version"] = source.version_id
    want_sec = [s for s in series_ids if s != BETA_ID]
    art = None
    cik = None
    if want_sec or BETA_ID in series_ids:
        cik = source.cik_for(sym)
    if want_sec:
        art = source.artifact_for(cik) if cik is not None else None
        if art is None and BETA_ID not in series_ids:
            return 404, {"detail": "no_data", "symbol": sym}, None
    if art is not None:
        out.update({"cik": art["cik"], "name": art.get("name"), "split_status": art.get("split_status"),
                    "withheld_split_sensitive": art.get("withheld_split_sensitive", False),
                    "built_at": art.get("built_at")})
        for s in want_sec:
            pts = art["metrics"].get(s)
            if pts:
                out["metrics"][s] = pts
            else:
                out["missing"].append(s)
    else:
        out["missing"].extend(want_sec)
    if BETA_ID in series_ids:
        pts = beta_points(sym, source.version, cik=cik) if cik is not None else []
        if pts:
            out["metrics"][BETA_ID] = pts
        else:
            out["missing"].append(BETA_ID)
    if not out["metrics"] and art is None:
        return 404, {"detail": "no_data", "symbol": sym}, None
    tag_parts = [art.get("input_hash") if art else None, sorted(series_ids),
                 {k: (v[-1] if v else None) for k, v in out["metrics"].items()}]
    if source.kind == "v5":                     # a new version with the same last points must not 304
        tag_parts.append([source.version_id, source.object_sha(cik) if cik is not None else None])
    tag = hashlib.sha256(json.dumps(tag_parts, default=str).encode()).hexdigest()[:32]
    return 200, out, f'"{tag}"'

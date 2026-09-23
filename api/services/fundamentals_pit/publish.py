"""Serving artifacts: the store's derived series -> small immutable JSON per company.

Members never read the worker's database and never wait on SEC. The worker
publishes one artifact per company per derivation version; the web tier
serves it (api/routers/fundamentals_pit.py) with an ETag.

ARTIFACT (compact on purpose -- ~3 KB per metric, gzip ~5x):
    {"v": 1, "cik": 320193, "tickers": ["AAPL"], "derivation_version": 1,
     "input_hash": "...", "built_at": 1790000000.0, "split_status": "verified",
     "metrics": {"net_margin_ttm": [[t_eff, value, "period_end", "method"], ...]}}

TARGETS
  * local directory  (dev, tests, the ChartWidget harness)
  * R2 via the existing data_sync client -- DRY-RUN unless
    FUNDAMENTALS_PIT_PUBLISH_R2=1 AND data_sync credentials are present.
    Nothing tonight sets either.
"""
from __future__ import annotations

import hashlib
import json
import os
import time

from . import store as S
from .derive import DERIVATION_VERSION

ARTIFACT_FORMAT = 1


def key_for(cik: int, version: int = DERIVATION_VERSION) -> str:
    return f"fundamentals_pit/v{version}/cik/{cik}.json"


def index_key(version: int = DERIVATION_VERSION) -> str:
    return f"fundamentals_pit/v{version}/tickers.json"


def artifact(conn, cik: int, version: int = DERIVATION_VERSION) -> dict | None:
    info = S.build_info(conn, cik, version)
    sec = S.security(conn, cik)
    if info is None or sec is None:
        return None
    series = S.read_series(conn, cik, version)
    return {"v": ARTIFACT_FORMAT, "cik": cik, "tickers": sec["tickers"], "name": sec["name"],
            "derivation_version": version, "input_hash": info["input_hash"], "built_at": info["built_at"],
            "split_status": info["detail"].get("split_verification", {}).get("status"),
            "withheld_split_sensitive": info["detail"].get("withheld_split_sensitive", False),
            "metrics": {m: [[t, v, pe, meth] for t, v, pe, meth in pts] for m, pts in series.items()}}


def encode(doc: dict) -> tuple[bytes, str]:
    body = json.dumps(doc, separators=(",", ":"), sort_keys=True).encode()
    return body, hashlib.sha256(body).hexdigest()[:32]


def ticker_index(conn) -> dict[str, int]:
    return {t: c for t, c in conn.execute(
        "SELECT ticker, cik FROM ticker_map t WHERE last_seen_at = "
        "(SELECT max(last_seen_at) FROM ticker_map u WHERE u.ticker = t.ticker)")}


def _put_local(root: str, key: str, body: bytes) -> None:
    path = os.path.join(root, *key.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(body)
    os.replace(tmp, path)


def r2_enabled() -> bool:
    if os.environ.get("FUNDAMENTALS_PIT_PUBLISH_R2") != "1":
        return False
    from api.services import data_sync
    return bool(data_sync.credentials_ok())


def publish_company(conn, cik: int, *, local_root: str | None = None, version: int = DERIVATION_VERSION,
                    now: float | None = None) -> dict:
    """Publish one company if its artifact changed. Returns what happened."""
    now = time.time() if now is None else now
    doc = artifact(conn, cik, version)
    if doc is None:
        return {"cik": cik, "published": False, "reason": "not built"}
    body, etag = encode(doc)
    targets = []
    if local_root:
        targets.append(("local", lambda: _put_local(local_root, key_for(cik, version), body)))
    if r2_enabled():
        from api.services import data_sync
        targets.append(("r2", lambda: data_sync.put_bytes(key_for(cik, version), body, "application/json")))
    done = []
    for name, put in targets:
        prev = conn.execute("SELECT etag FROM publish_log WHERE cik=? AND derivation_version=? AND target=?",
                            (cik, version, name)).fetchone()
        if prev and prev[0] == etag:
            continue
        put()
        with S.tx(conn):
            conn.execute("INSERT INTO publish_log VALUES (?,?,?,?,?) ON CONFLICT(cik, derivation_version, target) "
                         "DO UPDATE SET etag=excluded.etag, published_at=excluded.published_at",
                         (cik, version, etag, int(now), name))
        done.append(name)
    return {"cik": cik, "published": bool(done), "targets": done, "etag": etag, "bytes": len(body)}


def publish_index(conn, *, local_root: str | None = None, version: int = DERIVATION_VERSION) -> dict:
    body, etag = encode({"v": ARTIFACT_FORMAT, "derivation_version": version, "tickers": ticker_index(conn)})
    if local_root:
        _put_local(local_root, index_key(version), body)
    if r2_enabled():
        from api.services import data_sync
        data_sync.put_bytes(index_key(version), body, "application/json")
    return {"etag": etag, "bytes": len(body)}

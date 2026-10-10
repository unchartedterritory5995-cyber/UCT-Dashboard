"""Serving artifacts: the store's derived series -> small immutable JSON per company.

Members never read the worker's database and never wait on SEC. The worker
publishes one artifact per company per derivation version; the web tier
serves it (api/routers/fundamentals_pit.py) with an ETag.

ARTIFACT (compact on purpose -- ~3 KB per metric, gzip ~5x). Percent series are
SERVED as percent numbers (catalog.PERCENT_SERIES); the store keeps fractions.
    {"v": 1, "cik": 320193, "tickers": ["AAPL"], "derivation_version": 1,
     "input_hash": "...", "built_at": 1790000000.0, "split_status": "verified",
     "metrics": {"net_margin_ttm": [[t_eff, value, "period_end", "method"], ...]}}

SOURCES (TERM-043, owner ruling T-13: figure-to-source link only). When
FUNDAMENTALS_PIT_PUBLISH_SOURCES=1 the artifact also carries
    "sources": {"revenue_q": [["0000320193-24-000123"], ...], ...}
for SOURCE_LINK_METRICS only: one accession list per point, index-aligned with
"metrics". Unset (the default) the artifact is byte-identical to before, so no
company republishes until the worker is armed.

TARGETS
  * local directory  (dev, tests, the ChartWidget harness)
  * R2 via the existing data_sync client -- DRY-RUN unless
    FUNDAMENTALS_PIT_PUBLISH_R2=1 AND data_sync credentials are present.
    Nothing tonight sets either.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import time

from . import store as S
from .catalog import PERCENT_SERIES
from .derive import DERIVATION_VERSION

ARTIFACT_FORMAT = 1

#: The standalone quarterly statement lines a figure-to-source link is offered for.
SOURCE_LINK_METRICS = ("revenue_q", "net_income_q", "eps_diluted_q")
SOURCES_ENV = "FUNDAMENTALS_PIT_PUBLISH_SOURCES"


def sources_enabled() -> bool:
    """Read PER CALL. Unset means OFF (the artifact carries no `sources`)."""
    return os.environ.get(SOURCES_ENV, "0").strip() == "1"


def key_for(cik: int, version: int = DERIVATION_VERSION) -> str:
    return f"fundamentals_pit/v{version}/cik/{cik}.json"


def index_key(version: int = DERIVATION_VERSION) -> str:
    return f"fundamentals_pit/v{version}/tickers.json"


def read_series_sources(conn, cik: int, version: int, metrics: list[str]) -> dict[str, list[list[str]]]:
    """TERM-043: {metric: [[accession, ...] per point]} in the SAME (metric, t_eff) order as
    store.read_series, so index i here is point i there. Raw provenance only. Kept here, not
    in store.py, because store.py is a frozen methodology file (v5_prod.METHODOLOGY_FILES)."""
    out: dict[str, list[list[str]]] = {}
    if not metrics:
        return out
    q = ",".join("?" * len(metrics))
    for m, src in conn.execute(f"SELECT metric, sources FROM series_point WHERE cik=? AND derivation_version=? "
                               f"AND metric IN ({q}) ORDER BY metric, t_eff", (cik, version, *metrics)):
        out.setdefault(m, []).append([s for s in (src or "").split(",") if s])
    return out


def artifact(conn, cik: int, version: int = DERIVATION_VERSION) -> dict | None:
    info = S.build_info(conn, cik, version)
    sec = S.security(conn, cik)
    if info is None or sec is None:
        return None
    series = S.read_series(conn, cik, version)
    doc = {"v": ARTIFACT_FORMAT, "cik": cik, "tickers": sec["tickers"], "name": sec["name"],
            "derivation_version": version, "input_hash": info["input_hash"], "built_at": info["built_at"],
            "split_status": info["detail"].get("split_verification", {}).get("status"),
            "withheld_split_sensitive": info["detail"].get("withheld_split_sensitive", False),
            "metrics": {m: [[t, (v * 100.0 if (v is not None and m in PERCENT_SERIES) else v), pe, meth] for t, v, pe, meth in pts]
                        for m, pts in series.items()}}
    if sources_enabled():
        doc["sources"] = read_series_sources(conn, cik, version, list(SOURCE_LINK_METRICS))
    return doc


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
    beta = publish_beta(conn, cik, local_root=local_root, now=now)
    return {"cik": cik, "published": bool(done), "targets": done, "etag": etag, "bytes": len(body),
            "beta": beta}


def publish_beta(conn, cik: int, *, local_root: str | None = None, now: float | None = None) -> dict:
    """Publish the worker-precomputed Beta (beta_store) for one company, if changed.
    Logged in publish_log under target '<target>:beta' so the two artifacts are
    independent."""
    from . import beta_store as B
    now = time.time() if now is None else now
    doc = B.read(conn, cik)
    if doc is None:
        return {"published": False, "reason": "not built"}
    body, etag = encode(doc)
    gz = gzip.compress(body, mtime=0)            # etag is of the JSON; the object is gzip
    targets = []
    if local_root:
        targets.append(("local:beta", lambda: _put_local(local_root, B.key_for(cik), gz)))
    if r2_enabled():
        from api.services import data_sync
        targets.append(("r2:beta", lambda: data_sync.put_bytes(B.key_for(cik), gz, "application/gzip")))
    done = []
    for name, put in targets:
        prev = conn.execute("SELECT etag FROM publish_log WHERE cik=? AND derivation_version=? AND target=?",
                            (cik, B.BETA_METHOD_VERSION, name)).fetchone()
        if prev and prev[0] == etag:
            continue
        put()
        with S.tx(conn):
            conn.execute("INSERT INTO publish_log VALUES (?,?,?,?,?) ON CONFLICT(cik, derivation_version, target) "
                         "DO UPDATE SET etag=excluded.etag, published_at=excluded.published_at",
                         (cik, B.BETA_METHOD_VERSION, etag, int(now), name))
        done.append(name)
    return {"published": bool(done), "targets": done, "etag": etag, "bytes": len(body), "gzip_bytes": len(gz)}


def publish_index(conn, *, local_root: str | None = None, version: int = DERIVATION_VERSION) -> dict:
    body, etag = encode({"v": ARTIFACT_FORMAT, "derivation_version": version, "tickers": ticker_index(conn)})
    if local_root:
        _put_local(local_root, index_key(version), body)
    if r2_enabled():
        from api.services import data_sync
        data_sync.put_bytes(index_key(version), body, "application/json")
    return {"etag": etag, "bytes": len(body)}

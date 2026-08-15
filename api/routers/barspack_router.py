"""Serve the Universe Bars Pack to browsers (Phase 2).

Two public, edge-cacheable routes proxy the R2 artifact the worker builds
(api/services/barspack.py):

  GET /api/barspack/manifest        → latest.json (which shards exist, versioned
                                       by ET date). Short cache — it rolls daily.
  GET /api/barspack/{date}/{idx}    → one gzipped shard of columnar D/W/M bars.
                                       IMMUTABLE (date is in the URL) → Cloudflare
                                       caches it hard, so the origin is hit ~once
                                       per POP per shard per day regardless of
                                       user count. R2 egress is free.

Public by design (market data, same as the charts). Cloudflare keys its cache on
the URL, so these must NOT be auth-gated. Shards are already gzipped; we set
Content-Encoding: gzip so the browser transparently decompresses to JSON and the
web GZip middleware skips re-compressing an already-encoded body.
"""
from fastapi import APIRouter
from fastapi.responses import Response
from datetime import datetime

from api.services import data_sync

router = APIRouter(prefix="/api/barspack", tags=["barspack"])

_MANIFEST_HEADERS = {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    "Vary": "Accept-Encoding",
}
_SHARD_HEADERS = {
    "Cache-Control": "public, max-age=31536000, immutable",
    "Vary": "Accept-Encoding",
    "Content-Encoding": "gzip",
}
_NO_CACHE = {"Cache-Control": "no-store, max-age=0"}

_PREFIX = "barspack"


def _valid_date(s: str) -> bool:
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return True
    except (TypeError, ValueError):
        return False


@router.get("/manifest")
def manifest():
    """Latest pack manifest, or {"available": false} (no-store) when no pack has
    been published yet — so the client keeps polling instead of caching absence."""
    body = data_sync.get_bytes(f"{_PREFIX}/latest.json")
    if not body:
        return Response(content='{"available":false}', media_type="application/json",
                        headers=_NO_CACHE)
    return Response(content=body, media_type="application/json", headers=_MANIFEST_HEADERS)


@router.get("/{date}/delta")
def delta(date: str):
    """The day's small delta file (tail of every series) — immutable, gzipped.
    Declared before /{date}/{idx} so the literal 'delta' wins over the numeric
    shard route."""
    if not _valid_date(date):
        return Response(status_code=404, headers=_NO_CACHE)
    body = data_sync.get_bytes(f"{_PREFIX}/{date}/delta.json.gz")
    if not body:
        return Response(status_code=404, headers=_NO_CACHE)
    return Response(content=body, media_type="application/json", headers=_SHARD_HEADERS)


@router.get("/{date}/{idx}")
def shard(date: str, idx: str):
    """One immutable gzipped shard. Validates the path so it can only ever
    address a barspack/<date>/<NNN>.json.gz key — never an arbitrary object."""
    if not _valid_date(date) or not idx.isdigit():
        return Response(status_code=404, headers=_NO_CACHE)
    key = f"{_PREFIX}/{date}/{int(idx):03d}.json.gz"
    body = data_sync.get_bytes(key)
    if not body:
        return Response(status_code=404, headers=_NO_CACHE)
    return Response(content=body, media_type="application/json", headers=_SHARD_HEADERS)

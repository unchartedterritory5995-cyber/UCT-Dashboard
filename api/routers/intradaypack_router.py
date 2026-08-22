"""Serve the Intraday Bars Pack to browsers (Phase 4).

Mirror of barspack_router for the intraday artifact the worker builds
(api/services/intradaypack.py). Same edge-cache contract:

  GET /api/intradaypack/manifest        → latest.json (rolls per ET day; short cache)
  GET /api/intradaypack/{date}/delta    → the day's delta (immutable, gzipped)
  GET /api/intradaypack/{date}/{idx}    → one immutable gzipped 5m/60m shard

Public by design (market data) so Cloudflare caches on the URL — do NOT auth-gate.
Shards are already gzipped; Content-Encoding: gzip lets the browser decompress and
the web GZip middleware skip re-compressing.
"""
from fastapi import APIRouter
from fastapi.responses import Response
from datetime import datetime

from api.services import data_sync

router = APIRouter(prefix="/api/intradaypack", tags=["intradaypack"])

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

_PREFIX = "intradaypack"


def _valid_date(s: str) -> bool:
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return True
    except (TypeError, ValueError):
        return False


@router.get("/manifest")
def manifest():
    body = data_sync.get_bytes(f"{_PREFIX}/latest.json")
    if not body:
        return Response(content='{"available":false}', media_type="application/json",
                        headers=_NO_CACHE)
    return Response(content=body, media_type="application/json", headers=_MANIFEST_HEADERS)


@router.get("/{date}/delta")
def delta(date: str):
    if not _valid_date(date):
        return Response(status_code=404, headers=_NO_CACHE)
    body = data_sync.get_bytes(f"{_PREFIX}/{date}/delta.json.gz")
    if not body:
        return Response(status_code=404, headers=_NO_CACHE)
    return Response(content=body, media_type="application/json", headers=_SHARD_HEADERS)


@router.get("/{date}/{idx}")
def shard(date: str, idx: str):
    if not _valid_date(date) or not idx.isdigit():
        return Response(status_code=404, headers=_NO_CACHE)
    key = f"{_PREFIX}/{date}/{int(idx):03d}.json.gz"
    body = data_sync.get_bytes(key)
    if not body:
        return Response(status_code=404, headers=_NO_CACHE)
    return Response(content=body, media_type="application/json", headers=_SHARD_HEADERS)

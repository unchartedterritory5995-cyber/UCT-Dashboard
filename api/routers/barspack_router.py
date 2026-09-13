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

🔴 THIS SAID "Public by design (market data, same as the charts). Cloudflare
keys its cache on the URL, so these must NOT be auth-gated." BOTH CLAUSES WERE
SUPERSEDED, and the second is the dangerous one.

  * "same as the charts" — charts have been PAID since the 2026-07-19 free-tier
    decision, so this premise now argues the opposite of what it says.
  * "must NOT be auth-gated" described a CONSEQUENCE of edge caching as if it
    were a requirement. What the pack ships is the whole universe's D/W/M bars
    as shards — equivalent history to `/api/bars`, in bulk. Gating that route
    and leaving this one open would have been the complete bypass: an
    unentitled caller simply downloads the pack instead of asking for bars.

So these are gated, and — because a gate in front of a `public` response is
still a shared cache serving member data — the headers below are `private` to
match. The cost is real and accepted: Cloudflare no longer absorbs shard reads,
so the origin is hit per member rather than ~once per POP per day. Restoring
that needs an edge strategy keyed on entitlement, not a header. Shards are
already gzipped; we set
Content-Encoding: gzip so the browser transparently decompresses to JSON and the
web GZip middleware skips re-compressing an already-encoded body.
"""
from fastapi import APIRouter, Depends
from api.bars_auth import require_bars_access
from fastapi.responses import Response
from datetime import datetime

from api.services import data_sync

router = APIRouter(prefix="/api/barspack", tags=["barspack"])

_MANIFEST_HEADERS = {
    "Cache-Control": "private, max-age=300",
    "Vary": "Accept-Encoding",
}
_SHARD_HEADERS = {
    # ⛔ `private` — see the module docstring. A shard is immutable BY CONTENT
    # (the date is in the URL), which is why the long TTL is still right; what
    # changed is WHO may hold a copy. The browser still caches it for a year.
    "Cache-Control": "private, max-age=31536000, immutable",
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
def manifest(_access: dict = Depends(require_bars_access)):
    """Latest pack manifest, or {"available": false} (no-store) when no pack has
    been published yet — so the client keeps polling instead of caching absence."""
    body = data_sync.get_bytes(f"{_PREFIX}/latest.json")
    if not body:
        return Response(content='{"available":false}', media_type="application/json",
                        headers=_NO_CACHE)
    return Response(content=body, media_type="application/json", headers=_MANIFEST_HEADERS)


@router.get("/{date}/delta")
def delta(date: str, _access: dict = Depends(require_bars_access)):
    """The day's small delta file (tail of every series) — immutable, gzipped.
    Declared before /{date}/{idx} so the literal 'delta' wins over the numeric
    shard route."""
    if not _valid_date(date):
        return Response(status_code=404, headers=_NO_CACHE)
    body = data_sync.get_bytes(f"{_PREFIX}/{date}/delta.json.gz")
    if not body:
        return Response(status_code=404, headers=_NO_CACHE)
    return Response(content=body, media_type="application/json", headers=_SHARD_HEADERS)


@router.get("/{date}/hot")
def hot(date: str, _access: dict = Depends(require_bars_access)):
    """The hot-set shard (the ~100 most-opened names) — immutable, gzipped.
    Declared before /{date}/{idx} so the literal 'hot' wins over the numeric
    shard route (same pattern as /{date}/delta). A first-visit browser ingests
    this ONE small edge-cached file eagerly for instant first-open charts."""
    if not _valid_date(date):
        return Response(status_code=404, headers=_NO_CACHE)
    body = data_sync.get_bytes(f"{_PREFIX}/{date}/hot.json.gz")
    if not body:
        return Response(status_code=404, headers=_NO_CACHE)
    return Response(content=body, media_type="application/json", headers=_SHARD_HEADERS)


@router.get("/{date}/{idx}")
def shard(date: str, idx: str, _access: dict = Depends(require_bars_access)):
    """One immutable gzipped shard. Validates the path so it can only ever
    address a barspack/<date>/<NNN>.json.gz key — never an arbitrary object."""
    if not _valid_date(date) or not idx.isdigit():
        return Response(status_code=404, headers=_NO_CACHE)
    key = f"{_PREFIX}/{date}/{int(idx):03d}.json.gz"
    body = data_sync.get_bytes(key)
    if not body:
        return Response(status_code=404, headers=_NO_CACHE)
    return Response(content=body, media_type="application/json", headers=_SHARD_HEADERS)

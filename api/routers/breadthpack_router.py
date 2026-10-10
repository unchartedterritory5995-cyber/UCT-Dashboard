"""Serve the Breadth Pack (`api/services/breadth_pack.py`) to browsers.

  GET /api/breadthpack/manifest          → which version / shards exist ({"available": false}
                                            until the warm loop has built one). Short cache.
  GET /api/breadthpack/{version}/{idx}   → one gzipped columnar shard. IMMUTABLE — the version
                                            is a content hash, so the browser caches it hard.

Same gate as the Universe Bars Pack (`require_bars_access`): breadth series are paid chart data.
The client (`barsPackClient.js`, PACK_BREADTH) sends the session cookie.
"""
from fastapi import APIRouter, Depends
from fastapi.responses import Response

from api.bars_auth import require_bars_access

router = APIRouter(prefix="/api/breadthpack", tags=["breadthpack"])

_MANIFEST_HEADERS = {"Cache-Control": "private, max-age=120", "Vary": "Accept-Encoding"}
_SHARD_HEADERS = {"Cache-Control": "private, max-age=31536000, immutable",
                  "Vary": "Accept-Encoding", "Content-Encoding": "gzip"}
_NO_CACHE = {"Cache-Control": "no-store, max-age=0"}


@router.get("/manifest")
def manifest(_access: dict = Depends(require_bars_access)):
    import json
    from api.services import breadth_pack
    m = breadth_pack.manifest()
    if not m:
        return Response(content='{"available":false}', media_type="application/json",
                        headers=_NO_CACHE)
    return Response(content=json.dumps(m), media_type="application/json",
                    headers=_MANIFEST_HEADERS)


@router.get("/{version}/{idx}")
def shard(version: str, idx: str, _access: dict = Depends(require_bars_access)):
    from api.services import breadth_pack
    if not idx.isdigit() or not version.isalnum() or len(version) > 40:
        return Response(status_code=404, headers=_NO_CACHE)
    body = breadth_pack.shard(version, int(idx))
    if body is None:
        return Response(status_code=404, headers=_NO_CACHE)
    return Response(content=body, media_type="application/json", headers=_SHARD_HEADERS)

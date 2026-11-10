"""The StaticFiles class behind `/assets` and `/fonts`.

Both mounts hold files whose names change when their content does (Vite's content
hash; the upstream version in a font filename), so a year of `immutable` is safe.

`no-transform` is NOT a cache setting and must never be dropped. Commit 72f1c438f8:
Cloudflare re-encoded the origin response to zstd on the fly and deterministically
lost 668 bytes of the 1.1 MB ECharts vendor chunk, so every page that mounted a
chart died with "SyntaxError: Unexpected end of input". `no-transform` is what stops
the edge from re-encoding these responses.
"""
from __future__ import annotations

from starlette.staticfiles import StaticFiles


class ImmutableStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = (
                "public, max-age=31536000, immutable, no-transform"
            )
        return response

"""The StaticFiles class behind `/assets` and `/fonts`.

Both mounts hold files whose names change when their content does (Vite's content
hash; the upstream version in a font filename), so a year of `immutable` is safe.

`no-transform` is NOT a cache setting. Commit 72f1c438f8: Cloudflare re-encoded the
origin response to zstd on the fly and deterministically lost 668 bytes of the 1.1 MB
ECharts vendor chunk, so every page that mounted a chart died with "SyntaxError:
Unexpected end of input". `no-transform` is what stops the edge from re-encoding.

⛔ It may come off hashed JS/CSS ONLY through `ASSETS_NO_TRANSFORM_ENABLED=0`, and only while the
zone's Compression Rule limits `/assets/*` to brotli or gzip (never zstd), after a
byte-for-byte check of every asset through the edge (see `no_transform_enabled`). The
reason to want it off, measured 2026-11-10: with it on, Cloudflare decompresses our
precompressed responses and is then forbidden to re-compress them, so members get every
JS/CSS file uncompressed. Fonts and everything else keep `no-transform` always.

Why compression happens at build time. Commit 0e62823 took `/assets/*` out of the
runtime GZip middleware because streaming gzip of the large vendor chunks was also
truncated at the proxy (`_is_gzip_exempt` in api/main.py still says so, and must keep
saying so: compressing there would double-encode these files). The outcome was
correct and expensive, every JS and CSS byte went out uncompressed. So:
`app/scripts/precompress-assets.mjs` writes `<file>.br` and `<file>.gz` beside each
hashed file at build time, and this class picks one by Accept-Encoding. A sidecar is
an ordinary file on disk: it has a known Content-Length and nothing encodes it in
flight, which is exactly the property the two incidents above were missing.

Rules this class keeps, each railed in tests/test_precompressed_static_assets.py:

* A Range request always gets the PLAIN file. An offset into a compressed stream is
  not an offset into the file, so encoded responses also stop advertising
  `Accept-Ranges`, and an `If-Range` naming an encoded ETag falls through to the whole
  plain file, never to a slice of a different representation.
* Each representation has its own ETag, with the coding in it: two sidecars can share
  an mtime and a size, and a 304 for the wrong one would keep the wrong bytes.
* A sidecar is found ONLY through `lookup_path`, the same path guard the plain file
  goes through, and only after the plain file has been found. It is never addressable
  by its own name, because it would go out as compressed bytes with no Content-Encoding.
* A missing, empty or unreadable sidecar is not an error. The plain file is always a
  correct answer.
"""
from __future__ import annotations

import mimetypes
import os
import stat

import anyio.to_thread
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.responses import FileResponse
from starlette.staticfiles import NotModifiedResponse, StaticFiles

_NEGOTIATED_SUFFIXES = (".js", ".css")
# Server preference, used to break a tie in the client's q-values.
_SIDECAR_SUFFIX = {"br": ".br", "gzip": ".gz"}
_CACHE_CONTROL = "public, max-age=31536000, immutable, no-transform"
# Without `no-transform`: only for hashed JS/CSS, and only when ASSETS_NO_TRANSFORM_ENABLED=0 (see below).
_CACHE_CONTROL_EDGE_COMPRESSES = "public, max-age=31536000, immutable"

#: File types the built frontend ships that Python's own table does not know on the runtime
#: image: python:3.12-slim has no /etc/mime.types, and 3.12's built-in table has no web fonts,
#: so Starlette fell back to `text/plain`. Measured on production 2026-11-14: every `.woff2`
#: left the origin as `text/plain; charset=utf-8`, while Cloudflare was still handing out a
#: correctly typed copy it had cached 74 days earlier. Browsers load a font whatever its type,
#: so nothing looked wrong, which is how it lasted.
TYPES_THE_RUNTIME_LACKS = (("font/woff2", ".woff2"), ("font/woff", ".woff"))


def register_missing_types() -> None:
    """Teach `mimetypes` (the table Starlette's file responses read) the types above.
    Safe to call again: registering a type twice changes nothing."""
    for media_type, extension in TYPES_THE_RUNTIME_LACKS:
        mimetypes.add_type(media_type, extension)


register_missing_types()


def no_transform_enabled() -> bool:
    """`ASSETS_NO_TRANSFORM_ENABLED` (default ON, i.e. today's behaviour). Measured 2026-11-10: Cloudflare always
    decompresses a compressed origin response so it can re-encode it, and `no-transform` forbids the
    re-encode, so members received every JS/CSS file UNCOMPRESSED (main script 573 KB instead of 157 KB
    Brotli; ~6 MB first load instead of ~2 MB). Setting this to `0` drops `no-transform` from hashed
    JS/CSS only, letting Cloudflare compress them. That is safe ONLY together with the zone's Compression
    Rule restricting `/assets/*` to brotli or gzip (never zstd: zstd truncated the ECharts chunk,
    72f1c438f8), and only after every hashed asset has been verified byte-for-byte through the edge.
    Rollback: set it back to 1 (or unset), redeploy, then purge /assets at Cloudflare."""
    value = os.environ.get("ASSETS_NO_TRANSFORM_ENABLED", "1")
    return value.strip().lower() not in ("0", "false", "no")
_VARY = "Accept-Encoding"


def _quality(params: str) -> float:
    """The q-value in a coding's parameters. A malformed one reads as 0: refusing the
    coding leaves the plain file, which is always correct."""
    for param in params.split(";"):
        name, sep, value = param.partition("=")
        if sep and name.strip().lower() == "q":
            try:
                q = float(value.strip())
            except ValueError:
                return 0.0
            return q if 0.0 < q <= 1.0 else 0.0
    return 1.0


def accepted_codings(values: list[str]) -> list[str]:
    """The sidecar codings the client accepts, best first; ties go to server order."""
    qualities: dict[str, float] = {}
    for part in ",".join(values).split(","):
        token, _, params = part.strip().partition(";")
        token = token.strip().lower()
        if token:
            qualities[token] = _quality(params)
    wildcard = qualities.get("*", 0.0)
    ranked = [(qualities.get(coding, wildcard), coding) for coding in _SIDECAR_SUFFIX]
    return [coding for q, coding in sorted(ranked, key=lambda r: -r[0]) if q > 0.0]


def precompressed_enabled() -> bool:
    """The kill switch. Default on; `0`, `false` or `no` serve every asset plain, exactly
    as before this module negotiated. Read per request and cannot raise."""
    value = os.environ.get("PRECOMPRESSED_ASSETS_ENABLED", "1")
    return value.strip().lower() not in ("0", "false", "no")


def _is_sidecar_name(path: str) -> bool:
    return any(
        path.endswith(asset + suffix)
        for asset in _NEGOTIATED_SUFFIXES
        for suffix in _SIDECAR_SUFFIX.values()
    )


class ImmutableStaticFiles(StaticFiles):
    def _find_sidecar(self, path: str, codings: list[str]):
        """(coding, full path, stat) of the best sidecar, or None. Runs in a thread."""
        try:
            _, plain = self.lookup_path(path)
            if plain is None or not stat.S_ISREG(plain.st_mode):
                return None
            for coding in codings:
                full, found = self.lookup_path(path + _SIDECAR_SUFFIX[coding])
                if found is not None and stat.S_ISREG(found.st_mode) and found.st_size > 0:
                    return coding, full, found
        except OSError:
            return None
        return None

    def _encoded_response(self, path: str, coding: str, full, found, scope):
        response = FileResponse(
            full,
            stat_result=found,
            media_type=mimetypes.guess_type(path)[0] or "text/plain",
        )
        response.headers["Content-Encoding"] = coding
        response.headers["ETag"] = response.headers["etag"][:-1] + f'-{coding}"'
        del response.headers["accept-ranges"]
        self._stamp(response, negotiated=True)
        if self.is_not_modified(response.headers, Headers(scope=scope)):
            return NotModifiedResponse(response.headers)
        return response

    @staticmethod
    def _stamp(response, negotiated: bool) -> None:
        # `negotiated` is exactly the hashed JS/CSS set; everything else always keeps no-transform.
        edge_compresses = negotiated and not no_transform_enabled()
        response.headers["Cache-Control"] = _CACHE_CONTROL_EDGE_COMPRESSES if edge_compresses else _CACHE_CONTROL
        if negotiated:
            response.headers["Vary"] = _VARY

    async def get_response(self, path, scope):
        if "\x00" in path or _is_sidecar_name(path):
            raise HTTPException(status_code=404)
        negotiated = path.endswith(_NEGOTIATED_SUFFIXES) and precompressed_enabled()
        headers = Headers(scope=scope)
        if negotiated and scope["method"] in ("GET", "HEAD") and "range" not in headers:
            codings = accepted_codings(headers.getlist("accept-encoding"))
            if codings:
                sidecar = await anyio.to_thread.run_sync(self._find_sidecar, path, codings)
                if sidecar is not None:
                    return self._encoded_response(path, *sidecar, scope)
        response = await super().get_response(path, scope)
        if response.status_code in (200, 304):
            self._stamp(response, negotiated)
        return response

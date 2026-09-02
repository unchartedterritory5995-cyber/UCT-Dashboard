# tests/api/test_sse_gzip_exempt.py
"""Guard: every SSE endpoint must be GZip-exempt. GZip buffers the whole body, so
a gzipped event-stream never flushes and no events reach the client — this exact
regression broke the Floor chat stream (caught live 2026-07-11, fixed e72cf192)."""
from api.main import _is_gzip_exempt


def test_all_sse_endpoints_are_gzip_exempt():
    for p in ("/api/stream/prices", "/api/stream/bars",
              "/api/live/massive/stream", "/api/community/chat/stream",
              "/api/ai-search/stream"):
        assert _is_gzip_exempt(p), f"{p} would be gzip-buffered → SSE dead"


def test_regular_api_is_not_exempt():
    for p in ("/api/community/chat/channels", "/api/bars/NVDA", "/api/community/status"):
        assert not _is_gzip_exempt(p)


def test_notes_export_is_gzip_exempt():
    """The zip GZipMiddleware would re-compress here is already DEFLATE'd —
    hundreds of MB of re-gzip work for ~0% size gain, on the single shared
    event loop of a single-replica pod. Not an SSE endpoint (no streaming-body
    flush hazard) but the same "never gzip this" outcome for a different
    reason."""
    assert _is_gzip_exempt("/api/j2/notes/export")

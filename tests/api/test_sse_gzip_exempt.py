# tests/api/test_sse_gzip_exempt.py
"""Guard: every SSE endpoint must be GZip-exempt. GZip buffers the whole body, so
a gzipped event-stream never flushes and no events reach the client — this exact
regression broke the Floor chat stream (caught live 2026-07-11, fixed e72cf192).

⛔ THE LIST IS DERIVED, NOT TYPED. This file used to name six paths by hand
beside a function documented as "keep every SSE route here". A hand-typed list
beside the source that owns it is the defect class this repo keeps paying for,
and it behaved exactly as expected: when the sweep below was first run it found
SIX text/event-stream endpoints that were never added — the whole Compass chat
family (`/coach/chat/{cancel,confirm,redo_onboarding,start_onboarding,stream}`)
and `/api/live/massive/curated-stream`. Nobody had typed them in, and nothing
could tell.
"""
import inspect

from api.main import _is_gzip_exempt, app

_PATH_PARAM_SAMPLES = {
    "{note_id}": "abc123", "{account_id}": "acct1", "{ticker}": "NVDA",
    "{document_id}": "doc1", "{channel_id}": "chan1", "{user_id}": "u1",
}


def _concrete(path: str) -> str:
    for token, sample in _PATH_PARAM_SAMPLES.items():
        path = path.replace(token, sample)
    return path


def _sse_routes():
    """Every mounted route whose handler declares text/event-stream.

    Derived from the live app + the handler's own source, so a route added
    tomorrow is covered the day it lands.

    ⚠️ KNOWN LIMIT, stated rather than hidden: a handler that DELEGATES the
    StreamingResponse to a helper (as the unified Ask endpoints do) does not
    carry the literal in its own source and will not be found here. Those are
    covered by the explicit case below — the sweep is the net for everything
    written the ordinary way, not a proof of completeness.
    """
    found = {}
    for route in app.routes:
        fn = getattr(route, "endpoint", None)
        path = getattr(route, "path", None)
        if fn is None or not path:
            continue
        try:
            src = inspect.getsource(fn)
        except (OSError, TypeError):
            continue
        if "text/event-stream" in src:
            found[path] = True
    return sorted(found)


def test_the_sweep_sees_a_real_set_of_sse_routes():
    # Non-vacuity: an empty sweep would pass the assertion below forever.
    routes = _sse_routes()
    assert len(routes) >= 8, routes
    assert "/api/community/chat/stream" in routes   # the 2026-07-11 regression
    assert "/api/stream/prices" in routes


def test_every_sse_route_the_app_declares_is_gzip_exempt():
    offenders = [p for p in _sse_routes() if not _is_gzip_exempt(_concrete(p))]
    # Names, never a count — a failure must say WHICH route goes dead.
    assert offenders == []


def test_the_delegating_ask_endpoints_are_exempt():
    """The unified Ask handlers build their StreamingResponse in a shared
    helper, so the sweep above cannot see them. Named explicitly, with the
    reason, rather than left to a rail that structurally cannot cover them."""
    assert _is_gzip_exempt("/api/j2/ask/stream")
    assert _is_gzip_exempt("/api/j2/notes/abc123/ask/stream")


def test_regular_api_is_not_exempt():
    for p in ("/api/community/chat/channels", "/api/bars/NVDA", "/api/community/status"):
        assert not _is_gzip_exempt(p)


def test_a_status_endpoint_that_merely_says_stream_is_not_exempt():
    # Guards the other direction: the rule is "is it an event stream", not
    # "does the path contain the word".
    assert not _is_gzip_exempt("/api/admin/bars-stream-status")


def test_notes_export_is_gzip_exempt():
    """The zip GZipMiddleware would re-compress here is already DEFLATE'd —
    hundreds of MB of re-gzip work for ~0% size gain, on the single shared
    event loop of a single-replica pod. Not an SSE endpoint (no streaming-body
    flush hazard) but the same "never gzip this" outcome for a different
    reason."""
    assert _is_gzip_exempt("/api/j2/notes/export")

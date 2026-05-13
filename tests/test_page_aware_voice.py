"""
P4-B unification — page-aware Compass voice tests.

Verifies the _describe_page_hint helper that turns a route pathname into
a system-prompt block, and that the session_token endpoint passes the
hint through (smoke).
"""

from api.routers.voice import _describe_page_hint


# ── _describe_page_hint ───────────────────────────────────────────────────

def test_describe_empty_hint_returns_empty():
    assert _describe_page_hint("") == ""
    assert _describe_page_hint("   ") == ""
    assert _describe_page_hint(None or "") == ""


def test_describe_known_root_routes():
    out = _describe_page_hint("/journal")
    assert "CURRENT PAGE" in out
    assert "Journal" in out  # the friendly description
    assert "END CURRENT PAGE" in out


def test_describe_dashboard_route():
    out = _describe_page_hint("/dashboard")
    assert "Dashboard" in out


def test_describe_strips_query_string():
    out = _describe_page_hint("/screener?type=remount")
    assert "Scanner Hub" in out  # friendly description for /screener


def test_describe_handles_sub_routes():
    """/journal/foo should fall back to /journal description."""
    out = _describe_page_hint("/journal/2-0/beta")
    assert "Journal" in out


def test_describe_unknown_path_includes_path():
    """An unknown path still produces a usable block with the raw path."""
    out = _describe_page_hint("/some-new-feature")
    assert "CURRENT PAGE" in out
    assert "some-new-feature" in out


def test_describe_freeform_text_passes_through():
    """A non-URL hint like 'chart of NVDA, daily' is used verbatim."""
    out = _describe_page_hint("chart of NVDA, daily timeframe")
    assert "CURRENT PAGE" in out
    assert "chart of NVDA" in out
    assert "daily timeframe" in out


def test_describe_freeform_text_gets_terminal_period():
    """Free-form hint without a trailing period gets one added."""
    out = _describe_page_hint("looking at AAPL")
    assert "looking at AAPL." in out


def test_describe_handles_trailing_slash():
    out = _describe_page_hint("/journal/")
    assert "Journal" in out


def test_describe_root_path():
    """`/` is treated as an unknown root, not crashing."""
    out = _describe_page_hint("/")
    assert "CURRENT PAGE" in out


# ── End-to-end smoke through session_token (light) ────────────────────────

def test_session_token_request_model_accepts_page_hint():
    """The SessionTokenRequest pydantic model has the field."""
    from api.routers.voice import SessionTokenRequest
    body = SessionTokenRequest(context="compass", page_hint="/journal")
    assert body.page_hint == "/journal"
    # Optional / defaults to None
    body2 = SessionTokenRequest(context="compass")
    assert body2.page_hint is None

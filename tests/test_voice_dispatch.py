"""Voice dispatch — wraps voice_tools.dispatch with audit logging + Realtime-format normalization."""

from unittest.mock import patch
from api.services import voice_dispatch
from api.services.auth_db import init_db


def test_run_tool_returns_normalized_result():
    init_db()
    from api.services import voice_tools, voice_tool_impls  # noqa
    with patch("api.services.voice_dispatch.dispatch", return_value={"symbol": "NVDA", "last": 487.20}):
        out = voice_dispatch.run_tool(
            session_id=None,
            user_id="u-1",
            tool_name="get_quote",
            args={"symbol": "NVDA"},
        )
    assert out["ok"] is True
    assert out["result"]["symbol"] == "NVDA"


def test_run_tool_unknown_returns_error_envelope():
    init_db()
    out = voice_dispatch.run_tool(
        session_id=None,
        user_id="u-1",
        tool_name="this_tool_does_not_exist",
        args={},
    )
    assert out["ok"] is False
    assert "not found" in out["error"].lower() or "unknown" in out["error"].lower()


def test_run_tool_arg_mismatch_returns_error():
    init_db()
    from api.services import voice_tools

    @voice_tools.voice_tool(
        name="dispatch_test_strict",
        description="d",
        parameters={"a": {"type": "integer"}},
        contexts=["global"],
    )
    def _strict(a: int):
        return {"ok": True}

    out = voice_dispatch.run_tool(
        session_id=None, user_id="u-1",
        tool_name="dispatch_test_strict", args={"wrong_key": 1},
    )
    assert out["ok"] is False

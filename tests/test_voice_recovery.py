"""Voice tool-failure recovery hints."""

from api.services import voice_recovery as vr


def test_annotate_success_result_untouched():
    out = vr.annotate_failure("get_quote", {"ok": True, "narration": "NVDA at 200"})
    assert "recovery_hint" not in out


def test_annotate_failure_for_known_tool():
    out = vr.annotate_failure("set_price_alert", {"ok": False,
                                                  "narration": "Should that alert fire above or below the price?"})
    assert out["recovery_hint"]["next_action"] == "ask_clarification"
    assert "above or below" in out["recovery_hint"]["prompt"].lower()


def test_annotate_existing_hint_preserved():
    seed = {"ok": False, "narration": "x", "recovery_hint": {"next_action": "custom", "prompt": "my hint"}}
    out = vr.annotate_failure("flag_ticker", seed)
    assert out["recovery_hint"]["next_action"] == "custom"


def test_annotate_unknown_tool_uses_default():
    out = vr.annotate_failure("nonexistent_tool", {"ok": False, "error": "boom"})
    assert out["recovery_hint"]["next_action"] == "retry"


def test_annotate_missing_symbol_pattern():
    """Generic 'I need a ticker' style errors get the missing_symbol hint."""
    out = vr.annotate_failure(
        "get_insider_activity",
        {"ok": False, "narration": "I need a ticker symbol."},
    )
    assert out["recovery_hint"]["next_action"] == "ask_clarification"
    assert "ticker" in out["recovery_hint"]["prompt"].lower()


def test_annotate_tool_not_found_dispatch_error():
    out = vr.annotate_failure(
        "made_up_tool",
        {"ok": False, "error": "tool 'made_up_tool' not found"},
        dispatch_error="tool 'made_up_tool' not found",
    )
    assert out["recovery_hint"]["next_action"] == "try_alternate_tool"


def test_non_dict_result_returned_unchanged():
    assert vr.annotate_failure("x", None) is None
    assert vr.annotate_failure("x", "string") == "string"

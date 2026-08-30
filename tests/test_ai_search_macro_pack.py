"""The economic calendar the desk holds but never hands over (2026-08-29).

Two defects, one root:

  * `voice_tool_impls._economic_calendar()` imports `engine.get_macro_events`,
    which DOES NOT EXIST. The `except (ImportError, AttributeError): return []`
    swallows it, so the agent lane's `get_economic_calendar` tool has been
    permanently answering "no upcoming events available".
  * the fast lane has no macro pack at all, so "when is the next CPI print"
    reaches the model with `regime` grounding and nothing else.

The real feed is `econ_calendar_fmp.fetch_us_econ_week`, already powering the
Calendar page and the week poster.
"""
import pytest

import api.routers.ai_search as ai

_WEEK = {
    "2026-08-31": [{"time": "08:30", "event": "Core PCE Price Index m/m",
                    "estimate": "0.2%", "prior": "0.3%", "is_fed": False}],
    "2026-09-02": [{"time": "14:00", "event": "FOMC Statement",
                    "estimate": "", "prior": "", "is_fed": True}],
}


def _stub_week(monkeypatch, payload):
    from api.services import econ_calendar_fmp
    monkeypatch.setattr(econ_calendar_fmp, "fetch_us_econ_week",
                        lambda *a, **k: payload)


# ── the agent lane's tool was permanently empty ────────────────────────────
def test_the_agent_economic_calendar_tool_returns_real_events(monkeypatch):
    """It imported a function that does not exist and swallowed the ImportError,
    so it answered "no upcoming events available" every time, forever."""
    _stub_week(monkeypatch, _WEEK)
    from api.services import voice_tool_impls
    out = voice_tool_impls._get_economic_calendar()
    assert out["count"] > 0, out
    assert "PCE" in out["events"] or "FOMC" in out["events"], out


def test_an_empty_week_still_answers_honestly(monkeypatch):
    """CONTROL — a genuinely empty calendar must say so, not raise."""
    _stub_week(monkeypatch, {})
    from api.services import voice_tool_impls
    assert voice_tool_impls._get_economic_calendar()["count"] == 0


# ── the fast lane gets a macro pack ────────────────────────────────────────
@pytest.mark.parametrize("q", [
    "when is the next CPI print",
    "what's on the economic calendar this week",
    "when does the Fed decide on rates",
    "when is the jobs report",
])
def test_a_macro_question_opens_the_macro_gate(q):
    assert ai._MACRO_CAL_RE.search(q), q


@pytest.mark.parametrize("q", [
    "what is NVDA trading at",
    "what were the biggest gainers today",
])
def test_a_single_stock_question_does_not(q):
    """CONTROL — the macro pack costs an external call; a stock question must
    not pay for it."""
    assert not ai._MACRO_CAL_RE.search(q), q


def test_the_macro_pack_renders_the_week(monkeypatch):
    _stub_week(monkeypatch, _WEEK)
    out = ai._ctx_macro()
    assert "PCE" in out and "FOMC" in out, out
    assert "2026-08-31" in out or "08/31" in out, out


def test_the_macro_pack_is_silent_when_the_feed_is_empty(monkeypatch):
    """CONTROL — silence here is correct: _INTENT_SPECS packs that return ""
    are declared as a DESK GAP by the assembler, which is the honest answer."""
    _stub_week(monkeypatch, {})
    assert ai._ctx_macro() == ""


def test_a_dead_feed_never_raises_into_an_answer(monkeypatch):
    """CONTROL — grounding is best-effort; a provider outage must not break the
    ask."""
    from api.services import econ_calendar_fmp

    def _boom(*a, **k):
        raise RuntimeError("FMP down")

    monkeypatch.setattr(econ_calendar_fmp, "fetch_us_econ_week", _boom)
    assert ai._ctx_macro() == ""


def test_the_macro_pack_is_wired_into_the_intent_table():
    """lesson_built_tested_green_and_unreachable — a pack absent from
    _INTENT_SPECS is a green test file attached to nothing."""
    assert any(fn == "_ctx_macro" for _rx, fn in ai._INTENT_SPECS), \
        "_ctx_macro is not registered in _INTENT_SPECS"

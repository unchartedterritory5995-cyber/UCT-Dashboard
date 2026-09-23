"""
PACKET-W CP1 (fingerprint 425778f2c) — Compass regime/Exposure-Backdrop
vocabulary collision (RG-32).

journal_two's own four-tier bucket (green/amber/orange/red) is a pure
Exposure-Rating read; voice_regime_classifier.get_current_regime() (reached
via the shared `get_regime` tool) is a broader, independent 5-way market
classification. Both used the bare word "regime" in member/LLM-facing text,
so the two could disagree inside one Compass conversation while both claiming
to describe "the regime" -- the whole finding.

These tests prove: (1) the WORDS retired from journal_two's own surfaces,
(2) the underlying dict keys / stored data are UNCHANGED, and (3) the
`get_regime` tool's chat-side description now matches what it actually
returns instead of describing journal_two's vocabulary.
"""
import inspect

from api.services.journal_two import coach_chat
from api.services.journal_two import pre_trade_verdict as ptv
from api.services.journal_two import coach_chat_tools
import api.services.voice_tools as voice_tools
import api.services.voice_tool_impls  # noqa: F401 -- registers tools at import


def test_current_regime_context_uses_exposure_backdrop_wording(monkeypatch):
    monkeypatch.setattr(
        "api.services.journal_two.regime.get_current_regime",
        lambda: {"regime": "green", "exposure_pct": 72},
    )
    ctx = coach_chat._current_regime_context()
    assert "Exposure Backdrop is green" in ctx
    assert "exposure score 72" in ctx
    # The bare word "regime" never reaches the LLM-facing sentence.
    assert "regime" not in ctx.lower()


def test_current_regime_context_empty_when_no_regime(monkeypatch):
    monkeypatch.setattr(
        "api.services.journal_two.regime.get_current_regime",
        lambda: {},
    )
    assert coach_chat._current_regime_context() == ""


def test_current_regime_context_swallows_exceptions(monkeypatch):
    def _boom():
        raise RuntimeError("classifier unavailable")

    monkeypatch.setattr(
        "api.services.journal_two.regime.get_current_regime", _boom
    )
    assert coach_chat._current_regime_context() == ""


def test_current_regime_context_dict_key_read_is_unchanged():
    # The stored/dict key stays `regime` -- only the rendered word changes.
    src = inspect.getsource(coach_chat._current_regime_context)
    assert 'info.get("regime")' in src


def test_pre_trade_verdict_prompt_uses_exposure_backdrop_label():
    src = inspect.getsource(ptv._llm_verdict)
    assert "## Current Exposure Backdrop: {regime_label" in src
    assert "## Current regime:" not in src
    # The dict-key read is unchanged -- only the displayed label moved.
    assert 'info.get("regime")' in src


def test_get_regime_chat_tool_description_matches_the_real_tool():
    # coach_chat_tools' entry delegates to voice_tools' registered
    # implementation (via _voice_delegate) -- its description must describe
    # THAT tool, not journal_two's own four-tier bucket. `get_regime` lives in
    # `_BRAIN_TOOLS`, merged into the live `TOOLS` dict only when
    # BRAIN_TOOLS_ENABLED=1 was set at import time -- read the source dict
    # directly so this test doesn't depend on that env var.
    chat_desc = coach_chat_tools._BRAIN_TOOLS["get_regime"]["description"]
    real_desc = voice_tools._REGISTRY["get_regime"]["description"]

    # It no longer claims journal_two's GREEN/YELLOW/ORANGE/RED vocabulary...
    assert "GREEN/YELLOW/ORANGE/RED" not in chat_desc
    # ...and it now names the actual classification voice_regime_classifier
    # returns (the same terms the real tool's own description uses).
    for term in ("bull_trend", "bear_trend", "chop"):
        assert term in chat_desc
        assert term in real_desc

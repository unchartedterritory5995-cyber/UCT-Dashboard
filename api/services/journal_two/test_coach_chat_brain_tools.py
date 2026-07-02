import importlib

import pytest


def _reload_tools(monkeypatch, enabled: bool):
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1" if enabled else "0")
    import api.services.journal_two.coach_chat_tools as cct
    return importlib.reload(cct)


@pytest.fixture(autouse=True)
def _restore_registry(monkeypatch):
    yield
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "0")
    import api.services.journal_two.coach_chat_tools as cct
    importlib.reload(cct)


def test_brain_tools_absent_when_flag_off(monkeypatch):
    cct = _reload_tools(monkeypatch, enabled=False)
    assert "ask_the_brain" not in cct.TOOLS
    assert "get_quote" not in cct.TOOLS


def test_brain_and_parity_tools_present_when_flag_on(monkeypatch):
    cct = _reload_tools(monkeypatch, enabled=True)
    for name in ("ask_the_brain", "lookup_playbook", "setup_winrate",
                 "find_historical_analogs", "size_a_trade",
                 "get_quote", "get_regime", "get_breadth"):
        assert name in cct.TOOLS, name
        spec = cct.TOOLS[name]
        assert spec["requires_confirm"] is False
        assert spec["input_schema"]["type"] == "object"


def test_executor_signature_and_delegation(monkeypatch):
    cct = _reload_tools(monkeypatch, enabled=True)
    from api.services import brain_service
    monkeypatch.setattr(brain_service, "lookup_playbook",
                        lambda setup_name: {"ok": True, "name": setup_name})
    out = cct.TOOLS["lookup_playbook"]["executor"](
        user_id="u1", account_id="a1", args={"setup_name": "VCP"}, conn=None)
    assert out == {"ok": True, "name": "VCP"}


def test_get_quote_delegates_to_voice_registry(monkeypatch):
    cct = _reload_tools(monkeypatch, enabled=True)
    from api.services import voice_tools
    monkeypatch.setattr(voice_tools, "dispatch",
                        lambda name, args, user=None: {"ok": True, "tool": name, "args": args})
    out = cct.TOOLS["get_quote"]["executor"](
        user_id="u1", account_id="a1", args={"symbol": "nvda"}, conn=None)
    assert out["tool"] == "get_quote" and out["args"]["symbol"] == "nvda"

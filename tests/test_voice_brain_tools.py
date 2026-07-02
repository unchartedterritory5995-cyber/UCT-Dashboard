import importlib
import os

import pytest


def _reload_voice(monkeypatch, enabled: bool):
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1" if enabled else "0")
    from api.services import voice_tools, voice_tool_impls
    voice_tools._REGISTRY.clear()
    importlib.reload(voice_tool_impls)
    return voice_tools


def test_brain_tools_absent_when_flag_off(monkeypatch):
    vt = _reload_voice(monkeypatch, enabled=False)
    assert "ask_the_brain" not in vt._REGISTRY
    assert "lookup_playbook" not in vt._REGISTRY


def test_brain_tools_registered_when_flag_on(monkeypatch):
    vt = _reload_voice(monkeypatch, enabled=True)
    for name in ("ask_the_brain", "lookup_playbook", "setup_winrate",
                 "find_historical_analogs", "size_a_trade"):
        assert name in vt._REGISTRY, name


def test_lookup_playbook_dispatch_returns_dict(monkeypatch):
    vt = _reload_voice(monkeypatch, enabled=True)
    from api.services import brain_service
    monkeypatch.setattr(brain_service, "lookup_playbook",
                        lambda setup_name: {"ok": True, "name": "HTF"})
    out = vt.dispatch("lookup_playbook", {"setup_name": "HTF"}, user={"id": "u1"})
    assert out == {"ok": True, "name": "HTF"}


def test_compass_core_set_includes_brain_tools(monkeypatch):
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1")
    from api.services import voice_agents
    for name in ("ask_the_brain", "lookup_playbook", "setup_winrate", "size_a_trade"):
        assert name in voice_agents._COMPASS_CORE_TOOLS, name
        assert name in voice_agents._compass_tool_union(), name

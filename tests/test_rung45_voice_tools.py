import importlib


def test_registered_when_flag_on(monkeypatch):
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1")
    from api.services import voice_tools, voice_tool_impls
    voice_tools._REGISTRY.clear()
    importlib.reload(voice_tool_impls)
    assert "portfolio_heat" in voice_tools._REGISTRY
    assert "grade_watchlist" in voice_tools._REGISTRY


def test_in_compass_union_and_core(monkeypatch):
    monkeypatch.setenv("BRAIN_TOOLS_ENABLED", "1")
    from api.services import voice_agents
    for t in ("portfolio_heat", "grade_watchlist"):
        assert t in voice_agents._COMPASS_CORE_TOOLS
        assert t in voice_agents._compass_tool_union()

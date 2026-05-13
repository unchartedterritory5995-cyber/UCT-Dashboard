"""
Phase 1 of Compass × Voice unification — agent foundation tests.

Verifies:
  - compass agent is registered with the full tool catalog union
  - compass.system_prompt resolves lazily and includes both Compass chat
    prompt content and the voice-mode addendum
  - list_agents() returns ONLY Compass (5 specialists hidden from UI)
  - The 5 specialists are still callable in code (eval shadow)
"""

from api.services.voice_agents import (
    AGENTS, get_agent, list_agents, _compass_tool_union,
)


def test_compass_agent_registered():
    compass = get_agent("compass")
    assert compass is not None
    assert compass["id"] == "compass"
    assert compass["emoji"] == "🧭"


def test_compass_system_prompt_resolves():
    compass = get_agent("compass")
    sp = compass.get("system_prompt", "")
    assert sp, "compass system_prompt must resolve via _system_prompt_loader"
    # From the existing Compass chat prompt
    assert "You are Compass" in sp
    assert "Voice principles" in sp or "voice principles" in sp.lower()
    # From the voice-mode addendum
    assert "voice mode" in sp.lower()
    assert "validate_trade" in sp
    assert "Audio formatting" in sp or "audio formatting" in sp.lower()
    assert "intervention rule" in sp.lower()


def test_compass_tool_union_includes_all_specialist_tools():
    union = _compass_tool_union()
    # route_to_agent is deliberately excluded (compass doesn't route)
    assert "route_to_agent" not in union
    # Sample tools from each specialist
    assert "get_quote" in union               # analyst
    assert "validate_trade" in union          # risk_officer
    assert "get_my_psychology" in union       # coach
    assert "get_scanner_candidates" in union  # scout
    assert "remember" in union                # global memory
    # P9 deep data tools
    assert "get_bar_summary" in union
    assert "get_pattern_detection" in union
    assert "get_trade_detail" in union
    assert "get_recent_alerts" in union
    assert "get_breadth_history" in union


def test_compass_tool_allowlist_is_the_union():
    compass = get_agent("compass")
    assert compass["tool_allowlist"] == _compass_tool_union()


def test_list_agents_only_returns_compass():
    """Phase 1: specialists are hidden from the UI picker."""
    agents = list_agents()
    ids = {a["id"] for a in agents}
    assert ids == {"compass"}


def test_specialists_still_callable_in_code():
    """The 5 specialist agents survive as eval shadow variants."""
    for sid in ("orchestrator", "analyst", "risk_officer", "coach", "scout"):
        a = get_agent(sid)
        assert a is not None, f"{sid} should remain registered for eval shadow"
        assert "system_prompt" in a


def test_compass_alias_lookup():
    """Compass should be findable by id or display_name."""
    by_id = get_agent("compass")
    by_name = get_agent("Compass")
    assert by_id is not None and by_name is not None
    assert by_id["id"] == by_name["id"]


def test_voice_router_routes_global_to_compass():
    """The voice/session_token endpoint must route ctx='global' to compass."""
    import inspect
    from api.routers import voice as voice_router
    src = inspect.getsource(voice_router)
    # Look for the routing block (Phase 1 of unification)
    assert "_SPECIALIST_CTXS" in src
    assert 'ctx = "compass"' in src or "ctx = 'compass'" in src

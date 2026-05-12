"""Voice agents — specialist personas + routing."""

import pytest
from api.services import voice_agents as va
from api.services import voice_tools


def test_five_agents_defined():
    """4 specialists + 1 orchestrator (Batch 10d)."""
    assert set(va.AGENTS.keys()) == {
        "orchestrator", "analyst", "risk_officer", "coach", "scout",
    }


def test_orchestrator_has_route_tool():
    """Orchestrator's primary action is routing."""
    assert "route_to_agent" in va.AGENTS["orchestrator"]["tool_allowlist"]


def test_orchestrator_does_not_get_create_position():
    """Orchestrator routes; it doesn't write trades."""
    assert "create_position" not in va.AGENTS["orchestrator"]["tool_allowlist"]


def test_each_agent_has_required_fields():
    required = {"id", "display_name", "emoji", "color", "voice",
                "description", "system_prompt", "tool_allowlist"}
    for agent_id, agent in va.AGENTS.items():
        missing = required - set(agent.keys())
        assert not missing, f"{agent_id} missing fields: {missing}"
        assert isinstance(agent["tool_allowlist"], set), \
            f"{agent_id} tool_allowlist must be a set"
        assert len(agent["tool_allowlist"]) > 0
        assert len(agent["system_prompt"]) > 100


def test_get_agent_by_id():
    a = va.get_agent("analyst")
    assert a is not None
    assert a["id"] == "analyst"


def test_get_agent_by_display_name():
    a = va.get_agent("Risk Officer")
    assert a is not None
    assert a["id"] == "risk_officer"


def test_get_agent_case_insensitive():
    a = va.get_agent("ANALYST")
    assert a is not None
    assert a["id"] == "analyst"


def test_get_agent_unknown_returns_none():
    assert va.get_agent("janitor") is None
    assert va.get_agent("") is None
    assert va.get_agent(None) is None


def test_list_agents_returns_safe_dicts():
    out = va.list_agents()
    assert len(out) == 5  # orchestrator + 4 specialists
    for a in out:
        assert set(a.keys()) == {
            "id", "display_name", "emoji", "color", "voice", "description"
        }


def test_route_to_agent_valid():
    out = va.route_to_agent_tool(target="analyst", reason="needs analysis")
    assert out["ok"] is True
    assert out["client_action"]["type"] == "switch_agent"
    assert out["client_action"]["agent_id"] == "analyst"


def test_route_to_agent_unknown():
    out = va.route_to_agent_tool(target="banana")
    assert out["ok"] is False


# ── Allowlist contents ──────────────────────────────────────────────────────

def test_risk_officer_has_validate_trade():
    assert "validate_trade" in va.AGENTS["risk_officer"]["tool_allowlist"]


def test_risk_officer_can_write_trades():
    """Risk officer is the only agent that can do trade writes (with veto)."""
    allow = va.AGENTS["risk_officer"]["tool_allowlist"]
    assert "create_position" in allow
    assert "confirm_action" in allow


def test_coach_does_not_get_create_position():
    """Coach should not be doing trade writes — that's risk officer."""
    assert "create_position" not in va.AGENTS["coach"]["tool_allowlist"]


def test_scout_has_opportunity_tools():
    allow = va.AGENTS["scout"]["tool_allowlist"]
    assert "get_scanner_candidates" in allow
    assert "get_uct20_picks" in allow
    assert "flag_ticker" in allow


def test_analyst_has_market_reads():
    allow = va.AGENTS["analyst"]["tool_allowlist"]
    assert "get_quote" in allow
    assert "get_regime" in allow
    assert "lookup_trading_principle" in allow


def test_every_agent_can_route_to_others():
    """Every agent needs route_to_agent so they can hand off."""
    for agent in va.AGENTS.values():
        assert "route_to_agent" in agent["tool_allowlist"]


def test_train_me_context_isolation_unchanged():
    """train_me remains a non-agent context restricted to memory tools."""
    import api.services.voice_tool_impls  # noqa: F401  # populate registry
    tools = voice_tools.get_schema_for_context("train_me")
    names = {t["name"] for t in tools}
    # Must include the 4 core memory tools + recall_relevant (Batch 8a).
    # Must NOT include trade reads/writes etc.
    assert {"remember", "forget", "list_my_facts", "correct_me"}.issubset(names)
    assert "get_quote" not in names
    assert "create_position" not in names
    assert "get_regime" not in names
    # Cap on size — should stay tight as we add tools
    assert len(names) <= 10


# ── Tool registry agent-context filtering ───────────────────────────────────

def test_get_schema_for_agent_context_filters_tools():
    # Force the registry to load by importing tool_impls
    import api.services.voice_tool_impls  # noqa: F401
    analyst_tools = voice_tools.get_schema_for_context("analyst")
    global_tools = voice_tools.get_schema_for_context("global")
    # Analyst should have fewer tools than global
    assert 0 < len(analyst_tools) < len(global_tools)
    names = {t["name"] for t in analyst_tools}
    # Spot-check inclusions
    assert "get_quote" in names
    assert "get_regime" in names
    # Spot-check exclusion — create_position belongs to risk_officer
    assert "create_position" not in names


def test_get_schema_for_unknown_agent_returns_empty():
    """Unknown agent context with no global-context tools returns []."""
    import api.services.voice_tool_impls  # noqa: F401
    tools = voice_tools.get_schema_for_context("janitor")
    assert tools == []

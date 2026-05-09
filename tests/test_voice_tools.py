"""Voice tool registry + dispatcher."""

import pytest
from api.services import voice_tools


def setup_function(_):
    voice_tools._REGISTRY.clear()


def test_register_tool_via_decorator():
    @voice_tools.voice_tool(
        name="dummy",
        description="A dummy tool for tests",
        parameters={"x": {"type": "string"}},
        contexts=["global"],
    )
    def dummy(x: str) -> dict:
        return {"echo": x}

    assert "dummy" in voice_tools._REGISTRY
    schema = voice_tools.get_schema_for_context("global")
    assert any(t["name"] == "dummy" for t in schema)


def test_get_schema_filters_by_context():
    @voice_tools.voice_tool(name="g_only", description="d", parameters={}, contexts=["global"])
    def g_only():
        return {}

    @voice_tools.voice_tool(name="chart_only", description="d", parameters={}, contexts=["chart"])
    def chart_only():
        return {}

    g_schema = voice_tools.get_schema_for_context("global")
    c_schema = voice_tools.get_schema_for_context("chart")

    g_names = {t["name"] for t in g_schema}
    c_names = {t["name"] for t in c_schema}

    assert "g_only" in g_names and "chart_only" not in g_names
    assert "chart_only" in c_names and "g_only" not in c_names


def test_dispatch_calls_tool_and_returns_dict():
    @voice_tools.voice_tool(name="add", description="d", parameters={
        "a": {"type": "integer"}, "b": {"type": "integer"}}, contexts=["global"])
    def add(a, b):
        return {"sum": a + b}

    result = voice_tools.dispatch("add", {"a": 2, "b": 3}, user={"id": "test"})
    assert result == {"sum": 5}


def test_dispatch_unknown_tool_raises():
    with pytest.raises(KeyError, match="not found"):
        voice_tools.dispatch("does_not_exist", {}, user={"id": "test"})


def test_dispatch_passes_user_when_tool_accepts_it():
    @voice_tools.voice_tool(name="who", description="d", parameters={}, contexts=["global"], wants_user=True)
    def who(user):
        return {"id": user["id"]}

    result = voice_tools.dispatch("who", {}, user={"id": "u-42"})
    assert result == {"id": "u-42"}

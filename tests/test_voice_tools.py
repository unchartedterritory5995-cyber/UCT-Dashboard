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


# ── Tool implementations (Slice 2 reads) ────────────────────────────────────

def test_tool_implementations_register_on_import():
    from api.services import voice_tool_impls  # noqa: F401
    names = voice_tools.all_tool_names()
    expected = {
        "get_quote", "get_movers", "get_breadth", "get_sector_strength",
        "get_company_info", "compare_tickers",
    }
    assert expected.issubset(set(names))


def test_get_quote_calls_snapshot(monkeypatch):
    from api.services import voice_tool_impls

    captured = {}
    def fake_snapshot(sym):
        captured["sym"] = sym
        # Real Massive shape: close, change_pct, change, vwap
        return {"close": 487.20, "change_pct": 2.10, "change": 10.0, "vwap": 480.5}

    monkeypatch.setattr(voice_tool_impls, "_snapshot", fake_snapshot)

    out = voice_tools.dispatch("get_quote", {"symbol": "nvda"}, user={"id": "u"})
    assert captured["sym"] == "NVDA"
    assert out["symbol"] == "NVDA"
    assert out["last"] == 487.20
    assert out["direction"] == "up"
    assert round(out["abs_pct"], 1) == 2.1


def test_get_movers_returns_summary(monkeypatch):
    from api.services import voice_tool_impls
    monkeypatch.setattr(voice_tool_impls, "_movers", lambda: {
        "ripping": [{"sym": "AAA", "pct": 12.5}, {"sym": "BBB", "pct": 8.0}],
        "drilling": [{"sym": "ZZZ", "pct": -7.2}],
    })

    up = voice_tools.dispatch("get_movers", {"direction": "gainers", "count": 2}, user={"id": "u"})
    assert "AAA" in up["top_movers"]
    assert "12" in up["top_movers"]


def test_compare_tickers(monkeypatch):
    from api.services import voice_tool_impls

    snapshots = {
        "AAPL": {"close": 200, "change_pct": 1.5, "change": 3.0, "vwap": 199},
        "MSFT": {"close": 400, "change_pct": -0.5, "change": -2.0, "vwap": 401},
    }
    monkeypatch.setattr(voice_tool_impls, "_snapshot", lambda sym: snapshots[sym])

    out = voice_tools.dispatch("compare_tickers", {"symbols": ["AAPL", "MSFT"]}, user={"id": "u"})
    assert "AAPL" in out["summary"] and "MSFT" in out["summary"]


def test_tool_set_2_registers():
    from api.services import voice_tool_impls  # noqa
    names = set(voice_tools.all_tool_names())
    expected = {"get_news", "get_earnings_today", "get_theme_status",
                "get_options_flow", "get_dark_pool", "get_economic_calendar"}
    assert expected.issubset(names)


def test_get_news_returns_headline_summary(monkeypatch):
    from api.services import voice_tool_impls
    monkeypatch.setattr(voice_tool_impls, "_news", lambda symbol=None: [
        {"headline": "Apple beats earnings"},
        {"headline": "Microsoft cloud revenue up"},
    ])
    out = voice_tools.dispatch("get_news", {"count": 2}, user={"id": "u"})
    assert "Apple" in out["headlines"] or "earnings" in out["headlines"]
    assert out["count"] == 2


def test_get_earnings_today(monkeypatch):
    from api.services import voice_tool_impls
    monkeypatch.setattr(voice_tool_impls, "_earnings_today", lambda: [
        {"sym": "AAPL", "session": "AMC"},
        {"sym": "GOOGL", "session": "AMC"},
    ])
    out = voice_tools.dispatch("get_earnings_today", {}, user={"id": "u"})
    assert "AAPL" in out["tickers"]
    assert out["count"] == 2


# ── Memory tools (Slice 8) ──────────────────────────────────────────────────

def test_memory_tools_register():
    from api.services import voice_tool_impls  # noqa
    names = set(voice_tools.all_tool_names())
    expected = {"remember", "forget", "list_my_facts", "recall_session"}
    assert expected.issubset(names)


def test_remember_tool_persists_fact():
    from api.services.auth_db import init_db
    from api.services.auth_service import create_user
    init_db()
    uid = create_user(f"r_{__import__('uuid').uuid4()}@example.com", "p")["id"]

    out = voice_tools.dispatch(
        "remember",
        {"fact": "I trade small caps under $5B", "category": "style"},
        user={"id": uid},
    )
    assert out["ok"] is True

    from api.services.voice_memory_service import list_facts
    facts = list_facts(uid)
    assert any("small caps" in f["text"] for f in facts)


def test_forget_tool_removes_matching():
    from api.services.auth_db import init_db
    from api.services.auth_service import create_user
    from api.services.voice_memory_service import add_fact, list_facts
    init_db()
    uid = create_user(f"f_{__import__('uuid').uuid4()}@example.com", "p")["id"]
    add_fact(uid, text="I trade options on weekends", category="style")
    add_fact(uid, text="My main account is Swing", category="account_alias")

    out = voice_tools.dispatch("forget", {"query": "options"}, user={"id": uid})
    assert out["removed"] >= 1

    facts = list_facts(uid)
    assert not any("options" in f["text"] for f in facts)


def test_list_my_facts_tool():
    from api.services.auth_db import init_db
    from api.services.auth_service import create_user
    from api.services.voice_memory_service import add_fact
    init_db()
    uid = create_user(f"l_{__import__('uuid').uuid4()}@example.com", "p")["id"]
    add_fact(uid, text="I prefer dollar amounts over percentages", category="preference")

    out = voice_tools.dispatch("list_my_facts", {}, user={"id": uid})
    assert "dollar amounts" in out["facts_text"]
    assert out["count"] >= 1


def test_recall_session_tool():
    from api.services.auth_db import init_db
    from api.services.auth_service import create_user
    from api.services.voice_session_service import create_session
    from api.services.voice_memory_service import add_summary
    init_db()
    uid = create_user(f"rs_{__import__('uuid').uuid4()}@example.com", "p")["id"]
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")
    add_summary(session_id=sid, user_id=uid,
                summary_text="Discussed NVDA earnings setup",
                key_topics=["NVDA", "earnings"])

    out = voice_tools.dispatch("recall_session", {"query": "NVDA"}, user={"id": uid})
    assert "NVDA" in out["recall_text"]
    assert out["count"] >= 1


# ── Agentic flows (Slice 6) ────────────────────────────────────────────────

def test_agentic_flows_register():
    from api.services import voice_tool_impls  # noqa
    names = set(voice_tools.all_tool_names())
    expected = {"morning_briefing", "closing_briefing", "pre_trade_check",
                "post_trade_review", "plan_my_day"}
    assert expected.issubset(names)


def test_morning_briefing_tool_returns_narration(monkeypatch):
    from api.services import voice_tool_impls, voice_briefings  # noqa

    monkeypatch.setattr(voice_briefings, "_get_breadth", lambda: {
        "breadth_score": 75, "advancing": 320, "declining": 180, "market_phase": "uptrend"})
    monkeypatch.setattr(voice_briefings, "_get_themes", lambda: {"leaders": [
        {"name": "Semis", "pct": "+2.5%"}]})
    monkeypatch.setattr(voice_briefings, "_get_earnings", lambda: {"bmo": [{"sym": "AAPL"}], "amc": []})

    out = voice_tools.dispatch("morning_briefing", {}, user={"id": "u-1"})
    assert "narration" in out
    assert len(out["narration"]) > 0


def test_pre_trade_check_tool(monkeypatch):
    from api.services import voice_tool_impls, voice_briefings  # noqa
    monkeypatch.setattr(voice_briefings, "_get_snapshot",
                        lambda sym: {"close": 487.2, "change_pct": 2.1})
    monkeypatch.setattr(voice_briefings, "_get_breadth", lambda: {"market_phase": "uptrend"})
    monkeypatch.setattr(voice_briefings, "_get_themes", lambda: {})

    out = voice_tools.dispatch("pre_trade_check", {"symbol": "NVDA"}, user={"id": "u-1"})
    assert "NVDA" in out["narration"]


# ── Write tools (Slice 5) ──────────────────────────────────────────────────

def test_write_tools_register():
    from api.services import voice_tool_impls  # noqa
    names = set(voice_tools.all_tool_names())
    expected = {
        "create_position", "close_position", "update_position",
        "add_daily_note", "log_mistake", "confirm_action",
    }
    assert expected.issubset(names)


def test_create_position_tool_returns_preview():
    from api.services.auth_db import init_db
    from api.services.auth_service import create_user
    init_db()
    uid = create_user(f"cp_{__import__('uuid').uuid4()}@example.com", "p")["id"]

    out = voice_tools.dispatch(
        "create_position",
        {"account": "Swing", "symbol": "NVDA", "shares": 100,
         "entry": 200.20, "stop": 199.10},
        user={"id": uid},
    )
    assert "action_id" in out
    assert "NVDA" in out["narration"]
    assert "Confirm" in out["narration"]


def test_confirm_action_rejects_unknown_id():
    out = voice_tools.dispatch(
        "confirm_action", {"action_id": "garbage.not-a-real-token"},
        user={"id": "u-1"},
    )
    assert out["ok"] is False


# ── Self-Q&A (Slice 7) ─────────────────────────────────────────────────────

def test_self_qa_tools_register():
    from api.services import voice_tool_impls  # noqa
    names = set(voice_tools.all_tool_names())
    expected = {"get_my_pnl", "get_my_setup_performance", "get_my_recent_mistakes",
                "get_my_psychology", "find_my_trades"}
    assert expected.issubset(names)


def test_get_my_pnl_tool(monkeypatch):
    from api.services import voice_self_qa
    monkeypatch.setattr(voice_self_qa, "_stats_for_period", lambda uid, p: {
        "trade_count": 5, "total_pnl_pct": 3.2, "win_rate": 0.6,
    })
    out = voice_tools.dispatch("get_my_pnl", {"period": "week"}, user={"id": "u-1"})
    assert "5" in out["narration"] or "3.2" in out["narration"]

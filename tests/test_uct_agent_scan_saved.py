"""SC-1 PR 2 — `screen.saved`, and `screen.run`/`screen.count` from a saved id or criteria text (owner: agent-sc).

Real screener snapshot + real auth DB (both in tmp), the real saved_screens service, the real grammar.
No model, no provider.
"""
from __future__ import annotations

import pytest

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway
from api.services.uct_agent.scan import sources

ME, OTHER = "admin-1", "member-2"
_ROW = {"company": "Co", "sector": "Technology", "price": 50.0, "chg_pct_1d": 1.0, "vol_ratio": 1.0,
        "rsi14": 50, "market_cap": 5e9, "bars_asof": 20261030, "snapshot_date": "2026-10-31",
        "security_type": "Common Stock", "avg_dollar_vol_30d": 5e7}
RS = {"filters": [{"key": "rsi14", "op": "gte", "min": 50}]}


@pytest.fixture
def world(tmp_path, monkeypatch):
    from api.services import auth_db
    from api.services.screener import saved_screens, snapshot_db
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    snapshot_db.upsert_rows([dict(_ROW, ticker=f"T{i:02d}", price=10.0 + i, rsi14=i) for i in range(60)])
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    saved_screens.init()                                  # test setup only; the adapter never calls init()
    mine = saved_screens.create(ME, "Leaders", RS)
    ind = saved_screens.create(ME, "EMA cross", {"filters": [{"key": "scan", "op": "in", "value": ["h1"]}]})
    theirs = saved_screens.create(OTHER, "Not yours", {"filters": [{"key": "price", "op": "gte", "min": 1}]})
    monkeypatch.setenv("UCT_AGENT_DATA", "1")
    monkeypatch.setenv(gateway.KINDS_ENV, ",".join(gateway.registry().names()))  # every kind on
    monkeypatch.setenv("UCT_AGENT_SCAN", "1")
    gateway._reset_for_test()
    yield {"mine": mine["id"], "ind": ind["id"], "theirs": theirs["id"]}
    gateway._reset_for_test()


def _read(kind, params, turn):
    return gateway.read(kind, params, user_id=ME, turn_id=turn, purpose="scan")


# ── screen.saved ────────────────────────────────────────────────────────────────────────────────

def test_saved_lists_only_the_members_own_screens(world):
    out = _read("screen.saved", {}, "s1")
    assert env.validate_envelope(out) == []
    assert out["kind"] == "screen.saved" and out["freshness"] == "periodic"
    names = {s["name"] for s in out["data"]["screens"]}
    assert names == {"Leaders", "EMA cross"}             # never another member's
    assert out["as_of"] is not None and out["provider_calls"] == 0


def test_a_saved_screen_the_agent_cannot_run_is_listed_with_its_reason_not_hidden(world):
    out = _read("screen.saved", {}, "s2")
    ema = next(s for s in out["data"]["screens"] if s["name"] == "EMA cross")
    assert ema["runnable"] is False and "indicator-condition" in ema["reason"]
    cov = out["coverage"]
    assert cov == {"evaluated": 2, "answered": 1, "dropped": 0, "not_computable": 1}
    assert out["status"] == "partial"


def test_saved_is_read_only_and_never_creates_the_table(tmp_path, monkeypatch):
    from api.services import auth_db
    import sqlite3
    db = tmp_path / "empty.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(db))
    monkeypatch.setenv("UCT_AGENT_DATA", "1")
    monkeypatch.setenv(gateway.KINDS_ENV, ",".join(gateway.registry().names()))  # every kind on
    monkeypatch.setenv("UCT_AGENT_SCAN", "1")
    gateway._reset_for_test()
    out = _read("screen.saved", {}, "s3")
    assert out["status"] == "ok" and out["data"]["screens"] == [] and out["as_of"] is None and out["notes"]
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT name FROM sqlite_master WHERE name='screener_saved_screens'").fetchone() is None
    gateway._reset_for_test()


def test_saved_counts_as_the_turns_scan(world):
    _read("screen.saved", {}, "s4")
    assert _read("screen.run", {"saved_id": world["mine"]}, "s4")["status"] == "refused"


# ── screen.run from a saved id ──────────────────────────────────────────────────────────────────

def test_run_a_saved_screen_by_id(world):
    out = _read("screen.run", {"saved_id": world["mine"]}, "r1")
    assert env.validate_envelope(out) == [] and out["status"] in ("ok", "partial")
    assert out["data"]["origin"] == {"source": "saved", "id": world["mine"], "name": "Leaders"}
    assert out["data"]["spec"]["filters"] == RS["filters"]
    assert out["data"]["total_matches"] == 10


def test_another_members_screen_id_is_not_found_never_run(world, monkeypatch):
    from api.services.screener import query
    ran = []
    monkeypatch.setattr(query, "run_scan", lambda *a, **k: ran.append(a))
    out = _read("screen.run", {"saved_id": world["theirs"]}, "r2")
    assert out["status"] == "refused" and "no saved screen" in out["notes"][0]
    assert ran == [] and "Not yours" not in str(out)


def test_a_saved_indicator_screen_is_refused_by_the_same_rule(world):
    out = _read("screen.count", {"saved_id": world["ind"]}, "r3")
    assert out["status"] == "refused" and "indicator-condition" in out["notes"][0]


@pytest.mark.parametrize("params,words", [
    ({}, "exactly one"),
    ({"spec": RS, "saved_id": 1}, "exactly one"),
    ({"saved_id": "abc"}, "is a number"),
])
def test_ambiguous_or_bad_sources_are_refused(world, params, words):
    out = _read("screen.run", params, "r4-" + words)
    assert out["status"] == "refused" and words in out["notes"][0]


# ── criteria text (the screener's own grammar, deterministic) ──────────────────────────────────

def test_criteria_text_runs_through_the_screeners_grammar(world, monkeypatch):
    monkeypatch.setenv("SCREENER_LOGIC_ENABLED", "1")
    out = _read("screen.count", {"text": "rsi14 >= 50"}, "t1")
    assert env.validate_envelope(out) == [], out
    assert out["data"]["count"] == 10
    o = out["data"]["origin"]
    assert o["source"] == "text" and o["text"] == "rsi14 >= 50" and o["explanation"]
    assert "logic" in out["data"]["spec"]          # the spec the member can open in the Screener


def test_criteria_text_scope_is_resolved_for_the_member(world, monkeypatch):
    monkeypatch.setenv("SCREENER_LOGIC_ENABLED", "1")
    monkeypatch.setenv("SCREENER_ALERT_GRAMMAR_ENABLED", "1")
    out = _read("screen.run", {"text": "$T55 and price > 1"}, "t2")
    assert [r["symbol"] for r in out["data"]["rows"]] == ["T55"]


def test_a_scope_follows_the_screeners_own_grammar_gate(world, monkeypatch):
    monkeypatch.setenv("SCREENER_LOGIC_ENABLED", "1")
    monkeypatch.delenv("SCREENER_ALERT_GRAMMAR_ENABLED", raising=False)
    out = _read("screen.run", {"text": "$T55 and price > 1"}, "t2b")
    assert out["status"] == "refused" and "not in the language yet" in out["notes"][0]


def test_criteria_text_is_refused_while_the_screeners_language_is_off(world, monkeypatch):
    monkeypatch.delenv("SCREENER_LOGIC_ENABLED", raising=False)
    out = _read("screen.run", {"text": "rsi14 >= 50"}, "t3")
    assert out["status"] == "refused" and "criteria language is off" in out["notes"][0]


def test_unreadable_criteria_text_carries_the_grammars_sentence(world, monkeypatch):
    monkeypatch.setenv("SCREENER_LOGIC_ENABLED", "1")
    out = _read("screen.run", {"text": "rsi14 >>> banana"}, "t4")
    assert out["status"] == "refused" and out["notes"][0].startswith("the Screener could not read those criteria")


def test_overlong_text_is_refused(world, monkeypatch):
    monkeypatch.setenv("SCREENER_LOGIC_ENABLED", "1")
    out = _read("screen.run", {"text": "price > 1 and " * 60}, "t5")
    assert out["status"] == "refused" and "at most 600" in out["notes"][0]


def test_no_model_compile_path_is_reachable():
    import ast
    import inspect
    tree = ast.parse(inspect.getsource(sources))
    called = {n.func.attr for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    assert "compile_english" not in called and "nl_compile" not in inspect.getsource(sources).split('"""')[-1]


# ── the pre-admission hook ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [{}, {"saved_id": "abc"}, {"text": ""}, {"text": "x" * 601},
                                 {"spec": {"filters": [{"key": "nope"}]}}, {"spec": RS, "text": "price > 1"}])
def test_structural_refusals_spend_nothing(world, bad):
    assert _read("screen.run", bad, "pre")["status"] == "refused"
    assert _read("screen.run", {"saved_id": world["mine"]}, "pre")["status"] in ("ok", "partial")


def test_another_members_id_is_an_attempt_and_spends_the_scan(world):
    assert _read("screen.run", {"saved_id": world["theirs"]}, "att")["status"] == "refused"
    assert _read("screen.run", {"saved_id": world["mine"]}, "att")["status"] == "refused"


def test_coverage_counts_every_screen_even_past_the_listed_hundred(world):
    from api.services.screener import saved_screens
    for i in range(105):
        saved_screens.create(ME, f"S{i}", RS)
    out = _read("screen.saved", {}, "big")
    assert len(out["data"]["screens"]) == 100
    cov = out["coverage"]
    assert cov["evaluated"] == 107 and cov["answered"] == 106 and cov["not_computable"] == 1
    assert any("100 most recently saved of 107" in n for n in out["notes"])

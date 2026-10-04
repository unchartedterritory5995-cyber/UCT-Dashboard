"""FT-026 logical groups, FT-029 the where-grammar, FT-028 the count's as-of.

A recorded fixture universe (five rows in a temp screener.db); every assertion
runs the REAL query path, so a group can never mean something different from
the same filter in the flat list."""
from __future__ import annotations

import pytest

from api.services.screener import grammar, logic
from api.services.screener import query as Q
from api.services.screener import snapshot_db as db

ROWS = [
    {"ticker": "AAA", "price": 100.0, "rsi14": 20.0, "sector": "Technology",
     "eps_growth": 40.0, "avg_volume_30d": 2_000_000, "gross_margin": 60.0, "op_margin": 30.0,
     "snapshot_date": "2026-10-01"},
    {"ticker": "BBB", "price": 50.0, "rsi14": 80.0, "sector": "Utilities",
     "eps_growth": 5.0, "avg_volume_30d": 500_000, "gross_margin": 20.0, "op_margin": 25.0,
     "snapshot_date": "2026-10-01"},
    {"ticker": "CCC", "price": 10.0, "rsi14": 55.0, "sector": "Energy",
     "eps_growth": 30.0, "avg_volume_30d": 1_500_000, "gross_margin": 35.0, "op_margin": 10.0,
     "snapshot_date": "2026-10-01"},
    {"ticker": "DDD", "price": 5.0, "rsi14": None, "sector": None,
     "eps_growth": None, "avg_volume_30d": 100_000, "gross_margin": None, "op_margin": None,
     "snapshot_date": "2026-10-01"},
    {"ticker": "EEE", "price": 300.0, "rsi14": 65.0, "sector": "Technology",
     "eps_growth": 60.0, "avg_volume_30d": 9_000_000, "gross_margin": 70.0, "op_margin": 40.0,
     "snapshot_date": "2026-09-30"},
]


@pytest.fixture
def snap(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.setenv(logic.FLAG, "1")
    db.init_db()
    db.upsert_rows([dict(r) for r in ROWS])
    return tmp_path


def _tickers(spec):
    return sorted(r["ticker"] for r in Q.run_scan({**spec, "page_size": 100})["rows"])


# ── FT-026: groups ──────────────────────────────────────────────────────────

def test_any_of_is_an_or(snap):
    spec = {"logic": {"any": [{"key": "price", "op": "gte", "min": 200},
                              {"key": "price", "op": "lte", "max": 10}]}}
    assert _tickers(spec) == ["CCC", "DDD", "EEE"]


def test_none_of_excludes_and_keeps_rows_we_cannot_evaluate(snap):
    """A row whose sector we do not hold is NOT 'in Utilities', so excluding
    Utilities must keep it -- the rule `not_in` already keeps."""
    spec = {"logic": {"none": [{"key": "sector", "op": "in", "values": ["Utilities"]}]}}
    assert _tickers(spec) == ["AAA", "CCC", "DDD", "EEE"]


def test_groups_and_with_the_flat_list(snap):
    spec = {"filters": [{"key": "price", "op": "gte", "min": 20}],
            "logic": {"any": [{"key": "sector", "op": "in", "values": ["Energy"]},
                              {"key": "eps_growth", "op": "gte", "min": 50}]}}
    assert _tickers(spec) == ["EEE"]


def test_nested_all_inside_any(snap):
    spec = {"logic": {"any": [
        {"all": [{"key": "sector", "op": "in", "values": ["Technology"]},
                 {"key": "price", "op": "lte", "max": 150}]},
        {"key": "rsi14", "op": "gte", "min": 75}]}}
    assert _tickers(spec) == ["AAA", "BBB"]


def test_the_count_agrees_with_the_grouped_screen(snap):
    spec = {"logic": {"none": [{"key": "price", "op": "lt", "max": 20}]}}
    assert Q.preview_count(spec)["count"] == len(_tickers(spec))


def test_dark_refuses_with_a_sentence_never_ignores(snap, monkeypatch):
    monkeypatch.delenv(logic.FLAG, raising=False)
    with pytest.raises(ValueError, match="not switched on"):
        Q.run_scan({"logic": {"any": [{"key": "price", "op": "gte", "min": 1}]}})


@pytest.mark.parametrize("key", ["scan", "list", "universe"])
def test_statement_scoped_keys_are_refused_inside_a_group(key):
    with pytest.raises(ValueError, match="cannot go inside"):
        logic.validate({"any": [{"key": key, "op": "in", "value": ["x"]}]})


def test_leaf_ceiling_is_25():
    leaves = [{"key": "price", "op": "gte", "min": i} for i in range(26)]
    with pytest.raises(ValueError, match="at most 25"):
        logic.validate({"all": leaves})


def test_an_unknown_field_inside_a_group_is_refused_by_the_flat_lists_own_check(snap):
    with pytest.raises(ValueError, match="unknown filter key"):
        Q.run_scan({"logic": {"any": [{"key": "no_such", "op": "gte", "min": 1}]}})


# ── FT-028: the count carries its as-of ────────────────────────────────────

def test_the_count_carries_the_snapshot_it_describes(snap):
    out = Q.preview_count({})
    assert out["count"] == 5
    assert out["as_of"]["snapshot_date"] == "2026-10-01"
    assert out["as_of"]["mixed"] is True            # EEE is a day older
    assert out["as_of"]["oldest_snapshot_date"] == "2026-09-30"
    assert out["as_of"]["counted_at"]


# ── FT-029: the grammar ─────────────────────────────────────────────────────

def test_suffixes_and_percent(snap):
    node = grammar.parse("avg_volume_30d >= 1.5m and eps_growth > 25%")
    assert node == {"all": [{"key": "avg_volume_30d", "op": "gte", "min": 1_500_000},
                            {"key": "eps_growth", "op": "gt", "min": 25}]}
    assert _tickers({"logic": node}) == ["AAA", "CCC", "EEE"]


def test_k_b_t_suffixes():
    assert grammar.parse("market_cap > 2b")["min"] == 2_000_000_000
    assert grammar.parse("market_cap < 1.5t")["max"] == 1_500_000_000_000
    assert grammar.parse("avg_volume_30d >= 750k")["min"] == 750_000


def test_percent_on_a_non_percent_field_is_refused():
    with pytest.raises(grammar.GrammarError, match="not a percentage field"):
        grammar.parse("price > 5%")


def test_and_binds_tighter_than_or_and_parens_override(snap):
    a = grammar.parse("price > 200 or price < 20 and rsi14 > 50")
    assert a == {"any": [{"key": "price", "op": "gt", "min": 200},
                         {"all": [{"key": "price", "op": "lt", "max": 20},
                                  {"key": "rsi14", "op": "gt", "min": 50}]}]}
    assert _tickers({"logic": a}) == ["CCC", "EEE"]
    b = grammar.parse("(price > 200 or price < 20) and rsi14 > 50")
    assert _tickers({"logic": b}) == ["CCC", "EEE"]


def test_not_and_not_in(snap):
    node = grammar.parse('not sector in [Utilities, "Energy"] and price > 1')
    assert _tickers({"logic": node}) == ["AAA", "DDD", "EEE"]
    node2 = grammar.parse("sector not in [Technology]")
    assert node2 == {"key": "sector", "op": "not_in", "values": ["Technology"]}


def test_field_to_field(snap):
    node = grammar.parse("gross_margin > op_margin")
    assert node == {"key": "gross_margin", "op": "gt_col", "other": "op_margin"}
    assert _tickers({"logic": node}) == ["AAA", "CCC", "EEE"]


def test_between_and_ne(snap):
    assert _tickers({"logic": grammar.parse("price between 20 and 150")}) == ["AAA", "BBB"]
    node = grammar.parse("price != 50")
    assert node == {"not": {"key": "price", "op": "eq", "value": 50}}


def test_unknown_field_suggests_the_nearest():
    with pytest.raises(grammar.GrammarError, match="did you mean.*eps_growth"):
        grammar.parse("eps_growht > 5")


def test_scope_prefixes_and_arithmetic_are_refused_with_the_reason():
    with pytest.raises(grammar.GrammarError, match="scope prefixes"):
        grammar.parse("$AAPL and price > 5")
    with pytest.raises(grammar.GrammarError, match="arithmetic"):
        grammar.parse("price * avg_volume_30d > 50m")


def test_dangling_text_is_refused_with_position():
    with pytest.raises(grammar.GrammarError, match="position"):
        grammar.parse("price > 5 rsi14 < 3")


def test_explanation_is_one_sentence_per_criterion():
    node = grammar.parse("price > 10 and (eps_growth > 25% or not sector in [Utilities])")
    lines = grammar.explain(node)
    assert [l["text"] for l in lines] == [
        "All of the following:",
        "Price is above $10",
        "Any of the following:",
        "EPS Growth is above 25%",
        "NOT: Sector is one of Utilities",
    ]
    assert [l["depth"] for l in lines] == [0, 1, 1, 2, 2]


def test_describe_lists_every_field():
    from api.services.screener import filters
    d = grammar.describe()
    assert {f["key"] for f in d["fields"]} == set(filters.FILTERS)
    assert "%" in d["number_suffixes"]


# ── the routes ──────────────────────────────────────────────────────────────

def _client(monkeypatch, armed=True, paid=True):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user_with_plan
    from api.routers import screener as rs
    if armed:
        monkeypatch.setenv(logic.FLAG, "1")
    else:
        monkeypatch.delenv(logic.FLAG, raising=False)
    monkeypatch.setattr(rs, "is_paid_user", lambda u: paid)
    app = FastAPI()
    app.include_router(rs.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": "u1", "plan": "pro"}
    return TestClient(app)


def test_grammar_routes_are_dark_by_default(monkeypatch):
    c = _client(monkeypatch, armed=False)
    assert c.get("/api/screener/grammar").status_code == 404
    assert c.post("/api/screener/grammar/parse", json={"text": "price > 1"}).status_code == 404


def test_parse_route_returns_tree_and_explanation(monkeypatch):
    c = _client(monkeypatch)
    r = c.post("/api/screener/grammar/parse", json={"text": "price > 10 and rsi14 < 30"})
    assert r.status_code == 200
    b = r.json()
    assert b["criteria"] == 2 and b["logic"]["all"][0]["key"] == "price"
    assert b["explanation"][1]["text"] == "Price is above $10"
    bad = c.post("/api/screener/grammar/parse", json={"text": "price >"})
    assert bad.status_code == 400 and "end too early" in bad.json()["detail"]


def test_grammar_routes_are_paid(monkeypatch):
    c = _client(monkeypatch, paid=False)
    assert c.get("/api/screener/grammar").status_code == 402

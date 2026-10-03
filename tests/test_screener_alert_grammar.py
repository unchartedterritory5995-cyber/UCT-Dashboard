"""FT-029 v2: typed subjects ($TICKER / #list scopes) and arithmetic, as an
extension of the ONE where-grammar (no second parser).

Every assertion runs the REAL query path over a fixture screener.db, so an
arithmetic criterion or a ticker scope can never mean something different from
the same filter written by hand."""
from __future__ import annotations

import pytest

from api.services.screener import grammar, logic
from api.services.screener import query as Q
from api.services.screener import snapshot_db as db

ROWS = [
    {"ticker": "AAA", "price": 100.0, "avg_volume_30d": 2_000_000, "gross_margin": 60.0,
     "op_margin": 30.0, "snapshot_date": "2026-10-01"},
    {"ticker": "BBB", "price": 50.0, "avg_volume_30d": 500_000, "gross_margin": 20.0,
     "op_margin": 25.0, "snapshot_date": "2026-10-01"},
    {"ticker": "CCC", "price": 10.0, "avg_volume_30d": 1_500_000, "gross_margin": 35.0,
     "op_margin": 0.0, "snapshot_date": "2026-10-01"},
    {"ticker": "DDD", "price": 5.0, "avg_volume_30d": None, "gross_margin": None,
     "op_margin": None, "snapshot_date": "2026-10-01"},
]


@pytest.fixture
def v2(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.setenv(logic.FLAG, "1")
    monkeypatch.setenv(grammar.V2_FLAG, "1")
    db.init_db()
    db.upsert_rows([dict(r) for r in ROWS])
    return tmp_path


def _run(text, user_id=None):
    out = grammar.compile_text(text)
    spec = {"filters": grammar.resolve_scopes(out["subjects"], user_id), "page_size": 100}
    if out["logic"] is not None:
        spec["logic"] = out["logic"]
    return sorted(r["ticker"] for r in Q.run_scan(spec)["rows"])


# ── arithmetic ──────────────────────────────────────────────────────────────

def test_dollar_volume_by_arithmetic(v2):
    # AAA 200m, BBB 25m, CCC 15m, DDD NULL (no match, never an error)
    assert _run("avg_volume_30d * price > 20m") == ["AAA", "BBB"]


def test_precedence_and_parens(v2):
    # (gm - om) / gm : AAA .5, BBB -.25, CCC 1.0
    assert _run("(gross_margin - op_margin) / gross_margin >= 0.5") == ["AAA", "CCC"]
    # * binds tighter than -: AAA 60-60=0, BBB 20-50<0, CCC 35-0=35
    assert _run("gross_margin - op_margin * 2 >= 0") == ["AAA", "CCC"]
    assert _run("(gross_margin - op_margin) * 2 >= 60") == ["AAA", "CCC"]
    # ⛔ A fixture that DISTINGUISHES precedence: right is price > 60 (AAA);
    # left-to-right would read (price + vol) * 0 > 60 and match nothing.
    assert _run("price + avg_volume_30d * 0 > 60") == ["AAA"]
    node = grammar.parse("price + gross_margin * 2 > 1")
    assert node["lhs"] == {"o": "+", "a": {"f": "price"},
                           "b": {"o": "*", "a": {"f": "gross_margin"}, "b": {"n": 2}}}


def test_division_by_zero_does_not_match_and_does_not_raise(v2):
    assert _run("gross_margin / op_margin > 1") == ["AAA"]


def test_arithmetic_mixes_with_groups_and_plain_criteria(v2):
    assert _run("price > 20 and (avg_volume_30d * price > 100m or op_margin > 26)") == ["AAA"]


def test_field_on_the_left_arithmetic_on_the_right(v2):
    # AAA 60 >= 60, BBB 20 < 50, CCC 35 >= 0
    assert _run("gross_margin >= op_margin * 2") == ["AAA", "CCC"]
    assert _run("gross_margin > op_margin * 2") == ["CCC"]


def test_arithmetic_explanation_reads_as_a_sentence(v2):
    node = grammar.parse("avg_volume_30d * price > 20m")
    line = grammar.explain(node)[0]["text"]
    assert "*" in line and "is above 20M" in line


def test_arithmetic_refusals(v2):
    with pytest.raises(grammar.GrammarError, match="not a number"):
        grammar.parse("sector * price > 5")
    with pytest.raises(grammar.GrammarError, match="at least one field"):
        grammar.parse("2 * 3 > 5")
    with pytest.raises(grammar.GrammarError, match="plain number"):
        grammar.parse("price * 5% > 1")
    too_long = " + ".join(["price"] * 20) + " > 1"
    with pytest.raises(grammar.GrammarError, match="at most"):
        grammar.parse(too_long)


def test_arith_numbers_are_bound_never_inlined(v2):
    where, params = Q.build_where([{"key": "arith", "op": "gt",
                                    "lhs": {"f": "price"}, "rhs": {"n": 12345}}])
    assert "12345" not in where and 12345 in params


def test_arith_refuses_a_non_registry_field(v2):
    with pytest.raises(ValueError, match="cannot be used in arithmetic"):
        Q.build_where([{"key": "arith", "op": "gt", "lhs": {"f": "ticker; drop"},
                        "rhs": {"n": 1}}])


# ── scopes ──────────────────────────────────────────────────────────────────

def test_ticker_scope_unions_and_ands_with_criteria(v2):
    assert _run("$AAA $CCC") == ["AAA", "CCC"]
    assert _run("$aaa, $ccc and price > 20") == ["AAA"]


def test_two_scopes_intersect(v2):
    assert _run("$AAA $BBB and $BBB $CCC") == ["BBB"]


def test_scope_under_or_or_not_is_refused(v2):
    with pytest.raises(grammar.GrammarError, match="whole criteria"):
        grammar.compile_text("$AAA or price > 5")
    with pytest.raises(grammar.GrammarError, match="whole criteria"):
        grammar.compile_text("not $AAA")


def test_parse_refuses_a_scope_with_a_sentence(v2):
    with pytest.raises(grammar.GrammarError, match="scope"):
        grammar.parse("$AAA and price > 5")


def test_list_scope_resolves_to_the_list_filter(v2, monkeypatch):
    from api.services.screener import list_universe
    monkeypatch.setattr(list_universe, "available", lambda uid: [
        {"value": "wl:7", "label": "Swing Ideas (3)"},
        {"value": "wl:8", "label": "Dupes (1)"}, {"value": "wl:9", "label": "Dupes (2)"}])
    f = grammar.resolve_scopes(grammar.compile_text("#swing_ideas")["subjects"], "u1")
    assert f == [{"key": "list", "op": "in", "value": "wl:7"}]
    f = grammar.resolve_scopes(grammar.compile_text("#flagged, #tag:red")["subjects"], "u1")
    assert f == [{"key": "list", "op": "in", "value": ["flagged", "tag:red"]}]
    with pytest.raises(grammar.GrammarError, match="several"):
        grammar.resolve_scopes(grammar.compile_text("#dupes")["subjects"], "u1")
    with pytest.raises(grammar.GrammarError, match="exactly one"):
        grammar.resolve_scopes(grammar.compile_text("#nope")["subjects"], "u1")


def test_mixed_scope_is_refused(v2):
    with pytest.raises(grammar.GrammarError, match="mix"):
        grammar.resolve_scopes(grammar.compile_text("$AAA #flagged")["subjects"], "u1")


def test_tickers_cannot_go_inside_a_group(v2):
    with pytest.raises(ValueError, match="cannot go inside"):
        logic.validate({"any": [{"key": "tickers", "op": "in", "values": ["AAA"]}]})


def test_empty_ticker_scope_is_zero_rows_not_everything(v2):
    where, _ = Q.build_where([{"key": "tickers", "op": "in", "values": []}])
    assert "1=0" in where


# ── dark ────────────────────────────────────────────────────────────────────

def test_dark_keeps_the_v1_refusals(monkeypatch):
    monkeypatch.delenv(grammar.V2_FLAG, raising=False)
    with pytest.raises(grammar.GrammarError, match="scope prefixes"):
        grammar.compile_text("$AAPL and price > 5")
    with pytest.raises(grammar.GrammarError, match="arithmetic"):
        grammar.parse("price * avg_volume_30d > 50m")
    assert "arithmetic between fields" in grammar.describe()["not_supported"]


def test_dark_refuses_crafted_reserved_keys_with_a_sentence(monkeypatch):
    monkeypatch.delenv(grammar.V2_FLAG, raising=False)
    with pytest.raises(ValueError, match="not switched on"):
        Q.build_where([{"key": "tickers", "op": "in", "values": ["AAA"]}])
    with pytest.raises(ValueError, match="not switched on"):
        Q.build_where([{"key": "arith", "op": "gt", "lhs": {"f": "price"}, "rhs": {"n": 1}}])


def test_at_scope_stays_refused_even_armed(v2):
    with pytest.raises(grammar.GrammarError, match="scope prefixes"):
        grammar.compile_text("@tech and price > 5")


# ── the route ───────────────────────────────────────────────────────────────

def test_parse_route_returns_scope_filters(v2, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user_with_plan
    from api.routers import screener as rs
    monkeypatch.setattr(rs, "is_paid_user", lambda u: True)
    app = FastAPI()
    app.include_router(rs.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": "u1", "plan": "pro"}
    c = TestClient(app)
    r = c.post("/api/screener/grammar/parse", json={"text": "$AAA and price * 2 > 10"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["scope_filters"] == [{"key": "tickers", "op": "in", "values": ["AAA"]}]
    assert b["logic"]["key"] == "arith" and b["criteria"] == 1

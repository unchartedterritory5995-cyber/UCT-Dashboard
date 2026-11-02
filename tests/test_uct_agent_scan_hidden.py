"""SC-1 §2d (owner F-16 final ruling): fields the Agent never reaches, enforced SERVER-SIDE in the SC-1 kinds.

Every way a spec can name a field is refused with the sentence, before any read (so it spends nothing): a filter, a
logic leaf, an arithmetic term, a sort, a rank criterion, a requested column, a named view, criteria text, a saved
screen. Rows never carry a hidden column. With no order asked for, the order is market cap, largest first, and the
receipt says so. The hidden set is DERIVED (enrich.ratings_fields by AST, the catalog's flow category) plus explicit
owner names where no metadata exists. Owner: agent-sc. No model, no provider.
"""
from __future__ import annotations

import pytest

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway
from api.services.uct_agent.scan import hidden, spec as scan_spec

ME = "admin-1"
_ROW = {"company": "Co", "sector": "Technology", "price": 50.0, "chg_pct_1d": 1.0, "vol_ratio": 1.0, "rsi14": 50,
        "market_cap": 5e9, "bars_asof": 20261030, "snapshot_date": "2026-10-31", "security_type": "Common Stock",
        "avg_dollar_vol_30d": 5e7, "rs_rank": 90, "uct_composite": 88, "dp_notional_1d": 2e7}


@pytest.fixture
def world(tmp_path, monkeypatch):
    from api.services import auth_db
    from api.services.screener import saved_screens, snapshot_db
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    snapshot_db.upsert_rows([dict(_ROW, ticker=f"T{i:02d}", price=10.0 + i, market_cap=1e9 * (i + 1), rsi14=i)
                             for i in range(30)])
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    saved_screens.init()
    plain = saved_screens.create(ME, "Plain", {"filters": [{"key": "rsi14", "op": "gte", "min": 10}]})
    rated = saved_screens.create(ME, "Rated", {"filters": [{"key": "uct_composite", "op": "gte", "min": 80}]})
    flow = saved_screens.create(ME, "Flow", {"filters": [{"key": "dp_notional_1d", "op": "gte", "min": 1e7}]})
    monkeypatch.setenv("UCT_AGENT_DATA", "1")
    monkeypatch.setenv(gateway.KINDS_ENV, ",".join(gateway.registry().names()))
    monkeypatch.setenv("UCT_AGENT_SCAN", "1")
    monkeypatch.setenv("SCREENER_LOGIC_ENABLED", "1")
    gateway._reset_for_test()
    yield {"plain": plain["id"], "rated": rated["id"], "flow": flow["id"]}
    gateway._reset_for_test()


def _read(kind, params, turn):
    return gateway.read(kind, params, user_id=ME, turn_id=turn, purpose="scan")


# ── the set: derived, complete, exists ──────────────────────────────────────────────────────────

def test_the_rating_set_is_derived_from_enrich_and_follows_it():
    derived = hidden.enrich_rating_columns()
    assert {"uct_composite", "rating_eps", "rating_growth", "rating_value", "rating_smr", "accdis", "sponsorship",
            "sector_rs_pct", "blended_growth"} <= derived
    assert not {"eps_growth", "rev_growth", "pe_fwd", "sector"} & derived     # vendor passthroughs (variable names)
    src = hidden._ENRICH.read_text(encoding="utf-8").replace('out["uct_composite"] = composite',
                                                              'out["uct_composite"] = composite\n        out["new_rating"] = 1')
    assert "new_rating" in hidden.enrich_rating_columns(src)                  # a rating added tomorrow is hidden


def test_the_owner_named_and_flow_sets_and_every_hidden_key_is_a_real_catalog_field():
    from api.services.screener import filters
    cat = {f["key"]: f for f in filters.field_catalog()}
    assert {"rs_rank", "rs_return", "candle_score", "earnings_setup_grade", "in_uct20", "pattern_engine_id",
            "pattern_entry_dist_pct", "pattern_stop_dist_pct", "pattern_expectancy_r"} <= hidden.rating_keys()
    assert hidden.flow_keys() == {k for k, f in cat.items() if f.get("category") == "flow"}
    assert hidden.flow_keys()                                                   # non-vacuity
    assert hidden.hidden_keys() <= set(cat)                                     # no typo can hide nothing
    assert not {"price", "rsi14", "vol_ratio", "above_50sma", "candle_type", "eps_growth", "rs_line_trend"} & hidden.hidden_keys()


# ── refusals: every way a spec can name a field ─────────────────────────────────────────────────

RATED = hidden.RATINGS_REFUSAL
FLOWED = hidden.FLOW_REFUSAL


@pytest.mark.parametrize("spec,sentence", [
    ({"filters": [{"key": "rs_rank", "op": "gte", "min": 80}]}, RATED),
    ({"filters": [{"key": "dp_notional_1d", "op": "gte", "min": 1}]}, FLOWED),
    ({"filters": [{"key": "price", "op": "gt", "other": "pattern_entry_dist_pct"}]}, RATED),
    ({"filters": [], "logic": {"all": [{"key": "price", "op": "gt", "min": 1}, {"key": "sector_rs_pct", "op": "gte", "min": 80}]}}, RATED),
    ({"filters": [{"key": "arith", "op": "gt", "lhs": {"o": "*", "a": {"f": "uct_composite"}, "b": {"n": 1}}, "rhs": {"n": 50}}]}, RATED),
    ({"filters": [], "sort": {"key": "rs_return", "dir": "desc"}}, RATED),
    ({"filters": [], "sort": {"key": "opt_net_premium_1d", "dir": "desc"}}, FLOWED),
    ({"filters": [], "columns": ["ticker", "price", "candle_score"]}, RATED),
    ({"filters": [], "rank": {"criteria": [{"column": "rs_rank", "weight": 1}], "top_n": 10}}, RATED),
    ({"filters": [], "view": "uct_ratings"}, RATED),
    ({"filters": [], "view": "flow"}, FLOWED),
])
def test_every_use_is_refused_with_the_sentence(spec, sentence):
    with pytest.raises(scan_spec.SpecError) as e:
        scan_spec.validate(spec)
    assert str(e.value) == sentence


def test_a_refused_spec_spends_nothing_and_runs_nothing(world, monkeypatch):
    from api.services.screener import query
    ran = []
    real = query.run_scan
    monkeypatch.setattr(query, "run_scan", lambda *a, **k: (ran.append(1), real(*a, **k))[1])
    out = _read("screen.run", {"spec": {"filters": [], "sort": {"key": "rs_rank", "dir": "desc"}}}, "t1")
    assert out["status"] == "refused" and RATED in out["notes"][0] and ran == []
    assert env.validate_envelope(out) == []
    ok = _read("screen.run", {"spec": {"filters": [{"key": "rsi14", "op": "gte", "min": 1}]}}, "t1")   # same turn
    assert ok["status"] in ("ok", "partial") and ran == [1]                    # the refusal did not take the scan


def test_criteria_text_naming_a_rating_is_refused(world):
    out = _read("screen.count", {"text": "uct_composite >= 80"}, "t2")
    assert out["status"] == "refused" and RATED in out["notes"][0]


def test_a_saved_screen_on_a_rating_or_flow_is_listed_not_run_and_its_criteria_never_shown(world):
    listed = {s["name"]: s for s in _read("screen.saved", {}, "s1")["data"]["screens"]}
    for name, sentence in (("Rated", RATED), ("Flow", FLOWED)):
        assert listed[name]["runnable"] is False and listed[name]["reason"] == sentence and listed[name]["spec"] is None
    assert listed["Plain"]["runnable"] is True and listed["Plain"]["spec"]
    for sid, sentence, turn in ((world["rated"], RATED, "s2"), (world["flow"], FLOWED, "s3")):
        out = _read("screen.run", {"saved_id": sid}, turn)
        assert out["status"] == "refused" and sentence in out["notes"][0]


# ── results never carry a hidden column ─────────────────────────────────────────────────────────

def test_the_default_views_hidden_columns_are_never_returned(world):
    out = _read("screen.run", {"spec": {"filters": [{"key": "rsi14", "op": "gte", "min": 1}]}, "limit": 5}, "r1")
    assert out["status"] in ("ok", "partial")
    keys = {k for row in out["data"]["rows"] for k in row} | set(out["data"]["fields"])
    assert not keys & hidden.hidden_keys()
    assert "rs_rank" in scan_spec.view_columns("overview")                     # non-vacuity: the view carries one


# ── the order: market cap, never the screener's UCT Composite default, and said ─────────────────

def test_no_order_asked_means_market_cap_largest_first_and_the_receipt_says_so(world):
    out = _read("screen.run", {"spec": {"filters": [{"key": "rsi14", "op": "gte", "min": 1}]}, "limit": 5}, "o1")
    assert out["data"]["spec"]["sort"] == {"key": "market_cap", "dir": "desc"}
    assert scan_spec.DEFAULT_ORDER_NOTE in out["notes"]
    syms = [r["symbol"] for r in out["data"]["rows"]]
    assert syms == ["T29", "T28", "T27", "T26", "T25"]                         # largest market caps first


def test_a_saved_screen_and_criteria_text_without_an_order_get_the_same_default(world):
    for params, turn in (({"saved_id": world["plain"]}, "o2"), ({"text": "rsi14 >= 10"}, "o3")):
        out = _read("screen.run", {**params, "limit": 3}, turn)
        assert out["data"]["spec"]["sort"] == {"key": "market_cap", "dir": "desc"}
        assert scan_spec.DEFAULT_ORDER_NOTE in out["notes"]


def test_an_order_the_member_asked_for_is_kept_and_not_labelled_as_the_default(world):
    out = _read("screen.run", {"spec": {"filters": [], "sort": {"key": "price", "dir": "asc"}}, "limit": 3}, "o4")
    assert out["data"]["spec"]["sort"] == {"key": "price", "dir": "asc"}
    assert scan_spec.DEFAULT_ORDER_NOTE not in out["notes"]

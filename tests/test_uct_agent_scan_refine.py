"""W1-C C-01 (builder-c) — the last screen as server-persisted refinement state: the store table, its route, the
stored shape, the SC-2 §3 composition rules and the F-16 refusal with a public alternative. No model, no provider."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx
from api.services.uct_agent import store
from api.services.uct_agent.scan import refine

ME = {"id": "u-me", "plan": "pro", "role": "admin"}
OTHER = {"id": "u-other", "plan": "pro", "role": "admin"}
CATALOG = frozenset({"price", "sector", "industry", "pct_vs_ema20", "vol_ratio", "chg_pct_3m", "adr_pct", "rs_rank"})
COLUMNS = frozenset({"ticker", "company", "price", "chg_pct_3m", "adr_pct", "rs_rank"})
VIEWS = frozenset({"overview"})

LAST = {"spec": {"filters": [{"key": "pct_vs_ema20", "op": "gt", "min": 0}, {"key": "vol_ratio", "op": "gte", "min": 2}],
                 "post": [], "sort": None},
        "symbols": ["AAA", "BBB", "CCC"], "total": 41, "asOf": "2026-10-30", "name": None, "savedId": None}


@pytest.fixture(autouse=True)
def _db(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_DB_PATH", str(tmp_path / "agent.db"))
    store._reset_for_tests()
    # the field catalog, pinned so the test never depends on the live registry's size
    monkeypatch.setattr(refine.scan_spec, "catalog_keys", lambda: CATALOG)
    monkeypatch.setattr(refine.scan_spec, "column_keys", lambda: COLUMNS)
    monkeypatch.setattr(refine.scan_spec, "view_names", lambda: VIEWS)
    yield
    store._reset_for_tests()


@pytest.fixture
def client():
    def build(user):
        from api.middleware.auth_middleware import get_current_user_with_plan
        app = FastAPI()
        app.include_router(rx.router)
        app.dependency_overrides[get_current_user_with_plan] = lambda: user
        return TestClient(app)
    return build


# ── the store ───────────────────────────────────────────────────────────────────────────────────────────────────────

def test_state_round_trips_per_conversation_and_is_owner_scoped():
    cid = store.create_conversation(ME["id"], "find stocks above the 20 ema")
    assert store.get_state(ME["id"], cid, "lastScreen") is None
    assert store.set_state(ME["id"], cid, "lastScreen", LAST) is True
    got = store.get_state(ME["id"], cid, "lastScreen")
    assert got["value"] == LAST and isinstance(got["updated_at"], int)
    # a second write replaces (one row per conversation + key)
    assert store.set_state(ME["id"], cid, "lastScreen", {**LAST, "total": 7}) is True
    assert store.get_state(ME["id"], cid, "lastScreen")["value"]["total"] == 7
    # another member can neither read nor write it, and a foreign conversation id is never written into
    assert store.get_state(OTHER["id"], cid, "lastScreen") is None
    assert store.set_state(OTHER["id"], cid, "lastScreen", LAST) is False
    assert store.get_state(ME["id"], cid, "lastScreen")["value"]["total"] == 7


def test_state_keys_are_an_allow_list_and_values_are_bounded():
    cid = store.create_conversation(ME["id"], "x")
    with pytest.raises(ValueError):
        store.set_state(ME["id"], cid, "anything", {"a": 1})
    with pytest.raises(ValueError):
        store.set_state(ME["id"], cid, "lastScreen", {"symbols": ["A" * 30000]})
    assert store.get_state(ME["id"], cid, "lastScreen") is None


def test_deleting_the_conversation_deletes_its_state():
    cid = store.create_conversation(ME["id"], "x")
    store.set_state(ME["id"], cid, "lastScreen", LAST)
    assert store.delete_conversation(ME["id"], cid) is True
    assert store.get_state(ME["id"], cid, "lastScreen") is None
    assert store.set_state(ME["id"], cid, "lastScreen", LAST) is False       # gone: never re-created by a late write


def test_the_table_is_created_on_an_existing_database(tmp_path, monkeypatch):
    """Migration-safe: a store whose schema predates the table gains it on first connect (CREATE IF NOT EXISTS)."""
    import sqlite3
    p = tmp_path / "old.db"
    with sqlite3.connect(p) as c:
        c.executescript("CREATE TABLE agent_conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, "
                        "created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);")
    monkeypatch.setattr(store, "_DB_PATH", str(p))
    store._reset_for_tests()
    cid = store.create_conversation(ME["id"], "x")
    assert store.set_state(ME["id"], cid, "lastScreen", LAST) is True
    assert store.get_state(ME["id"], cid, "lastScreen")["value"] == LAST


# ── the route ───────────────────────────────────────────────────────────────────────────────────────────────────────

def test_the_route_reads_and_writes_the_members_own_conversation_only(client):
    cid = store.create_conversation(ME["id"], "x")
    me, other = client(ME), client(OTHER)
    assert me.get(f"/api/agent/conversations/{cid}/state/lastScreen").json() == {"key": "lastScreen", "value": None, "updated_at": None}
    r = me.put(f"/api/agent/conversations/{cid}/state/lastScreen", json={"value": LAST})
    assert r.status_code == 200 and r.json()["value"]["spec"]["filters"] == LAST["spec"]["filters"]
    assert me.get(f"/api/agent/conversations/{cid}/state/lastScreen").json()["value"]["symbols"] == ["AAA", "BBB", "CCC"]
    assert other.get(f"/api/agent/conversations/{cid}/state/lastScreen").status_code == 404
    assert other.put(f"/api/agent/conversations/{cid}/state/lastScreen", json={"value": LAST}).status_code == 404
    assert me.get(f"/api/agent/conversations/{cid}/state/nope").status_code == 404


def test_the_route_refuses_a_bad_or_hidden_screen_with_a_sentence(client):
    cid = store.create_conversation(ME["id"], "x")
    me = client(ME)
    bad = me.put(f"/api/agent/conversations/{cid}/state/lastScreen", json={"value": {"spec": {"filters": [{"key": "nope", "op": "gt", "min": 1}]}}})
    assert bad.status_code == 400 and "no field 'nope'" in bad.json()["detail"]
    hid = me.put(f"/api/agent/conversations/{cid}/state/lastScreen", json={"value": {"spec": {"filters": [{"key": "rs_rank", "op": "gte", "min": 80}]}}})
    assert hid.status_code == 400 and hid.json()["detail"].startswith(refine.RATINGS_REFUSAL)
    assert store.get_state(ME["id"], cid, "lastScreen") is None


# ── the stored shape ────────────────────────────────────────────────────────────────────────────────────────────────

def test_validate_last_screen_normalises_and_bounds():
    out = refine.validate_last_screen({**LAST, "savedId": 7, "spec": {**LAST["spec"], "sort": {"key": "chg_pct_3m", "dir": "desc"}}})
    assert out["spec"]["sort"] == {"key": "chg_pct_3m", "dir": "desc"} and out["savedId"] == "7"
    assert out["symbols"] == ["AAA", "BBB", "CCC"] and out["total"] == 41
    # review hardening (#708): browser decorations never reach the store — `pending` and a catalog filter's label are
    # dropped; only a `list` scope's label (the watchlist's name) is kept, capped
    deco = refine.validate_last_screen({"spec": {"filters": [
        {"key": "price", "op": "gte", "min": 10, "label": "x" * 5000, "pending": True},
        {"key": "list", "op": "in", "value": "wl:7", "label": "Momentum " + "y" * 200, "pending": True}]}, "symbols": []})
    assert deco["spec"]["filters"][0] == {"key": "price", "op": "gte", "min": 10}
    assert deco["spec"]["filters"][1]["label"] == ("Momentum " + "y" * 200)[:refine.LABEL_MAX]
    assert "pending" not in deco["spec"]["filters"][1]
    with pytest.raises(refine.RefineError, match="at most 50 result ids"):
        refine.validate_last_screen({**LAST, "symbols": [f"S{i}" for i in range(51)]})
    with pytest.raises(refine.RefineError, match="list of tickers"):
        refine.validate_last_screen({**LAST, "symbols": ["ok", "not a ticker"]})
    with pytest.raises(refine.RefineError, match="needs a `spec`"):
        refine.validate_last_screen({"symbols": []})
    with pytest.raises(refine.RefineError, match="no comparison"):
        refine.validate_last_screen({"spec": {"filters": [{"key": "price", "op": "near"}]}})
    # a measure condition (browser-only key) is kept by shape, not by catalog
    out = refine.validate_last_screen({"spec": {"filters": [], "post": [{"key": "dollar_volume_1d", "op": "gte", "min": 1e7}]}, "symbols": []})
    assert out["spec"]["post"] == [{"key": "dollar_volume_1d", "op": "gte", "min": 1e7}]


# ── SC-2 §3 composition ─────────────────────────────────────────────────────────────────────────────────────────────

BASE = {"filters": [{"key": "pct_vs_ema20", "op": "gt", "min": 0}, {"key": "vol_ratio", "op": "gte", "min": 2},
                    {"key": "sector", "op": "in", "values": ["Energy"]}], "post": [], "sort": None}


def test_add_narrow_replace_by_key_keeps_the_rest():
    out = refine.compose(BASE, {"add": [{"key": "price", "op": "gte", "min": 10}]})
    assert [f["key"] for f in out["filters"]] == ["pct_vs_ema20", "vol_ratio", "sector", "price"]
    again = refine.compose(out, {"add": [{"key": "price", "op": "gte", "min": 20}]})
    assert [f for f in again["filters"] if f["key"] == "price"] == [{"key": "price", "op": "gte", "min": 20}]
    assert len(again["filters"]) == 4


def test_replace_universe_swaps_the_sector_industry_slot_and_sort_replaces_only_the_sort():
    tech = refine.compose(BASE, {"universe": [{"key": "sector", "op": "in", "values": ["Technology"]}]})
    assert [f for f in tech["filters"] if f["key"] == "sector"] == [{"key": "sector", "op": "in", "values": ["Technology"]}]
    assert [f["key"] for f in tech["filters"]] == ["pct_vs_ema20", "vol_ratio", "sector"]
    ind = refine.compose(tech, {"universe": [{"key": "industry", "op": "in", "values": ["Software - Application"]}]})
    assert [f["key"] for f in ind["filters"]] == ["pct_vs_ema20", "vol_ratio", "industry"]      # the sector went with the slot
    srt = refine.compose(ind, {"sort": {"key": "chg_pct_3m", "dir": "desc"}})
    assert srt["filters"] == ind["filters"] and srt["sort"] == {"key": "chg_pct_3m", "dir": "desc"}
    with pytest.raises(refine.RefineError, match="not a universe field"):
        refine.compose(BASE, {"universe": [{"key": "price", "op": "gt", "min": 1}]})


def test_remove_and_show():
    out = refine.compose(BASE, {"remove": ["sector"], "show": 500})
    assert [f["key"] for f in out["filters"]] == ["pct_vs_ema20", "vol_ratio"] and out["show"] == 50
    with pytest.raises(refine.RefineError, match="has no rs_rank filter"):
        refine.compose(BASE, {"remove": ["rs_rank"]})


def test_the_flagship_follow_ups_compose_onto_the_last_screen():
    """'above their 20 EMA with volume at least twice average' → 'drop anything under $10' → 'top five by three-month change'."""
    first = {"filters": [{"key": "pct_vs_ema20", "op": "gt", "min": 0}, {"key": "vol_ratio", "op": "gte", "min": 2}], "post": [], "sort": None}
    narrowed = refine.compose(first, {"add": [{"key": "price", "op": "gte", "min": 10}]})
    ranked = refine.compose(narrowed, {"sort": {"key": "chg_pct_3m", "dir": "desc"}, "show": 5})
    assert ranked == {"filters": [{"key": "pct_vs_ema20", "op": "gt", "min": 0}, {"key": "vol_ratio", "op": "gte", "min": 2},
                                  {"key": "price", "op": "gte", "min": 10}], "post": [], "sort": {"key": "chg_pct_3m", "dir": "desc"}, "show": 5}
    assert not ({f["key"] for f in ranked["filters"]} | {"chg_pct_3m"}) & refine.hidden_keys()


# ── F-16 on a refinement: the owner's sentence + ONE public alternative, never a formula ───────────────────────────

@pytest.mark.parametrize("key,alt", [
    ("rs_rank", refine.ALT_STRENGTH), ("rs_return", refine.ALT_STRENGTH), ("uct_composite", refine.ALT_STRENGTH),
    ("rating_value", refine.ALT_STRENGTH), ("sector_rs_pct", refine.ALT_STRENGTH),
    ("candle_score", refine.ALT_SETUP), ("pattern_expectancy_r", refine.ALT_SETUP), ("earnings_setup_grade", refine.ALT_SETUP),
])
def test_a_refinement_adding_a_hidden_field_is_refused_with_the_sentence_and_one_public_alternative(key, alt):
    with pytest.raises(refine.RefineError) as e:
        refine.compose(BASE, {"add": [{"key": key, "op": "gte", "min": 80}]})
    msg = str(e.value)
    assert msg == f"{refine.RATINGS_REFUSAL}. A public alternative: {alt[1]} ({alt[0]})."
    assert alt[0] not in refine.hidden_keys()
    with pytest.raises(refine.RefineError, match=refine.RATINGS_REFUSAL):
        refine.compose(BASE, {"sort": {"key": key, "dir": "desc"}})


def test_a_flow_field_gets_the_flow_sentence_and_the_volume_alternative():
    with pytest.raises(refine.RefineError) as e:
        refine.compose(BASE, {"add": [{"key": "dp_notional_1d", "op": "gt", "min": 0}]})
    assert str(e.value) == f"{refine.FLOW_REFUSAL}. A public alternative: {refine.ALT_FLOW[1]} ({refine.ALT_FLOW[0]})."


def test_the_alternative_wording_never_reproduces_a_uct_formula_or_weight():
    """F-16-R (owner): the Agent must not name a UCT weight or formula. The sentences name one public field each."""
    sentences = {refine.refusal_for([k]) for k in refine.hidden_keys()}
    assert all(sentences)
    forbidden = ("0.40", "0.20", "0.4", "0.2", "25/18", "weight", "formula", "percentile", "composite of", "sum of", "×", "+ ")
    for s in sentences:
        for w in forbidden:
            assert w not in s, (w, s)
        assert s.count("(") == 1                                   # exactly one alternative, one key
    # the public alternatives are themselves public
    for k, _label in (refine.ALT_STRENGTH, refine.ALT_SETUP, refine.ALT_FLOW):
        assert k not in refine.hidden_keys()


def test_the_hidden_set_is_scan_hidden_py_and_covers_the_owner_ruling():
    ruling = {"uct_composite", "rating_eps", "rating_growth", "rating_value", "rating_smr", "sponsorship", "accdis", "rs_rank",
              "rs_return", "candle_score", "earnings_setup_grade", "in_uct20", "sector_rs_pct", "pattern_entry_dist_pct",
              "pattern_stop_dist_pct", "pattern_expectancy_r", "archive_calls_n"}
    assert ruling <= refine.hidden_keys()
    assert len([k for k in refine.hidden_keys() if k.startswith("pattern_engine_")]) >= 5
    assert len([k for k in refine.hidden_keys() if k.startswith("dp_")]) >= 4 and len([k for k in refine.hidden_keys() if k.startswith("opt_")]) >= 3

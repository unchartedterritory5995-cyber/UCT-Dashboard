"""W1-C C-05 (builder-c) — the flagship scan slice, deterministic: "above their 20 EMA with volume at least twice
average, drop anything under $10, top five by three-month change" is a validated SC-1 spec on PUBLIC fields only,
runs through the real `screen.run` against seeded fake rows, and its result ids are what a watchlist composition
takes. The browser half (one approval card, watchlist.create + watchlist.add {from: screen1, top: 5}) is
app/src/agent/agentFlagshipScan.test.jsx. No provider, no model."""
from __future__ import annotations

import pytest

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway
from api.services.uct_agent.scan import refine, spec as scan_spec

#: the flagship phrase as SC-1 wire filters (SC-2 §4 vocabulary: "above the 20-day EMA" = pct_vs_ema20 > 0;
#: "volume at least twice average" = vol_ratio >= 2 (full session vs 30-day average); "under $10" = price >= 10;
#: "three-month change" = chg_pct_3m)
FLAGSHIP = {"filters": [{"key": "pct_vs_ema20", "op": "gt", "min": 0}, {"key": "vol_ratio", "op": "gte", "min": 2},
                        {"key": "price", "op": "gte", "min": 10}],
            "sort": {"key": "chg_pct_3m", "dir": "desc"}, "columns": ["ticker", "company", "price", "chg_pct_3m"]}
TOP = 5

_ROW = {"company": "Co", "sector": "Technology", "chg_pct_1d": 1.0, "market_cap": 5e9, "bars_asof": 20261030,
        "snapshot_date": "2026-10-31", "security_type": "Common Stock", "rs_rank": 50, "uct_composite": 50}


def _rows():
    rows = []
    # 12 names that pass every filter, with distinct 3-month changes (the ranking is unambiguous)
    for i in range(12):
        rows.append(dict(_ROW, ticker=f"PASS{i:02d}", price=12.0 + i, pct_vs_ema20=1.0 + i, vol_ratio=2.0 + i / 10, chg_pct_3m=5.0 + 3 * i))
    # traps: each fails exactly one filter but would rank first by 3-month change
    rows.append(dict(_ROW, ticker="UNDER10", price=9.99, pct_vs_ema20=4.0, vol_ratio=3.0, chg_pct_3m=99.0))
    rows.append(dict(_ROW, ticker="BELOWEMA", price=50.0, pct_vs_ema20=-0.5, vol_ratio=3.0, chg_pct_3m=98.0))
    rows.append(dict(_ROW, ticker="THINVOL", price=50.0, pct_vs_ema20=4.0, vol_ratio=1.9, chg_pct_3m=97.0))
    rows.append(dict(_ROW, ticker="NOCHG", price=50.0, pct_vs_ema20=4.0, vol_ratio=3.0, chg_pct_3m=None))
    return rows


@pytest.fixture
def snap(tmp_path, monkeypatch):
    from api.services.screener import snapshot_db
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    snapshot_db.upsert_rows(_rows())
    return snapshot_db


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("UCT_AGENT_DATA", "1")
    monkeypatch.setenv(gateway.KINDS_ENV, "screen.run,screen.count")
    monkeypatch.setenv("UCT_AGENT_SCAN", "1")
    gateway._reset_for_test()
    yield
    gateway._reset_for_test()


def test_the_flagship_spec_is_a_valid_sc1_spec_on_public_fields_only():
    out = scan_spec.validate(FLAGSHIP)
    assert out["filters"] == FLAGSHIP["filters"] and out["sort"] == FLAGSHIP["sort"]
    from api.services.screener import filters
    catalog = {f["key"] for f in filters.field_catalog()}
    used = {f["key"] for f in FLAGSHIP["filters"]} | {FLAGSHIP["sort"]["key"]}
    assert used <= catalog
    assert not (used & refine.hidden_keys()), used & refine.hidden_keys()
    assert refine.refusal_for(used) is None


def test_the_phrase_composes_as_three_follow_ups_onto_the_same_spec():
    first = {"filters": FLAGSHIP["filters"][:2], "post": [], "sort": None}
    narrowed = refine.compose(first, {"add": [FLAGSHIP["filters"][2]]})
    ranked = refine.compose(narrowed, {"sort": FLAGSHIP["sort"], "show": TOP})
    assert ranked["filters"] == FLAGSHIP["filters"] and ranked["sort"] == FLAGSHIP["sort"] and ranked["show"] == TOP


def test_screen_run_returns_the_top_five_by_three_month_change_from_names_that_pass_every_filter(on, snap):
    out = gateway.read("screen.run", {"spec": FLAGSHIP, "limit": TOP}, user_id="admin-1", turn_id="t-flagship", purpose="answer")
    assert env.validate_envelope(out) == []
    assert out["status"] in ("ok", "partial") and out["freshness"] == "periodic" and out["provider_calls"] == 0
    rows = out["data"]["rows"]
    assert [r["symbol"] for r in rows] == ["PASS11", "PASS10", "PASS09", "PASS08", "PASS07"]
    # the 12 passing names + NOCHG (it passes every filter but has no 3-month change: a match, ranked last, never top-5)
    assert out["data"]["total_matches"] == 13
    changes = [r["chg_pct_3m"] for r in rows]
    assert changes == sorted(changes, reverse=True) and all(r["price"] >= 10 for r in rows)
    for trap in ("UNDER10", "BELOWEMA", "THINVOL", "NOCHG"):
        assert trap not in {r["symbol"] for r in rows}
    # the rows carry only the requested public columns: no hidden UCT field leaves the gateway
    for r in rows:
        assert set(r) == {"symbol", "company", "price", "chg_pct_3m"}
        assert not (set(r) & refine.hidden_keys())
    assert any("not live" in n for n in out["notes"])


def test_the_result_ids_are_what_the_watchlist_composition_takes_and_are_persisted_as_the_last_screen(on, snap, tmp_path, monkeypatch):
    from api.services.uct_agent import store
    monkeypatch.setattr(store, "_DB_PATH", str(tmp_path / "agent.db"))
    store._reset_for_tests()
    out = gateway.read("screen.run", {"spec": FLAGSHIP, "limit": TOP}, user_id="admin-1", turn_id="t-flagship-2", purpose="answer")
    ids = [r["symbol"] for r in out["data"]["rows"]]
    assert len(ids) == TOP
    last = refine.validate_last_screen({"spec": {"filters": FLAGSHIP["filters"], "post": [], "sort": FLAGSHIP["sort"]},
                                        "symbols": ids, "total": out["data"]["total_matches"], "asOf": out["as_of"][:10]})
    cid = store.create_conversation("admin-1", "above their 20 EMA…")
    assert store.set_state("admin-1", cid, refine.STATE_KEY, last) is True
    assert store.get_state("admin-1", cid, refine.STATE_KEY)["value"]["symbols"] == ids
    store._reset_for_tests()


def test_one_scan_per_turn_still_holds_for_the_flagship_read(on, snap):
    gateway.read("screen.run", {"spec": FLAGSHIP, "limit": TOP}, user_id="admin-1", turn_id="t-once", purpose="answer")
    again = gateway.read("screen.count", {"spec": FLAGSHIP}, user_id="admin-1", turn_id="t-once", purpose="answer")
    assert again["status"] == "refused" and "already ran 1 scan" in again["notes"][0]

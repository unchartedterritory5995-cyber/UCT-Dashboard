"""Spec §P2 item 7 (R-P2b-4/5): one read for the post-trade review block; the pre-entry ticks carry.

Pre-flight corrections carried here (R-PF-B6, R-PF-N15, N7/N29):
  * B6: `get_trade_detail` answers `{"trade": {...}, "tradeRef": ...}`; the review reads the trade,
    its tags and its position id from `detail["trade"]`.
  * N7 / N29: the adherence read is ONE helper (the trade's own record, else the position's pre-entry
    record under `pre_entry_ref(position_id)`, the ONE spelling).
  * N15: a `j2_trades` uuid is reissued on every broker resync, so the review also resolves a stable
    trade ref (`id:` / `ext:`) through `trade_refs.resolve_trade_by_ref`, and the trade list carries it.
"""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _trade(user="u1", tid="t1", *, symbol="NVDA", exit_date="2026-10-05", result="Win", position="p1",
           source=None, ext=None, setup=None):
    from api.services.auth_db import get_connection
    c = get_connection()
    c.execute("INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date, exit_price,"
              " exit_date, original_stop, pnl_dollar, pnl_percent, r_multiple, hold_days, result, context_at_entry,"
              " created_at, mistake_tags, emotion_tags, source, external_id, setup) VALUES (?, ?, ?, ?, 'Long', 1, 100,"
              " '2026-10-01', 110, ?, 95, 10, 0.1, 2.0, 4, ?, '{}', 'now', '[\"chased\"]', '[\"calm\"]', ?, ?, ?)",
              (tid, user, position, symbol, exit_date, result, source, ext, setup))
    c.commit()
    c.close()


def test_review_carries_the_trade_tags_and_pre_entry(db_path, monkeypatch):
    from api.services.journal_two import adherence_store, trader_blocks as tb
    monkeypatch.delenv("NOTEBOOK_PLAN_GRADING_ENABLED", raising=False)
    _trade(setup="VCP")
    adherence_store.upsert_adherence("u1", "pos:p1", "VCP", ["s1"], 3)
    got = tb.trade_review("u1", "t1")
    assert got["trade"]["symbol"] == "NVDA" and got["trade"]["rMultiple"] == 2.0
    assert set(got["trade"]) == set(tb._TRADE_KEYS) | {"tradeRef"}
    assert (got["trade"]["id"], got["trade"]["tradeRef"], got["trade"]["setup"]) == ("t1", "id:t1", "VCP")
    assert got["tags"] == {"mistakes": ["chased"], "emotions": ["calm"]}
    assert got["preEntry"] == {"setup": "VCP", "checkedRuleIds": ["s1"], "totalRules": 3}
    assert got["planGrade"] == {"needs": "plan grading"}


def test_the_trades_own_adherence_record_wins_over_the_pre_entry_one(db_path):
    from api.services.journal_two import adherence_store, trader_blocks as tb
    _trade()
    adherence_store.upsert_adherence("u1", "pos:p1", "VCP", ["s1"], 3)
    adherence_store.upsert_adherence("u1", "id:t1", "Flag", ["a", "b"], 2)
    assert tb.trade_review("u1", "t1")["preEntry"] == {"setup": "Flag", "checkedRuleIds": ["a", "b"], "totalRules": 2}


def test_no_record_at_all_is_no_pre_entry(db_path):
    from api.services.journal_two import trader_blocks as tb
    _trade(position="p-unticked")                                      # no own record, no pos: record
    assert tb.trade_review("u1", "t1")["preEntry"] is None


def test_the_adherence_read_is_ONE_helper_over_the_ONE_spelling(db_path, monkeypatch):
    """N7 / N29: the fallback key is `pre_entry_ref(position_id)`, asked through the one helper."""
    from api.services.journal_two import adherence_store, trader_blocks as tb
    _trade(position="p9")
    asked: list[str] = []
    real = adherence_store.get_adherence
    monkeypatch.setattr(adherence_store, "get_adherence", lambda uid, ref, conn=None: asked.append(ref) or real(uid, ref, conn=conn))
    monkeypatch.setattr(tb, "pre_entry_ref", lambda pid: f"POS-SPELLING:{pid}")
    tb.trade_review("u1", "t1")
    assert asked == ["id:t1", "POS-SPELLING:p9"]


def test_review_of_a_missing_trade_is_404(db_path):
    from api.services.journal_two import trader_blocks as tb
    _trade(user="u2")
    assert tb.trade_review("u1", "t1") is None
    assert tb.trade_review("u1", "gone") is None
    assert tb.trade_review("u1", "id:t1") is None                     # another member's, by ref too


def test_review_resolves_a_stable_trade_ref(db_path):
    """N15: a broker trade's uuid changes on every full resync; its `ext:` ref does not."""
    from api.services.journal_two import trader_blocks as tb
    _trade(tid="t-uuid-1", source="broker", ext="FP-1")
    by_ref = tb.trade_review("u1", "ext:FP-1")
    assert by_ref is not None and by_ref["trade"]["id"] == "t-uuid-1" and by_ref["trade"]["tradeRef"] == "ext:FP-1"
    assert tb.trade_review("u1", "id:t-uuid-1") is None                 # a broker row's ref is ext:, never id:
    assert tb.trade_review("u1", "ext:NOPE") is None


def test_plan_grading_on_answers_the_trade_pages_grade(db_path, monkeypatch):
    from api.services.journal_two import plan_grading, trader_blocks as tb
    _trade()
    seen: list[str] = []
    monkeypatch.setattr(plan_grading, "enabled", lambda: True)
    monkeypatch.setattr(plan_grading, "grade_payload", lambda conn, uid, t, *a, **k: seen.append((uid, t["id"])) or {"grade": "B"})
    assert tb.trade_review("u1", "t1")["planGrade"] == {"grade": "B"}
    assert seen == [("u1", "t1")]


def test_recent_closed_trades(db_path):
    from api.services.journal_two import trader_blocks as tb
    _trade(tid="t1", exit_date="2026-10-01")
    _trade(tid="t2", exit_date="2026-10-05", symbol="AMD", result="Loss")
    _trade(tid="t3", user="u2")
    got = tb.recent_closed_trades("u1")
    assert [t["id"] for t in got] == ["t2", "t1"]
    assert got[0] == {"id": "t2", "tradeRef": "id:t2", "symbol": "AMD", "exitDate": "2026-10-05", "result": "Loss"}
    assert len(tb.recent_closed_trades("u1", limit=1)) == 1
    assert tb.recent_closed_trades("nobody") == []


def test_a_broker_trade_is_listed_by_its_stable_ref(db_path):
    from api.services.journal_two import trader_blocks as tb
    _trade(tid="t-uuid-2", source="broker", ext="FP-2")
    assert tb.recent_closed_trades("u1")[0]["tradeRef"] == "ext:FP-2"


# ── the routes ────────────────────────────────────────────────────────────────────────────

def _client(monkeypatch, plan="pro"):
    from api.routers import notebook_journal_styles as r
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    app = FastAPI()
    app.include_router(r.router)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": plan}
    return TestClient(app), r


def test_routes_list_review_and_404(db_path, monkeypatch):
    monkeypatch.delenv("NOTEBOOK_PLAN_GRADING_ENABLED", raising=False)
    _trade()
    _trade(tid="t2", user="u2")
    client, r = _client(monkeypatch)
    listed = client.get("/api/j2/trader-blocks/review/trades")
    assert listed.status_code == 200 and [t["id"] for t in listed.json()["trades"]] == ["t1"]
    got = client.get("/api/j2/trader-blocks/review/t1")
    assert got.status_code == 200 and got.json()["trade"]["symbol"] == "NVDA"
    assert client.get("/api/j2/trader-blocks/review/id:t1").status_code == 200
    for gone in ("gone", "t2", "id:t2"):
        res = client.get(f"/api/j2/trader-blocks/review/{gone}")
        assert res.status_code == 404 and res.json()["detail"] == r.NOT_FOUND, gone
    free, _ = _client(monkeypatch, plan="free")
    assert free.get("/api/j2/trader-blocks/review/trades").status_code == 402


def test_the_list_route_is_declared_before_the_review_route(db_path, monkeypatch):
    """`/review/trades` answers the list, never a review of a trade whose id is "trades"."""
    _trade(tid="trades")
    client, _ = _client(monkeypatch)
    got = client.get("/api/j2/trader-blocks/review/trades")
    assert got.status_code == 200 and "trades" in got.json() and "trade" not in got.json()
    assert [t["id"] for t in got.json()["trades"]] == ["trades"]

# tests/api/test_community_call_record.py
"""TERM-009 — a member's call record: every $TICKER they mentioned and how it has moved,
losses included, published ONLY by the member's own choice (owner ruling 2026-09-29)."""
import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

MEMBER = {"id": "u-member", "email": "m@x.com", "display_name": "Mem",
          "role": "member", "plan": "pro", "email_verified": True}
OTHER = {"id": "u-other", "email": "o@x.com", "display_name": "Oth",
         "role": "member", "plan": "pro", "email_verified": True}
DOC = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"%s"}]}]}'
PRICES_NOW = {"NVDA": 110.0, "AMD": 95.0, "TSLA": 200.0}


@pytest.fixture
def floor(monkeypatch, tmp_path):
    monkeypatch.setenv("COMMUNITY_DB_PATH", str(tmp_path / "community.db"))
    monkeypatch.setenv("COMMUNITY_ENABLED", "1")
    monkeypatch.setenv("COMMUNITY_CHAT_ENABLED", "1")
    from api.services import community_store
    importlib.reload(community_store)
    community_store._init_db()
    from api.services import community_call_record, community_marks
    importlib.reload(community_call_record)
    monkeypatch.setattr(community_marks, "prices_now",
                        lambda tks: {t: PRICES_NOW[t] for t in tks if t in PRICES_NOW})
    # MEMBER mentions NVDA at 100 (+10% since), AMD at 100 (-5%), TSLA at 200 (flat), and
    # a ticker nothing can price. OTHER mentions NVDA once.
    for author, tk, px in [(MEMBER["id"], "NVDA", 100.0), (MEMBER["id"], "AMD", 100.0),
                           (MEMBER["id"], "TSLA", 200.0), (MEMBER["id"], "ZZZZ", 5.0),
                           (OTHER["id"], "NVDA", 90.0)]:
        msg = community_store.create_message("trading-floor", author, DOC % f"${tk}",
                                             ticker_tags=[tk], bypass_rate_limit=True)
        mid = msg["id"] if isinstance(msg, dict) else msg
        community_store.record_ticker_marks(mid, {tk: px})
    return community_store


def _client(user):
    from api.routers import community as router_mod
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_user_with_plan] = lambda: user
    return TestClient(app)


def test_the_record_reports_moves_losses_included_and_counts_what_it_cannot_price(floor):
    from api.services import community_call_record
    rec = community_call_record.build(MEMBER["id"])
    by = {r["ticker"]: r for r in rec["rows"]}
    assert by["NVDA"]["move_pct"] == 10.0
    assert by["AMD"]["move_pct"] == -5.0          # the loss is in the record
    assert by["TSLA"]["move_pct"] == 0.0
    assert by["ZZZZ"]["move_pct"] is None          # unpriced, never dropped
    s = rec["summary"]
    assert (s["marks"], s["priced"], s["unpriced"]) == (4, 3, 1)
    assert (s["up"], s["down"], s["flat"]) == (1, 1, 1)


def test_nobody_is_scored_without_choosing_it(floor):
    c = _client(OTHER)
    r = c.get(f"/api/community/members/{MEMBER['id']}/calls")
    assert r.status_code == 404
    assert "does not share" in r.json()["detail"]


def test_the_owner_sees_their_own_record_marked_private(floor):
    r = _client(MEMBER).get(f"/api/community/members/{MEMBER['id']}/calls")
    assert r.status_code == 200
    assert r.json()["public"] is False and r.json()["mine"] is True
    assert r.json()["summary"]["marks"] == 4


def test_opting_in_publishes_it_and_opting_out_hides_it_without_deleting_anything(floor):
    me, them = _client(MEMBER), _client(OTHER)
    assert me.put("/api/community/me/call-record", json={"enabled": True}).json() == {"public": True}
    shown = them.get(f"/api/community/members/{MEMBER['id']}/calls")
    assert shown.status_code == 200 and shown.json()["summary"]["marks"] == 4
    assert me.put("/api/community/me/call-record", json={"enabled": False}).json() == {"public": False}
    assert them.get(f"/api/community/members/{MEMBER['id']}/calls").status_code == 404
    # hidden, not deleted: the owner still has every mark
    assert me.get(f"/api/community/members/{MEMBER['id']}/calls").json()["summary"]["marks"] == 4
    assert len(floor.calls_for_member(MEMBER["id"])) == 4


def test_a_deleted_message_leaves_the_record(floor):
    rows = floor.calls_for_member(MEMBER["id"])
    amd = next(r for r in rows if r["ticker"] == "AMD")
    with floor.get_connection() as conn:
        conn.execute("UPDATE messages SET deleted=1 WHERE id=?", (amd["message_id"],))
        conn.commit()
    assert "AMD" not in [r["ticker"] for r in floor.calls_for_member(MEMBER["id"])]

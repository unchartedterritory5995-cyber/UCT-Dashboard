# tests/api/test_community_chat_router.py
"""End-to-end chat API: gating, send, server-built card redaction, reactions,
rate-limit, moderation, and a live SSE receive (cross-thread broadcast)."""
import asyncio
import json

import pytest
from httpx import ASGITransport, AsyncClient

MEMBER = {"id": "u-member", "email": "m@x.com", "display_name": "Mem",
          "role": "member", "plan": "pro", "email_verified": True}
MEMBER2 = {"id": "u-two", "email": "t@x.com", "display_name": "Two",
           "role": "member", "plan": "pro", "email_verified": True}
ADMIN = {"id": "u-admin", "email": "a@x.com", "display_name": "Adm",
         "role": "admin", "plan": "pro", "email_verified": True}
FREE = {"id": "u-free", "email": "f@x.com", "display_name": "Fre",
        "role": "member", "plan": "free", "email_verified": True}

DOC = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"%s"}]}]}'


@pytest.fixture
def client_for(monkeypatch, tmp_path):
    monkeypatch.setenv("COMMUNITY_DB_PATH", str(tmp_path / "community.db"))
    monkeypatch.setenv("COMMUNITY_ENABLED", "1")
    monkeypatch.setenv("COMMUNITY_CHAT_ENABLED", "1")
    monkeypatch.setenv("CHAT_BURST_MAX", "3")
    import importlib
    from api.services import community_store
    importlib.reload(community_store)
    community_store._init_db()
    from api import chat_stream
    chat_stream.reset_hub_for_tests()
    from api.main import app
    from api.routers import community as community_router
    if not any(getattr(r, "path", "").startswith("/api/community")
               for r in app.router.routes):
        app.include_router(community_router.router)
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan

    def make(user):
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_current_user_with_plan] = lambda: user
        return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    yield make
    app.dependency_overrides.clear()


async def _ack(ac):
    await ac.post("/api/community/ack")


@pytest.mark.asyncio
async def test_chat_gating(client_for, monkeypatch):
    # flag off + non-admin → 503
    monkeypatch.setenv("COMMUNITY_CHAT_ENABLED", "0")
    async with client_for(MEMBER) as ac:
        assert (await ac.get("/api/community/chat/channels")).status_code == 503
    # admin previews while dark
    async with client_for(ADMIN) as ac:
        assert (await ac.get("/api/community/chat/channels")).status_code == 200


@pytest.mark.asyncio
async def test_free_plan_blocked(client_for):
    async with client_for(FREE) as ac:
        assert (await ac.get("/api/community/chat/channels")).status_code == 402


@pytest.mark.asyncio
async def test_ack_required_then_send(client_for):
    async with client_for(MEMBER) as ac:
        # no ack yet → 403
        r = await ac.post("/api/community/chat/channels/trading-floor/messages",
                          json={"body": DOC % "hello", "client_msg_id": "c1"})
        assert r.status_code == 403
        await _ack(ac)
        r = await ac.post("/api/community/chat/channels/trading-floor/messages",
                          json={"body": DOC % "hello floor", "client_msg_id": "c1"})
        assert r.status_code == 200
        msg = r.json()
        # author name resolves from auth.db; the mock user has no row → "member" fallback
        assert msg["client_msg_id"] == "c1" and msg["author"]["name"] in ("Mem", "member")
        # appears in list
        lst = (await ac.get("/api/community/chat/channels/trading-floor/messages")).json()
        assert any(m["id"] == msg["id"] for m in lst["messages"])


@pytest.mark.asyncio
async def test_trade_card_redacted_over_http(client_for, monkeypatch):
    def fake_trade(uid, tid):
        return {"id": tid, "symbol": "nvda", "side": "Long", "result": "Win", "setup": "HTF",
                "rMultiple": 2.3, "pnlPercent": 0.12, "entryPrice": 100.5, "exitPrice": 112.1,
                "shares": 500, "pnlDollar": 5800, "pnlDollarNet": 5750, "tradeRef": "r1"}
    monkeypatch.setattr("api.services.journal_two.trades.get_trade_detail", fake_trade)
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        r = await ac.post("/api/community/chat/channels/trading-floor/messages",
                          json={"body": "", "card": {"kind": "trade", "tradeId": "t1"},
                                "client_msg_id": "c2"})
        assert r.status_code == 200
        blob = json.dumps(r.json())
        for leak in ("shares", "pnlDollar", "5800", "500"):
            assert leak not in blob
        assert r.json()["card"]["rMultiple"] == 2.3


@pytest.mark.asyncio
async def test_offorigin_card_rejected(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        r = await ac.post("/api/community/chat/channels/trading-floor/messages",
                          json={"body": "", "card": {"kind": "chart", "ticker": "AAPL",
                                                     "stateUrl": "https://evil.example/x"}})
        assert r.status_code == 400


@pytest.mark.asyncio
async def test_rate_limit_429(client_for):
    async with client_for(MEMBER2) as ac:
        await _ack(ac)
        for i in range(3):
            assert (await ac.post("/api/community/chat/channels/trading-floor/messages",
                                  json={"body": DOC % f"m{i}"})).status_code == 200
        assert (await ac.post("/api/community/chat/channels/trading-floor/messages",
                              json={"body": DOC % "flood"})).status_code == 429


@pytest.mark.asyncio
async def test_react_and_moderation(client_for):
    from api.services import community_store
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        mid = (await ac.post("/api/community/chat/channels/trading-floor/messages",
                             json={"body": DOC % "abusive"})).json()["id"]
        r = await ac.post(f"/api/community/chat/messages/{mid}/reactions", json={"kind": "fire"})
        assert r.json()["on"] is True
        # report it
        assert (await ac.post("/api/community/chat/reports",
                              json={"message_id": mid, "reason": "spam"})).status_code == 200
    # admin hides it → deleted + report resolved
    async with client_for(ADMIN) as ac:
        reports = (await ac.get("/api/community/chat/admin/reports")).json()["reports"]
        rid = reports[0]["id"]
        assert (await ac.patch(f"/api/community/chat/admin/reports/{rid}",
                               json={"action": "hide"})).status_code == 200
    assert community_store.get_message(mid)["deleted"] == 1
    assert community_store.get_message(mid)["body"] == ""


@pytest.mark.asyncio
async def test_poll_create_and_vote(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        mid = (await ac.post("/api/community/chat/channels/trading-floor/messages",
                             json={"body": "", "card": {"kind": "poll",
                                   "question": "Bull or Bear on $NVDA?",
                                   "options": ["Bull", "Bear", "Chop"]}})).json()["id"]
        r = await ac.post(f"/api/community/chat/messages/{mid}/vote", json={"option_key": "o0"})
        assert r.status_code == 200 and r.json()["my_vote"] == "o0"
        r = await ac.post(f"/api/community/chat/messages/{mid}/vote", json={"option_key": "o1"})
        assert r.json()["my_vote"] == "o1" and r.json()["total"] == 1     # re-vote moves
        assert (await ac.post(f"/api/community/chat/messages/{mid}/vote",
                              json={"option_key": "o9"})).status_code == 400
        msgs = (await ac.get("/api/community/chat/channels/trading-floor/messages")).json()["messages"]
        poll = next(m for m in msgs if m["id"] == mid)
        assert poll["card"]["results"]["counts"] == {"o1": 1}


@pytest.mark.asyncio
async def test_idea_card_tracking_and_outcome(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        r = await ac.post("/api/community/chat/channels/trading-floor/messages",
                          json={"body": "", "card": {"kind": "idea", "ticker": "NVDA",
                                "side": "long", "entry": 128.5, "stop": 124, "target": 140,
                                "note": "flag break"}})
        assert r.status_code == 200
        card = r.json()["card"]
        assert card["rr"] == 2.56 and card["side"] == "LONG"
        mid = r.json()["id"]
        # I'm in toggle
        r = await ac.post(f"/api/community/chat/messages/{mid}/im-in")
        assert r.json() == {"in_count": 1, "me_in": True}
        r = await ac.post(f"/api/community/chat/messages/{mid}/im-in")
        assert r.json() == {"in_count": 0, "me_in": False}
        # outcome: author marks hit
        r = await ac.patch(f"/api/community/chat/messages/{mid}/idea", json={"outcome": "hit"})
        assert r.status_code == 200 and r.json()["outcome"] == "hit"
        msgs = (await ac.get("/api/community/chat/channels/trading-floor/messages")).json()["messages"]
        idea = next(m for m in msgs if m["id"] == mid)
        assert idea["card"]["outcome"] == "hit" and "tracking" in idea["card"]
    # non-author can't mark
    async with client_for(MEMBER2) as ac2:
        await _ack(ac2)
        assert (await ac2.patch(f"/api/community/chat/messages/{mid}/idea",
                                json={"outcome": "stopped"})).status_code == 403


@pytest.mark.asyncio
async def test_chat_search(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        await ac.post("/api/community/chat/channels/trading-floor/messages",
                      json={"body": DOC % "watching PLTR into the close"})
        r = await ac.get("/api/community/chat/search?q=PLTR")
        assert r.status_code == 200
        hits = r.json()["messages"]
        assert any("PLTR" in m["snippet"] for m in hits)
        assert (await ac.get("/api/community/chat/search?q=x")).json()["messages"] == []


@pytest.mark.asyncio
async def test_ask_gate_disabled(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        r = await ac.post("/api/community/chat/channels/trading-floor/ask",
                          json={"question": "playbook for a high tight flag?"})
        assert r.status_code == 503   # COMMUNITY_ASK_ENABLED not set


@pytest.mark.asyncio
async def test_graduate_message_to_board(client_for):
    from api.services import community_store
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        mid = (await ac.post("/api/community/chat/channels/trading-floor/messages",
                             json={"body": DOC % "NVDA reclaim", "ticker_tags": ["NVDA"]})).json()["id"]
        r = await ac.post(f"/api/community/chat/messages/{mid}/graduate",
                          json={"space": "trade-ideas", "title": "NVDA reclaim — why"})
        assert r.status_code == 200
        tid = r.json()["thread_id"]
        # thread created + message linked
        assert community_store.get_thread(tid)["title"] == "NVDA reclaim — why"
        assert community_store.get_message(mid)["graduated_thread_id"] == tid
        # idempotent
        r2 = await ac.post(f"/api/community/chat/messages/{mid}/graduate",
                           json={"space": "wins-lessons", "title": "dup"})
        assert r2.json().get("already") and r2.json()["thread_id"] == tid
        # member can't graduate into the mentor-only Board
        m2 = (await ac.post("/api/community/chat/channels/trading-floor/messages",
                            json={"body": DOC % "x"})).json()["id"]
        assert (await ac.post(f"/api/community/chat/messages/{m2}/graduate",
                              json={"space": "mentor-desk", "title": "no"})).status_code == 403


@pytest.mark.asyncio
async def test_sse_stream_registers_subscriber_and_broadcasts(client_for):
    """The SSE endpoint opens (200) and registers a live subscriber on the hub; a
    concurrent POST fires a broadcast to it. (End-to-end queue→client delivery is
    proven by the hub unit test — httpx's in-process ASGITransport does not surface
    SSE chunks incrementally, so we assert the observable wiring here.)"""
    from api import chat_stream
    async with client_for(MEMBER) as sender, client_for(MEMBER) as listener:
        await _ack(sender)
        opened = {}

        async def listen():
            async with listener.stream(
                    "GET", "/api/community/chat/stream?channels=trading-floor") as resp:
                opened["status"] = resp.status_code
                # hold the stream open long enough for the POST below to broadcast
                try:
                    async for _line in resp.aiter_lines():
                        if opened.get("done"):
                            return
                except Exception:
                    pass

        task = asyncio.create_task(listen())
        await asyncio.sleep(0.5)   # let the SSE coroutine subscribe on the hub
        assert chat_stream.get_hub().stats()["connections"] >= 1, "subscriber not registered"
        before = chat_stream.get_hub().stats()["messages_broadcast_total"]
        r = await sender.post("/api/community/chat/channels/trading-floor/messages",
                              json={"body": DOC % "live!", "client_msg_id": "cx"})
        assert r.status_code == 200, r.text
        after = chat_stream.get_hub().stats()["messages_broadcast_total"]
        assert after == before + 1, "broadcast did not fire to the live subscriber"
        opened["done"] = True
        task.cancel()

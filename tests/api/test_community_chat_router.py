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

# tests/api/test_floor_router.py
"""The Floor (forum v2) API — gating, feed, create, vote, react, bookmark,
accepted answer, notifications, search."""
import pytest
from httpx import AsyncClient, ASGITransport


MEMBER = {"id": "u-member", "email": "m@x.com", "display_name": "Mem",
          "role": "member", "plan": "pro", "email_verified": True}
MEMBER2 = {"id": "u-member2", "email": "m2@x.com", "display_name": "Mem2",
           "role": "member", "plan": "pro", "email_verified": True}
ADMIN = {"id": "u-admin", "email": "a@x.com", "display_name": "Adm",
         "role": "admin", "plan": "free", "email_verified": True}
FREE = {"id": "u-free", "email": "f@x.com", "display_name": "Fre",
        "role": "member", "plan": "free", "email_verified": True}

VALID_BODY = ('{"type":"doc","content":[{"type":"paragraph","content":'
              '[{"type":"text","text":"revisit your stop"}]}]}')


@pytest.fixture
def client_for(monkeypatch, tmp_path):
    monkeypatch.setenv("COMMUNITY_DB_PATH", str(tmp_path / "community.db"))
    monkeypatch.setenv("COMMUNITY_ENABLED", "1")
    from api.services import community_store
    community_store._init_db()
    from api.main import app
    from api.routers import community as community_router
    if not any(getattr(r, "path", "").startswith("/api/community")
               for r in app.router.routes):
        app.include_router(community_router.router)
    from api.middleware.auth_middleware import (
        get_current_user, get_current_user_with_plan)

    def make(user):
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_current_user_with_plan] = lambda: user
        return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    yield make
    app.dependency_overrides.clear()


async def _ack(ac):
    assert (await ac.post("/api/community/ack")).status_code == 200


@pytest.mark.asyncio
async def test_feed_gating(client_for, monkeypatch):
    async with client_for(FREE) as ac:
        assert (await ac.get("/api/community/floor/feed")).status_code == 402
    monkeypatch.setenv("COMMUNITY_ENABLED", "0")
    async with client_for(MEMBER) as ac:
        assert (await ac.get("/api/community/floor/feed")).status_code == 503


@pytest.mark.asyncio
async def test_status_carries_notifications_unseen(client_for):
    async with client_for(MEMBER) as ac:
        body = (await ac.get("/api/community/status")).json()
    assert body["notifications_unseen"] == 0


@pytest.mark.asyncio
async def test_create_thread_and_feed(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        r = await ac.post("/api/community/floor/threads", json={
            "title": "How to handle a gap-up on a swing?",
            "body": VALID_BODY, "flair": "Question", "ticker_tags": ["nvda"],
            "chart": {"ticker": "nvda", "tf": "1D", "caption": "the setup"}})
        assert r.status_code == 200
        tid = r.json()["id"]
        feed = (await ac.get("/api/community/floor/feed")).json()["threads"]
        assert feed[0]["id"] == tid
        assert feed[0]["flair"] == "Question"
        assert feed[0]["tickers"] == ["NVDA"]
        assert feed[0]["chart"]["ticker"] == "NVDA"
        # author is attached (name resolves from auth.db; falls back to "member"
        # in the test sandbox where no users row exists)
        assert isinstance(feed[0]["author"]["name"], str)
        assert feed[0]["author"]["is_mentor"] is False
        # flair filter
        assert len((await ac.get("/api/community/floor/feed",
                                 params={"flair": "Question"})).json()["threads"]) == 1
        assert len((await ac.get("/api/community/floor/feed",
                                 params={"flair": "Lesson"})).json()["threads"]) == 0


@pytest.mark.asyncio
async def test_write_requires_ack(client_for):
    async with client_for(MEMBER) as ac:
        r = await ac.post("/api/community/floor/threads",
                          json={"title": "t", "body": VALID_BODY})
        assert r.status_code == 403 and r.json()["detail"] == "acknowledgment_required"


@pytest.mark.asyncio
async def test_bad_flair_rejected(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        r = await ac.post("/api/community/floor/threads",
                          json={"title": "t", "body": VALID_BODY, "flair": "Bogus"})
        assert r.status_code == 400


@pytest.mark.asyncio
async def test_deep_nesting_and_detail(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        tid = (await ac.post("/api/community/floor/threads",
                             json={"title": "t", "body": VALID_BODY})).json()["id"]
        c1 = (await ac.post(f"/api/community/floor/threads/{tid}/posts",
                            json={"body": VALID_BODY})).json()["id"]
        c2 = (await ac.post(f"/api/community/floor/threads/{tid}/posts",
                            json={"body": VALID_BODY, "parent_post_id": c1})).json()["id"]
        c3 = (await ac.post(f"/api/community/floor/threads/{tid}/posts",
                            json={"body": VALID_BODY, "parent_post_id": c2})).json()["id"]
        det = (await ac.get(f"/api/community/floor/threads/{tid}")).json()
        parents = {p["id"]: p["parent_post_id"] for p in det["posts"]}
        assert parents == {c1: None, c2: c1, c3: c2}
        assert det["comment_count"] == 3


@pytest.mark.asyncio
async def test_vote_react_bookmark(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        tid = (await ac.post("/api/community/floor/threads",
                             json={"title": "t", "body": VALID_BODY})).json()["id"]
        r = await ac.post("/api/community/floor/votes",
                          json={"target_type": "thread", "target_id": tid, "dir": 1})
        assert r.json() == {"score": 1, "my_vote": 1}
        r = await ac.post("/api/community/floor/reactions", json={
            "target_type": "thread", "target_id": tid, "emoji": "\U0001f525"})
        assert r.json()["on"] is True
        assert (await ac.post(f"/api/community/floor/bookmarks/{tid}")).json()["on"] is True
        bm = (await ac.get("/api/community/floor/feed",
                           params={"filter": "bookmarks"})).json()["threads"]
        assert [t["id"] for t in bm] == [tid]
        d = (await ac.get("/api/community/floor/feed")).json()["threads"][0]
        assert d["my_vote"] == 1 and d["bookmarked"] is True
        assert d["reactions"][0]["emoji"] == "\U0001f525"


@pytest.mark.asyncio
async def test_accepted_answer_author_only(client_for):
    # author creates a question
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        tid = (await ac.post("/api/community/floor/threads", json={
            "title": "q", "body": VALID_BODY, "flair": "Question"})).json()["id"]
    # a different member answers it
    async with client_for(MEMBER2) as ac2:
        await _ack(ac2)
        cid = (await ac2.post(f"/api/community/floor/threads/{tid}/posts",
                              json={"body": VALID_BODY})).json()["id"]
        # non-author cannot accept
        r = await ac2.post(f"/api/community/floor/threads/{tid}/answer",
                           json={"post_id": cid})
        assert r.status_code == 403
    # author accepts
    async with client_for(MEMBER) as ac:
        r = await ac.post(f"/api/community/floor/threads/{tid}/answer",
                          json={"post_id": cid})
        assert r.json()["answer_post_id"] == cid
        assert (await ac.get("/api/community/floor/feed")).json()["threads"][0]["answered"] is True


@pytest.mark.asyncio
async def test_comment_notifies_thread_author(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        tid = (await ac.post("/api/community/floor/threads",
                             json={"title": "t", "body": VALID_BODY})).json()["id"]
    async with client_for(MEMBER2) as ac2:
        await _ack(ac2)
        await ac2.post(f"/api/community/floor/threads/{tid}/posts",
                       json={"body": VALID_BODY})
    async with client_for(MEMBER) as ac:
        n = (await ac.get("/api/community/floor/notifications")).json()
        assert n["unseen"] == 1
        assert n["notifications"][0]["kind"] == "comment"
        assert n["notifications"][0]["actor"] is not None  # actor profile attached
        assert (await ac.post("/api/community/floor/notifications/read")).status_code == 200
        assert (await ac.get("/api/community/floor/notifications")).json()["unseen"] == 0


@pytest.mark.asyncio
async def test_search_dash_agnostic(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        await ac.post("/api/community/floor/threads", json={
            "title": "Handling a gap-up on a swing", "body": VALID_BODY})
        res = (await ac.get("/api/community/floor/search",
                            params={"q": "gap up"})).json()["threads"]
        assert len(res) == 1
        assert (await ac.get("/api/community/floor/search",
                             params={"q": "nomatch"})).json()["threads"] == []


@pytest.mark.asyncio
async def test_delete_own_thread(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        tid = (await ac.post("/api/community/floor/threads",
                             json={"title": "t", "body": VALID_BODY})).json()["id"]
    # a different member cannot delete it
    async with client_for(MEMBER2) as ac2:
        assert (await ac2.delete(f"/api/community/floor/threads/{tid}")).status_code == 403
    async with client_for(MEMBER) as ac:
        assert (await ac.delete(f"/api/community/floor/threads/{tid}")).status_code == 200
        assert (await ac.get("/api/community/floor/feed")).json()["threads"] == []

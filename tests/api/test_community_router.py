# tests/api/test_community_router.py
import pytest
from httpx import AsyncClient, ASGITransport


MEMBER = {"id": "u-member", "email": "m@x.com", "display_name": "Mem",
          "role": "member", "plan": "pro", "email_verified": True}
ADMIN = {"id": "u-admin", "email": "a@x.com", "display_name": "Adm",
         "role": "admin", "plan": "free", "email_verified": True}
FREE = {"id": "u-free", "email": "f@x.com", "display_name": "Fre",
        "role": "member", "plan": "free", "email_verified": True}


@pytest.fixture
def client_for(monkeypatch, tmp_path):
    """Factory: authed ASGI client with the community flag ON and a temp DB."""
    monkeypatch.setenv("COMMUNITY_DB_PATH", str(tmp_path / "community.db"))
    monkeypatch.setenv("COMMUNITY_ENABLED", "1")
    from api.services import community_store
    community_store._init_db()
    from api.main import app
    # Self-contained until Task 7 registers the router in main.py (no-op after).
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


@pytest.mark.asyncio
async def test_status_reports_enabled_and_role(client_for):
    async with client_for(ADMIN) as ac:
        r = await ac.get("/api/community/status")
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is True and body["is_mentor"] is True


@pytest.mark.asyncio
async def test_flag_off_returns_503(client_for, monkeypatch):
    monkeypatch.setenv("COMMUNITY_ENABLED", "0")
    async with client_for(MEMBER) as ac:
        assert (await ac.get("/api/community/spaces")).status_code == 503
        r = await ac.get("/api/community/status")
        assert r.status_code == 200 and r.json()["enabled"] is False


@pytest.mark.asyncio
async def test_free_plan_gets_402(client_for):
    async with client_for(FREE) as ac:
        assert (await ac.get("/api/community/spaces")).status_code == 402


@pytest.mark.asyncio
async def test_spaces_and_threads_read(client_for):
    from api.services import community_store
    tid = community_store.create_thread("trade-ideas", "u-member", "AMD flag", body="{}")
    async with client_for(MEMBER) as ac:
        spaces = (await ac.get("/api/community/spaces")).json()
        assert {s["key"] for s in spaces} == {"mentor-desk", "trade-ideas",
                                              "questions", "wins-lessons"}
        threads = (await ac.get("/api/community/threads",
                                params={"space": "trade-ideas"})).json()["threads"]
        assert threads[0]["id"] == tid
        detail = (await ac.get(f"/api/community/threads/{tid}")).json()
        assert detail["title"] == "AMD flag" and detail["posts"] == []
        assert (await ac.get("/api/community/threads/999999")).status_code == 404
        assert (await ac.get("/api/community/threads",
                             params={"space": "nope"})).status_code == 400


VALID_BODY = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hi"}]}]}'


async def _ack(ac):
    assert (await ac.post("/api/community/ack")).status_code == 200


@pytest.mark.asyncio
async def test_thread_write_requires_ack(client_for):
    async with client_for(MEMBER) as ac:
        r = await ac.post("/api/community/threads",
                          json={"space": "trade-ideas", "title": "t", "body": VALID_BODY})
        assert r.status_code == 403 and r.json()["detail"] == "acknowledgment_required"
        await _ack(ac)
        r = await ac.post("/api/community/threads",
                          json={"space": "trade-ideas", "title": "t", "body": VALID_BODY})
        assert r.status_code == 200 and r.json()["id"] > 0


@pytest.mark.asyncio
async def test_member_cannot_post_thread_in_mentor_desk(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        r = await ac.post("/api/community/threads",
                          json={"space": "mentor-desk", "title": "t", "body": VALID_BODY})
        assert r.status_code == 403
    async with client_for(ADMIN) as ac:
        await _ack(ac)
        r = await ac.post("/api/community/threads",
                          json={"space": "mentor-desk", "title": "lesson", "body": VALID_BODY})
        assert r.status_code == 200


@pytest.mark.asyncio
async def test_muted_member_cannot_write(client_for):
    from api.services import community_store
    community_store.set_ack(MEMBER["id"])
    community_store.set_muted(MEMBER["id"], True)
    async with client_for(MEMBER) as ac:
        r = await ac.post("/api/community/threads",
                          json={"space": "trade-ideas", "title": "t", "body": VALID_BODY})
        assert r.status_code == 403


@pytest.mark.asyncio
async def test_thread_rate_limit_429(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        for _ in range(5):
            r = await ac.post("/api/community/threads",
                              json={"space": "trade-ideas", "title": "t", "body": VALID_BODY})
            assert r.status_code == 200
        r = await ac.post("/api/community/threads",
                          json={"space": "trade-ideas", "title": "t", "body": VALID_BODY})
        assert r.status_code == 429


@pytest.mark.asyncio
async def test_reply_locked_and_bad_parent(client_for):
    from api.services import community_store
    community_store.set_ack(MEMBER["id"])
    tid = community_store.create_thread("questions", "u-x", "q", body=VALID_BODY)
    async with client_for(MEMBER) as ac:
        p1 = (await ac.post(f"/api/community/threads/{tid}/posts",
                            json={"body": VALID_BODY})).json()["id"]
        p2 = (await ac.post(f"/api/community/threads/{tid}/posts",
                            json={"body": VALID_BODY, "parent_post_id": p1})).json()["id"]
        r = await ac.post(f"/api/community/threads/{tid}/posts",
                          json={"body": VALID_BODY, "parent_post_id": p2})
        assert r.status_code == 400
        community_store.set_thread_flag(tid, "locked", 1)
        r = await ac.post(f"/api/community/threads/{tid}/posts", json={"body": VALID_BODY})
        assert r.status_code == 409


@pytest.mark.asyncio
async def test_mod_actions_admin_only(client_for):
    from api.services import community_store
    tid = community_store.create_thread("questions", "u-x", "q", body=VALID_BODY)
    async with client_for(MEMBER) as ac:
        assert (await ac.patch(f"/api/community/threads/{tid}/mod",
                               json={"pinned": True})).status_code == 403
    async with client_for(ADMIN) as ac:
        assert (await ac.patch(f"/api/community/threads/{tid}/mod",
                               json={"pinned": True, "answered": True})).status_code == 200
    assert community_store.get_thread(tid)["pinned"] == 1


@pytest.mark.asyncio
async def test_delete_own_content_only(client_for):
    from api.services import community_store
    community_store.set_ack(MEMBER["id"])
    tid = community_store.create_thread("questions", "other-user", "q", body=VALID_BODY)
    async with client_for(MEMBER) as ac:
        assert (await ac.delete(f"/api/community/threads/{tid}")).status_code == 403
    async with client_for(ADMIN) as ac:
        assert (await ac.delete(f"/api/community/threads/{tid}")).status_code == 200
    assert community_store.get_thread(tid) is None


@pytest.mark.asyncio
async def test_report_hide_flow(client_for):
    from api.services import community_store
    tid = community_store.create_thread("questions", "u-x", "bad", body=VALID_BODY)
    async with client_for(MEMBER) as ac:
        rid = (await ac.post("/api/community/reports",
                             json={"thread_id": tid, "reason": "spam"})).json()["id"]
    async with client_for(ADMIN) as ac:
        reports = (await ac.get("/api/community/admin/reports")).json()["reports"]
        assert reports[0]["id"] == rid
        assert (await ac.patch(f"/api/community/admin/reports/{rid}",
                               json={"action": "hide"})).status_code == 200
    assert community_store.get_thread(tid) is None          # soft-deleted
    assert community_store.list_reports("hidden")[0]["id"] == rid


@pytest.mark.asyncio
async def test_invalid_body_json_400(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        r = await ac.post("/api/community/threads",
                          json={"space": "trade-ideas", "title": "t", "body": "not json{"})
        assert r.status_code == 400


@pytest.mark.asyncio
async def test_image_upload_roundtrip(client_for, monkeypatch, tmp_path):
    monkeypatch.setenv("COMMUNITY_UPLOAD_DIR", str(tmp_path / "uploads"))
    from PIL import Image
    import io
    buf = io.BytesIO()
    Image.new("RGB", (900, 500), (20, 20, 20)).save(buf, format="PNG")
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        r = await ac.post("/api/community/images",
                          files={"file": ("chart.png", buf.getvalue(), "image/png")})
        assert r.status_code == 200
        url = r.json()["url"]
        assert url.startswith("/api/community/images/") and url.endswith(".webp")
        r2 = await ac.get(url)
        assert r2.status_code == 200
        # non-image rejected
        r3 = await ac.post("/api/community/images",
                           files={"file": ("x.txt", b"hello", "text/plain")})
        assert r3.status_code == 400


@pytest.mark.asyncio
async def test_threads_carry_author_names(client_for, monkeypatch):
    from api.services import community_store
    # seeded thread (author_id NULL) + a member thread
    seeded = community_store.create_thread("mentor-desk", None, "Session", body="{}",
                                           desk_content_id=41)
    async with client_for(MEMBER) as ac:
        rows = (await ac.get("/api/community/threads",
                             params={"space": "mentor-desk"})).json()["threads"]
    assert rows[0]["author"] == {"name": "UCT Mentor", "is_mentor": True}


@pytest.mark.asyncio
async def test_desk_threads_batch(client_for):
    from api.services import community_store
    tid = community_store.create_thread("mentor-desk", None, "Session", body="{}",
                                        desk_content_id=41)
    community_store.create_post(tid, "u-z", "{}")
    async with client_for(MEMBER) as ac:
        r = await ac.get("/api/community/desk-threads", params={"ids": "41,42"})
    body = r.json()
    assert body["41"]["thread_id"] == tid and body["41"]["reply_count"] == 1
    assert "42" not in body

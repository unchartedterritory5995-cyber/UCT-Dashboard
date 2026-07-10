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

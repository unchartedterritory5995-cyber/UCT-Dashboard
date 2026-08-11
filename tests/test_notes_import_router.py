"""Router-level HTTP tests for notebook import endpoints."""
import pytest
from httpx import AsyncClient, ASGITransport

from api.main import app
from api.middleware.auth_middleware import get_current_user
from api.services.journal_two import notes as notes_svc


@pytest.mark.asyncio
async def test_import_check_with_valid_keys():
    """POST /notes/import/check with importKeys list returns existing."""
    # Create a note via the service first
    notes_svc.import_confirm("test_user", {
        "source": "test",
        "destFolderId": None,
        "notes": [{
            "importKey": "test:1",
            "title": "Test",
            "bodyJson": {"type": "doc", "content": []},
            "tags": [],
            "folderPath": [],
        }]
    })

    # Override auth dependency
    app.dependency_overrides[get_current_user] = lambda: {"id": "test_user"}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.post("/api/j2/notes/import/check", json={
                "importKeys": ["test:1", "test:2"]
            })
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert r.status_code == 200
    data = r.json()
    assert "test:1" in data["existing"]
    assert "test:2" not in data["existing"]
    assert "id" in data["existing"]["test:1"]


@pytest.mark.asyncio
async def test_import_check_rejects_non_list_importKeys():
    """POST /notes/import/check with non-list importKeys returns 400."""
    app.dependency_overrides[get_current_user] = lambda: {"id": "test_user"}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.post("/api/j2/notes/import/check", json={
                "importKeys": "not-a-list"
            })
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert r.status_code == 400
    assert "importKeys must be a list" in r.json()["detail"]


@pytest.mark.asyncio
async def test_import_confirm_creates_and_skips_on_repost():
    """POST /notes/import/confirm creates notes, then skips on identical re-post."""
    payload = {
        "source": "test",
        "destFolderId": None,
        "notes": [{
            "importKey": "repost_test:1",
            "title": "Test Note Repost",
            "bodyJson": {"type": "doc", "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "body"}]}
            ]},
            "tags": ["imported"],
            "folderPath": [],
            "createdAt": "2024-01-01T12:00:00Z",
            "updatedAt": "2024-01-01T12:00:00Z",
        }]
    }

    app.dependency_overrides[get_current_user] = lambda: {"id": "test_user_repost"}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            # First POST: create
            r1 = await ac.post("/api/j2/notes/import/confirm", json=payload)
            assert r1.status_code == 200
            data1 = r1.json()
            assert len(data1["created"]) == 1, f"Expected 1 created, got: {data1}"
            assert data1["created"][0]["importKey"] == "repost_test:1"

            # Second POST: identical payload should skip
            r2 = await ac.post("/api/j2/notes/import/confirm", json=payload)
            assert r2.status_code == 200
            data2 = r2.json()
            assert len(data2["skipped"]) == 1
            assert len(data2["created"]) == 0
            assert len(data2["updated"]) == 0
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_import_confirm_rejects_invalid_bodyJson():
    """POST /notes/import/confirm with invalid bodyJson returns 400."""
    payload = {
        "source": "test",
        "destFolderId": None,
        "notes": [{
            "importKey": "invalid_body:1",
            "title": "Test",
            "bodyJson": "not-a-doc",  # Invalid: should be a dict
            "tags": [],
            "folderPath": [],
        }]
    }

    app.dependency_overrides[get_current_user] = lambda: {"id": "test_user_invalid"}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.post("/api/j2/notes/import/confirm", json=payload)
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert r.status_code == 400
    # The error message may be "body_json must be valid JSON" or similar
    assert "body" in r.json()["detail"].lower()

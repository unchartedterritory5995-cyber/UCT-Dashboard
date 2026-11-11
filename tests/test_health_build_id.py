"""/api/health `build_id`: the SPA entry bundle path, read once from the Vite manifest.

Railway's healthcheck points at /api/health, so the field must be cheap, cached
after the first read, and never raise. The frontend half (`getClientBuildId` in
app/src/lib/buildVersion.js) must produce the SAME string from the served page;
both sides pin the literal `assets/index-abc123.js` in their tests.
"""
import json

import pytest
from httpx import ASGITransport, AsyncClient

import api.main as main

ENTRY = "assets/index-abc123.js"


def _write_manifest(dist, rows):
    vite = dist / ".vite"
    vite.mkdir(parents=True)
    (vite / "manifest.json").write_text(json.dumps(rows), encoding="utf-8")


@pytest.fixture(autouse=True)
def _reset_cache(monkeypatch):
    monkeypatch.setattr(main, "_BUILD_ID_CACHE", None, raising=False)
    yield
    monkeypatch.setattr(main, "_BUILD_ID_CACHE", None, raising=False)


async def _health():
    async with AsyncClient(transport=ASGITransport(app=main.app), base_url="http://test") as ac:
        return await ac.get("/api/health")


@pytest.mark.asyncio
async def test_build_id_is_entry_path_from_manifest(tmp_path, monkeypatch):
    _write_manifest(tmp_path, {
        "src/chunk.js": {"file": "assets/chunk-zzz.js"},
        "index.html": {"file": ENTRY, "isEntry": True, "src": "index.html"},
    })
    monkeypatch.setattr(main, "DIST", str(tmp_path))
    r = await _health()
    assert r.status_code == 200
    assert r.json()["build_id"] == ENTRY


@pytest.mark.asyncio
async def test_build_id_is_empty_string_without_manifest(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DIST", str(tmp_path))
    r = await _health()
    assert r.status_code == 200
    assert r.json()["build_id"] == ""


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", ["not json", "[]", '{"index.html": 5}', '{"index.html": {"file": 3}}'])
async def test_build_id_never_raises_on_bad_manifest(tmp_path, monkeypatch, payload):
    vite = tmp_path / ".vite"
    vite.mkdir()
    (vite / "manifest.json").write_text(payload, encoding="utf-8")
    monkeypatch.setattr(main, "DIST", str(tmp_path))
    r = await _health()
    assert r.status_code == 200
    assert r.json()["build_id"] == ""


@pytest.mark.asyncio
async def test_build_id_normalizes_leading_slash(tmp_path, monkeypatch):
    _write_manifest(tmp_path, {"index.html": {"file": "/" + ENTRY, "isEntry": True}})
    monkeypatch.setattr(main, "DIST", str(tmp_path))
    assert (await _health()).json()["build_id"] == ENTRY


@pytest.mark.asyncio
async def test_build_id_is_cached_after_first_read(tmp_path, monkeypatch):
    _write_manifest(tmp_path, {"index.html": {"file": ENTRY, "isEntry": True}})
    monkeypatch.setattr(main, "DIST", str(tmp_path))
    assert (await _health()).json()["build_id"] == ENTRY
    (tmp_path / ".vite" / "manifest.json").unlink()
    assert (await _health()).json()["build_id"] == ENTRY


@pytest.mark.asyncio
async def test_existing_health_fields_unchanged(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DIST", str(tmp_path))
    body = (await _health()).json()
    assert body["status"] == "ok"
    for key in ("wire_date", "uptime_seconds", "thread_count", "rss_mb"):
        assert key in body
    assert isinstance(body["build_id"], str)

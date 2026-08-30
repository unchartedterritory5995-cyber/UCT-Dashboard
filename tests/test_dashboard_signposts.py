"""The signposts endpoint is keyed by the frontend door manifest. If the two
drift, Zone D renders cards with no numbers — a silent, plausible failure.

⛔ The endpoint requires auth (`Depends(get_current_user)`). A bare
unauthenticated `TestClient` always gets 401, and a test that only asserts
`status_code in (200, 401)` then skips its own body under `if status_code ==
200` PASSES WITHOUT EVER EXERCISING THE 200 PATH — a rail that cannot fail.
Every test below forces the real 200 path via `app.dependency_overrides` on
`get_current_user` (the same idiom `tests/test_admin_chart_health.py` uses:
fake the GATE'S INPUT, never the gate itself, so the real auth/route code
still runs) and clears the override in a fixture teardown so it can never
leak into another test module.
"""
import pathlib
import re

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.middleware.auth_middleware import get_current_user
from api.services.cache import cache as _cache

DOORS_JS = pathlib.Path("app/src/pages/dashboard/doors.js")


def _door_keys() -> set[str]:
    src = DOORS_JS.read_text(encoding="utf-8")
    return set(re.findall(r"key:\s*'([a-z0-9_]+)'", src))


def _as(user: dict) -> TestClient:
    """Present `user` to the REAL `get_current_user`-gated route, by faking
    only that dependency's input."""
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


@pytest.fixture
def auth_client():
    client = _as({"id": 1, "role": "user", "email": "member@test"})
    yield client
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _clear_signposts_cache():
    """The endpoint self-caches its whole response under ONE global key
    (`dashboard_signposts`, 60s TTL). Without clearing it, the first test to
    populate it would silently serve every later test a stale cached body —
    including the raising-service test below, which needs its monkeypatch to
    actually be exercised, not skipped by a warm cache from a prior test."""
    _cache.invalidate("dashboard_signposts")
    yield
    _cache.invalidate("dashboard_signposts")


def test_signposts_requires_auth():
    """Without the override, the real 401 gate still fires — this is the
    assertion the brief's own vacuous version never made."""
    client = TestClient(app)
    r = client.get("/api/dashboard/signposts")
    assert r.status_code == 401


def test_signposts_covers_every_door(auth_client):
    r = auth_client.get("/api/dashboard/signposts")
    assert r.status_code == 200
    assert set(r.json().keys()) == _door_keys()


def test_every_card_has_label_value_tone(auth_client):
    r = auth_client.get("/api/dashboard/signposts")
    assert r.status_code == 200
    for card in r.json().values():
        assert set(card.keys()) == {"label", "value", "tone"}
        assert isinstance(card["label"], str) and card["label"]


def test_door_manifest_is_not_empty():
    assert len(_door_keys()) == 8


def test_one_failing_card_does_not_break_the_others(auth_client, monkeypatch):
    """A raising service must yield exactly ONE null card, never a 500 for the
    whole endpoint. Discriminates the brief's per-block try/except design:
    patch engine.get_breadth to raise and confirm every other key still comes
    back well-formed with breadth alone nulled out."""
    from api.services import engine

    def _boom():
        raise RuntimeError("breadth service is down")

    monkeypatch.setattr(engine, "get_breadth", _boom)

    r = auth_client.get("/api/dashboard/signposts")
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == _door_keys()
    assert body["breadth"]["value"] is None
    for card in body.values():
        assert set(card.keys()) == {"label", "value", "tone"}

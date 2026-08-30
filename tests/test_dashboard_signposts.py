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


# ---------------------------------------------------------------------------
# The desk door — moved off the client
# ---------------------------------------------------------------------------
#
# 🔴 IT WAS REFUSED HERE FOR THE WRONG REASON AND THE STAND-IN WAS BROKEN.
# `desk` sat in this module's null list beside `journal` and `community`, but
# its objection was CACHE SHAPE (`desk_store.list_posts` has no TTLCache), not
# per-user data — the number is the same for every member, and this endpoint
# already owns a 60s cache, so the read happens at most once a minute for
# everybody. Meanwhile the client fill it was left to was blank Mon–Fri (it
# borrowed `TheWeek`'s SWR key, and that hero mounts only at the weekend) and
# structurally "0" the rest of the time, because `published_at` is a unix EPOCH
# INT and `Date.parse` of an integer is NaN.

def _desk(client) -> dict:
    return client.get("/api/dashboard/signposts").json()["desk"]


def test_desk_counts_posts_inside_the_48h_window(auth_client, monkeypatch):
    import time as _time

    from api.services import desk_store

    now = _time.time()
    monkeypatch.setattr(desk_store, "list_posts", lambda limit=12: [
        {"published_at": int(now - 3600)},          # 1h ago      ✓
        {"published_at": int(now - 47 * 3600)},     # 47h ago     ✓
        {"published_at": int(now - 49 * 3600)},     # 49h ago     ✗ outside
        {"published_at": int(now - 400 * 3600)},    # weeks ago   ✗
    ])
    assert _desk(auth_client) == {"label": "New", "value": 2, "tone": "neutral"}


def test_desk_reads_EPOCH_SECONDS_which_is_what_the_store_actually_holds(auth_client, monkeypatch):
    # ⛔ THE EXACT BUG THE CLIENT VERSION HAD, PINNED. Its fixture built ISO
    # strings the endpoint never sends, so it passed while production counted
    # nothing. An int must be understood; a string date must NOT be silently
    # coerced into a number and counted.
    import time as _time

    from api.services import desk_store

    now = _time.time()
    monkeypatch.setattr(desk_store, "list_posts", lambda limit=12: [
        {"published_at": int(now - 60)},                       # a real row  ✓
        {"published_at": "2026-08-30T12:00:00Z"},              # not the shape ✗
        {"published_at": None},                                # ✗
        {},                                                    # ✗
        {"published_at": True},                                # bool is an int in Python ✗
    ])
    assert _desk(auth_client)["value"] == 1


def test_desk_does_not_count_a_future_dated_row(auth_client, monkeypatch):
    # A clock problem is not a new article, and counting it would inflate the
    # number with nothing on screen to say why.
    import time as _time

    from api.services import desk_store

    now = _time.time()
    monkeypatch.setattr(desk_store, "list_posts", lambda limit=12: [
        {"published_at": int(now + 86_400)},
        {"published_at": int(now - 60)},
    ])
    assert _desk(auth_client)["value"] == 1


def test_desk_is_a_real_ZERO_not_a_null_when_nothing_is_recent(auth_client, monkeypatch):
    # ⭐ The distinction the door renders differently: `0` prints a number,
    # `None` prints a plain link. "Nothing published in 48h" is an ANSWER.
    import time as _time

    from api.services import desk_store

    now = _time.time()
    monkeypatch.setattr(desk_store, "list_posts",
                        lambda limit=12: [{"published_at": int(now - 500 * 3600)}])
    assert _desk(auth_client)["value"] == 0


def test_a_raising_desk_store_leaves_the_door_null_and_the_other_seven_intact(auth_client, monkeypatch):
    # Every block here is independently best-effort; a SQLite problem in one
    # must not take the response down.
    from api.services import desk_store

    def boom(**kw):
        raise RuntimeError("desk.db is locked")

    monkeypatch.setattr(desk_store, "list_posts", boom)
    body = auth_client.get("/api/dashboard/signposts").json()
    assert body["desk"]["value"] is None
    assert set(body) == _door_keys()


def test_journal_and_community_STAY_null_here(auth_client):
    # ⛔ THE REFUSAL THAT MUST NOT DRIFT WITH IT. `desk` moved because it is the
    # same number for everybody. These two are per-user, and this payload is
    # cached under ONE global key shared by every logged-in member — writing a
    # member's count here would serve it to everyone else for the next 60s.
    body = auth_client.get("/api/dashboard/signposts").json()
    assert body["journal"]["value"] is None
    assert body["community"]["value"] is None

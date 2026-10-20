"""§8.4: the ticker never leaves the server before scoring. This walks EVERY
member-facing Study route's response (derived from the router, not typed)
with approved chart items seeded, and asserts no `sym`, no forward bars and
no answer key appear anywhere in the JSON — by key AND by value.

Run alone: python -m pytest tests/test_study_no_sym_leak.py -q
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.study as study_router
from api.middleware.auth_middleware import get_current_user
from api.services import study_store as ss

REAL_TICKERS = ("NVDA", "AAPL")
FORBIDDEN_KEYS = {"sym", "forward", "forward_json", "forward_bars", "answer_json", "answer",
                  "reveal_json", "lesson_text", "source_ref", "sha256"}
FORWARD_SENTINEL = 777777.5     # a price that exists ONLY in forward bars
KEY_SENTINEL = "the-secret-key-string"


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    monkeypatch.delenv("STUDY_ENABLED", raising=False)
    ss.init_db()
    vis = [{"t": 20240516 + i, "o": 10, "h": 11, "l": 9, "c": 10.5, "v": 100} for i in range(5)]
    fwd = [{"t": 20240521, "o": FORWARD_SENTINEL, "h": FORWARD_SENTINEL, "l": FORWARD_SENTINEL,
            "c": FORWARD_SENTINEL, "v": 1}]
    items = []
    for i, sym in enumerate(REAL_TICKERS):
        items.append({"id": f"si_chart{i}", "type": "spot", "skill_id": "setup.vcp", "bars_ref": f"sb_{i}",
                      "sym": sym, "asof": "2024-05-20", "prompt_json": {"q": "VCP?"},
                      "answer_json": {"answer": KEY_SENTINEL}, "reveal_json": {"why": KEY_SENTINEL},
                      "lesson_text": KEY_SENTINEL, "source_ref": KEY_SENTINEL})
        ss.upsert_bars(f"sb_{i}", "D", vis, fwd)
    items.append({"id": "si_recall", "type": "recall", "skill_id": "f1", "prompt_json": {"q": "bid?"},
                  "answer_json": {"answer": KEY_SENTINEL}, "lesson_text": KEY_SENTINEL})
    ss.upsert_items(items)
    for it in items:
        ss.approve(it["id"], "owner")
    return ss


@pytest.fixture()
def paid_client(store):
    user = {"id": "u1", "role": "member", "plan": "pro"}
    app = FastAPI()
    app.include_router(study_router.router)
    app.dependency_overrides[study_router.require_paid] = lambda: user
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _walk(node, path="$"):
    """Yield (path, key, value) for every dict entry and (path, None, value)
    for every scalar, recursively."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield (f"{path}.{k}", k, v)
            yield from _walk(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _walk(v, f"{path}[{i}]")
    else:
        yield (path, None, node)


def _assert_clean(body, where):
    for path, key, value in _walk(body):
        if key is not None:
            assert key not in FORBIDDEN_KEYS, f"{where}: forbidden key {key!r} at {path}"
        if isinstance(value, str):
            assert value.upper() not in REAL_TICKERS, f"{where}: real ticker {value!r} at {path}"
            assert KEY_SENTINEL not in value, f"{where}: key text leaked at {path}"
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            assert value != FORWARD_SENTINEL, f"{where}: forward bar leaked at {path}"


def _member_routes():
    """Every route on the router that is NOT admin/import — derived."""
    out = []
    for r in study_router.router.routes:
        path = getattr(r, "path", "")
        if "/admin/" in path or path.endswith("/import"):
            continue
        for m in getattr(r, "methods", ()) or ():
            out.append((m, path))
    return sorted(out)


def test_the_member_route_roster_is_what_this_test_walks():
    """A new member route must be added to WALKS below, or this fails by name."""
    expected = {(m, p) for m, p in _member_routes()}
    walked = {(m, p) for m, p, _ in WALKS}
    assert expected == walked, f"unwalked routes: {sorted(expected - walked)}; stale: {sorted(walked - expected)}"


def _today(c):
    return c.get("/api/study/today")


def _session(c):
    return c.post("/api/study/sessions", json={"kind": "free"})


def _skill_session(c):
    return c.post("/api/study/sessions", json={"kind": "skill", "skill_id": "setup.vcp"})


def _item(c):
    return c.get("/api/study/items/si_chart0")


def _bars(c):
    return c.get("/api/study/items/si_chart0/bars")


def _map(c):
    return c.get("/api/study/map")


def _profile(c):
    return c.get("/api/study/profile")


def _put_profile(c):
    return c.put("/api/study/profile", json={"daily_goal": 60})


def _leaderboard(c):
    return c.get("/api/study/leaderboard")


def _step_without_attempt(c):
    return c.post("/api/study/attempts/1/step", json={"n": 5})


def _attempt_on_a_draft(c):
    # the one POST /attempts shape that happens BEFORE scoring: a refused one
    return c.post("/api/study/attempts", json={"item_id": "si_nope", "answer": "x"})


WALKS = [
    ("GET", "/api/study/map", _map),
    ("GET", "/api/study/today", _today),
    ("POST", "/api/study/sessions", _session),
    ("POST", "/api/study/sessions", _skill_session),
    ("GET", "/api/study/items/{item_id}", _item),
    ("GET", "/api/study/items/{item_id}/bars", _bars),
    ("POST", "/api/study/attempts", _attempt_on_a_draft),
    ("POST", "/api/study/attempts/{attempt_id}/step", _step_without_attempt),
    ("GET", "/api/study/profile", _profile),
    ("PUT", "/api/study/profile", _put_profile),
    ("GET", "/api/study/leaderboard", _leaderboard),
]


@pytest.mark.parametrize("method,path,call", WALKS, ids=[f"{m} {p} {c.__name__}" for m, p, c in WALKS])
def test_no_sym_or_forward_before_scoring(paid_client, method, path, call):
    r = call(paid_client)
    assert r.status_code in (200, 404), (path, r.status_code, r.text)
    _assert_clean(r.json(), f"{method} {path}")


def test_today_really_carried_the_chart_items(paid_client):
    """Non-vacuity: the walk above means nothing if the set had no chart."""
    body = _today(paid_client).json()
    assert any(i["has_chart"] and i["bars"]["symbol"] == i["id"] for i in body["items"])


def test_the_sentinels_do_leak_after_scoring_so_the_walker_can_see_them(paid_client):
    """Control: the same walker FAILS on the reveal, proving it detects what
    it is looking for."""
    r = paid_client.post("/api/study/attempts", json={"item_id": "si_chart0", "answer": KEY_SENTINEL})
    assert r.status_code == 200
    with pytest.raises(AssertionError):
        _assert_clean(r.json(), "reveal")
    step = paid_client.post(f"/api/study/attempts/{r.json()['attempt_id']}/step", json={"n": 1, "offset": 0})
    with pytest.raises(AssertionError):
        _assert_clean(step.json(), "step")


def test_store_prompt_fields_are_an_allowlist_without_the_secrets():
    for forbidden in ("sym", "answer_json", "reveal_json", "lesson_text", "source_ref"):
        assert forbidden not in ss._PROMPT_FIELDS

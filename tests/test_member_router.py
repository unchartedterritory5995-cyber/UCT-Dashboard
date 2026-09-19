"""S6 CP4 — `GET /api/member/interest`.

Strategy mirrors `tests/test_calendar_seen.py`: override
`get_current_user_with_plan` (the gate's INPUT), never `require_paid` itself
(that would mean never running the gate).
"""
from unittest import mock

from fastapi.testclient import TestClient

_PAID_USER = {"id": "user-paid", "email": "paid@example.com", "role": "member",
              "plan": "pro"}
_FREE_USER = {"id": "user-free", "email": "free@example.com", "role": "member",
              "plan": "free"}


def _make_client(user=None):
    from api.main import app
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    who = dict(user or _PAID_USER)
    app.dependency_overrides[get_current_user] = lambda: dict(who)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who)
    client = TestClient(app)
    return client, app


def _clear_cache_for(user_id: str):
    from api.services.cache import cache
    from api.routers.member import _cache_key
    cache.invalidate(_cache_key(user_id))


def test_a_FREE_member_is_refused_402():
    client, app = _make_client(_FREE_USER)
    try:
        r = client.get("/api/member/interest")
        assert r.status_code == 402
    finally:
        app.dependency_overrides.clear()


def test_a_paid_member_gets_the_resolvers_answer(monkeypatch):
    _clear_cache_for(_PAID_USER["id"])
    client, app = _make_client(_PAID_USER)
    try:
        import api.routers.member as member_router
        fake_result = {
            "by_source": {"watchlist": {"AAPL"}}, "all_mine": {"AAPL"},
            "entities": {"AAPL": {"weight": 2.0, "because": ["watchlist"]}},
        }
        monkeypatch.setattr(member_router, "interest_for", lambda uid: fake_result)
        r = client.get("/api/member/interest")
        assert r.status_code == 200
        assert r.json() == {"entities": {"AAPL": {"weight": 2.0, "because": ["watchlist"]}}}
    finally:
        app.dependency_overrides.clear()


def test_the_response_never_leaks_by_source_or_all_mine():
    """⛔ The response is `interest_for`'s `entities` field only -- `by_source`
    and `all_mine` are internal to the resolver and `/api/calendar/my-sets`'
    own shape, not this endpoint's."""
    _clear_cache_for(_PAID_USER["id"])
    client, app = _make_client(_PAID_USER)
    try:
        with mock.patch("api.routers.member.interest_for", return_value={
            "by_source": {"watchlist": {"X"}}, "all_mine": {"X"},
            "entities": {"X": {"weight": 2.0, "because": ["watchlist"]}},
        }):
            r = client.get("/api/member/interest")
        body = r.json()
        assert set(body.keys()) == {"entities"}
    finally:
        app.dependency_overrides.clear()


def test_ten_requests_within_the_ttl_compute_the_resolver_only_once():
    """⛔⛔ THE LOAD-BEARING CASE. SPEC §3.2: 'a shared per-member cache key,
    not a per-caller one, so ten surfaces asking do not fragment into ten
    entries.' Ten requests for the SAME member inside the TTL window must
    hit the resolver exactly once."""
    _clear_cache_for(_PAID_USER["id"])
    client, app = _make_client(_PAID_USER)
    calls = []
    try:
        with mock.patch("api.routers.member.interest_for",
                         side_effect=lambda uid: calls.append(uid) or
                                     {"by_source": {}, "all_mine": set(), "entities": {}}):
            for _ in range(10):
                r = client.get("/api/member/interest")
                assert r.status_code == 200
        assert len(calls) == 1, f"resolver was called {len(calls)} times, expected 1"
    finally:
        app.dependency_overrides.clear()


def test_two_different_members_never_share_a_cache_entry():
    """⛔ The cache key is PER MEMBER -- one member's answer must never leak
    into another's request, even inside the same TTL window."""
    _clear_cache_for(_PAID_USER["id"])
    other_user = {**_PAID_USER, "id": "user-other-paid"}
    _clear_cache_for(other_user["id"])

    def _fake(uid):
        return {"by_source": {}, "all_mine": set(),
                "entities": {uid: {"weight": 1.0, "because": ["watchlist"]}}}

    with mock.patch("api.routers.member.interest_for", side_effect=_fake):
        client1, app1 = _make_client(_PAID_USER)
        try:
            r1 = client1.get("/api/member/interest")
        finally:
            app1.dependency_overrides.clear()

        client2, app2 = _make_client(other_user)
        try:
            r2 = client2.get("/api/member/interest")
        finally:
            app2.dependency_overrides.clear()

    assert r1.json()["entities"] == {_PAID_USER["id"]: {"weight": 1.0, "because": ["watchlist"]}}
    assert r2.json()["entities"] == {other_user["id"]: {"weight": 1.0, "because": ["watchlist"]}}


def test_a_stale_cache_entry_expires_after_the_TTL(monkeypatch):
    """The freshness half of SPEC §3.2's requirement -- a cached answer is
    not served forever."""
    _clear_cache_for(_PAID_USER["id"])
    client, app = _make_client(_PAID_USER)
    calls = []
    try:
        with mock.patch("api.routers.member.interest_for",
                         side_effect=lambda uid: calls.append(uid) or
                                     {"by_source": {}, "all_mine": set(), "entities": {}}):
            client.get("/api/member/interest")
            # Simulate TTL expiry by clearing the entry directly rather than
            # sleeping 15s in a test -- the cache module's own TTL mechanics
            # are exercised elsewhere; this proves THIS endpoint re-reads
            # through the SAME key it wrote, not a different one.
            _clear_cache_for(_PAID_USER["id"])
            client.get("/api/member/interest")
        assert len(calls) == 2
    finally:
        app.dependency_overrides.clear()

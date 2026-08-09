"""Admin diagnostics + Gate-5 operator review — behaviour AND the gate.

🔴 WHY THIS FILE WAS REWRITTEN ON 2026-08-09.

Every test below used to call these routes with a bare `client.get(...)`, no
credential of any kind, and assert **200**. That is not a test that happened to
be written before the gate existed — it is an assertion that *encoded the
vulnerability*: `GET /api/admin/patterns/recent` answered an anonymous caller
with 3.9 MB of every detection the engine made, geometry and narrative and the
operator's accept/reject adjudication included, and `POST /{id}/review` let
anybody WRITE the adjudication whose accept-rate decides whether the engine
ships. `AdminGuardMiddleware` was written, tested green, and never installed for
months. **This suite stayed green through all of it, because it never once
asserted these routes were protected.**

So the repairs below are the smaller half. The load-bearing half is
`test_EVERY_route_on_this_router_refuses_an_anonymous_caller` and its
non-admin sibling: the next time the guard is dropped, this file goes RED.

HOW THE AUTHENTICATED CLIENT WORKS, AND WHY IT IS NOT AN OVERRIDE ON THE GATE
----------------------------------------------------------------------------
`admin_client` overrides **`get_current_user`**, never `require_admin` itself —
the idiom `tests/test_exposed_routes_gated.py` documents at length. Overriding
`require_admin` would mean these tests never run the gate at all
(`lesson_injected_dependency_hides_the_fetch`): the admin check would be
replaced by a lambda, and a handler that had lost its `Depends(require_admin)`
would look identical to one that still had it. Overriding the *identity* source
one level down leaves the real `require_admin` in the tree, running, on every
one of the eight repaired tests.

⛔ THE ROUTE LIST IS DERIVED FROM `admin_patterns.router.routes`, NEVER TYPED.
A hand-typed list is how a guard's list stops matching the thing it guards and
passes anyway (`lesson_probe_names_must_be_derived_not_typed`). A fourth route
added to this router is refusal-tested the moment it is added, by nobody.

⛔ AND THE ANONYMOUS PROBE OF THE MUTATING ROUTE SENDS NO BODY, ON PURPOSE.
`lesson_never_probe_a_mutating_endpoint_to_test_auth`: firing an unauthenticated
POST at a real writer is only safe WHEN THE GATE WORKS, which is the one case
this test exists to doubt. FastAPI solves dependencies before it validates the
body, so a gated route refuses (401/403) and an UNGATED one answers 422 with the
handler never entered — there is no ordering in which this probe records a
review. `test_the_anonymous_probes_wrote_NOTHING` measures that rather than
trusting it.
"""
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.middleware.auth_middleware import get_current_user
from api.routers import admin_patterns
from api.services.pattern_engine.pattern_db import get_connection, init_db
from api.services.pattern_engine import memory


ADMIN_USER = {"id": "adm-pat-1", "email": "admin@example.test",
              "role": "admin", "plan": "free"}
#: A real, logged-in, PAYING account that is simply not staff. `/api/admin/` in
#: the path is a naming convention, not a gate — if the gate were merely
#: `get_current_user`, this member (one free signup away, on any plan) would
#: read the whole detection corpus.
MEMBER_USER = {"id": "mem-pat-1", "email": "member@example.test",
               "role": "member", "plan": "pro"}

REFUSALS = {401, 403}


@pytest.fixture
def admin_client():
    """The real app, the real `require_admin`, a caller who IS an admin."""
    app.dependency_overrides[get_current_user] = lambda: dict(ADMIN_USER)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def member_client():
    """The real app, the real `require_admin`, a caller who is NOT an admin."""
    app.dependency_overrides[get_current_user] = lambda: dict(MEMBER_USER)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def anon_client():
    """No overrides at all — the real cookie path with an empty jar."""
    app.dependency_overrides.pop(get_current_user, None)
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.pop(get_current_user, None)


def _uid(prefix: str) -> str:
    """Generate a unique detection id per test invocation. Tests share a
    persistent SQLite db on disk, so reusing fixed ids across runs would
    trip pattern_detections.id UNIQUE constraint."""
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


# ─── the gate ──────────────────────────────────────────────────────────────
#
# 🔴 THE ASSERTIONS THIS FILE NEVER HAD. Ten call sites, none of them ever
# asking whether a stranger could make the same call.

#: Path-param samples. `detection_id` names a row that cannot exist, so even in
#: the (impossible, per the module docstring) event that an ungated handler ran,
#: it would have nothing to adjudicate.
PATH_PARAM_SAMPLES = {"detection_id": "no-such-detection-id"}


def _router_calls():
    """Every (method, url) this router mounts, read off the router object.

    Derived, not typed — and self-policing: a path param with no sample fails
    loudly here rather than 404-ing quietly and turning a refusal assertion into
    a test of FastAPI's router.
    """
    import re

    out = []
    for route in admin_patterns.router.routes:
        methods = getattr(route, "methods", None)
        if not methods:
            continue
        url = route.path
        for name in re.findall(r"\{(\w+)\}", route.path):
            assert name in PATH_PARAM_SAMPLES, (
                f"{route.path} declares path param {name!r} with no sample — add "
                "one or this sweep silently 404s instead of measuring the gate")
            url = url.replace("{" + name + "}", PATH_PARAM_SAMPLES[name])
        for method in sorted(methods - {"HEAD", "OPTIONS"}):
            out.append((method, url))
    return sorted(out)


ROUTER_CALLS = _router_calls()


def test_the_route_walk_actually_found_this_routers_routes():
    """⭐ THE CONTROL ON THE DERIVATION.

    A parametrized sweep over an EMPTY list passes, loudly reporting nothing.
    That is the exact shape of the `_fetch_naaim` vacuous guard. So the derived
    set is asserted to contain the three routes the module docstring names as
    the breach, by path, before anything is asserted about them.
    """
    paths = {url for _m, url in ROUTER_CALLS}
    assert "/api/admin/patterns/health" in paths
    assert "/api/admin/patterns/recent" in paths
    assert any(p.endswith("/review") for p in paths)
    assert len(ROUTER_CALLS) >= 3, ROUTER_CALLS


@pytest.mark.parametrize("method,url", ROUTER_CALLS, ids=lambda v: str(v))
def test_EVERY_route_on_this_router_refuses_an_anonymous_caller(
        anon_client, method, url):
    """🔴 THE TEST THIS FILE SHOULD ALWAYS HAVE HAD.

    `/api/admin` in a path was never a gate. If `require_admin` is dropped from
    a handler — or the router is remounted without it — this is what goes red.
    """
    resp = anon_client.request(method, url)
    assert resp.status_code in REFUSALS, (
        f"{method} {url} answered an ANONYMOUS caller {resp.status_code} — this "
        f"router serves the whole detection corpus and the Gate-5 adjudication "
        f"that decides whether the engine ships: {resp.text[:200]}")


@pytest.mark.parametrize("method,url", ROUTER_CALLS, ids=lambda v: str(v))
def test_EVERY_route_on_this_router_refuses_a_logged_in_NON_ADMIN(
        member_client, method, url):
    """"Logged in" is not "staff", and signup is open.

    A gate of `get_current_user` alone would satisfy the anonymous test above
    while leaving all of this one paid signup away. This is the assertion that
    tells `require_admin` from `get_current_user`.
    """
    resp = member_client.request(method, url)
    assert resp.status_code == 403, (
        f"{method} {url} answered a logged-in NON-ADMIN {resp.status_code} — the "
        f"gate is identity, not authority: {resp.text[:200]}")


def test_the_refusal_harness_can_SEE_a_non_refusal(anon_client):
    """⭐ THE CONTROL ON THE REFUSAL SWEEPS.

    A client that refuses everything is also what a broken TestClient, a 500ing
    app, or a mis-built request produces. `GET /api/health` is Railway's
    healthcheck and public by design, so a non-refusal there is what makes every
    refusal above evidence of a gate rather than evidence of a broken harness.
    """
    assert anon_client.get("/api/health").status_code not in REFUSALS


def test_the_anonymous_probes_wrote_NOTHING(anon_client):
    """⛔ `lesson_never_probe_a_mutating_endpoint_to_test_auth`, MEASURED.

    The refusal sweep fires an unauthenticated POST at a real writer. The
    argument that this is safe (dependencies are solved before the body, so an
    ungated route 422s with the handler never entered) is an argument — this
    counts the rows instead.
    """
    init_db()
    conn = get_connection()
    try:
        before = conn.execute("SELECT COUNT(*) AS n FROM pattern_feedback").fetchone()["n"]
    finally:
        conn.close()

    for method, url in ROUTER_CALLS:
        anon_client.request(method, url)

    conn = get_connection()
    try:
        after = conn.execute("SELECT COUNT(*) AS n FROM pattern_feedback").fetchone()["n"]
    finally:
        conn.close()
    assert after == before, (
        f"an unauthenticated sweep of this router wrote {after - before} "
        "pattern_feedback rows — the probe is performing the operation it is "
        "supposed to be proving is refused")


# ─── the behaviour, for the caller it was built for ────────────────────────

def test_health_endpoint_returns_200_and_required_keys(admin_client):
    r = admin_client.get("/api/admin/patterns/health")
    assert r.status_code == 200
    body = r.json()
    for key in ("detector_count", "stored_detections_total", "registered_detectors",
                "stored_by_pattern", "stored_by_status", "schema_version"):
        assert key in body


# ─── Gate 5 operator review ────────────────────────────────────────────────

def _seed_detection(det_id: str, detected_at: int | None = None) -> dict:
    """Insert a minimal Detection through memory.store_detection.

    Uses a randomized sym so hash_key is unique per call — hash_key derives
    from (sym, tf, pattern_id, start_t, end_t) and SQLite UNIQUEs it. Two
    calls within the same second would otherwise collide.
    """
    if detected_at is None:
        detected_at = int(time.time())
    unique_sym = f"ADM{uuid.uuid4().hex[:5].upper()}"
    d = {
        "id": det_id,
        "sym": unique_sym, "tf": "D",
        "pattern_id": "bull_flag", "pattern_name": "Bull Flag",
        "category": "classical", "direction": "bullish",
        "start_t": detected_at - 3600,
        "end_t": detected_at,
        "pivot_ts": [],
        "geometry": {"shape": "trendline_pair", "anchors": [], "extras": {}},
        "levels": {"entry": 100.0, "entry_condition": "",
                   "stop": 95.0, "stop_basis": "",
                   "target_primary": 110.0, "target_secondary": None,
                   "risk_reward": 2.0},
        "context": {"trend_stage": 2, "rs_trend": "up",
                    "ma_alignment": "stacked_bullish",
                    "volume_signature": "contracting", "regime": "bull",
                    "nearest_resistance": None, "nearest_support": None,
                    "days_to_earnings": None, "sector_strength_rank": None},
        "confidence": 80.0,
        "quality_components": {"geometry_score": 80.0, "volume_score": 70.0,
                               "context_score": 80.0, "historical_score": 50.0},
        "narrative": {"headline": "Test bull flag forming",
                      "what_it_is": "", "why_it_matters": "",
                      "what_to_watch_for": "", "failure_signal": ""},
        "status": "ready", "outcome": None,
        "detected_at": detected_at, "last_seen_at": detected_at,
    }
    memory.store_detection(d)
    return d


def test_recent_endpoint_returns_window(admin_client):
    init_db()
    r = admin_client.get("/api/admin/patterns/recent?hours=48")
    assert r.status_code == 200
    body = r.json()
    for key in ("detections", "count", "reviewed_count", "accepted",
                "rejected", "flagged", "accept_rate_pct", "hours_window"):
        assert key in body
    assert body["hours_window"] == 48
    assert isinstance(body["detections"], list)


def test_recent_endpoint_clamps_hours(admin_client):
    """hours param bounded 1-168.

    Driven as an ADMIN on purpose: a 422 from an anonymous caller would be a
    fact about the gate, not about the bound, and the two would be
    indistinguishable in the assertion.
    """
    r = admin_client.get("/api/admin/patterns/recent?hours=999")
    assert r.status_code == 422
    r = admin_client.get("/api/admin/patterns/recent?hours=0")
    assert r.status_code == 422


def test_recent_endpoint_includes_review_fields(admin_client):
    init_db()
    det_id = _uid("test-admin-recent")
    _seed_detection(det_id)
    r = admin_client.get("/api/admin/patterns/recent?hours=24")
    assert r.status_code == 200
    body = r.json()
    found = [d for d in body["detections"] if d["id"] == det_id]
    assert len(found) == 1
    d = found[0]
    assert "reviewed" in d
    assert "reviewer_rating" in d
    assert "reviewer_note" in d
    assert d["reviewed"] is False
    assert d["reviewer_rating"] is None


def test_review_endpoint_accepts_valid_action(admin_client):
    init_db()
    det_id = _uid("test-admin-review-accept")
    _seed_detection(det_id)
    r = admin_client.post(
        f"/api/admin/patterns/{det_id}/review",
        json={"action": "accept", "note": "clean setup"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["action"] == "accept"
    assert body["feedback_id"] is not None


def test_review_endpoint_rejects_invalid_action(admin_client):
    r = admin_client.post(
        "/api/admin/patterns/whatever/review",
        json={"action": "garbage"},
    )
    assert r.status_code == 400


def test_review_then_recent_marks_reviewed(admin_client):
    """End-to-end: store → review → recent shows reviewed=true with rating."""
    init_db()
    det_id = _uid("test-admin-review-flow")
    _seed_detection(det_id)

    # Submit a reject
    r = admin_client.post(
        f"/api/admin/patterns/{det_id}/review",
        json={"action": "reject", "note": "fake breakout"},
    )
    assert r.status_code == 200

    # Verify recent picks it up
    r2 = admin_client.get("/api/admin/patterns/recent?hours=24")
    assert r2.status_code == 200
    body = r2.json()
    matched = [d for d in body["detections"] if d["id"] == det_id]
    assert len(matched) == 1
    d = matched[0]
    assert d["reviewed"] is True
    assert d["reviewer_rating"] == "wrong"
    assert d["reviewer_note"] == "fake breakout"
    assert body["reviewed_count"] >= 1
    assert body["rejected"] >= 1


def test_review_action_mapping(admin_client):
    """All three actions map to the right pattern_feedback rating."""
    init_db()
    cases = [
        (_uid("test-admin-map-accept"), "accept", "great"),
        (_uid("test-admin-map-reject"), "reject", "wrong"),
        (_uid("test-admin-map-flag"), "flag", "miss"),
    ]
    for det_id, action, expected_rating in cases:
        _seed_detection(det_id)
        r = admin_client.post(
            f"/api/admin/patterns/{det_id}/review",
            json={"action": action},
        )
        assert r.status_code == 200, f"{action} failed: {r.text}"

    # Verify in the DB
    conn = get_connection()
    try:
        for det_id, _action, expected_rating in cases:
            row = conn.execute("""
                SELECT rating, user_id FROM pattern_feedback
                WHERE detection_id = ? AND user_id = 'admin_operator'
                ORDER BY created_at DESC LIMIT 1
            """, (det_id,)).fetchone()
            assert row is not None, f"no feedback for {det_id}"
            assert row["rating"] == expected_rating
            assert row["user_id"] == "admin_operator"
    finally:
        conn.close()

"""S5 CP3 (GATE-S5-PERSISTENCE-USER-STATE, fingerprint 41ffcc91c) — Tracings'
dedicated store: compare-and-set semantics, the HTTP surface, and the
inertness rail proving nothing in the product calls it yet (CP3 is dark;
CP4 is the checkpoint that wires a live consumer).

⛔ APPROVED SCOPE: backend, additive, dark. No change to
`POST /api/auth/preferences`'s existing semantics for its other 70 call
sites, no change to the Notebook layer, no change to `_PREFERENCE_KEYS`.
"""
from __future__ import annotations

import pathlib
import uuid

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.services.auth_db import init_db, get_connection
from api.services.auth_service import create_user, create_session
from api.services import tracings_store

_REPO = pathlib.Path(__file__).resolve().parents[1]


def _make_user() -> str:
    init_db()
    user = create_user(f"tracings_{uuid.uuid4()}@example.com", "password123", "Test")
    return user["id"]


# ─────────────────────────────────────────────────────────────────────────────
# SERVICE LAYER — compare-and-set
# ─────────────────────────────────────────────────────────────────────────────

def test_get_returns_none_for_a_member_who_never_wrote_one():
    uid = _make_user()
    assert tracings_store.get_tracings(uid) is None


def test_first_write_starts_at_revision_1():
    uid = _make_user()
    result = tracings_store.set_tracings(uid, '{"sheets":[]}')
    assert result["revision"] == 1
    assert result["doc"] == '{"sheets":[]}'
    fetched = tracings_store.get_tracings(uid)
    assert fetched["revision"] == 1


def test_a_correct_baseline_updates_and_increments_the_revision():
    uid = _make_user()
    first = tracings_store.set_tracings(uid, '{"sheets":[]}')
    second = tracings_store.set_tracings(uid, '{"sheets":["a"]}', expected_revision=first["revision"])
    assert second["revision"] == 2
    assert second["doc"] == '{"sheets":["a"]}'


def test_a_stale_baseline_is_REFUSED_not_silently_overwritten():
    """⛔ THE A-1 CLOBBER THIS CHECKPOINT EXISTS TO PREVENT. Two writers, the
    second holding a baseline one write behind — the exact shape of a second
    tab or a second device racing this member's own first write."""
    uid = _make_user()
    first = tracings_store.set_tracings(uid, '{"sheets":[]}')
    tracings_store.set_tracings(uid, '{"sheets":["from device A"]}', expected_revision=first["revision"])
    with pytest.raises(tracings_store.TracingsConflictError):
        tracings_store.set_tracings(uid, '{"sheets":["from device B, stale"]}',
                                     expected_revision=first["revision"])
    # ⛔ THE REFUSAL MUST WRITE NOTHING. Device A's write must survive.
    assert tracings_store.get_tracings(uid)["doc"] == '{"sheets":["from device A"]}'


def test_the_conflict_rail_CAN_FAIL(monkeypatch=None):
    """⛔ CONTROL. A CAS check that always agrees is not a CAS check — prove
    the SAME two writes succeed when the baseline is fresh instead of stale."""
    uid = _make_user()
    first = tracings_store.set_tracings(uid, '{"sheets":[]}')
    second = tracings_store.set_tracings(uid, '{"sheets":["from device A"]}',
                                          expected_revision=first["revision"])
    # This time device B's baseline IS current (second["revision"]) -- must succeed.
    third = tracings_store.set_tracings(uid, '{"sheets":["from device B, current"]}',
                                         expected_revision=second["revision"])
    assert third["revision"] == 3


def test_no_baseline_is_last_writer_wins_by_design():
    """`expected_revision=None` is the explicit opt-out (mirrors
    `update_note`'s `expected_updated_at=None`) -- a caller that never read a
    baseline must not be refused, or CP4's first, baseline-less write would
    break on a member who already has a row from a previous session."""
    uid = _make_user()
    tracings_store.set_tracings(uid, '{"sheets":["first"]}')
    result = tracings_store.set_tracings(uid, '{"sheets":["second, no baseline"]}')
    assert result["doc"] == '{"sheets":["second, no baseline"]}'
    assert result["revision"] == 2


def test_two_members_do_not_share_a_row():
    uid_a = _make_user()
    uid_b = _make_user()
    tracings_store.set_tracings(uid_a, '{"sheets":["a"]}')
    tracings_store.set_tracings(uid_b, '{"sheets":["b"]}')
    assert tracings_store.get_tracings(uid_a)["doc"] == '{"sheets":["a"]}'
    assert tracings_store.get_tracings(uid_b)["doc"] == '{"sheets":["b"]}'


# ─────────────────────────────────────────────────────────────────────────────
# HTTP SURFACE — /api/tracings
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    init_db()
    return TestClient(app)


def _login(client) -> str:
    user = create_user(f"tracings_ep_{uuid.uuid4()}@example.com", "password123")
    token = create_session(user["id"])
    client.cookies.set("uct_session", token)
    return user["id"]


def test_get_requires_auth(client):
    r = client.get("/api/tracings")
    assert r.status_code in (401, 403)


def test_get_before_any_write_is_null_not_404(client):
    _login(client)
    r = client.get("/api/tracings")
    assert r.status_code == 200
    assert r.json()["doc"] is None


def test_put_then_get_roundtrips(client):
    _login(client)
    r = client.put("/api/tracings", json={"doc": '{"sheets":["x"]}'})
    assert r.status_code == 200
    assert r.json()["revision"] == 1
    r2 = client.get("/api/tracings")
    assert r2.json()["doc"] == '{"sheets":["x"]}'


def test_put_with_stale_expectedRevision_is_409(client):
    _login(client)
    client.put("/api/tracings", json={"doc": '{"sheets":["v1"]}'})
    client.put("/api/tracings", json={"doc": '{"sheets":["v2"]}', "expectedRevision": 1})
    r = client.put("/api/tracings", json={"doc": '{"sheets":["stale"]}', "expectedRevision": 1})
    assert r.status_code == 409


def test_two_members_are_isolated_over_http(client):
    uid_a = _login(client)
    client.put("/api/tracings", json={"doc": '{"sheets":["a"]}'})
    client2 = TestClient(app)
    _login(client2)
    client2.put("/api/tracings", json={"doc": '{"sheets":["b"]}'})
    assert client.get("/api/tracings").json()["doc"] == '{"sheets":["a"]}'
    assert client2.get("/api/tracings").json()["doc"] == '{"sheets":["b"]}'


# ─────────────────────────────────────────────────────────────────────────────
# AUTHORIZED-CALLER ALLOW-LIST — CP4 (ea7178473) named its two files. Anything
# else touching /api/tracings needs its own signed line, same as CP4 did.
# ─────────────────────────────────────────────────────────────────────────────

#: ⛔ CP4 (fingerprint ea7178473) is the signed authorization for exactly these
#: two files to reference /api/tracings: useTracingsSync.js (the real fetch
#: calls, gated behind TRACINGS_STORE_ENABLED) and tracingsStoreFlag.js (a
#: comment describing the flag's OFF behavior, not a call). No other file is
#: authorized. This is CP3's original inertness rail, narrowed rather than
#: deleted when CP4 made "nothing calls it" no longer the invariant to want.
_CP4_AUTHORIZED_CALLERS = frozenset({
    "app/src/components/chart/useTracingsSync.js",
    "app/src/components/chart/tracingsStoreFlag.js",
})


def test_only_the_CP4_authorized_files_reference_api_tracings():
    """⛔ Fails BY NAME the moment a THIRD file starts calling /api/tracings
    without its own CP4-successor line naming it."""
    offenders = []
    scanned = 0
    for p in (_REPO / "app" / "src").rglob("*.js*"):
        if ".test." in p.name:
            continue
        code = p.read_text(encoding="utf-8", errors="ignore")
        scanned += 1
        rel = str(p.relative_to(_REPO)).replace("\\", "/")
        if "/api/tracings" in code and rel not in _CP4_AUTHORIZED_CALLERS:
            offenders.append(rel)
    assert scanned > 100, f"the module walk found almost nothing ({scanned}) -- it is broken"
    assert offenders == [], (
        f"a frontend path calls /api/tracings without CP4 (or a successor line) naming it: {offenders}")


def test_the_authorized_caller_list_is_not_stale():
    """⛔ CONTROL, the other direction: both named files must actually exist
    and actually reference it, or the allow-list is protecting nothing."""
    for rel in _CP4_AUTHORIZED_CALLERS:
        p = _REPO / rel
        assert p.exists(), f"CP4 names {rel} but it does not exist"
        assert "/api/tracings" in p.read_text(encoding="utf-8"), (
            f"CP4 names {rel} as an authorized caller but it no longer references /api/tracings "
            f"-- the allow-list entry is stale and should be removed")


def test_the_inertness_rail_can_see_a_real_reference():
    """⛔ THE CONTROL. Without it, a broken walk would make the assertion
    above pass over nothing."""
    router_src = (_REPO / "api" / "routers" / "tracings.py").read_text(encoding="utf-8")
    assert "/api/tracings" in router_src or 'prefix="/api/tracings"' in router_src

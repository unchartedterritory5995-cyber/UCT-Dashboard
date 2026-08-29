"""🔴 THE DIAGNOSTIC HEALTH FAMILY NO LONGER HANDS THE APP'S INSIDES TO ANYONE.

THE DEFECT THIS FILE EXISTS FOR
-------------------------------
Four routes answered **unauthenticated** callers with process internals:

    GET /api/health/thread-stacks   2,841 B of LIVE PYTHON STACK TRACES —
                                    module paths, function names, line numbers
    GET /api/watchdog/stacks        the same dump, captured mid-stall
    GET /api/health/threads         a histogram naming every background
                                    subsystem this pod runs
    GET /api/health/cache           the R2 bars-snapshot sync state

The 2026-08-09 auth sweep classified them as EXPOSED and could not fix them:
three are declared inline in `api/main.py` and the fourth in
`api/event_loop_watchdog.py`, neither of which the sweep owned.

⭐ AND THE OTHER DIRECTION IS ASSERTED TOO. A gate that blocks everyone is not a
fix. Every case below has an admin counterpart that must reach the HANDLER (not
merely pass the gate — the payload is checked), and a control proving the
liveness probes and the two documented-no-auth status routes are untouched.
`/api/health` is Railway's `healthcheckPath` AND what `worker_main`'s down-alert
monitor polls before posting a red "site down" to Discord; gating it by accident
is a self-inflicted outage with an alert attached.

WHY THE GUARD IS DERIVED AND NOT PATTERN-MATCHED
------------------------------------------------
`_declared_guards` walks `route.dependant` — the tree FastAPI itself resolves —
via `auth_surface_check._guard_names_for`, the repo's single implementation of
"what counts as a gate". A source-text scan for `require_admin` would pass on
the comment above the decorator (`lesson_probe_names_must_be_derived_not_typed`:
a grep here once "found 5 call sites, all five of them prose").
"""
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import auth_surface_check as asc  # noqa: E402
from api.middleware import auth_middleware as am  # noqa: E402

#: The routes this fix gates. This IS the requirement, so it is stated once —
#: but nothing about the GATE is typed: presence is read off the dependency tree.
GATED = (
    "/api/health/thread-stacks",
    "/api/health/threads",
    "/api/health/cache",
    "/api/health/memory",
    "/api/watchdog/stacks",
)

#: ⛔ MUST STAY ANONYMOUS. The first two are liveness probes with real
#: consumers; the last two were re-audited on 2026-08-09 and are counters only
#: (no market data, no universe size, no symbol lists). `/api/watchdog/status`
#: is here for the same reason — it reports lag numbers about the loop and
#: nothing about the code running on it, and its activation runbook is a curl.
STILL_OPEN = (
    "/api/health",
    "/api/ready",
    "/api/admin/bars-stream-status",
    "/api/admin/reconciliation-status",
    "/api/watchdog/status",
)


@pytest.fixture(scope="module")
def real_app():
    from api.main import app
    return app


@pytest.fixture(scope="module")
def client(real_app):
    # A handler error must not be able to masquerade as a blocked request.
    return TestClient(real_app, raise_server_exceptions=False)


def _routes_by_path(app):
    out = {}
    for r in app.routes:
        path = getattr(r, "path", None)
        if path and "GET" in (getattr(r, "methods", None) or set()):
            out[path] = r
    return out


def _declared_guards(app, path):
    route = _routes_by_path(app).get(path)
    assert route is not None, (
        f"{path} is not a GET route on api.main:app at all. Either it moved or "
        f"this rail has gone stale — do not delete the assertion, move the path.")
    return asc._guard_names_for(route)


def _as(monkeypatch, role):
    """Become a user of `role` for the duration of one test.

    Patched on `auth_middleware`, where `get_current_user` resolved the name at
    import (`lesson_from_import_severs_a_module_from_its_guards` — patching
    `auth_service.validate_session` would reach nothing).
    """
    monkeypatch.setattr(am, "validate_session",
                        lambda tok: {"id": 42, "role": role, "email": "x@y.z"})


# ── the gate is declared, on the real app ───────────────────────────────────

@pytest.mark.parametrize("path", GATED)
def test_the_route_declares_require_admin(real_app, path):
    guards = _declared_guards(real_app, path)
    assert "require_admin" in guards, (
        f"{path} carries no admin gate on api.main:app. Its dependency tree is "
        f"{sorted(guards) or 'EMPTY'} — an anonymous caller on the internet gets "
        f"this pod's internals back.")


def test_the_guard_probe_is_not_vacuous(real_app):
    """⛔ Every assertion above would pass just as happily against a broken
    `_guard_names_for` that returned `{'require_admin'}` for everything. Both
    controls, on the same app: a route that must NOT report the guard, and one
    that must."""
    assert "require_admin" not in _declared_guards(real_app, "/api/health"), (
        "the liveness probe reports an admin guard — the derivation is wrong, or "
        "Railway's healthcheck is about to start 401ing")
    known_admin = _declared_guards(real_app, "/api/theme-engine/status")
    assert "require_admin" in known_admin, (
        "a route known to be admin-gated does not report the guard; "
        "`_guard_names_for` has stopped seeing dependency trees")


# ── the gate refuses, through the real ASGI stack ───────────────────────────

@pytest.mark.parametrize("path", GATED)
def test_an_anonymous_caller_is_refused(client, path):
    r = client.get(path)
    assert r.status_code == 401, (
        f"anonymous GET {path} answered {r.status_code}, not 401")


@pytest.mark.parametrize("path", GATED)
def test_a_logged_in_NON_admin_is_refused(client, monkeypatch, path):
    """Fails closed on ROLE, not merely on the presence of a session — signup is
    open and free, so 'has a cookie' is not a credential here."""
    _as(monkeypatch, "user")
    r = client.get(path)
    assert r.status_code == 403, (
        f"a free logged-in account got {r.status_code} from {path}, not 403")


# ── …and an admin still gets the diagnostic ─────────────────────────────────

def test_an_admin_still_gets_thread_stacks(client, monkeypatch):
    _as(monkeypatch, "admin")
    r = client.get("/api/health/thread-stacks")
    assert r.status_code == 200, f"an admin was refused: {r.status_code}"
    body = r.json()
    # The HANDLER ran, not just the gate: these keys come from its own body.
    assert set(body) == {"total", "by_location", "samples"}
    assert body["total"] >= 1


def test_an_admin_still_gets_the_thread_histogram(client, monkeypatch):
    _as(monkeypatch, "admin")
    r = client.get("/api/health/threads")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"total", "groups"} and body["groups"]


def test_an_admin_still_gets_the_cache_state(client, monkeypatch):
    _as(monkeypatch, "admin")
    r = client.get("/api/health/cache")
    assert r.status_code == 200
    assert "seconds_since_sync" in r.json()


def test_an_admin_still_gets_the_stall_captures(client, monkeypatch):
    _as(monkeypatch, "admin")
    r = client.get("/api/watchdog/stacks")
    assert r.status_code == 200
    assert "captures" in r.json()


# ── the control: nothing else moved ─────────────────────────────────────────

@pytest.mark.parametrize("path", STILL_OPEN)
def test_the_documented_no_auth_routes_are_still_anonymous(client, path):
    r = client.get(path)
    assert r.status_code not in (401, 403), (
        f"{path} now refuses an anonymous caller ({r.status_code}). "
        f"/api/health is Railway's healthcheckPath and worker_main's down-alert "
        f"probe; /api/admin/bars-stream-status and /api/admin/reconciliation-status "
        f"are documented no-auth and were re-verified clean. This gate has spread "
        f"past its scope.")


def test_gating_did_not_leak_into_the_admin_guard_middleware():
    """⛔ THE WRONG FIX, ASSERTED AGAINST. Widening
    `admin_guard.GUARDED_PREFIXES` to cover `/api/health/*` would have gated the
    diagnostics AND put `/api/health` + `/api/ready` one prefix-typo from a 403.
    A per-route `Depends` cannot reach them; this keeps it that way."""
    from api.middleware import admin_guard as ag

    for p in ag.GUARDED_PREFIXES:
        assert not p.startswith("/api/health"), (
            f"the admin-guard middleware now claims {p!r}; the liveness probes "
            f"live under that prefix")
    for path in STILL_OPEN:
        assert not ag._is_guarded(path), f"{path} is now middleware-guarded"


# ── and the roster itself cannot go stale ───────────────────────────────────


def test_every_diagnostic_health_route_is_either_gated_or_documented_open(real_app):
    """SWEEP: a NEW /api/health/* route must be classified, not merely added.

    ⛔ `GATED` above is a hand-typed roster, and until this test existed nothing
    noticed a route that was neither in it nor gated — which is precisely how the
    original defect shipped: four routes handing out process internals to anyone,
    each added one at a time by someone who never saw the list.

    This reads the ACTUAL route table and requires every /api/health/* path to be
    one of: gated (per the dependency tree, not a text scan), or explicitly
    listed in STILL_OPEN with a reason recorded there. Adding a diagnostic route
    without deciding which it is now fails HERE rather than in an audit months
    later.
    """
    guarded_or_open = set(GATED) | set(STILL_OPEN)
    unclassified = []
    for path, route in _routes_by_path(real_app).items():
        if not path.startswith("/api/health"):
            continue
        if path in guarded_or_open:
            continue
        if asc._guard_names_for(route):
            # Gated but unlisted: still a drift, because the OTHER direction
            # (an admin actually reaching the payload) is only asserted for
            # roster members.
            unclassified.append(f"{path} (gated, but missing from GATED)")
        else:
            unclassified.append(f"{path} (NOT GATED and not in STILL_OPEN)")

    joined = "; ".join(sorted(unclassified))
    assert not unclassified, (
        "a /api/health route is unclassified — decide whether it is admin-only "
        "(add to GATED) or deliberately anonymous (add to STILL_OPEN, with the "
        "reason): " + joined
    )


def test_the_sweep_can_actually_see_health_routes(real_app):
    """Non-vacuity control for the sweep above.

    The sweep asserts an EMPTY list, which a probe that finds no routes at all
    would satisfy forever. Pin that it sees the family it is policing.
    """
    seen = [p for p in _routes_by_path(real_app) if p.startswith("/api/health")]
    assert len(seen) >= len(GATED), (
        f"the sweep only sees {len(seen)} /api/health routes; it is not "
        "discriminating and its empty-list assertion proves nothing"
    )

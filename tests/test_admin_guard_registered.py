"""🔴 THE ADMIN GUARD IS INSTALLED ON THE APP THIS REPO ACTUALLY SERVES.

THE DEFECT THIS FILE EXISTS FOR
-------------------------------
`api/middleware/admin_guard.py` shipped complete and fails closed. It had EIGHT
passing tests. And `app.add_middleware(AdminGuardMiddleware)` appeared nowhere in
`api/main.py` — not on this branch, not on `origin/master` — so the ~30
destructive operations under `/api/admin/{massive,oi,ticker-types,flow}/*`,
`/api/admin/alert-tester` and `/api/live/admin/*` answered any caller on the
internet. Built, tested, green and connected to nothing, in its most expensive
form: the unreachable thing was a security guard.

WHY EIGHT GREEN TESTS COULD NOT SEE IT, MEASURED
------------------------------------------------
`tests/test_launch_hardening.py::_guard_app` builds its OWN `FastAPI()` and calls
`app.add_middleware(ag.AdminGuardMiddleware)` itself. Every one of those tests is
correct, and every one of them stays green for the entire time production has no
guard at all — because both halves of a severed wire remain individually correct.
That is the same shape as `CustomScan.chartmount`, `ConciergeBox` and
`ScanResults`, and it is why the rail has to drive the REAL `api.main:app`.
The precedent idiom is `test_signature_router.py::test_the_router_is_mounted_on
_the_real_app`.

⛔ AND IT PROBES A PATH THAT ROUTES TO NOTHING, ON PURPOSE.
`lesson_never_probe_a_mutating_endpoint_to_test_auth`: firing an unauthenticated
POST at a real destructive endpoint is safe only WHEN THE GATE WORKS — in the one
case the test exists to detect, the request is not rejected and the handler RUNS.
This repo has already executed a real production job (8,108 contracts captured)
that way. So the canary is `POST /api/admin/massive/<a path no route claims>`:

    guard installed      -> 403 from the middleware, before routing
    guard NOT installed  -> 405 from the router, having executed nothing

Both answers are side-effect-free by construction, and the 403→405 flip is
exactly the registration going away.

⭐ WHY 405 AND NOT 404, MEASURED ON THIS APP: the only route that can match the
probe path is the SPA catch-all `GET /{full_path:path}` (`spa_fallback`), which
serves static HTML — so a POST is a PARTIAL match and Starlette answers "Method
Not Allowed" without running anything. That is the same tell the broker_sync
outage left behind (`POST /connect` → 405 while `GET /connect` → 200 HTML), and
`test_only_the_static_spa_fallback_can_match_the_probe` below asserts it stays
true, because the day a real handler claims that path is the day this probe
stops being harmless.
"""
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.middleware import admin_guard as ag  # noqa: E402

# A path UNDER a guarded prefix that no route claims. Derived from the
# middleware's own tuple so a rename of the prefix moves the probe with it —
# never a second, hand-typed copy of the same fact.
PROBE_PATH = ag.GUARDED_PREFIXES[0] + "__guard_probe_no_such_route__"

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}


@pytest.fixture(scope="module")
def real_app():
    from api.main import app
    return app


@pytest.fixture(scope="module")
def client(real_app):
    # `raise_server_exceptions=False` so a handler error surfaces as a status
    # code rather than an exception — this file asserts about the GUARD, and a
    # broken handler must not be able to masquerade as a blocked request.
    return TestClient(real_app, raise_server_exceptions=False)


# ── the registration itself ─────────────────────────────────────────────────

def test_the_admin_guard_is_registered_on_the_real_app(real_app):
    """Read off `app.user_middleware` — the list Starlette itself iterates when
    it builds the stack — never off the source text of `main.py`.
    (`lesson_probe_names_must_be_derived_not_typed`: derive a guard's list from
    the REGISTRY the code iterates.)"""
    installed = [getattr(m.cls, "__name__", str(m.cls)) for m in real_app.user_middleware]
    assert "AdminGuardMiddleware" in installed, (
        "AdminGuardMiddleware is NOT installed on api.main:app. The middleware "
        "module exists and passes its own tests, and nothing is calling it, so "
        "every destructive operation under "
        f"{', '.join(ag.GUARDED_PREFIXES)} answers an anonymous caller from the "
        f"internet. Installed stack: {installed}"
    )


def test_it_runs_inside_CORS_and_outside_the_paywall(real_app):
    """Order is a fact worth asserting, not a coincidence to rediscover.
    Starlette PREPENDS, so `user_middleware[0]` is outermost. The guard must sit
    inside CORS (a browser still gets CORS headers on the 403) and outside the
    paywall/maintenance layers (an anonymous caller is refused before either
    does any work)."""
    order = [getattr(m.cls, "__name__", str(m.cls)) for m in real_app.user_middleware]
    assert "CORSMiddleware" in order and "CompassPaywallMiddleware" in order, (
        f"the surrounding stack changed shape; this assertion is stale: {order}")
    assert order.index("CORSMiddleware") < order.index("AdminGuardMiddleware") \
        < order.index("CompassPaywallMiddleware"), (
        f"admin guard is in the wrong layer of the stack: {order}")


# ── the end-to-end proof, through the real ASGI stack ───────────────────────

def test_an_anonymous_caller_is_refused_by_the_real_stack(client):
    r = client.post(PROBE_PATH)
    assert r.status_code == 403, (
        f"an anonymous POST to {PROBE_PATH} was answered {r.status_code}, not 403. "
        f"The admin guard is not intercepting {ag.GUARDED_PREFIXES[0]}* on the real "
        f"app, which means the destructive operations under it — apply-gap-fill, "
        f"rollback-gap-fill, backfill-from-patches, normalize-sweep-sides, "
        f"rebuild-color, flow/delete-by-date, live/admin/clear-before-date — are "
        f"open to the internet."
    )


def test_a_logged_in_NON_admin_is_refused_too(client, monkeypatch):
    """Fails closed on ROLE, not merely on the presence of a session."""
    monkeypatch.setattr(ag, "validate_session", lambda tok: {"id": 7, "role": "user"})
    assert client.post(PROBE_PATH).status_code == 403


def test_an_ADMIN_is_let_through_the_guard(client, monkeypatch):
    """⭐ A guard that blocks everything is not a fix. An admin must reach
    ROUTING — which, for this deliberately unclaimed probe path, means the
    router's own refusal (405, see the module docstring). That answer is the
    proof the guard passed the request on WITHOUT any handler running."""
    monkeypatch.setattr(ag, "validate_session", lambda tok: {"id": 1, "role": "admin"})
    r = client.post(PROBE_PATH)
    assert r.status_code != 403, (
        "an authenticated ADMIN was refused by the admin guard — the gate is "
        "closed on the people it exists to admit")
    assert r.status_code in (404, 405), (
        f"expected the guard to hand an admin through to routing (404/405 for a "
        f"path no handler claims), got {r.status_code}")


def test_the_guard_does_not_blanket_block_the_rest_of_the_app(client):
    """The other direction of 'a guard that blocks everything is not a fix':
    an ordinary public route is untouched."""
    r = client.get("/api/maintenance")
    assert r.status_code != 403, (
        "the admin guard is refusing a public, non-admin route — its prefix "
        "matching has gone wrong and it is now an outage, not a gate")


# ── the controls, without which none of the above means anything ────────────

def test_only_the_static_spa_fallback_can_match_the_probe(real_app):
    """⛔ THE SAFETY PROPERTY, ASSERTED RATHER THAN ASSUMED.

    The anonymous probe above is harmless only while nothing with side effects
    can be reached at that path. Asked of the router itself — `route.matches` on
    a real POST scope — not inferred from the path string. If a handler ever
    claims it, this goes red BEFORE the probe can execute anything.
    """
    from starlette.routing import Match

    scope = {"type": "http", "method": "POST", "path": PROBE_PATH,
             "headers": [], "query_string": b"", "root_path": ""}
    matched = []
    for r in real_app.routes:
        try:
            m, _ = r.matches(scope)
        except Exception:                      # pragma: no cover - defensive
            continue
        if m is not Match.NONE:
            matched.append((getattr(r, "path", "?"),
                            getattr(getattr(r, "endpoint", None), "__name__", "?"),
                            m is Match.FULL))

    assert matched, "nothing at all matched the probe scope; this control is vacuous"
    for path, endpoint, full in matched:
        assert endpoint == "spa_fallback" and not full, (
            f"{endpoint} at {path} now claims {PROBE_PATH} "
            f"(full match: {full}). This file's probe is no longer harmless — "
            f"move the probe, do NOT delete this assertion.")


def test_there_really_ARE_guarded_destructive_routes_to_protect(real_app):
    """⛔ NON-VACUITY. Every assertion above would pass just as happily on an app
    with no admin surface at all. Derived from the middleware's own prefixes and
    the live route table — never a hand-typed list that agrees with today."""
    guarded_mutating = sorted(
        (m, r.path)
        for r in real_app.routes
        for m in ((getattr(r, "methods", None) or set()) & MUTATING)
        if ag._is_guarded(getattr(r, "path", "") or "")
    )
    assert len(guarded_mutating) >= 15, (
        f"only {len(guarded_mutating)} guarded mutating routes were found on the "
        f"real app; the admin surface this guard exists for has moved, and this "
        f"file may be protecting nothing: {guarded_mutating}")


def test_the_boot_audit_now_looks_at_the_admin_surface_at_all(real_app):
    """The SECOND reason the missing registration was silent.

    `auth_surface_check.AUDITED_PREFIXES` did not contain `/api/admin`, so the
    startup check that exists to say "this pod serves ungated mutating routes"
    was not looking at the admin surface — it logged a green fingerprint every
    boot while ~30 destructive ops were open.
    """
    from api import auth_surface_check as asc

    assert "/api/admin" in asc.AUDITED_PREFIXES
    res = asc.audit_routes(real_app)
    admin_checked = [p for _m, p in res["middleware_gated"] if p.startswith("/api/admin")]
    assert admin_checked, (
        "the audit reports no middleware-gated admin routes; either the guard is "
        "not installed or /api/admin is no longer being audited")
    assert res["ok"], (
        f"the boot audit is RED: {res['ungated']}. A permanently-red monitor is "
        f"as broken as a green one — either gate these, or record them in "
        f"ALLOWED_OPEN with a paired assertion.")


def test_the_audits_middleware_bucket_collapses_when_the_guard_is_uninstalled():
    """⛔ THE BUCKET IS NOT A SUPPRESSION. `middleware_gated` must be derived
    from a middleware that is genuinely INSTALLED — otherwise it would be a
    prefix allow-list that declares routes safe on the strength of a module
    nobody is running, which is precisely the state this whole fix came out of.

    Measured on a throwaway app rather than by mutating the real one.
    """
    from fastapi import FastAPI

    from api import auth_surface_check as asc

    def _app(with_guard):
        a = FastAPI()
        if with_guard:
            a.add_middleware(ag.AdminGuardMiddleware)

        @a.post(ag.GUARDED_PREFIXES[0] + "wipe-it")
        def wipe():                            # pragma: no cover - never called
            return {}
        return a

    guarded = asc.audit_routes(_app(True))
    bare = asc.audit_routes(_app(False))

    assert guarded["middleware_gated"] and guarded["ok"] is True
    assert bare["middleware_gated"] == [], (
        "a route was reported middleware-gated on an app with no middleware")
    assert bare["ungated"] and bare["ok"] is False, (
        "removing the middleware left the audit green — the bucket is a "
        "suppression, not a check")


def test_every_allowed_open_admin_route_still_calls_its_inline_gate():
    """The obligation `ALLOWED_OPEN` states about itself: *"An entry here is a
    promise this audit CANNOT keep on its own — if the inline check is later
    deleted, the allow-list would keep reporting OK. So every entry must be
    paired with a source-level assertion."*

    ⛔ THE FIVE ARE DERIVED FROM THE DICT, never retyped — an entry added to
    `ALLOWED_OPEN` without a real gate fails here rather than being waved
    through by a hand-list that happens to agree with today.
    """
    import ast

    from api import auth_surface_check as asc

    admin_entries = sorted(p for (_m, p) in asc.ALLOWED_OPEN if p.startswith("/api/admin"))
    assert admin_entries, "no admin entries in ALLOWED_OPEN; this control is vacuous"

    src = open("api/routers/bars.py", encoding="utf-8").read()
    tree = ast.parse(src)
    # path -> handler, by reading the decorator, so a renamed function moves with it.
    by_path = {}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call) or not dec.args:
                continue
            arg = dec.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                by_path[arg.value] = node

    for path in admin_entries:
        fn = by_path.get(path)
        assert fn is not None, (
            f"{path} is recorded in ALLOWED_OPEN but no handler in "
            f"api/routers/bars.py declares it — the allow-list is describing a "
            f"route that moved")
        body = ast.get_source_segment(src, fn) or ""
        assert "_check_admin_auth(request)" in body, (
            f"{path} is in ALLOWED_OPEN as 'gated INLINE by _check_admin_auth', "
            f"and its handler no longer calls it. The audit is now reporting OK "
            f"for an endpoint with NO gate at all.")


def test_the_inline_gate_it_relies_on_actually_refuses():
    """…and the gate itself fails closed. An `ALLOWED_OPEN` entry that points at
    a function which returns quietly would be worse than no entry."""
    from fastapi import HTTPException

    from api.services.bars_fetch import _check_admin_auth

    class _R:
        headers = {"Authorization": "Bearer nope"}

    os.environ["PUSH_SECRET"] = "the-real-secret"
    try:
        with pytest.raises(HTTPException) as e:
            _check_admin_auth(_R())
        assert e.value.status_code in (401, 403)

        class _Ok:
            headers = {"Authorization": "Bearer the-real-secret"}
        _check_admin_auth(_Ok())               # must NOT raise
    finally:
        os.environ.pop("PUSH_SECRET", None)


def test_the_fixture_app_tests_cannot_see_this_and_that_is_the_finding(real_app):
    """The measurement, made executable so it does not rot into folklore.

    `tests/test_launch_hardening.py` proves the middleware BEHAVES correctly on
    an app it builds itself. Nothing about that app is `api.main:app`, so no
    assertion in it can distinguish 'registered in production' from 'not
    registered at all' — which is exactly the state the repo was in with all 8
    of them green.
    """
    import inspect

    import tests.test_launch_hardening as lh

    src = inspect.getsource(lh._guard_app)
    assert "FastAPI()" in src and "add_middleware" in src, (
        "test_launch_hardening._guard_app no longer builds its own app — if it "
        "now drives the real one, delete this test with the finding it records")
    assert "api.main" not in src, (
        "the fixture app now reaches for api.main; this record is stale")

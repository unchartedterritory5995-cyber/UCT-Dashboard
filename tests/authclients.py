"""ONE way for a backend test to say "this caller is signed in".

WHY THIS EXISTS
---------------
The 2026-08-09 auth/paywall sweep closed 253 routes that had been answering
callers with no credential of any kind. That is the fix. The side effect is that
every *behaviour* test written against those routes — `client.get("/api/groups")`
and assert 200 — now measures the gate instead of the behaviour it was written
for, and reads `assert 401 == 200`.

Those assertions were never about auth. Repairing them means giving each one the
caller it always implied, and the failure mode to avoid while doing that is
inventing a ninth idiom per file. This module is the one idiom.

⛔ THE OVERRIDE IS ON THE IDENTITY, NEVER ON THE GATE.
`get_current_user` / `get_current_user_with_plan` are replaced; `require_paid`
and `require_admin` are NOT. Overriding a gate means the test no longer runs the
gate at all (`lesson_injected_dependency_hides_the_fetch`) — a handler that had
silently lost its `Depends(require_paid)` would look identical to one that still
carried it, which is exactly the blindness that let `AdminGuardMiddleware` stay
green while uninstalled for months. Substituting the identity one level down
leaves the real gate in the dependency tree, running, on every request a fixed
test makes.

✋ AND THESE FIXTURES DO NOT ASSERT THE GATE. That is deliberate.
`tests/test_exposed_routes_gated.py` drives an anonymous, a free, a paid and an
admin caller at every gated route on the real `api.main:app` and is the single
owner of "is this route gated, and as what". A per-file re-assertion here would
be a SECOND AUTHORITY OVER ONE VALUE — this repo's most repeated defect — and
the copy that drifts is the one nobody re-derives. Repair the behaviour here;
assert the gate there.

USAGE
-----
Module-wide, one line, at the top of a test file whose routes are paid-gated::

    # Every request in this module is made by a PAID member: these routes are
    # `require_paid` since the 2026-08-09 auth sweep.
    from tests.authclients import as_a_paid_member  # noqa: F401  (autouse)

For a single test that needs a different caller (e.g. one admin-only route in an
otherwise paid file)::

    from tests.authclients import ADMIN, signed_in_as
    ...
    with signed_in_as(ADMIN):
        resp = client.post("/api/cot/refresh")

For a test that builds its OWN minimal `FastAPI()` app rather than importing
`api.main:app`::

    from tests.authclients import PAID_MEMBER, authorize
    app = FastAPI(); app.include_router(rt.router)
    authorize(app, PAID_MEMBER)
"""
from __future__ import annotations

import contextlib

import pytest

from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
)

#: A signed-in account with no entitlement. Here so a test that wants to prove a
#: paid surface refuses a free member has the same vocabulary as the rest.
FREE_MEMBER = {"id": "free-test", "email": "free@example.test",
               "role": "member", "plan": "free"}

#: The ordinary paying customer these behaviour tests were always written for.
PAID_MEMBER = {"id": "paid-test", "email": "paid@example.test",
               "role": "member", "plan": "pro"}

#: Staff. Satisfies `require_admin` AND `require_paid` (both short-circuit on
#: role == "admin"), so it is the right caller for an admin-only route and the
#: WRONG one for a paid route — using it everywhere would hide a route that had
#: been over-gated to admin.
ADMIN = {"id": "admin-test", "email": "admin@example.test",
         "role": "admin", "plan": "free"}

_DEPS = (get_current_user, get_current_user_with_plan)


def authorize(app, user: dict) -> None:
    """Make `app` see every request as coming from `user`. No teardown."""
    for dep in _DEPS:
        app.dependency_overrides[dep] = lambda u=dict(user): dict(u)


def sign_in_flow_caller(monkeypatch, user: dict = PAID_MEMBER) -> dict:
    """The flow family's identity, which is NOT `get_current_user`.

    `require_flow_user` / `require_flow_admin` read the cookie themselves through
    `api.flow_admin_auth.validate_session` — a `from` import, so the patch has to
    land on `flow_admin_auth`'s OWN name; patching `auth_service` would reach
    nothing (`lesson_from_import_severs_a_module_from_its_guards`). The gate
    itself is left alone, same rule as everywhere else in this module.

    Deliberately NOT "just send `Bearer PUSH_SECRET`": that authenticates as the
    machine, so a test written that way keeps passing even if the member path
    through the gate is broken.
    """
    import api.flow_admin_auth as fa
    monkeypatch.setattr(fa, "validate_session", lambda _cookie: dict(user))
    return user


def _main_app():
    from api.main import app
    return app


@contextlib.contextmanager
def signed_in_as(user: dict, app=None):
    """Sign in as `user` for the duration of the block, then restore whatever
    caller was in force before — so it nests inside a module-wide fixture
    instead of clearing it (`lesson_teardown_must_undo_what_setup_created`)."""
    app = app or _main_app()
    prior = {dep: app.dependency_overrides.get(dep) for dep in _DEPS}
    authorize(app, user)
    try:
        yield user
    finally:
        for dep, was in prior.items():
            if was is None:
                app.dependency_overrides.pop(dep, None)
            else:
                app.dependency_overrides[dep] = was


def _autouse_as(user):
    @pytest.fixture(autouse=True)
    def _fixture():
        with signed_in_as(user) as u:
            yield u
    return _fixture


#: Autouse fixtures. Import one into a test module and every request that module
#: makes against `api.main:app` carries that caller.
as_a_paid_member = _autouse_as(PAID_MEMBER)
as_an_admin = _autouse_as(ADMIN)
as_a_free_member = _autouse_as(FREE_MEMBER)

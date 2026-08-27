"""ONE way for a test to ask *"what does `api/main.py` BUILD under this env?"*
without leaving the shared app object different from how it found it.

WHY THIS EXISTS
---------------
`api/main.py` mounts several routers behind env flags as MODULE-LEVEL
statements, so the only honest way to ask what it builds under a flag is to make
it build — `importlib.reload(api.main)`. A locally constructed `FastAPI()` proves
the router works and cannot prove `api/main.py` calls it; that is the exact shape
`test_exposed_routes_gated.py` names as how `AdminGuardMiddleware` stayed green
for months while production had no guard at all.

⛔ AND A RELOAD REBINDS `api.main.app` TO A **NEW OBJECT**, WHICH POISONS EVERY
MODULE THAT ALREADY HELD THE OLD ONE. Measured on this branch, 2026-08-27:

    api.main.app                 before 0x14BEA23C740  after 0x14BFA1B2AB0   (DIFFERENT)
    api.middleware.auth_middleware   (module)  identical
    get_current_user / get_current_user_with_plan     identical
    require_paid on /api/backtest    identical on BOTH apps

So the dependency FUNCTIONS survive a reload untouched — only the `app` moves.
That single moved object is the whole defect, because the two sides of a test's
authentication resolve it at different times:

  * `tests/test_backtest_endpoint.py` does `from api.main import app` and
    `client = TestClient(app)` at MODULE IMPORT — pytest imports every test
    module during collection, so it pins app #1 before any test runs;
  * `tests/authclients.py::_main_app()` does `from api.main import app` at CALL
    time, so `signed_in_as` writes `dependency_overrides` onto whatever app is
    current — app #2 after somebody reloads.

The override is then perfectly correct and lands on an app nobody is driving.
`require_paid` runs for real against the client's app and the request 401s, and
the 8 assertions in `test_backtest_endpoint.py` read `assert 401 == 200` in the
full baseline while passing alone. Neither that file nor `api/routers/backtest.py`
had changed; a neighbour three files earlier had reloaded `api.main`.

THE FIX IS STRUCTURAL, NOT A TEARDOWN
-------------------------------------
`app_built_with()` snapshots `api.main`'s namespace, reloads, takes the app it
built, and puts the namespace back **before it returns**. There is therefore no
window at all in which `api.main.app` is the reloaded object — not one bounded by
a fixture that a caller has to remember to import, and not one an exception can
skip. The app it hands back is a complete, drivable FastAPI instance (its route
table holds direct references to the endpoints built during the reload); what it
is NOT is `api.main.app`.

⚠️ TEARDOWN MUST UNDO WHAT SETUP CREATED, and the namespace is restored by
snapshot rather than by a second reload. A second reload would produce a THIRD
distinct app — "restored" in spirit, still not the object anybody was holding.

Rails: `tests/test_main_reload_leaves_no_leak.py` — it drives a client bound
before a reload and asserts an `authclients` override still reaches it, and it
walks `tests/**` with an AST so a module that reloads `api.main` on its own again
fails BY NAME.

USAGE
-----
    from tests.mainreload import app_built_with

    app_on = app_built_with(SCREEN_BACKTEST_ENABLED="1")
    app_off = app_built_with(SCREEN_BACKTEST_ENABLED="0")
"""
from __future__ import annotations

import contextlib
import importlib
import os


@contextlib.contextmanager
def _env(overrides: dict):
    """`overrides` in force for the block, then whatever was there before.

    Restores prior values rather than clearing them, so this nests inside an
    outer env pin instead of erasing it (`lesson_teardown_must_undo_what_setup_
    created`) — the same rule `tests/authclients.py:119` follows for overrides.
    """
    prior = {k: os.environ.get(k) for k in overrides}
    try:
        for k, v in overrides.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = str(v)
        yield
    finally:
        for k, was in prior.items():
            if was is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = was


def app_built_with(**env):
    """The app `api/main.py` builds under `env` — with `api.main` left as found.

    ⛔ The caller gets an app object; `api.main.app` is NOT it and never was
    during this call. That is the point: see the module docstring.
    """
    import api.main as main

    # `importlib.reload` re-executes the module IN PLACE, so `sys.modules` keeps
    # the same module object and every rebound global lives in this one dict.
    # Restoring the dict therefore restores every name — `app` included — to the
    # exact object it held, which a second reload could not do.
    snapshot = dict(vars(main))
    try:
        with _env(env):
            importlib.reload(main)
        return main.app
    finally:
        namespace = vars(main)
        namespace.clear()
        namespace.update(snapshot)

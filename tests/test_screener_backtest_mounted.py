"""🔴 THE SCREEN-BACKTEST DOOR IS REACHABLE FROM `api.main:app`, AND THAT IS
MEASURED ON THE REAL APP RATHER THAN ON THE ROUTER THAT DECLARES IT.

WHY THIS FILE EXISTS
--------------------
This repo's signature failure is a feature that is built, tested, green — and
reachable from nothing. `api/earnings_router.py` has sat unmounted for months
while its own docstring explains how to mount it. `scan_evaluator.enabled()`'s
docstring and the comment above its `add_job` BOTH said "E-4 has not wired a
surface to these results" for weeks after the surface was wired; two copies of
one false sentence read as corroboration.

⛔ A COMPONENT TEST CANNOT SEE A SEVERED WIRE. Both halves stay individually
correct: the router declares its routes, the router's own tests pass, and no
request can reach any of it. So nothing here reads
`screener_backtest.router.routes` and stops — every assertion resolves against
the route table the app actually dispatches on.

⛔ AND NOT `test_flow_proxy_register.py` EITHER. That is this repo's only other
precedent for a flag-gated mount, and it builds a LOCAL `FastAPI()` — the exact
shape `test_exposed_routes_gated.py`'s docstring names as how
`AdminGuardMiddleware` stayed green for months while production had no guard at
all. It proves `register_on` works; it cannot prove `api/main.py` calls it.

⭐ THE FLAG IS PART OF THE SUBJECT, NOT AN OBSTACLE TO IT. The mount is gated on
`SCREEN_BACKTEST_ENABLED`, default OFF, so this file asserts BOTH directions:
with the flag off the door is absent from the real table, with it on the door
resolves. A rail that only ever checked the "on" state would pass just as
happily if the flag had stopped gating anything.

⛔ NO PATH IS TYPED. Every address is derived from the router object, because
`lesson_probe_names_must_be_derived_not_typed` was written after a grep on this
branch "found 5 call sites, all five of them prose".
"""
from __future__ import annotations

import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from tests.mainreload import app_built_with  # noqa: E402

FLAG = "SCREEN_BACKTEST_ENABLED"

#: A route this file is NOT looking for, used as the non-vacuity control. It is
#: the screener's own scan door — a different router module at a neighbouring
#: prefix, so a probe that can see it is genuinely reading the live table.
SIBLING = ("POST", "/api/screener/scan")


# ── the app, built both ways ─────────────────────────────────────────────────

def _app_with(flag: str):
    """`api.main:app` as it is built with `SCREEN_BACKTEST_ENABLED=<flag>`.

    ⚠️ `importlib.reload` and not a locally constructed `FastAPI()` — that
    reason is unchanged, and it is why `tests/mainreload.py` exists instead of a
    local `FastAPI()` helper. The mount is a module-level statement in
    `api/main.py`, so the only honest way to ask "what does main.py build under
    this flag" is to make main.py build it. The heavy imports are already
    cached, so the reload is fast.

    ⛔ WHAT CHANGED IS WHERE THE RELOAD LANDS, NOT WHETHER IT HAPPENS.
    `app_built_with` puts `api.main`'s namespace back before it returns, so
    `api.main.app` is never left rebound and this file's subject cannot leak
    into anybody else's fixtures. It used to — measured: this module runs three
    files ahead of `tests/test_backtest_endpoint.py` in the branch baseline and
    made all 8 of its assertions read `assert 401 == 200`, because that file
    pins `api.main.app` at import while `tests/authclients.py` resolves it per
    call, so the override landed on an app nobody was driving. A module-teardown
    fixture that reloaded once more could not fix it: a third reload builds a
    THIRD app, not the one the victim is holding.
    """
    return app_built_with(**{FLAG: flag})


@pytest.fixture(scope="module")
def app_on():
    return _app_with("1")


@pytest.fixture(scope="module")
def router_mod():
    return importlib.import_module("api.routers.screener_backtest")


# ── reading the real table ───────────────────────────────────────────────────

def _registrations(app) -> dict:
    """(method, path) -> [endpoint qualnames], over the LIVE route table."""
    out: dict = {}
    for r in getattr(app, "routes", []):
        path = getattr(r, "path", None)
        if not path:
            continue
        ep = getattr(r, "endpoint", None)
        name = f"{getattr(ep, '__module__', '?')}.{getattr(ep, '__name__', '?')}"
        for m in (getattr(r, "methods", None) or set()):
            if m in ("HEAD", "OPTIONS"):
                continue
            out.setdefault((m, path), []).append(name)
    return out


def _declared(router_mod) -> set:
    """Every (method, path) the ROUTER declares — read off the object."""
    return {(m, r.path)
            for r in router_mod.router.routes
            for m in (getattr(r, "methods", None) or set())
            if m not in ("HEAD", "OPTIONS")}


# ── the rails ────────────────────────────────────────────────────────────────

def test_the_router_declares_routes_at_all(router_mod):
    """⛔ NON-VACUITY, FIRST. Every membership assertion below is over a derived
    set; an empty router would satisfy all of them by describing nothing."""
    assert _declared(router_mod), (
        "api/routers/screener_backtest.py declares no routes — every "
        "'the door resolves' assertion in this file would pass vacuously")


def test_the_probe_can_see_a_SIBLING_it_is_not_looking_for(app_on):
    """⛔ THE CONTROL. Everything else here is a presence check, and a reader
    that had quietly stopped seeing routes — a renamed attribute, a table that
    never loaded — must not be able to pass. This asserts the probe
    independently sees a route it is not looking for."""
    live = _registrations(app_on)
    assert len(live) > 500, (
        f"only {len(live)} registrations read off api.main:app — the route "
        f"table did not load and every assertion in this file is vacuous")
    assert SIBLING in live, (
        f"the probe cannot see {SIBLING[0]} {SIBLING[1]}, a route it is not "
        f"looking for, so it is not reading the real screener surface")


def test_every_route_the_router_declares_RESOLVES_on_the_real_app(app_on, router_mod):
    """⭐ THE WIRE. Cut the `include_router` in api/main.py and this goes red."""
    live = _registrations(app_on)
    declared = _declared(router_mod)
    missing = sorted(f"{m} {p}" for (m, p) in declared if (m, p) not in live)
    assert not missing, (
        f"screener_backtest declares {len(declared)} route(s) and {len(missing)} "
        f"resolve on NOTHING: {missing}. The router is built, its own tests are "
        f"green, and no request can reach it — this repo's signature failure.")


def test_those_routes_are_answered_by_THIS_router(app_on, router_mod):
    """Resolving is not enough. Another module could already own the address and
    FastAPI answers first-match, so ours would be dead code that looks live."""
    live = _registrations(app_on)
    wrong = {f"{m} {p}": live[(m, p)]
             for (m, p) in _declared(router_mod) if (m, p) in live
             and not any(n.startswith(router_mod.__name__) for n in live[(m, p)])}
    assert not wrong, f"these addresses resolve to a DIFFERENT module: {wrong}"


def test_no_backtest_address_is_claimed_twice(app_on, router_mod):
    """`api/routers/backtest.py` — the 2026-05-11 strategy backtester — is
    already mounted. A collision would silently shadow one of the two."""
    live = _registrations(app_on)
    dupes = {f"{m} {p}": live[(m, p)]
             for (m, p) in _declared(router_mod) if len(live.get((m, p), [])) > 1}
    assert not dupes, f"address(es) with more than one handler: {dupes}"


def test_the_flag_actually_GATES_the_mount(router_mod):
    """⛔ THE OTHER DIRECTION, AND IT IS HALF THE POINT. `SCREEN_BACKTEST_ENABLED`
    defaults OFF; with it off the door must be absent from the real table. A rail
    that only checked the "on" state would pass unchanged if the flag had stopped
    gating anything — at which point a dark feature would be live and nothing
    would say so."""
    live_off = _registrations(_app_with("0"))
    leaked = sorted(f"{m} {p}" for (m, p) in _declared(router_mod)
                    if (m, p) in live_off)
    assert not leaked, (
        f"{FLAG} is off and these routes are mounted anyway: {leaked}. The flag "
        f"has stopped gating the mount, so the feature is live in production "
        f"without the decision to ship it having been made.")
    # …and the control: the app built with the flag off is a REAL app, not an
    # empty one that would make the assertion above true for the wrong reason.
    assert SIBLING in live_off, (
        "the flag-off app has no /api/screener/scan either — it did not build, "
        "so 'the backtest routes are absent' means nothing")


def test_the_door_ANSWERS_and_does_not_merely_resolve(app_on, router_mod):
    """⭐⭐ THE ASSERTION THAT EARNED ITS PLACE. A resolving route whose handler
    raises is a door onto a 500, and every check above passes for it.

    This drove out three real breaks between the router and the engine on the day
    they were written — `engine.run` (the engine exposes `run_backtest`), a
    `Receipt` where `_envelope` wanted a dict, and a `YYYYMMDD` window the engine
    refuses as `bad_date`. Each half was individually correct and green.

    ⚠️ Safe to drive: this endpoint computes over a LOCAL bars read. It mutates
    nothing, so `lesson_never_probe_a_mutating_endpoint_to_test_auth` does not
    apply — and the universe is stubbed to two symbols so no sweep happens.
    """
    from fastapi.testclient import TestClient

    num = lambda v: {"type": "num", "value": v}            # noqa: E731
    ser = lambda n: {"type": "series", "name": n}          # noqa: E731
    op = lambda n, *a: {"type": "op", "name": n, "args": list(a)}      # noqa: E731
    call = lambda n, *a: {"type": "call", "name": n, "args": list(a)}  # noqa: E731

    app_on.dependency_overrides[router_mod.require_paid] = lambda: {"id": 1}
    real_universe = router_mod._universe_for
    router_mod._universe_for = lambda spec, uid: (
        ["AAPL", "MSFT"], {"kind": "test", "membership": "current"})
    try:
        c = TestClient(app_on, raise_server_exceptions=False)
        r = c.post("/api/screener/backtest",
                   json={"ast": op(">", ser("close"), call("sma", ser("close"), num(5))),
                         "universe": "current", "from": "2024-01-01",
                         "to": "2024-06-30", "horizons": [5]})
        assert r.status_code == 200, (
            f"the backtest door resolved but answered {r.status_code}: "
            f"{r.text[:400]}")
        body = r.json()
        # The engine's receipt reached the member THROUGH the route: these keys
        # are the engine's, and their presence is what proves the seam holds.
        for key in ("backtestable", "universe", "method", "coverage"):
            assert key in body, (
                f"the response is missing the engine receipt's {key!r} — the "
                f"route answered without the engine's receipt reaching it: {sorted(body)}")
        assert body.get("job"), "the route's own job id is missing from the envelope"
    finally:
        router_mod._universe_for = real_universe
        app_on.dependency_overrides.pop(router_mod.require_paid, None)


def test_a_screen_reading_a_SCALAR_is_refused_BY_NAME_through_the_door(app_on, router_mod):
    """⛔⛔ THE FEATURE'S HEADLINE, ASSERTED WHERE THE MEMBER MEETS IT.

    `screener_rows` holds ONE row per ticker, so there is no history of
    `rs_rank`. Evaluating today's value at a 2024 bar screens the past using a
    fact from the future.

    ⭐ AND THE REFUSAL MUST BEAT THE EVALUATOR TO IT. Measured on this codebase:
    with no scalar value `interpret(rs_rank > 80)` returns a CONFIDENT FALSE on
    every bar — not a hole — so a backtester that skipped `unresolved_scalars`
    would not print a wrong equity curve, it would print "never triggered" about
    a screen that may have fired constantly. A refusal and an empty result are
    indistinguishable downstream, which is why this is asserted by NAME.
    """
    from fastapi.testclient import TestClient

    app_on.dependency_overrides[router_mod.require_paid] = lambda: {"id": 1}
    real_universe = router_mod._universe_for
    router_mod._universe_for = lambda spec, uid: (
        ["AAPL", "MSFT"], {"kind": "test", "membership": "current"})
    try:
        c = TestClient(app_on, raise_server_exceptions=False)
        r = c.post("/api/screener/backtest",
                   json={"ast": {"type": "op", "name": ">",
                                 "args": [{"type": "series", "name": "rs_rank"},
                                          {"type": "num", "value": 80}]},
                         "universe": "current", "from": "2024-01-01",
                         "to": "2024-06-30", "horizons": [5]})
        assert r.status_code == 200, (
            f"a refusal is an ANSWER, not an error — got {r.status_code}: {r.text[:300]}")
        body = r.json()
        assert body.get("backtestable") is False
        assert body.get("refused") == "scalar_no_history", body.get("refused")
        assert "rs_rank" in (body.get("names") or []), (
            f"the refusal does not NAME the scalar it refused on: {body.get('names')}")
    finally:
        router_mod._universe_for = real_universe
        app_on.dependency_overrides.pop(router_mod.require_paid, None)


def test_the_door_is_PAID_and_an_anonymous_caller_is_refused(app_on, router_mod):
    """The new surface did not land ungated.

    ⚠️ Worth its own assertion because neither existing auth rail would notice:
    `test_scan_screener_auth.py` reads routes off the `screener`/`scans` router
    MODULES, so a third screener router is invisible to it, and
    `test_exposed_routes_gated.py` only checks routes already named in its own
    `GATED` table — it has no completeness assertion. A new router landing open
    passes both.
    """
    from fastapi.testclient import TestClient

    c = TestClient(app_on, raise_server_exceptions=False)
    for method, path in sorted(_declared(router_mod)):
        probe = path.replace("{job}", "deadbeef")
        r = (c.post(probe, json={}) if method == "POST" else c.get(probe))
        assert r.status_code in (401, 402, 403), (
            f"{method} {probe} answered {r.status_code} to an ANONYMOUS caller — "
            f"a paid compute surface is open")

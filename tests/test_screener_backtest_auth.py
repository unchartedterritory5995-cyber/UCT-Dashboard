"""THE BACKTEST SURFACE IS PAID, AND THE PROOF IS DERIVED FROM THE ROUTER.

⛔ WHY THIS IS A NEW FILE AND NOT THREE MORE LINES IN
``tests/test_scan_screener_auth.py`` — a decision, recorded, because the task
demanded one or the other be made deliberately.

That file is the rail for ``screener.py`` + ``scans.py``. Every assertion in it is
shaped around TWO routers: two asserted counts, a ``-4`` arithmetic over the admin
and public-door exceptions, a ``_klass`` that resolves ``scans_mod.require_paid``
or ``screener_mod.require_paid`` by identity, a ``PUBLIC_BY_DESIGN`` whose SIZE is
asserted, and a ``stub_services`` fixture wired to those two routers' services.
Threading a third router through it would edit every one of those assertions as a
side effect of shipping a feature — and its own docstring says the counts must
cost a DELIBERATE edit. Worse, this branch has several agents in it: a merge that
resolves a count is a merge that silently re-baselines a safety number. So the new
surface gets its OWN file with the SAME shape, and the seam between the two files
is itself asserted below by
``test_exactly_TWO_router_modules_declare_an_api_screener_path`` — the guard
against the failure the split could actually cause, which is a THIRD screener
surface landing where neither rail is looking.

⛔ NOTHING HERE IS TYPED.
  * the (method, path) set comes out of ``router.routes``;
  * the COUNT is asserted, cross-checked against an INDEPENDENT oracle (an AST
    walk of the router SOURCE counting decorated handlers), so a route defined but
    never mounted cannot hide and a third route cannot ride in uncovered;
  * each route's CLASS is read off ``route.dependant.dependencies`` by object
    identity, never off the source text;
  * and the paid pass drives every route and asserts 200, because a sweep of
    refusals is satisfied by a router that refuses everybody.
"""
from __future__ import annotations

import ast as pyast
import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
    require_admin,
)
from api.routers import screener_backtest as bt_mod

ROOT = Path(__file__).resolve().parents[1]
ROUTER_SRC = ROOT / "api" / "routers" / "screener_backtest.py"

#: ⛔ ASSERTED, NOT INFORMATIONAL. A third route on this surface must cost a
#: DELIBERATE edit here, which is what makes it land covered.
EXPECTED_ROUTES = 2

#: The 402 sentence THIS router speaks. Asserted rather than imported so a quiet
#: edit to the message is a failure here and not a silent change to what a refused
#: member reads. It must also be distinct from every sibling's — the repo-wide rail
#: is ``tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…``.
PAID_DETAIL = "Screen backtesting requires a paid plan"

#: ✋ NO PUBLIC DOOR. Unlike ``screener.py`` this surface has no share-token route,
#: so the expected size of the open set is ZERO and that is asserted, not assumed.
PUBLIC_BY_DESIGN: set = set()

PATH_PARAM_SAMPLES = {"job": "0123456789abcdef01234567"}

#: ``close > sma(close, 3)`` — a real canonical tree, so ``max_lookback`` at the
#: door resolves rather than refusing and the paid pass measures the GATE.
BAR_TREE = {"type": "op", "name": ">",
            "args": [{"type": "series", "name": "close"},
                     {"type": "call", "name": "sma",
                      "args": [{"type": "series", "name": "close"},
                               {"type": "num", "value": 3}]}]}

BODY_SAMPLES = {
    ("POST", "/api/screener/backtest"):
        {"ast": BAR_TREE, "from": "2024-01-02", "to": "2024-03-01",
         "universe": "current"},
}


# ─── the derived route table ─────────────────────────────────────────────────

def _routes():
    """⛔ `getattr(r, "methods", None)`, not an isinstance check — a `Mount` has no
    `methods` and a type filter would name a FastAPI class this file must then
    keep in step with."""
    return [r for r in bt_mod.router.routes if getattr(r, "methods", None)]


def _http_methods(route):
    return sorted(route.methods - {"HEAD", "OPTIONS"})


def _dep_calls(route):
    return [d.call for d in route.dependant.dependencies]


def _klass(route) -> str:
    """paid / admin / open — BY OBJECT IDENTITY, never by reading the source."""
    calls = _dep_calls(route)
    if bt_mod.require_paid in calls:
        return "paid"
    if require_admin in calls:
        return "admin"
    return "open"


def _pairs():
    routes = _routes()
    assert len(routes) == EXPECTED_ROUTES, (
        f"api/routers/screener_backtest.py mounts {len(routes)} routes — one was "
        f"added or removed. Update EXPECTED_ROUTES DELIBERATELY.")
    return [(m, r.path, r) for r in routes for m in _http_methods(r)]


def _request_kwargs(route, *, with_body: bool):
    """URL + kwargs derived from what the route DECLARES, so a new path param or a
    new required query param fails loudly instead of quietly turning a 200
    assertion into a 404 or a 422."""
    declared = set(re.findall(r"\{(\w+)\}", route.path))
    missing = declared - set(PATH_PARAM_SAMPLES)
    assert not missing, (
        f"{route.path} declares path params {sorted(missing)} with no sample — "
        "add them or the sweep 404s instead of measuring the gate")
    url = route.path
    for name in declared:
        url = url.replace("{" + name + "}", str(PATH_PARAM_SAMPLES[name]))

    params = {}
    for field in route.dependant.query_params:
        if field.required:
            raise AssertionError(
                f"{route.path} grew a REQUIRED query param {field.name!r} with no "
                "sample — the paid pass would 422 and its 200 assertion would stop "
                "meaning anything")
    kwargs = {"params": params} if params else {}
    if with_body:
        for method in _http_methods(route):
            body = BODY_SAMPLES.get((method, route.path))
            if body is not None:
                kwargs["json"] = body
    return url, kwargs


# ─── the app under test ──────────────────────────────────────────────────────

def _client(user: dict | None):
    """A client for one caller.

    ⚠️ THE OVERRIDES ARE ON `get_current_user` / `get_current_user_with_plan`,
    WHICH ARE WHAT THE GATE DEPENDS ON — never on `require_paid` itself.
    Overriding the gate means the test never runs the gate
    (`lesson_injected_dependency_hides_the_fetch`). `user=None` overrides NOTHING,
    so an anonymous caller walks the real cookie path.
    """
    app = FastAPI()
    app.include_router(bt_mod.router)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


FREE_USER = {"id": "free1", "role": "member", "plan": "free"}
PAID_USER = {"id": "paid1", "role": "member", "plan": "pro"}
ADMIN_USER = {"id": "adm1", "role": "admin", "plan": "free"}


class _FakeReceipt:
    def __init__(self, payload):
        self._payload = payload

    def to_dict(self):
        return dict(self._payload)


class _FakeEngine:
    """The engine, stubbed — so the paid pass measures THE GATE and not the sweep.

    ⛔ IT IS STILL THE ROUTER'S OWN CALL. `_engine` is what is patched, NOT
    `_run_engine`: the adapter still runs, still spells the window, still builds
    the reader and still hands over the keywords it really hands over, so a
    signature drift shows up here as a `TypeError` rather than being hidden. The
    REAL signature is bound in `tests/test_screener_backtest_route.py`.
    """
    DEFAULT_HORIZONS = (5, 10, 20)

    @staticmethod
    def run_backtest(tree, symbols, frm, to, *, bars_for, horizons,
                     min_signals=30, membership="current", bars_source=None):
        return _FakeReceipt({
            "backtestable": False, "refused": "stubbed", "names": [],
            "detail": "stubbed engine", "universe": {"symbols_requested": len(symbols)},
            "method": {}, "coverage": {}, "window": {"from": frm, "to": to},
            "bars_source": bars_source,
        })


@pytest.fixture
def stub_services(monkeypatch):
    """Stub every service the router reaches OUTSIDE the gate.

    ⛔ NOT A HAND-LIST THAT CAN ROT: the paid sweep drives EVERY route derived from
    the table and asserts 200, so a service this forgets shows up as a non-200 and
    fails BY NAME.
    """
    from api.services import bars_sqlite
    from api.services.screener import snapshot_builder

    monkeypatch.setattr(bt_mod, "_engine", lambda: _FakeEngine)
    monkeypatch.setattr(snapshot_builder, "_load_universe",
                        lambda: ["AAA", "BBB", "CCC"])
    monkeypatch.setattr(bars_sqlite, "get_bars_before",
                        lambda sym, tf, want, to_key: [])
    # A poll for a job nobody ran must still be a 200 `unknown`, not a 404 — the
    # gate is what is being measured, and an honest "never heard of it" is an
    # answer.
    return True


# ─── the count, and an INDEPENDENT oracle on it ──────────────────────────────

def test_the_route_count_is_what_the_router_SOURCE_declares():
    """⛔ THE MOUNTED TABLE AND THE FILE ARE TWO ARTIFACTS.

    Every other assertion here reads ``router.routes``. A handler defined but never
    mounted (a decorator on the wrong object, a route inside a dead branch) would
    leave the table short while the source told a different story, and every sweep
    below would pass. So the count is cross-checked against an AST walk of the
    SOURCE — the shape ``tests/test_scan_screener_auth.py`` uses for the same
    reason.
    """
    verbs = {"get", "post", "put", "delete", "patch", "head", "options"}
    tree = pyast.parse(ROUTER_SRC.read_text(encoding="utf-8"))
    n = 0
    for node in pyast.walk(tree):
        if not isinstance(node, (pyast.FunctionDef, pyast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if (isinstance(dec, pyast.Call)
                    and isinstance(dec.func, pyast.Attribute)
                    and dec.func.attr in verbs
                    and isinstance(dec.func.value, pyast.Name)
                    and dec.func.value.id == "router"):
                n += 1
    # The control: the walk CAN see decorators, so a zero is a broken scan rather
    # than a router that stopped declaring routes.
    assert n > 0, "the AST walk found no decorated handlers at all — it is broken"
    assert n == EXPECTED_ROUTES, f"source declares {n} routes, expected {EXPECTED_ROUTES}"
    assert len(_routes()) == EXPECTED_ROUTES


def test_every_route_is_paid_and_the_gate_is_PER_HANDLER():
    """The PARTITION, by dependency identity — the structural half.

    ⛔ ``router.dependencies == []`` IS LOAD-BEARING. ``main.py`` mounts this router
    with no router-level dependency (asserted in
    ``test_the_router_is_mounted_in_main_with_no_hoisted_gate``), so a per-handler
    gate is the ONLY gate there is. The day someone "simplifies" by hoisting it,
    every per-handler assertion below would keep passing for a route that declares
    none of its own — and this is what says so.
    """
    by_klass = {"paid": [], "admin": [], "open": []}
    for method, path, route in _pairs():
        by_klass[_klass(route)].append((method, path))

    assert len(by_klass["paid"]) == EXPECTED_ROUTES, by_klass
    assert by_klass["admin"] == [], (
        "a backtest route became admin-only. This surface spends LOCAL BARS, not "
        f"provider budget — admin here is a gate whose reason is false: {by_klass}")
    assert set(by_klass["open"]) == PUBLIC_BY_DESIGN, (
        "an un-gated route appeared. Unlike screener.py this surface has NO "
        f"documented public door: {by_klass['open']}")
    assert bt_mod.router.dependencies == [], "screener_backtest grew a router-level dependency"


def test_the_402_sentence_is_this_routers_own_and_no_siblings():
    """"Which surface locked me out" has to be readable off the message alone.

    ⛔ THE SWEEP IS DERIVED, over every module in ``api/routers/``, not a hand-list
    of the two neighbours — a fourth router copying this sentence tomorrow is the
    same defect and would slip past a pair check.
    """
    assert PAID_DETAIL in ROUTER_SRC.read_text(encoding="utf-8"), (
        "the 402 sentence changed — say so deliberately, it is what a refused "
        "member reads")
    echoes = [p.name for p in sorted((ROOT / "api" / "routers").glob("*.py"))
              if p.name != ROUTER_SRC.name
              and PAID_DETAIL in p.read_text(encoding="utf-8")]
    assert echoes == [], (
        f"{echoes} speak this router's 402 sentence — a member cannot tell which "
        "surface refused them")


# ─── the behavioural sweeps ──────────────────────────────────────────────────

def test_an_anonymous_caller_is_refused_on_EVERY_route(stub_services):
    """NO body and NO overrides — the real cookie path, an empty jar. Dependencies
    are solved before parameter validation, so a gated route answers 401 whatever
    it was or wasn't sent."""
    client = _client(None)
    seen = []
    for method, path, route in _pairs():
        url, kwargs = _request_kwargs(route, with_body=False)
        resp = client.request(method, url, **kwargs)
        assert resp.status_code == 401, (
            f"{method} {path} answered an ANONYMOUS caller {resp.status_code} — "
            f"{resp.text[:200]}")
        seen.append(f"{method} {path}")
    assert len(seen) == EXPECTED_ROUTES, seen
    assert sorted(seen) == sorted(set(seen)), seen


def test_a_FREE_member_is_refused_on_EVERY_route_with_THIS_routers_sentence(stub_services):
    """"Logged in" is not "paid", and the sentence is asserted so a route cannot
    pass by being refused for somebody else's reason."""
    client = _client(FREE_USER)
    for method, path, route in _pairs():
        url, kwargs = _request_kwargs(route, with_body=False)
        resp = client.request(method, url, **kwargs)
        assert resp.status_code == 402, (
            f"{method} {path} answered a FREE member {resp.status_code} — "
            f"{resp.text[:200]}")
        assert resp.json()["detail"] == PAID_DETAIL, (
            f"{method} {path} refused with someone else's sentence: "
            f"{resp.json().get('detail')!r}")


def test_a_PAID_member_still_gets_200_on_EVERY_route(stub_services):
    """⚠️ THE HALF THAT TELLS A GATE FROM AN OUTAGE. A sweep of refusals is
    satisfied by a router that refuses everybody."""
    client = _client(PAID_USER)
    for method, path, route in _pairs():
        url, kwargs = _request_kwargs(route, with_body=True)
        resp = client.request(method, url, **kwargs)
        assert resp.status_code == 200, (
            f"{method} {path} answered a PAID member {resp.status_code} — the gate "
            f"became an outage: {resp.text[:300]}")


def test_an_ADMIN_gets_200_everywhere_too(stub_services):
    """Admins are paid by ``is_paid_user`` (role first). Nothing here is
    admin-only, so an admin must simply be able to use the feature."""
    client = _client(ADMIN_USER)
    for method, path, route in _pairs():
        url, kwargs = _request_kwargs(route, with_body=True)
        resp = client.request(method, url, **kwargs)
        assert resp.status_code == 200, (
            f"{method} {path} answered an ADMIN {resp.status_code} — {resp.text[:300]}")


def test_a_TRIAL_member_is_treated_as_paid(stub_services, monkeypatch):
    """``is_paid_user`` is ``admin OR paid plan OR in-trial``. A gate that refuses
    the trial cohort is the same outage as one that refuses paid members, just
    quieter."""
    import api.services.trial as trial
    monkeypatch.setattr(trial, "is_account_in_trial", lambda user, now=None: True)
    client = _client({"id": "trial1", "role": "member", "plan": "free"})
    for method, path, route in _pairs():
        url, kwargs = _request_kwargs(route, with_body=True)
        resp = client.request(method, url, **kwargs)
        assert resp.status_code == 200, (
            f"{method} {path} refused a TRIAL member {resp.status_code} — "
            f"{resp.text[:300]}")


# ─── the seam between this rail and the one next door ────────────────────────

def test_exactly_TWO_router_modules_declare_an_api_screener_path():
    """⛔ THE GUARD THE SPLIT ACTUALLY NEEDS.

    Two rail files cover ``/api/screener/*``: ``tests/test_scan_screener_auth.py``
    (``screener.py``) and this one (``screener_backtest.py``). The risk that split
    creates is a THIRD screener surface landing in a module neither file walks —
    ungated, and green all the way. So the census is DERIVED: an AST pass over
    every module in ``api/routers/`` looking for a route decorator whose literal
    path starts with ``/api/screener/``.

    ⚠️ A grep would find the string in a docstring or a refusal message (this
    router's own 400 quotes the path back at the member). The walk reads the
    DECORATOR ARGUMENT, which is the only place a route can actually be declared.
    """
    verbs = {"get", "post", "put", "delete", "patch"}
    declarers: dict[str, list[str]] = {}
    for path in sorted((ROOT / "api" / "routers").glob("*.py")):
        try:
            tree = pyast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:                                      # pragma: no cover
            continue
        for node in pyast.walk(tree):
            if not isinstance(node, pyast.Call):
                continue
            f = node.func
            if not (isinstance(f, pyast.Attribute) and f.attr in verbs):
                continue
            for arg in node.args:
                if (isinstance(arg, pyast.Constant) and isinstance(arg.value, str)
                        and arg.value.startswith("/api/screener/")):
                    declarers.setdefault(path.name, []).append(arg.value)

    # The control: the walk CAN see route paths, so an empty answer is a broken
    # probe rather than a repo with no screener routes.
    assert declarers, "the AST census found no /api/screener/ route at all — broken"
    assert set(declarers) == {"screener.py", "screener_backtest.py"}, (
        "a THIRD module declares an /api/screener/ route. That is a new paid "
        "surface, and neither this file nor tests/test_scan_screener_auth.py is "
        f"looking at it: {sorted(declarers)}")


def test_the_router_is_mounted_in_main_with_no_hoisted_gate():
    """⛔ A ROUTER NOBODY MOUNTS IS THE built-tested-green-and-unreachable SHAPE.

    Read off ``api/main.py``'s AST rather than by importing the app (which boots
    schedulers and warmers): the ``include_router`` call must exist, and it must
    pass NO ``dependencies=`` — the per-handler gate above is the only gate, and a
    hoisted one would make every per-route assertion vacuous.
    """
    tree = pyast.parse((ROOT / "api" / "main.py").read_text(encoding="utf-8"))
    mounts = []
    for node in pyast.walk(tree):
        if not (isinstance(node, pyast.Call)
                and isinstance(node.func, pyast.Attribute)
                and node.func.attr == "include_router"):
            continue
        for arg in node.args:
            if (isinstance(arg, pyast.Attribute) and arg.attr == "router"
                    and isinstance(arg.value, pyast.Name)
                    and "screener_backtest" in arg.value.id):
                mounts.append(node)

    # The control: the walk sees include_router calls at all.
    all_mounts = [n for n in pyast.walk(tree)
                  if isinstance(n, pyast.Call)
                  and isinstance(n.func, pyast.Attribute)
                  and n.func.attr == "include_router"]
    assert len(all_mounts) > 10, "the AST walk found almost no include_router calls — broken"
    assert len(mounts) == 1, (
        "api/main.py does not mount screener_backtest.router exactly once — the "
        "whole surface is unreachable (or mounted twice)")
    assert not any(kw.arg == "dependencies" for kw in mounts[0].keywords), (
        "the mount grew a router-level `dependencies=` — the per-handler gate is "
        "no longer the only gate and every assertion above went vacuous")

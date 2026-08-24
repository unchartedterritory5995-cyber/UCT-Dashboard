"""THE SCREENER + SCANS LANE IS PAID, AND THE PROOF IS DERIVED FROM THE ROUTERS.

🔴 WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE. Sixteen endpoints served the firm's
proprietary whole-market scan output to anyone who could type the URL. Measured
against production 2026-08-08, before the gate landed:

    GET /api/scans/top-gainers-30d   -> 200, 18,892 bytes of ranked whole-market data
    GET /api/candidates              -> 200, 32,610 bytes (the UCT scanner candidates)

and `/api/screener/{meta,scan,snapshot-status,saved-screens}` were gated with
`get_current_user` ONLY — "logged in" is not "paid". Owner ruling 2026-08-06,
reaffirmed 08-07: *"everything is paid, almost nothing is accessible for free"*,
with a free trial granting paid access for a period (which `is_paid_user`
already honours: admin OR paid plan OR in-trial).

⛔ NOTHING HERE IS TYPED.

  * the (method, path) set comes out of `router.routes` for BOTH routers;
  * the COUNTS are asserted, so a router that stopped mounting cannot pass by
    iterating zero times and a TWENTY-SIXTH route cannot ride in uncovered;
  * the counts are CROSS-CHECKED against an independent oracle — an AST walk of
    the router SOURCE counting decorated handlers — because "the table I read"
    and "the file someone edits" are two different artifacts, and a route
    defined but not mounted is invisible to the first;
  * each route's CLASS (paid / admin / public-by-design) is read off
    `route.dependant.dependencies` by object identity, never off the source text;
  * and the path/query samples are validated against what the route DECLARES, so
    a new path param or a new required query param fails loudly instead of
    quietly turning a 200 assertion into a 422.

Phase C Task 13 MEASURED the alternative: it dropped `Depends(require_paid)`
from `/confluence` and the shipped test stayed GREEN, because the test
hand-listed THREE paths while the router had FIVE.

✋ ONE ROUTE IS DELIBERATELY OPEN — `GET /api/screener/shared/{share_token}`.
It is token-authenticated public sharing by DESIGN, not by omission: the token is
minted only when the owner sets `is_public`, `get_public` re-checks `is_public=1`,
the payload is a saved filter SPEC (no tickers, no prices, no scan output), and
`docs/superpowers/plans/2026-06-19-full-market-screener.md:1413` lists it as
"(public read)". Gating it would break every share link already in the wild —
an outage, not a fix. It is named ONCE, in `PUBLIC_BY_DESIGN`, whose size is
asserted, and it is checked BOTH ways: a valid token still answers a logged-out
recipient, and a junk token answers 404 rather than a record.

⚠️ AND THE PAID SIDE IS ASSERTED TOO. A sweep that only proves refusals cannot
tell a gate from an outage, so every route is also driven with a paid caller and
must answer 200. The service layer is stubbed for that pass — an UNSTUBBED call
shows up as a non-200 and fails, so the stub set polices itself instead of being
a hand-list that can rot.
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
from api.routers import scans as scans_mod
from api.routers import screener as screener_mod

ROOT = Path(__file__).resolve().parents[1]

#: ⛔ ASSERTED, NOT INFORMATIONAL. A seventeenth scan or a thirteenth screener
#: route must cost a DELIBERATE edit here, which is what makes it land covered.
#:
#: ⭐ 2026-08-09 — 15 → 16, AND THE RAIL WORKED EXACTLY AS DESIGNED. A master
#: merge added `/api/scans/period-change-coverage` (`f03d80fd`, the bars.db
#: coverage probe). The derived count went red, a human looked, and the answer
#: was: all 16 are gated, UNGATED == 0. Notably the new route arrived ALREADY
#: gated — once every route in the file carried `require_paid`, the next author
#: followed the pattern without being told. That is the gate teaching the file.
#:
#: This edit is the deliberate one the message above demands. It is NOT a
#: rubber stamp: the verification that preceded it was an AST walk over both
#: routers printing every route with its gate status, and it is the only reason
#: bumping this number is honest rather than a way to make a red test quiet.
EXPECTED_SCANS_ROUTES = 16
EXPECTED_SCREENER_ROUTES = 18  # +1 2026-08-23: POST /api/screener/finviz-refresh
#                              # +1 2026-08-24: POST /api/screener/count — the
#   pre-run match count (benchmark metric 450). ⛔ It is PAID like /scan and
#   takes the SAME ScanSpec, which is the reason it belongs behind the same
#   gate rather than reading as a harmless read: the spec can carry a `list`
#   filter naming the caller's own watchlists, so an ungated count route
#   would leak the row COUNTS of another member's list one probe at a time.
#                              # +3 2026-08-24: the screen-alert subscription
#   trio (GET/POST/DELETE /api/screener/alerts). PAID because a subscription
#   is a member's own row and the list route enumerates it -- an open GET
#   would hand out which screens somebody watches.
# (admin) — the missing upstream half of POST /api/screener/refresh. A header
# correction could not reach members until the next 02:45 ET pull; this makes
# 'wait for tonight' a two-call operation. Deliberate, and admin-classed below.
#
# +1 2026-08-23: GET /api/screener/earnings-context-status (admin). The
# DELIBERATE edit this rail demands, and the reason is a measurement:
# `implied_move_pct` and `earnings_setup_grade` are non-null on 0 of 3,745 prod
# rows and nothing could say why — `railway ssh` is blocked here and there was
# no HTTP surface over `implied_store`. The route is strictly read-only (every
# database opened `mode=ro`, no provider call) and admin-classed below beside
# the two refresh routes. It is NOT paid: it exposes store internals and job
# schedules, which is operator information, not member information.

#: The 402 sentence each router speaks. Asserted rather than imported so a quiet
#: edit to the message is a failure here and not a silent change to what a
#: refused member reads. They are DISTINCT on purpose — "which surface locked me
#: out" has to be readable off the message (the repo-wide rail on that is
#: `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`).
SCANS_PAID_DETAIL = "Scanner presets require a paid plan"
SCREENER_PAID_DETAIL = "The screener requires a paid plan"

#: ✋ THE ONLY DOOR THAT STAYS OPEN, AND IT IS ONE. See the module docstring.
PUBLIC_BY_DESIGN = {("GET", "/api/screener/shared/{share_token}")}

#: Sample values for every path parameter the routers declare. Validated against
#: the DECLARED params below, so a new one fails instead of 404-ing quietly.
SHARE_TOKEN = "tok-public-sample"
PATH_PARAM_SAMPLES = {"sid": "1", "share_token": SHARE_TOKEN,
                      # An unsubscribe for a hash nobody subscribed is a
                      # clean no-op (`removed: false`), which is what makes
                      # it safe to probe on every plan in this file.
                      "def_hash": "no_such_hash"}

#: Sample values for every REQUIRED query parameter. Same self-policing rule.
QUERY_PARAM_SAMPLES = {"start": 20260601, "end": 20260701, "group": "sector"}

#: Bodies for the paid 200 pass only. The refusal passes deliberately send NO
#: body: dependencies are solved BEFORE `request_params_to_args`, so a gated
#: route answers 402 whatever the body is, while an ungated one answers 422 (or
#: 200) — which is how a deleted gate is caught rather than hidden behind "the
#: happy path".
BODY_SAMPLES = {
    ("POST", "/api/screener/scan"): {"filters": [], "view": "overview"},
    # Same ScanSpec as /scan, deliberately — the count previews THAT spec,
    # so a body shape of its own would be a second grammar for one request.
    ("POST", "/api/screener/count"): {"filters": [], "view": "overview"},
    ("POST", "/api/screener/alerts"): {"def_hash": "h", "def_id": "d",
                                       "name": "S", "mode": "both"},
    ("POST", "/api/screener/saved-screens"): {"name": "n", "spec": {"filters": []}},
    ("PUT", "/api/screener/saved-screens/{sid}"): {"name": "n2"},
}


# ─── the derived route table ─────────────────────────────────────────────────

def _routes(router):
    """Every mounted route, READ OFF THE ROUTER.

    ⛔ `getattr(r, "methods", None)` and not an isinstance check: a `Mount` or a
    `WebSocketRoute` has no `methods`, and a type filter would have to name a
    class this file would then have to keep in step with FastAPI.
    """
    return [r for r in router.routes if getattr(r, "methods", None)]


def _http_methods(route):
    return sorted(route.methods - {"HEAD", "OPTIONS"})


def _dep_calls(route):
    return [d.call for d in route.dependant.dependencies]


def _klass(route) -> str:
    """paid / admin / open — BY OBJECT IDENTITY, never by reading the source."""
    calls = _dep_calls(route)
    if scans_mod.require_paid in calls or screener_mod.require_paid in calls:
        return "paid"
    if require_admin in calls:
        return "admin"
    return "open"


def _all_routes():
    """[(router_name, route)] for both routers, with the counts asserted."""
    scans_routes = _routes(scans_mod.router)
    screener_routes = _routes(screener_mod.router)
    assert len(scans_routes) == EXPECTED_SCANS_ROUTES, (
        f"api/routers/scans.py mounts {len(scans_routes)} routes — one was added "
        f"or removed. Update EXPECTED_SCANS_ROUTES DELIBERATELY.")
    assert len(screener_routes) == EXPECTED_SCREENER_ROUTES, (
        f"api/routers/screener.py mounts {len(screener_routes)} routes — one was "
        f"added or removed. Update EXPECTED_SCREENER_ROUTES DELIBERATELY.")
    return ([("scans", r) for r in scans_routes]
            + [("screener", r) for r in screener_routes])


def _pairs():
    """Every (router_name, method, path, route) the two routers expose."""
    out = []
    for name, r in _all_routes():
        for method in _http_methods(r):
            out.append((name, method, r.path, r))
    return out


def _request_kwargs(route, *, with_body: bool):
    """URL + kwargs for one route, derived from what the route DECLARES."""
    declared_path_params = set(re.findall(r"\{(\w+)\}", route.path))
    missing = declared_path_params - set(PATH_PARAM_SAMPLES)
    assert not missing, (
        f"{route.path} declares path params {sorted(missing)} with no sample — "
        "add them to PATH_PARAM_SAMPLES or the sweep silently 404s instead of "
        "measuring the gate")
    url = route.path
    for name in declared_path_params:
        url = url.replace("{" + name + "}", str(PATH_PARAM_SAMPLES[name]))

    params = {}
    for field in route.dependant.query_params:
        if not field.required:
            continue
        assert field.name in QUERY_PARAM_SAMPLES, (
            f"{route.path} requires query param {field.name!r} with no sample — "
            "add it to QUERY_PARAM_SAMPLES or the paid pass 422s and the 200 "
            "assertion stops meaning anything")
        params[field.name] = QUERY_PARAM_SAMPLES[field.name]

    kwargs = {"params": params} if params else {}
    if with_body:
        for method in _http_methods(route):
            body = BODY_SAMPLES.get((method, route.path))
            if body is not None:
                kwargs["json"] = body
    return url, kwargs


# ─── the app under test ──────────────────────────────────────────────────────

def _app():
    app = FastAPI()
    app.include_router(scans_mod.router)
    app.include_router(screener_mod.router)
    return app


def _client(user: dict | None):
    """A client for one caller.

    ⚠️ THE OVERRIDES ARE ON `get_current_user` / `get_current_user_with_plan`,
    WHICH ARE WHAT THE GATES DEPEND ON — never on `require_paid` or
    `require_admin` themselves. Overriding a gate means the test never runs the
    gate, which is the injected-dependency vacuity
    `lesson_injected_dependency_hides_the_fetch` names (996 green tests, 0 of 24
    charts). `user=None` overrides NOTHING, so an anonymous caller walks the real
    cookie path.
    """
    app = _app()
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


FREE_USER = {"id": "free1", "role": "member", "plan": "free"}
PAID_USER = {"id": "paid1", "role": "member", "plan": "pro"}
ADMIN_USER = {"id": "adm1", "role": "admin", "plan": "free"}


@pytest.fixture
def stub_services(monkeypatch):
    """Stub every service the two routers reach, so the paid pass measures THE
    GATE rather than the provider layer.

    ⛔ NOT a hand-list that can rot: the paid sweep drives EVERY route derived
    from the route table and asserts 200, so a service this forgets shows up as a
    non-200 and fails BY NAME. Adding a route with a new service call turns this
    red until the stub joins it.

    The modules are patched (`scan_volume.get_…`), not the router's names,
    because the handlers resolve them off the module at call time — which is also
    why `from … import` would have severed them (`lesson_from_import_severs_a_
    module_from_its_guards`). The two names `screener.py` DOES bind with
    `from … import` (`get_screener`, `get_candidates`) are patched on the router
    module, where they actually live.
    """
    from api.routers import screener as scr_router
    from api.services import breadth_monitor, scan_gainers, scan_ipo, scan_period, scan_volume
    from api.services.screener import (
        filters as scr_filters,
        query as scr_query,
        saved_screens as scr_saved,
        snapshot_builder,
        snapshot_db as scr_db,
    )

    sentinel = {"stubbed": True, "rows": []}

    monkeypatch.setattr(scan_volume, "get_highest_volume_1y", lambda: dict(sentinel))
    monkeypatch.setattr(scan_volume, "get_highest_volume_ever", lambda: dict(sentinel))
    monkeypatch.setattr(scan_volume, "status", lambda scan_id="1y": dict(sentinel))
    monkeypatch.setattr(scan_ipo, "get_ipo_last_1y", lambda: dict(sentinel))
    monkeypatch.setattr(scan_ipo, "status", lambda: dict(sentinel))
    monkeypatch.setattr(scan_gainers, "get_top_gainers_30d", lambda: dict(sentinel))
    monkeypatch.setattr(scan_gainers, "get_top_gainers_60d", lambda: dict(sentinel))
    monkeypatch.setattr(scan_gainers, "get_top_gainers_90d", lambda: dict(sentinel))
    monkeypatch.setattr(scan_gainers, "status", lambda pid="30d": dict(sentinel))
    monkeypatch.setattr(scan_period, "get_period_change",
                        lambda start_ymd, end_ymd: dict(sentinel))

    monkeypatch.setattr(scr_router, "get_screener", lambda: dict(sentinel))
    # `candidates` walks `result["candidates"].values()` and warms bars for every
    # symbol it finds — an empty mapping keeps the stub from reaching the bars
    # warmer, which is a different subsystem and not this file's subject.
    monkeypatch.setattr(scr_router, "get_candidates", lambda: {"candidates": {}})
    monkeypatch.setattr(breadth_monitor, "get_universe_stocks", lambda date_str=None: dict(sentinel))
    monkeypatch.setattr(scr_filters, "meta", lambda user_id=None: dict(sentinel))
    # ⛔ THE STUB TAKES `user_id` because the ROUTE PASSES IT — the `list`
    # filter resolves a member's own watchlists, and the id must come from the
    # authenticated dependency rather than the request body. A stub that
    # silently swallowed it (**_) would let the route stop passing it and this
    # file would stay green.
    monkeypatch.setattr(scr_query, "run_scan",
                        lambda spec, user_id=None: dict(sentinel, _user_id=user_id))
    monkeypatch.setattr(scr_query, "preview_count",
                        lambda spec, user_id=None: dict(sentinel, _user_id=user_id))
    monkeypatch.setattr(scr_db, "status", lambda: dict(sentinel))
    monkeypatch.setattr(snapshot_builder, "run_build", lambda max_tickers=800: None)

    shared_record = {"id": 7, "name": "shared screen", "spec": {"filters": []},
                     "is_public": True, "share_token": SHARE_TOKEN}
    monkeypatch.setattr(scr_saved, "init", lambda: None)
    monkeypatch.setattr(scr_saved, "list_for", lambda uid: [])
    monkeypatch.setattr(scr_saved, "starters", lambda: [])
    monkeypatch.setattr(scr_saved, "create",
                        lambda uid, name, spec, is_public=False: {"id": 1, "name": name})
    monkeypatch.setattr(scr_saved, "update",
                        lambda sid, uid, **f: {"id": int(sid), "name": "n2"})
    monkeypatch.setattr(scr_saved, "delete", lambda sid, uid: True)
    # The token IS the credential: only the sample token resolves.
    monkeypatch.setattr(scr_saved, "get_public",
                        lambda tok: dict(shared_record) if tok == SHARE_TOKEN else None)
    return sentinel


# ─── the counts, and an INDEPENDENT oracle on them ───────────────────────────

def test_the_route_counts_are_what_the_router_SOURCE_declares():
    """⛔ THE MOUNTED TABLE AND THE FILE ARE TWO ARTIFACTS.

    Every other assertion in this file reads `router.routes`. If a handler were
    defined but never mounted (a decorator on the wrong router object, a route
    added inside a dead branch), the table would be short and every sweep below
    would pass while the source told a different story. So the counts are
    cross-checked against an AST walk of the SOURCE that counts decorated
    handlers — the shape `tests/test_user_definitions_auth.py` uses to keep one
    number honest across three files.
    """
    verbs = {"get", "post", "put", "delete", "patch", "head", "options"}
    counted = {}
    for name, path in (("scans", ROOT / "api" / "routers" / "scans.py"),
                       ("screener", ROOT / "api" / "routers" / "screener.py")):
        tree = pyast.parse(path.read_text(encoding="utf-8"))
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
        counted[name] = n

    # The control: the walk CAN see decorators, so a zero is a broken scan rather
    # than a router that stopped declaring routes.
    assert all(v > 0 for v in counted.values()), counted
    assert counted["scans"] == EXPECTED_SCANS_ROUTES, counted
    assert counted["screener"] == EXPECTED_SCREENER_ROUTES, counted


def test_every_route_is_paid_except_the_one_admin_route_and_the_one_public_door():
    """The PARTITION, derived by dependency identity — the structural half.

    ⛔ `router.dependencies == []` IS LOAD-BEARING. `main.py` mounts both routers
    with no router-level dependency, so a per-handler gate is the only gate there
    is; the day someone "simplifies" by hoisting it, every per-handler assertion
    below would keep passing for a route that declares none of its own, and this
    is what says so.
    """
    by_klass = {"paid": [], "admin": [], "open": []}
    for name, route in _all_routes():
        by_klass[_klass(route)].append((name, sorted(route.methods - {"HEAD", "OPTIONS"})[0],
                                        route.path))

    # -4: the three admin routes + the one public door. Both asserts below NAME
    # their members rather than trusting this count.
    assert len(by_klass["paid"]) == EXPECTED_SCANS_ROUTES + EXPECTED_SCREENER_ROUTES - 4, \
        by_klass
    # BOTH halves of the manual-refresh pair are admin and neither may drift to
    # paid: each spends provider budget on a whole-market call. The
    # earnings-context diagnostic is admin for a different reason — it spends
    # nothing, but it reports store paths, job schedules and raw coverage, which
    # is operator information. Either way the direction is the same: STRICTER
    # than paid, never weaker.
    assert sorted((m, p) for _, m, p in by_klass["admin"]) == [
        ("GET", "/api/screener/earnings-context-status"),
        ("POST", "/api/screener/finviz-refresh"),
        ("POST", "/api/screener/refresh"),
    ], \
        by_klass["admin"]
    assert {(m, p) for _, m, p in by_klass["open"]} == PUBLIC_BY_DESIGN, (
        "the set of un-gated routes changed. If a route was deliberately opened, "
        "say so in PUBLIC_BY_DESIGN and in the router docstring; if not, it is "
        f"the hole this file exists to close: {by_klass['open']}")
    assert len(PUBLIC_BY_DESIGN) == 1, (
        "a SECOND public route joined the one documented exception — that is a "
        "paywall decision, not a refactor")

    # …and each paid route carries its OWN router's gate, not the sibling's.
    for name, route in _all_routes():
        if _klass(route) != "paid":
            continue
        own = scans_mod.require_paid if name == "scans" else screener_mod.require_paid
        assert own in _dep_calls(route), (
            f"{sorted(route.methods)} {route.path} is gated by the OTHER router's "
            "require_paid — the shared gate the shipped pattern refuses")

    assert scans_mod.router.dependencies == [], "scans grew a router-level dependency"
    assert screener_mod.router.dependencies == [], "screener grew a router-level dependency"


# ─── the behavioural sweeps ──────────────────────────────────────────────────

def test_an_anonymous_caller_is_refused_on_EVERY_route_except_the_public_door(stub_services):
    """🔴 THE MEASUREMENT THIS CLOSES: `GET /api/scans/top-gainers-30d` answered
    an anonymous caller 200 with 18,892 bytes of ranked whole-market data.

    NO body and NO overrides — the real cookie path, an empty jar. Dependencies
    are solved before parameter validation, so a gated route answers 401 whatever
    it was or wasn't sent.
    """
    client = _client(None)
    seen = []
    for name, method, path, route in _pairs():
        url, kwargs = _request_kwargs(route, with_body=False)
        resp = client.request(method, url, **kwargs)
        if (method, path) in PUBLIC_BY_DESIGN:
            assert resp.status_code == 200, (
                f"{method} {path} is the documented public share door and it "
                f"answered {resp.status_code} — every share link in the wild just "
                "broke")
        else:
            assert resp.status_code == 401, (
                f"{method} {path} answered an ANONYMOUS caller {resp.status_code} "
                f"— {resp.text[:200]}")
        seen.append(f"{method} {path}")

    assert len(seen) == EXPECTED_SCANS_ROUTES + EXPECTED_SCREENER_ROUTES, seen
    assert sorted(seen) == sorted(set(seen)), seen


def test_a_FREE_member_is_refused_on_EVERY_route_with_THIS_routers_sentence(stub_services):
    """"Logged in" is not "paid" — the half `/api/screener/scan` was missing.

    The 402 sentence is asserted per router, so a route cannot pass by being
    refused for somebody else's reason (the wrong-door defect this branch has hit
    four times: a correct refusal from the wrong guard).
    """
    client = _client(FREE_USER)
    seen = []
    for name, method, path, route in _pairs():
        url, kwargs = _request_kwargs(route, with_body=False)
        resp = client.request(method, url, **kwargs)
        if (method, path) in PUBLIC_BY_DESIGN:
            assert resp.status_code == 200, f"{method} {path} -> {resp.status_code}"
        elif _klass(route) == "admin":
            assert resp.status_code == 403, (
                f"{method} {path} answered a free member {resp.status_code}; the "
                "admin route must be STRICTER than paid, not weaker")
        else:
            assert resp.status_code == 402, (
                f"{method} {path} answered a FREE member {resp.status_code} — "
                f"{resp.text[:200]}")
            expected = SCANS_PAID_DETAIL if name == "scans" else SCREENER_PAID_DETAIL
            assert resp.json()["detail"] == expected, (
                f"{method} {path} refused with someone else's sentence: "
                f"{resp.json().get('detail')!r}")
        seen.append(f"{method} {path}")

    assert len(seen) == EXPECTED_SCANS_ROUTES + EXPECTED_SCREENER_ROUTES, seen


def test_a_PAID_member_still_gets_200_on_EVERY_route(stub_services):
    """⚠️ THE HALF THAT TELLS A GATE FROM AN OUTAGE.

    A sweep of refusals is satisfied by a router that refuses everybody. Every
    route is driven with a paid caller and must answer 200 — the admin route
    excepted, which must answer 403 to a paid non-admin because it is the one
    route that spends provider budget.
    """
    client = _client(PAID_USER)
    for name, method, path, route in _pairs():
        url, kwargs = _request_kwargs(route, with_body=True)
        resp = client.request(method, url, **kwargs)
        if _klass(route) == "admin":
            assert resp.status_code == 403, f"{method} {path} -> {resp.status_code}"
        else:
            assert resp.status_code == 200, (
                f"{method} {path} answered a PAID member {resp.status_code} — the "
                f"gate became an outage: {resp.text[:300]}")


def test_an_ADMIN_gets_200_everywhere_including_the_refresh_route(stub_services):
    """Admins are paid by `is_paid_user` (role first), and the one admin route
    answers them — otherwise the strictest door would be shut to everybody."""
    client = _client(ADMIN_USER)
    for name, method, path, route in _pairs():
        url, kwargs = _request_kwargs(route, with_body=True)
        resp = client.request(method, url, **kwargs)
        assert resp.status_code == 200, (
            f"{method} {path} answered an ADMIN {resp.status_code} — {resp.text[:300]}")


def test_a_TRIAL_member_is_treated_as_paid(stub_services, monkeypatch):
    """The owner's ruling includes *"a free trial granting paid access for a
    period"*. `is_paid_user` is `admin OR paid plan OR in-trial`, so a trialling
    member must pass the new gates — asserted here rather than assumed, because a
    gate that refuses the trial cohort is the same outage as one that refuses
    paid members, just quieter.
    """
    import api.services.trial as trial
    monkeypatch.setattr(trial, "is_account_in_trial", lambda user, now=None: True)
    client = _client({"id": "trial1", "role": "member", "plan": "free"})
    for name, method, path, route in _pairs():
        if _klass(route) == "admin":
            continue
        url, kwargs = _request_kwargs(route, with_body=True)
        resp = client.request(method, url, **kwargs)
        assert resp.status_code == 200, (
            f"{method} {path} refused a TRIAL member {resp.status_code} — "
            f"{resp.text[:300]}")


# ─── the one public door, checked BOTH ways ──────────────────────────────────

def test_the_public_share_door_needs_a_REAL_token_and_serves_no_scan_output(stub_services):
    """✋ CONFIRMING THE EXCEPTION RATHER THAN ASSUMING IT.

    An honest exception has to be shown to be one:
      * a VALID token answers a logged-out recipient 200 — the share links in the
        wild keep working, which is why this route was left open;
      * a JUNK token answers 404, so the token is a credential and not decoration
        (`get_public` re-checks `is_public=1` in the same WHERE clause);
      * and the payload is a saved filter SPEC — no ticker rows, no prices. A
        recipient still needs a paid plan to RUN it, because `/api/screener/scan`
        is gated by the sweeps above.
    """
    client = _client(None)
    ok = client.get(f"/api/screener/shared/{SHARE_TOKEN}")
    assert ok.status_code == 200, ok.text[:200]
    body = ok.json()
    assert set(body["spec"]) <= {"filters", "view", "sort"}, body
    assert "rows" not in body and "results" not in body, (
        "the share door started serving scan OUTPUT — it may only serve a spec")

    junk = client.get("/api/screener/shared/not-a-real-token")
    assert junk.status_code == 404, (
        f"an invalid share token answered {junk.status_code} — the token is not "
        "acting as a credential")

"""TERM-026 (FB-S9-01) -- the auth-surface auditor SEES A GET, and publishes its
denominator.

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
`api/auth_surface_check.py` audited MUTATING methods only
(`MUTATING = {"POST","PUT","PATCH","DELETE"}`), so the one instrument that looks
at the auth surface was structurally blind to the class it exists for: an
unauthenticated GET of member or vendor data (anti-patterns GATE-7, "the
sharpest 'no detector' in the library"). And it printed a count with no
population, so "0 ungated" could not be told apart from "examined nothing".

THE RAIL HAS FOUR HALVES, AND EACH FAILS FOR A DIFFERENT REASON
---------------------------------------------------------------
1. APERTURE -- a fixture unauthenticated GET is REPORTED, beside the
   mutating-only view that is still blind to it on the same fixture (the
   contrast is the whole finding, kept as an executable fact).
2. DENOMINATOR -- the population is DERIVED from the route table, never typed:
   the test recounts it independently off `app.routes` and requires agreement.
3. BASELINE / RATCHET -- routes that are open TODAY are recorded by name with a
   reason in `api/auth_surface_read_baseline.json`. A NEW open read is a
   finding; a recorded entry that stopped being true (now gated, or gone) is
   STALE and also a finding, so the list can only shrink deliberately.
4. GATE -- the CLI exits non-zero on a finding and refuses (exit 2) a run that
   examined nothing.

Nothing here sends a request: an anonymous probe is only safe when the gate
works, and RUNS the handler in the one case this exists to catch
(`lesson_never_probe_a_mutating_endpoint_to_test_auth` -- and several recorded
GETs here are write-shaped, e.g. `/api/breadth-monitor/live/store`).
"""
from __future__ import annotations

import io
import os
import sys
from contextlib import redirect_stdout

import pytest
from fastapi import APIRouter, Depends, FastAPI

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api import auth_surface_check as asc  # noqa: E402

FIXTURE_PATH = "/api/terminal/quote"


def _bare() -> FastAPI:
    """A FastAPI app with NO default docs routes -- `/openapi.json`, `/docs` and
    `/redoc` are themselves unauthenticated GETs, and a fixture that carried
    them would not be a population of one."""
    return FastAPI(openapi_url=None, docs_url=None, redoc_url=None)


def get_current_user():          # a gate, by NAME -- the auditor's own identity rule
    return {"id": "u"}


def _app(*, gated: bool = False, method: str = "get", path: str = FIXTURE_PATH):
    app = _bare()
    r = APIRouter()
    deps = [Depends(get_current_user)] if gated else []
    getattr(r, method)(path, dependencies=deps)(lambda: {"ok": True})
    app.include_router(r)
    return app


# ── 1. APERTURE ──────────────────────────────────────────────────────────────

def test_a_fixture_UNAUTHENTICATED_GET_is_reported():
    res = asc.audit_surface(_app(), baseline={})
    assert ("GET", FIXTURE_PATH) in res["reads"]["ungated"], res["reads"]
    assert res["ok"] is False


def test_the_MUTATING_ONLY_view_is_still_blind_to_the_same_fixture():
    """The contrast that is TERM-026. `audit_routes` keeps its narrow job (it
    decides what pages at boot); the SAME fixture is invisible to it and visible
    to `audit_surface`. If both ever agree on "0", the aperture has closed again."""
    app = _app()
    narrow = asc.audit_routes(app)
    wide = asc.audit_surface(app, baseline={})
    assert narrow["checked"] == 0 and narrow["ungated"] == []
    assert wide["reads"]["examined"] == 1
    assert wide["reads"]["ungated"] == [("GET", FIXTURE_PATH)]


def test_a_GATED_GET_is_not_reported():
    res = asc.audit_surface(_app(gated=True), baseline={})
    assert res["reads"]["ungated"] == []
    assert res["reads"]["gated"] == 1
    assert res["ok"] is True


def test_the_chart_gate_run_on_its_own_limiter_is_GATED_by_identity_and_a_look_alike_name_is_not():
    """(2026-11-25) `/api/bars-history` (#2741) runs `require_bars_access` in a thread on its own limiter, so
    the gate is called, not `Depends`-ed. Its dependency is a `bars_auth.require_bars_access_on(...)` product,
    and the census counts it as `require_bars_access` by IDENTITY. A hand-built async dependency with the same
    NAME and no gate stays an open read: a name rule would have turned master green and hidden it."""
    from fastapi import Cookie, Header
    from api import bars_auth

    async def _run(request, fn, *args):
        return fn(*args)

    real = bars_auth.require_bars_access_on(_run, "require_bars_access_history")

    # (no `request: Request` parameter: this module's annotations are strings and `Request` is not one of its
    # globals; the census reads the dependency object and its name, never its signature)
    async def require_bars_access_history(uct_session: str | None = Cookie(None),
                                          authorization: str = Header(default="")) -> dict:
        return {"id": "anyone"}

    assert real.__name__ == require_bars_access_history.__name__
    app = _bare()
    r = APIRouter()
    r.get("/api/bars-history/{ticker}", dependencies=[Depends(real)])(lambda ticker: {"ok": True})
    r.get("/api/look-alike/{ticker}", dependencies=[Depends(require_bars_access_history)])(
        lambda ticker: {"ok": True})
    app.include_router(r)
    res = asc.audit_surface(app, baseline={})
    assert ("GET", "/api/bars-history/{ticker}") not in res["reads"]["ungated"], res["reads"]
    assert ("GET", "/api/look-alike/{ticker}") in res["reads"]["ungated"], (
        "a dependency that merely carries the product's NAME counts as a gate: the census reads names, and any "
        "function called require_bars_access_* opens a route", res["reads"])
    assert "require_bars_access" in asc._guard_names_for(app.routes[0])


def test_HEAD_is_a_read_and_is_examined():
    res = asc.audit_surface(_app(method="head"), baseline={})
    assert ("HEAD", FIXTURE_PATH) in res["reads"]["ungated"]


def test_a_read_anywhere_in_the_app_is_examined_not_only_the_audited_prefixes():
    """The terminal lives under many prefixes. The read aperture is the WHOLE
    route table; `AUDITED_PREFIXES` scopes the mutating verdict only."""
    path = "/api/some-prefix-nobody-listed/data"
    assert not path.startswith(asc.AUDITED_PREFIXES)
    res = asc.audit_surface(_app(path=path), baseline={})
    assert ("GET", path) in res["reads"]["ungated"]


# ── 2. DENOMINATOR ───────────────────────────────────────────────────────────

def _independent_total(app) -> int:
    """(method, path) pairs, counted without the auditor's help."""
    return sum(len(getattr(r, "methods", None) or ()) for r in app.routes)


def test_the_denominator_is_derived_from_the_route_table():
    app = _app()
    res = asc.audit_surface(app, baseline={})
    assert res["routes_total"] == _independent_total(app)
    assert sum(res["by_method"].values()) == res["routes_total"]
    assert res["examined"] <= res["routes_total"]


def test_the_read_buckets_CLOSE_over_what_was_examined():
    """Every examined read lands in exactly one bucket -- a read that falls
    through every bucket is a read nobody classified, which is the failure."""
    app = _bare()
    r = APIRouter()
    r.get("/api/a", dependencies=[Depends(get_current_user)])(lambda: 1)
    r.get("/api/b")(lambda: 1)
    r.get("/api/c")(lambda: 1)
    app.include_router(r)
    base = {("GET", "/api/c"): {"kind": "open", "reason": "fixture"}}
    reads = asc.audit_surface(app, baseline=base)["reads"]
    parts = (reads["gated"] + reads["middleware_gated"] + reads["delegated"]
             + sum(reads["recorded"].values()) + len(reads["ungated"]))
    assert parts == reads["examined"] == 3


# ── 3. BASELINE / RATCHET ────────────────────────────────────────────────────

def test_a_RECORDED_open_read_is_counted_not_reported_as_new():
    base = {("GET", FIXTURE_PATH): {"kind": "open", "reason": "fixture"}}
    res = asc.audit_surface(_app(), baseline=base)
    assert res["reads"]["ungated"] == []
    assert res["reads"]["recorded"]["open"] == 1
    assert res["ok"] is True


def test_a_recorded_entry_for_a_route_that_is_now_GATED_is_stale():
    base = {("GET", FIXTURE_PATH): {"kind": "open", "reason": "fixture"}}
    res = asc.audit_surface(_app(gated=True), baseline=base)
    assert ("GET", FIXTURE_PATH) in res["stale_baseline"]
    assert res["ok"] is False


def test_a_recorded_entry_for_a_route_that_is_GONE_is_stale():
    base = {("GET", "/api/removed"): {"kind": "open", "reason": "fixture"}}
    res = asc.audit_surface(_app(gated=True), baseline=base)
    assert ("GET", "/api/removed") in res["stale_baseline"]


def _marker_app(body_calls_gate: bool):
    """A handler whose inline gate is a real CALL, or only a COMMENT."""
    app = _bare()
    r = APIRouter()
    if body_calls_gate:
        def handler():
            _inline_gate_fixture()
            return 1
    else:
        def handler():
            # _inline_gate_fixture()   <- a comment is not a gate
            return 1
    r.get(FIXTURE_PATH)(handler)
    app.include_router(r)
    return app


def _inline_gate_fixture():
    return None


# Needle built by concatenation, so this file's own source is not a hit for it.
_MARKER = "_inline_gate" + "_fixture"


def test_an_INLINE_entry_is_honoured_while_its_marker_is_in_the_handler():
    base = {("GET", FIXTURE_PATH): {"kind": "inline", "reason": "fixture",
                                    "marker": _MARKER}}
    res = asc.audit_surface(_marker_app(True), baseline=base)
    assert res["reads"]["recorded"]["inline"] == 1, res
    assert res["inline_marker_missing"] == []
    assert res["ok"] is True


def test_an_INLINE_entry_whose_marker_survives_ONLY_IN_A_COMMENT_is_a_finding():
    base = {("GET", FIXTURE_PATH): {"kind": "inline", "reason": "fixture",
                                    "marker": _MARKER}}
    res = asc.audit_surface(_marker_app(False), baseline=base)
    assert ("GET", FIXTURE_PATH) in res["inline_marker_missing"]
    assert res["ok"] is False


def test_the_marker_reader_strips_comments_and_can_still_see_a_real_call():
    """Non-vacuity for the literal hunt: the reader must SEE the call when it is
    code (control) and must NOT see it when it is only a comment."""
    sees = asc._handler_mentions
    code_app, comment_app = _marker_app(True), _marker_app(False)
    ep_code = next(r.endpoint for r in code_app.routes if r.path == FIXTURE_PATH)
    ep_comment = next(r.endpoint for r in comment_app.routes if r.path == FIXTURE_PATH)
    assert sees(ep_code, _MARKER) is True
    assert sees(ep_comment, _MARKER) is False


# ── 4. THE REAL APP, AND THE GATE ────────────────────────────────────────────

@pytest.fixture(scope="module")
def real_app():
    from api.main import app
    return app


def test_the_SERVED_app_has_no_UNRECORDED_open_read_and_no_stale_entry(real_app):
    res = asc.audit_surface(real_app)
    assert res["reads"]["examined"] > 0, "examined nothing -- vacuous"
    assert res["reads"]["ungated"] == [], (
        "NEW unauthenticated read(s) with no gate in the dependency tree and no "
        "baseline entry. Gate them, or record each one in "
        "api/auth_surface_read_baseline.json with a reason:\n  "
        + "\n  ".join(f"{m} {p}" for m, p in res["reads"]["ungated"]))
    assert res["stale_baseline"] == [], (
        "baseline entries that are no longer true (now gated, or gone) -- "
        "remove them so the ratchet only moves down:\n  "
        + "\n  ".join(f"{m} {p}" for m, p in res["stale_baseline"]))
    assert res["inline_marker_missing"] == []
    assert res["mutating"]["ungated"] == []
    assert res["ok"] is True


def test_the_SERVED_app_denominator_is_derived_and_nontrivial(real_app):
    res = asc.audit_surface(real_app)
    assert res["routes_total"] == _independent_total(real_app)
    assert res["by_method"].get("GET", 0) > 100      # a floor, not a typed count
    assert res["examined"] == res["reads"]["examined"] + res["mutating"]["checked"]
    # EVERY read in the table is examined (or shadowed by an earlier
    # registration): the aperture is pinned to the DERIVED population.
    reads_in_table = sum(res["by_method"].get(m, 0) for m in ("GET", "HEAD"))
    assert res["reads"]["examined"] + res["reads"]["shadowed"] == reads_in_table


def test_a_baseline_entry_the_census_can_no_longer_SEE_is_stale():
    """A recorded GET that falls outside the aperture (because the aperture
    shrank) must not vanish quietly -- it is stale, which is what makes the
    baseline a floor on the aperture itself."""
    base = {("GET", FIXTURE_PATH): {"kind": "open", "reason": "fixture"},
            ("TRACE", "/api/x"): {"kind": "open", "reason": "fixture"}}
    res = asc.audit_surface(_app(), baseline=base)
    assert ("TRACE", "/api/x") in res["stale_baseline"]
    assert res["ok"] is False


def test_every_baseline_entry_has_a_known_kind_and_a_reason():
    base = asc.load_read_baseline()
    assert base, "baseline did not load -- every open read would be a finding"
    for key, entry in base.items():
        assert entry["kind"] in asc.BASELINE_KINDS, key
        assert entry.get("reason", "").strip(), key
        if entry["kind"] == "inline":
            assert entry.get("marker", "").strip(), key


# ── the CLI ──────────────────────────────────────────────────────────────────

def _run_cli(app):
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "tools"))
    import auth_surface_audit
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = auth_surface_audit.main([], app=app, baseline={})
    return code, buf.getvalue()


def test_the_CLI_exits_NONZERO_and_names_the_route_on_a_finding():
    code, out = _run_cli(_app())
    assert code == 1
    assert f"GET {FIXTURE_PATH}" in out


def test_the_CLI_exits_zero_on_a_clean_app_and_prints_examined_over_total():
    app = _app(gated=True)
    code, out = _run_cli(app)
    assert code == 0, out
    assert f"examined 1/{_independent_total(app)}" in out


def test_the_CLI_REFUSES_a_run_that_examined_nothing():
    code, out = _run_cli(_bare())
    assert code == 2, out


# ── requires_dist: static routes that exist only when app/dist is built ──────


def _dist_app(*, catch_all: bool, robots: bool):
    app = _bare()
    if robots:
        app.get("/robots.txt")(lambda: "")
    if catch_all:
        app.get(asc.SPA_CATCH_ALL)(lambda full_path: "")
    return app


_DIST_BASELINE = {
    ("GET", "/robots.txt"): {"kind": "public", "requires_dist": True, "reason": "r"},
}


def test_a_requires_dist_entry_is_NOT_stale_when_no_bundle_is_served():
    """A checkout with no built frontend registers none of the static routes;
    their baseline entries must not read as stale there."""
    res = asc.audit_surface(_dist_app(catch_all=False, robots=False),
                            baseline=_DIST_BASELINE)
    assert res["stale_baseline"] == []


def test_a_requires_dist_entry_IS_stale_when_the_bundle_is_served_without_it():
    """The exemption is not a blanket: with the SPA catch-all present the app IS
    serving the bundle, so a missing static route is a real change and stale."""
    res = asc.audit_surface(_dist_app(catch_all=True, robots=False),
                            baseline=_DIST_BASELINE)
    assert ("GET", "/robots.txt") in res["stale_baseline"]
    assert res["ok"] is False


def test_CONTROL_a_plain_entry_is_stale_whether_or_not_a_bundle_is_served():
    plain = {("GET", "/robots.txt"): {"kind": "public", "reason": "r"}}
    res = asc.audit_surface(_dist_app(catch_all=False, robots=False), baseline=plain)
    assert ("GET", "/robots.txt") in res["stale_baseline"]


# ── 6. NAMED ROUTERS: every route declares its audience, reads AND writes ────
#
# The read census above covers every GET in the app; the mutating verdict only
# looks under `AUDITED_PREFIXES`. For the routers named here BOTH halves are
# held, route by route: a guard dependency, the staged read gate's table, a
# recorded baseline entry, the installed admin middleware, or (writes only) an
# inline gate the handler's own code calls. A route added to one of these
# routers with none of them is a finding, by name.

#: module -> the inline gate its mutating handlers call (None = it has none, so
#: every mutating route there must carry a guard dependency).
AUDIENCE_DECLARED_ROUTERS: dict[str, str | None] = {
    "api.schwab_router": None,
    "api.liveflow_router": None,
    "api.routers.intradaypack_router": None,
    "api.routers.intelligence": None,
    "api.routers.breadth_monitor": "_check_auth",
}


def _audience_of(route, method, *, baseline, mw_prefixes, inline_marker):
    """How this (route, method) declares who may call it, or None."""
    from api import open_reads_gate as org
    path = getattr(route, "path", "") or ""
    names = asc._guard_names_for(route)
    if names & asc.GUARD_NAMES:
        return "dependency"
    if mw_prefixes and path.startswith(mw_prefixes):
        return "middleware"
    if method in asc.READ_METHODS:
        if asc.READ_GATE_NAME in names and org.family_of(path):
            return "staged-read-gate"
        entry = baseline.get((method, path))
        if entry and entry.get("kind") in asc.BASELINE_KINDS and entry.get("reason", "").strip():
            return "baseline"
        return None
    if (method, path) in asc.ALLOWED_OPEN:
        return "allowed-open"
    if inline_marker and asc._handler_mentions(getattr(route, "endpoint", None), inline_marker):
        return "inline"
    return None


def _undeclared(app, routers, baseline):
    mw = asc.middleware_guarded_prefixes(app)
    seen, missing, examined = set(), [], 0
    for route in getattr(app, "routes", []):
        mod = getattr(getattr(route, "endpoint", None), "__module__", None)
        if mod not in routers:
            continue
        for method in sorted((getattr(route, "methods", None) or set()) - {"OPTIONS"}):
            key = (method, getattr(route, "path", ""))
            if key in seen:
                continue
            seen.add(key)
            examined += 1
            if _audience_of(route, method, baseline=baseline, mw_prefixes=mw,
                            inline_marker=routers[mod]) is None:
                missing.append(key)
    return sorted(missing), examined


def test_every_route_of_the_named_routers_declares_its_audience(real_app):
    missing, examined = _undeclared(real_app, AUDIENCE_DECLARED_ROUTERS,
                                    asc.load_read_baseline())
    assert examined > 80, f"examined only {examined} routes -- the walk is not reaching the routers"
    assert missing == [], (
        "route(s) with no declared audience (add a guard dependency, or record "
        "the read in the baseline with a reason):\n  "
        + "\n  ".join(f"{m} {p}" for m, p in missing))


def test_every_named_router_is_really_served(real_app):
    """A module name that matches nothing would make the rail above vacuous for it."""
    served = {getattr(getattr(r, "endpoint", None), "__module__", None) for r in real_app.routes}
    assert set(AUDIENCE_DECLARED_ROUTERS) <= served, sorted(set(AUDIENCE_DECLARED_ROUTERS) - served)


def _named_router_fixture(*, gated: bool, inline: bool = False):
    app = _bare()
    r = APIRouter()
    deps = [Depends(get_current_user)] if gated else []
    if inline:
        def write():
            _inline_gate_fixture()
            return 1
    else:
        def write():
            return 1

    def read():
        return 1
    write.__module__ = read.__module__ = "fixture.named_router"
    r.post("/api/fixture/write", dependencies=deps)(write)
    r.get("/api/fixture/read", dependencies=deps)(read)
    app.include_router(r)
    return app


def test_CONTROL_an_undeclared_write_and_read_in_a_named_router_are_both_reported():
    routers = {"fixture.named_router": None}
    missing, examined = _undeclared(_named_router_fixture(gated=False), routers, {})
    assert examined == 2
    assert missing == [("GET", "/api/fixture/read"), ("POST", "/api/fixture/write")]
    assert _undeclared(_named_router_fixture(gated=True), routers, {}) == ([], 2)


def test_CONTROL_an_inline_gate_counts_for_a_write_only_while_the_code_calls_it():
    routers = {"fixture.named_router": _MARKER}
    base = {("GET", "/api/fixture/read"): {"kind": "public", "reason": "fixture"}}
    assert _undeclared(_named_router_fixture(gated=False, inline=True), routers, base)[0] == []
    assert _undeclared(_named_router_fixture(gated=False, inline=False), routers, base)[0] == [
        ("POST", "/api/fixture/write")]

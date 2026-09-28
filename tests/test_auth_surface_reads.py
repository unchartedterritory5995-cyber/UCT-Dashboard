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

"""The boot-time auth-surface audit must actually catch an ungated route.

The static source test proves the code is right; this proves the RUNNING app is.
The distinction is real because the flow surface is proxied — a gate added on
web never reaches the flow-worker's copy without its own deploy.
"""
from fastapi import APIRouter, Depends, FastAPI

from api import auth_surface_check as asc


def _require_flow_admin():        # stands in for the real guard, by NAME
    return {"admin": True}


def _build(gated: bool, method: str = "post", path: str = "/api/flow/danger"):
    app = FastAPI()
    r = APIRouter()
    deps = [Depends(_require_flow_admin)] if gated else []
    getattr(r, method)(path, dependencies=deps)(lambda: {"ok": True})
    app.include_router(r)
    return app


def test_flags_an_ungated_mutating_route():
    res = asc.audit_routes(_build(gated=False))
    assert res["ok"] is False
    assert ("POST", "/api/flow/danger") in res["ungated"]


def test_accepts_a_gated_mutating_route(monkeypatch):
    monkeypatch.setattr(asc, "GUARD_NAMES", {"_require_flow_admin"})
    res = asc.audit_routes(_build(gated=True))
    assert res["ok"] is True, f"a correctly gated route was reported open: {res}"


def test_finds_a_guard_nested_below_the_top_level(monkeypatch):
    """Gates are usually nested — router-level Depends, or a guard that itself
    Depends on get_current_user. Only checking depth 1 would report a properly
    protected route as wide open and cry wolf until people ignore the alert."""
    monkeypatch.setattr(asc, "GUARD_NAMES", {"_require_flow_admin"})

    def _outer(_u=Depends(_require_flow_admin)):
        return _u

    app = FastAPI()
    r = APIRouter()
    r.post("/api/flow/danger", dependencies=[Depends(_outer)])(lambda: {"ok": True})
    app.include_router(r)
    assert asc.audit_routes(app)["ok"] is True


def test_ignores_read_only_routes():
    app = FastAPI()
    r = APIRouter()
    r.get("/api/flow/data")(lambda: {"ok": True})
    app.include_router(r)
    res = asc.audit_routes(app)
    assert res["checked"] == 0 and res["ok"] is True


def test_ignores_routers_outside_the_audited_surface():
    app = FastAPI()
    r = APIRouter()
    r.post("/api/journal/entry")(lambda: {"ok": True})
    app.include_router(r)
    assert asc.audit_routes(app)["checked"] == 0


def test_every_mutating_verb_is_audited():
    for verb in ("post", "put", "patch", "delete"):
        res = asc.audit_routes(_build(gated=False, method=verb))
        assert res["ok"] is False, f"{verb.upper()} was not audited"


def test_allowed_open_suppresses_a_deliberate_exception(monkeypatch):
    monkeypatch.setattr(asc, "ALLOWED_OPEN", {("POST", "/api/flow/danger"): "test"})
    assert asc.audit_routes(_build(gated=False))["ok"] is True


def test_startup_audit_never_raises_and_never_alerts_when_clean(monkeypatch):
    called = []
    monkeypatch.setattr(asc, "_alert", lambda *a, **k: called.append(a))
    monkeypatch.setattr(asc, "GUARD_NAMES", {"_require_flow_admin"})
    res = asc.run_startup_audit(_build(gated=True), service="test")
    assert res["ok"] is True and called == []


def test_startup_audit_alerts_when_a_route_is_open(monkeypatch):
    called = []
    monkeypatch.setattr(asc, "_alert", lambda *a, **k: called.append(a))
    res = asc.run_startup_audit(_build(gated=False), service="test")
    assert res["ok"] is False and len(called) == 1


def test_startup_audit_survives_a_broken_app(monkeypatch):
    """A diagnostic that can take down the pod it diagnoses is a worse bug."""
    class Exploding:
        @property
        def routes(self):
            raise RuntimeError("boom")
    res = asc.run_startup_audit(Exploding(), service="test")
    assert res["ok"] is None and "error" in res

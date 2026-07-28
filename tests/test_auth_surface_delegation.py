"""A proxied route's gate lives on the OTHER pod — say so, then prove it.

The 2026-07-27 alert fired on `web` naming 56 ungated mutating routes. All 56
were `flow_proxy`'s catch-all forwarders: 7 audited prefixes x (exact +
/{path:path}) x 4 mutating verbs. Their gate is real but it lives on
flow-worker, so route introspection inside the web process cannot see it and
reports every one of them as wide open.

Reporting them as UNGATED is wrong twice. It is false on web (no handler runs
there), and it is noise that trains people to ignore the one channel that is
supposed to page them — the exact failure mode that let four genuinely ungated
routes sit unnoticed for weeks.

Suppressing them via ALLOWED_OPEN would be worse: that list means "checked, and
safe for a stated reason", and web has no way to check this one. So they get a
third bucket, DELEGATED, which is not a verdict but an obligation: web must go
ask flow-worker whether it actually gates them, and page when the answer is bad
OR unavailable. A delegation nobody can fail is just a suppression with better
manners.
"""
import pytest
from fastapi import APIRouter, Depends, FastAPI, Header
from fastapi.testclient import TestClient

from api import auth_surface_check as asc
from api import flow_proxy


def _require_flow_admin():        # stands in for the real guard, by NAME
    return {"admin": True}


def _app_with(route_factory) -> FastAPI:
    app = FastAPI()
    r = APIRouter()
    route_factory(r)
    app.include_router(r)
    return app


def _proxied(r: APIRouter, path="/api/flow/danger", method="POST"):
    """Register the REAL forwarder, exactly as flow_proxy.build_flow_proxy_router does."""
    r.add_api_route(path, flow_proxy._proxy, methods=[method])


def _local(r: APIRouter, path="/api/flow/danger", method="POST"):
    r.add_api_route(path, lambda: {"ok": True}, methods=[method])


# --- classification ----------------------------------------------------------

def test_a_proxy_forwarder_is_delegated_not_ungated():
    res = asc.audit_routes(_app_with(_proxied))
    assert res["ungated"] == [], f"the proxy hop was reported as an open route: {res}"
    assert ("POST", "/api/flow/danger") in res["delegated"]


def test_a_real_handler_under_a_proxied_prefix_is_still_ungated():
    """The anti-suppression property. If 'lives under /api/flow' were enough to
    earn a pass, adding a genuinely ungated endpoint next to the proxy would go
    silent. Only flow_proxy's own forwarder may be delegated."""
    res = asc.audit_routes(_app_with(_local))
    assert ("POST", "/api/flow/danger") in res["ungated"]
    assert res["delegated"] == []
    assert res["ok"] is False


def test_a_gated_proxy_prefix_route_is_neither_bucket(monkeypatch):
    monkeypatch.setattr(asc, "GUARD_NAMES", {"_require_flow_admin"})

    def _gated(r):
        r.add_api_route("/api/flow/danger", lambda: {"ok": True},
                        methods=["POST"], dependencies=[Depends(_require_flow_admin)])

    res = asc.audit_routes(_app_with(_gated))
    assert res["ungated"] == [] and res["delegated"] == [] and res["ok"] is True


def test_delegation_does_not_by_itself_make_the_audit_fail():
    assert asc.audit_routes(_app_with(_proxied))["ok"] is True


# --- the real artifact -------------------------------------------------------

def test_the_live_flow_proxy_router_reports_zero_ungated_routes():
    """The alert that started this, asserted against the real router object.

    Before delegation existed this produced exactly the 56 findings in that
    Discord message: prefixes /api/flow, -backup, -gap-fill, -reconcile,
    /api/live/massive, /api/liveflow, /api/oi-snapshot (the 7 of
    PROXY_PREFIXES that fall under AUDITED_PREFIXES), each registered bare and
    as /{path:path}, times POST/PUT/PATCH/DELETE. 7 x 2 x 4 = 56.
    """
    app = FastAPI()
    app.include_router(flow_proxy.build_flow_proxy_router())
    res = asc.audit_routes(app)

    assert res["ungated"] == [], f"{len(res['ungated'])} proxy routes still page"
    assert len(res["delegated"]) == 56, (
        f"expected the 56 forwarders from the 2026-07-27 alert, got "
        f"{len(res['delegated'])} — did PROXY_PREFIXES or AUDITED_PREFIXES change?"
    )
    delegated_paths = {p for _, p in res["delegated"]}
    for prefix in ("/api/flow", "/api/flow-backup", "/api/flow-gap-fill",
                   "/api/flow-reconcile", "/api/live/massive", "/api/liveflow",
                   "/api/oi-snapshot"):
        assert prefix in delegated_paths, f"{prefix} missing from the delegated set"
        assert prefix + "/{path:path}" in delegated_paths


# --- the obligation ----------------------------------------------------------

def _vouch(ok=True, checked=9, ungated=()):
    return {"reachable": True,
            "audit": {"ok": ok, "checked": checked, "ungated": list(ungated)}}


def test_delegated_routes_are_not_trusted_until_the_worker_vouches(monkeypatch):
    started = []
    monkeypatch.setattr(asc, "_start_delegation_vouch",
                        lambda service, delegated: started.append(delegated))
    monkeypatch.setattr(asc, "_alert", lambda *a, **k: pytest.fail("delegation paged"))

    res = asc.run_startup_audit(_app_with(_proxied), service="web")

    assert res["ok"] is True
    assert started and ("POST", "/api/flow/danger") in started[0], (
        "web accepted a proxied route without asking flow-worker to vouch for it"
    )


def test_no_vouch_is_attempted_when_nothing_is_delegated(monkeypatch):
    monkeypatch.setattr(asc, "GUARD_NAMES", {"_require_flow_admin"})
    monkeypatch.setattr(asc, "_start_delegation_vouch",
                        lambda *a: pytest.fail("vouched with nothing delegated"))

    def _gated(r):
        r.add_api_route("/api/flow/danger", lambda: {"ok": True},
                        methods=["POST"], dependencies=[Depends(_require_flow_admin)])

    assert asc.run_startup_audit(_app_with(_gated), service="web")["ok"] is True


def test_a_clean_worker_discharges_the_obligation(monkeypatch):
    monkeypatch.setattr(asc, "_alert", lambda *a, **k: pytest.fail("paged on a clean worker"))
    out = asc.verify_delegation([("POST", "/api/flow/x")],
                                fetch=lambda timeout=5.0: _vouch(),
                                attempts=1, sleep_s=0)
    assert out["vouched"] is True


def test_an_open_worker_pages(monkeypatch):
    """The emergency this whole mechanism exists for: web is forwarding these
    to the internet and the pod that owns them gates nothing."""
    alerts = []
    monkeypatch.setattr(asc, "_alert", lambda service, message: alerts.append(message))
    out = asc.verify_delegation([("POST", "/api/flow/x")],
                                fetch=lambda timeout=5.0: _vouch(
                                    ok=False, ungated=[["POST", "/api/flow/purge"]]),
                                attempts=1, sleep_s=0)
    assert out["vouched"] is False
    assert len(alerts) == 1
    assert "/api/flow/purge" in alerts[0], "the alert must name what is open"


def test_an_unreachable_worker_pages(monkeypatch):
    """Without this the check cannot fail: a worker that never answers would
    leave 56 internet-reachable mutators silently 'delegated' to nobody."""
    alerts = []
    monkeypatch.setattr(asc, "_alert", lambda service, message: alerts.append(message))
    out = asc.verify_delegation([("POST", "/api/flow/x")],
                                fetch=lambda timeout=5.0: {"reachable": False,
                                                           "detail": "connect refused"},
                                attempts=2, sleep_s=0)
    assert out["vouched"] is False
    assert len(alerts) == 1 and "connect refused" in alerts[0]


def test_a_worker_that_audited_nothing_does_not_count_as_a_vouch(monkeypatch):
    """ok=True over zero checked routes is a vacuous pass — it would vouch for
    56 routes on the strength of having examined none."""
    alerts = []
    monkeypatch.setattr(asc, "_alert", lambda service, message: alerts.append(message))
    out = asc.verify_delegation([("POST", "/api/flow/x")],
                                fetch=lambda timeout=5.0: _vouch(checked=0),
                                attempts=1, sleep_s=0)
    assert out["vouched"] is False and len(alerts) == 1


def test_a_worker_still_booting_is_retried_not_paged(monkeypatch):
    """web and flow-worker restart independently; 'audit has not run yet' is a
    race, not a finding. Paging on it would be the same false alarm in a new hat."""
    alerts = []
    monkeypatch.setattr(asc, "_alert", lambda service, message: alerts.append(message))
    answers = [{"reachable": True, "audit": {"ok": None, "checked": 0}}, _vouch()]
    out = asc.verify_delegation([("POST", "/api/flow/x")],
                                fetch=lambda timeout=5.0: answers.pop(0),
                                attempts=3, sleep_s=0)
    assert out["vouched"] is True and alerts == []


def test_the_vouch_never_raises(monkeypatch):
    monkeypatch.setattr(asc, "_alert", lambda *a, **k: None)

    def _explode(timeout=5.0):
        raise RuntimeError("boom")

    out = asc.verify_delegation([("POST", "/api/flow/x")], fetch=_explode,
                                attempts=1, sleep_s=0)
    assert out["vouched"] is False


# --- the endpoint flow-worker answers on --------------------------------------

def _vouch_client(monkeypatch, secret="s3cr3t"):
    monkeypatch.setenv("PUSH_SECRET", secret)
    app = FastAPI()
    app.include_router(asc.build_vouch_router())
    return TestClient(app)


def test_worker_serves_its_own_audit_result(monkeypatch):
    monkeypatch.setattr(asc, "_alert", lambda *a, **k: None)
    monkeypatch.setattr(asc, "GUARD_NAMES", {"_require_flow_admin"})

    def _gated(r):
        r.add_api_route("/api/flow/purge", lambda: {"ok": True},
                        methods=["POST"], dependencies=[Depends(_require_flow_admin)])

    asc.run_startup_audit(_app_with(_gated), service="flow-worker")
    body = _vouch_client(monkeypatch).get(
        asc.VOUCH_PATH, headers={"Authorization": "Bearer s3cr3t"}).json()

    assert body["ok"] is True and body["checked"] == 1
    assert body["service"] == "flow-worker"


def test_the_vouch_endpoint_refuses_a_wrong_secret(monkeypatch):
    r = _vouch_client(monkeypatch).get(asc.VOUCH_PATH,
                                       headers={"Authorization": "Bearer nope"})
    assert r.status_code == 403


def test_the_vouch_endpoint_refuses_when_no_secret_is_configured(monkeypatch):
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    app = FastAPI()
    app.include_router(asc.build_vouch_router())
    r = TestClient(app).get(asc.VOUCH_PATH, headers={"Authorization": "Bearer "})
    assert r.status_code == 403


def test_the_vouch_endpoint_is_read_only():
    """It must never become something the proxy could be tricked into mutating."""
    paths = {(m, r.path) for r in asc.build_vouch_router().routes
             for m in getattr(r, "methods", set())}
    assert paths == {("GET", asc.VOUCH_PATH)}


def test_the_vouch_endpoint_is_not_internet_reachable():
    """It answers "which of my routes are ungated" — private networking only.

    web reaches it via WORKER_INTERNAL_URL. If VOUCH_PATH ever fell under a
    proxied prefix, web's catch-all would forward it straight from the public
    internet, and the push-secret gate would be the only thing left.
    """
    for prefix in flow_proxy.PROXY_PREFIXES:
        assert not asc.VOUCH_PATH.startswith(prefix), (
            f"{asc.VOUCH_PATH} is proxied via {prefix} — it is now reachable "
            f"from the internet"
        )


def test_flow_worker_mounts_the_vouch_router():
    """Source-level, like the rest of the wiring assertions here: without this
    include_router, web's vouch check reaches a pod that answers 404 and pages
    on every boot — the crying-wolf failure this whole change removes."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[1]
           / "api" / "flow_worker_main.py").read_text(encoding="utf-8")
    assert "build_vouch_router()" in src, \
        "flow_worker_main no longer mounts the auth-surface vouch endpoint"
    assert "include_router" in src

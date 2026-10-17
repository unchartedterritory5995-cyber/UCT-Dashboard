"""The New-today route and its nightly hook, gated by SCREENER_NEW_TODAY_ENABLED."""
import inspect

import pytest
from fastapi import HTTPException

from api.routers import auth
from api.routers import screener_new_today as R
from api.services.screener import membership as M


def test_the_flag_rides_the_screener_flag_family(monkeypatch):
    monkeypatch.delenv("SCREENER_NEW_TODAY_ENABLED", raising=False)
    assert auth._screener_flags(is_admin=True)["screener_new_today_enabled"] is False
    monkeypatch.setenv("SCREENER_NEW_TODAY_ENABLED", "admin")
    assert auth._screener_flags(is_admin=True)["screener_new_today_enabled"] is True
    assert auth._screener_flags(is_admin=False)["screener_new_today_enabled"] is False


def test_the_job_runs_for_admin_or_everyone_and_not_when_off(monkeypatch):
    for v, want in (("", False), ("0", False), ("admin", True), ("1", True)):
        monkeypatch.setenv("SCREENER_NEW_TODAY_ENABLED", v)
        assert M.job_enabled() is want, v
    monkeypatch.delenv("SCREENER_NEW_TODAY_ENABLED", raising=False)
    assert M.job_enabled() is False


def test_the_route_is_404_for_a_member_when_only_the_owner_previews(monkeypatch):
    monkeypatch.setenv("SCREENER_NEW_TODAY_ENABLED", "admin")
    monkeypatch.setattr(M, "diff", lambda spec: {"state": "no_history"})
    with pytest.raises(HTTPException) as e:
        R.membership_diff(R.DiffIn(spec={}), user={"role": "member"})
    assert e.value.status_code == 404
    assert R.membership_diff(R.DiffIn(spec={}), user={"role": "admin"}) == {"state": "no_history"}


def test_the_route_is_404_for_everyone_when_off(monkeypatch):
    monkeypatch.delenv("SCREENER_NEW_TODAY_ENABLED", raising=False)
    with pytest.raises(HTTPException) as e:
        R.membership_diff(R.DiffIn(spec={}), user={"role": "admin"})
    assert e.value.status_code == 404


def test_the_route_answers_the_diff_when_on(monkeypatch):
    monkeypatch.setenv("SCREENER_NEW_TODAY_ENABLED", "1")
    monkeypatch.setattr(M, "diff", lambda spec: {"state": "no_history"})
    assert R.membership_diff(R.DiffIn(spec={"filters": []}), user={"role": "member"}) == {"state": "no_history"}


def test_the_route_carries_the_paid_gate():
    dep = inspect.signature(R.membership_diff).parameters["user"].default
    assert getattr(dep, "dependency", None) is R.require_paid
    with pytest.raises(HTTPException) as e:
        R.require_paid(user={"role": "member", "plan": "free"})
    assert e.value.status_code == 402


def test_the_route_is_mounted_on_the_app():
    import api.main as main
    paths = {(getattr(r, "path", None), m) for r in main.app.routes for m in (getattr(r, "methods", None) or ())}
    assert ("/api/screener/membership-diff", "POST") in paths
    assert ("/api/screener/to-watchlist", "POST") in paths      # control: the probe sees a sibling


def test_the_nightly_job_records_membership_only_after_a_complete_build(monkeypatch):
    import api.main as main
    from api.services import chart_health_alerts
    from api.services.screener import distribution, snapshot_builder, volume_curve
    calls = []
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setenv("SCREENER_NEW_TODAY_ENABLED", "1")
    monkeypatch.setattr(main, "start_screener_snapshot_warm", lambda: None)
    monkeypatch.setattr(chart_health_alerts, "emit", lambda *a, **k: True)
    monkeypatch.setattr(distribution, "distributions", lambda: None)
    monkeypatch.setattr(volume_curve, "nightly_job", lambda: {})
    monkeypatch.setattr(M, "record_all", lambda: calls.append(1) or {})
    jobs = {}

    class _S:
        def add_job(self, func, **kw):
            jobs[kw.get("id")] = func
    main.register_screener_jobs(_S())
    monkeypatch.setattr(snapshot_builder, "run_build",
                        lambda *a, **k: {"targets": 5, "built": 2, "skipped": 0, "errors": 0, "populated": {}})
    jobs["screener_snapshot_nightly"]()
    assert calls == []                      # short build: no record
    monkeypatch.setattr(snapshot_builder, "run_build",
                        lambda *a, **k: {"targets": 5, "built": 5, "skipped": 0, "errors": 0, "populated": {}})
    jobs["screener_snapshot_nightly"]()
    assert calls == [1]
    monkeypatch.setenv("SCREENER_NEW_TODAY_ENABLED", "0")
    jobs["screener_snapshot_nightly"]()
    assert calls == [1]                     # flag off: no record


def test_flag_off_answers_404_before_the_sign_in_and_paid_gates(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(R.router)
    c = TestClient(app)
    monkeypatch.delenv("SCREENER_NEW_TODAY_ENABLED", raising=False)
    assert c.post("/api/screener/membership-diff", json={"spec": {}}).status_code == 404
    monkeypatch.setenv("SCREENER_NEW_TODAY_ENABLED", "1")       # control: on, the auth gate answers
    assert c.post("/api/screener/membership-diff", json={"spec": {}}).status_code == 401

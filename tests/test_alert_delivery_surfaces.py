"""The two halves of "a failure nobody can see": the LATENCY that was never
measured, and the delivery failure that had no route.

🔴 D10 — `GET /api/indicator-alerts/latency` reported *"0–60 s"* built from two
constants (`_CYCLE_SECONDS` and `_TF_SECONDS`). Both `fired_at` and the bar's
timestamp are stored on every fire row and nothing anywhere subtracted them, so
the platform could not detect its own latency regression: a stalled evaluator
thread would leave that body byte-identical.

🔴 D5/D7 — `alert_fired_log.delivery_failures()` and `delivery_health()` were
correct and exposed by NOTHING. A member who missed an alert was invisible to
anyone without direct database access.

⛔ AND THE EMPTY SAMPLE IS THE TRAP THIS FILE CARES MOST ABOUT. The production
fire log is empty, so the FIRST thing the new measurement will ever do is report
on zero rows. A `p50: 0` there is the phase's own defect class one more time — a
confident number over an absent result — and it would read as best-in-class
latency. `observations: 0` with null quantiles is the only honest answer.
"""
from __future__ import annotations

import pytest

from api.services import alert_fired_log as fl
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db_path))
    monkeypatch.setattr(ias, "_DB_PATH", str(db_path))
    monkeypatch.setattr(fl, "_last_fire_prune_at", 0.0, raising=False)
    ias.init_schema()
    return db_path


@pytest.fixture
def client(tmp_db):
    from fastapi.testclient import TestClient
    from api.main import app
    from api.middleware.auth_middleware import get_current_user

    def _fake_user():
        return {"id": "user-abc", "email": "abc@test", "role": "member"}

    app.dependency_overrides[get_current_user] = _fake_user
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# A 5-minute bar. `bar_close_epoch` resolves 5m as bar start + 300s.
_BAR_T = 1_700_000_000


def _fire(alert_id, user_id, *, key, bar_time, fired_at, sym="AAPL"):
    assert fl.record_fire(alert_id, user_id, sym, "rsi", "above", "5",
                          key, 75.0, bar_time=bar_time,
                          fired_at=fired_at) is True


def _close_of(bar_t):
    close_at = ev.bar_close_epoch(bar_t, "5")
    assert close_at is not None, "the fixture's bar has no resolvable close"
    return close_at


# ─── D10: latency is a MEASUREMENT ──────────────────────────────────────────

def test_an_EMPTY_fire_log_reports_NO_OBSERVATIONS_and_never_a_zero(tmp_db):
    """🔴 THE HONESTY RAIL, and it is the state production is in TODAY.

    Every quantile must be null. A zero here would read as "our alerts land the
    instant the bar closes", which is the most flattering possible lie about a
    lane that has never fired.
    """
    out = ev.observed_latency()

    assert out["observations"] == 0, out
    for key in ("p50_seconds", "p90_seconds", "max_seconds", "min_seconds"):
        assert out[key] is None, (
            f"{key} is {out[key]!r} on an EMPTY sample — a fabricated number "
            "that would read as excellent latency")
    assert "no observed fires" in out["note"]


def test_the_observed_latency_is_fired_at_MINUS_bar_close(tmp_db):
    """The measurement itself, against a hand-computed answer.

    ⛔ THE EXPECTED VALUE IS DERIVED FROM `bar_close_epoch`, THE SAME FUNCTION
    THE LANE USES — not a retyped `_BAR_T + 300`. A restated bar-close rule is
    a second authority over the one thing this whole phase keys on, and it would
    silently agree with a broken implementation of itself.
    """
    aid = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                     condition="above", threshold=70.0, tf="5")
    close_at = _close_of(_BAR_T)
    for i, lag in enumerate((10.0, 20.0, 30.0, 40.0, 200.0)):
        _fire(aid, "u1", key=f"ep:{i}", bar_time=_BAR_T,
              fired_at=close_at + lag)

    out = ev.observed_latency()
    assert out["observations"] == 5, out
    assert out["min_seconds"] == 10.0
    assert out["max_seconds"] == 200.0
    assert out["p50_seconds"] == 30.0, out
    assert out["before_close"] == 0
    assert out["unresolved"] == 0


def test_a_fire_recorded_BEFORE_its_bar_closed_is_reported_not_clamped(tmp_db):
    """⚠️ A NEGATIVE SAMPLE IS A FINDING, not noise to `max(0, …)` away.

    It means the fire was recorded before the bar it names finished — which is
    exactly what the FORMING lane does. On the closed lane it is a defect, and
    a clamp would delete the only evidence of it.
    """
    aid = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                     condition="above", threshold=70.0, tf="5")
    close_at = _close_of(_BAR_T)
    _fire(aid, "u1", key="ep:1", bar_time=_BAR_T, fired_at=close_at - 120.0)

    out = ev.observed_latency()
    assert out["observations"] == 1
    assert out["before_close"] == 1, out
    assert out["min_seconds"] == -120.0, (
        "a fire recorded 2 minutes BEFORE its bar closed was clamped to zero")


def test_the_latency_route_carries_the_measurement_AND_the_stated_bound(client):
    """⛔ THE STATED BOUND IS NOT REPLACED. `worst_case_seconds` is also the
    second, independent witness of the running lane — its `5 → 360` arithmetic
    is only producible by the closed branch — so a measurement over an empty
    sample cannot stand in for it."""
    r = client.get("/api/indicator-alerts/latency")
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["observed"]["observations"] == 0
    assert body["observed"]["p50_seconds"] is None
    # unmoved:
    assert body["cycle_seconds"] == 60
    assert body["worst_case_seconds"]["5"] == 360
    assert body["mode"] == body["eval_mode"]["effective"]


def test_the_route_reports_only_MY_observed_latency(client):
    """Another member's fires may not move the number this member is shown."""
    mine = ias.create(user_id="user-abc", sym="AAA", indicator="rsi",
                      condition="above", threshold=70.0, tf="5")
    theirs = ias.create(user_id="someone-else", sym="BBB", indicator="rsi",
                        condition="above", threshold=70.0, tf="5")
    close_at = _close_of(_BAR_T)
    _fire(mine, "user-abc", key="ep:1", bar_time=_BAR_T, fired_at=close_at + 5)
    _fire(theirs, "someone-else", key="ep:1", bar_time=_BAR_T,
          fired_at=close_at + 9999, sym="BBB")

    body = client.get("/api/indicator-alerts/latency").json()
    assert body["observed"]["observations"] == 1, body["observed"]
    assert body["observed"]["max_seconds"] == 5.0, (
        "another member's fire is in this member's latency distribution")


# ─── D5/D7: the failure has a door ──────────────────────────────────────────

def test_the_delivery_health_route_serves_the_failures_the_member_can_SEE(client):
    mine = ias.create(user_id="user-abc", sym="AAA", indicator="rsi",
                      condition="above", threshold=70.0, tf="5")
    assert ias.record_trigger(mine, last_value=75.0) is True
    assert fl.claim_delivery(mine) is True
    fire_id = fl.fires_for_alert(mine)[0]["id"]
    assert fl.record_delivery_channels(
        fire_id, {"in_app": "ok", "email": "failed", "discord": "skipped"}) is True

    r = client.get("/api/indicator-alerts/delivery-health")
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["health"]["partial"] == 1, body["health"]
    assert body["health"]["delivered"] == 0, (
        "a partially-delivered fire is served as a clean delivery")
    assert body["health"]["trouble"] == 1
    assert len(body["failures"]) == 1
    assert body["failures"][0]["sym"] == "AAA"
    assert body["failures"][0]["delivery_channels"]["email"] == "failed"


def test_the_delivery_health_route_cannot_serve_ANOTHER_members_failure(client):
    """Scoped in SQL, not filtered afterwards."""
    theirs = ias.create(user_id="someone-else", sym="BBB", indicator="rsi",
                        condition="above", threshold=70.0, tf="5")
    assert ias.record_trigger(theirs, last_value=75.0) is True
    assert fl.claim_delivery(theirs) is True
    fid = fl.fires_for_alert(theirs)[0]["id"]
    fl.record_delivery_channels(fid, {"in_app": "ok", "email": "failed"})

    # CONTROL: the row really is a failure — an unscoped read finds it.
    assert len(fl.delivery_failures()) == 1

    body = client.get("/api/indicator-alerts/delivery-health").json()
    assert body["failures"] == [], body
    assert body["health"]["trouble"] == 0
    assert body["health"]["fires"] == 0


def test_a_healthy_fire_leaves_the_route_reporting_NO_trouble(client):
    """The control. Without it "no failures were served" could be produced by a
    route that serves nothing at all."""
    mine = ias.create(user_id="user-abc", sym="AAA", indicator="rsi",
                      condition="above", threshold=70.0, tf="5")
    assert ias.record_trigger(mine, last_value=75.0) is True
    assert fl.claim_delivery(mine) is True
    fl.record_delivery_channels(fl.fires_for_alert(mine)[0]["id"],
                                {"in_app": "ok", "email": "ok"})

    body = client.get("/api/indicator-alerts/delivery-health").json()
    assert body["health"]["fires"] == 1, "the fixture's fire is not visible"
    assert body["health"]["delivered"] == 1
    assert body["health"]["trouble"] == 0
    assert body["failures"] == []


def test_the_delivery_health_route_is_declared_ABOVE_the_alert_id_routes():
    """⚠️ `/delivery-health` would be parsed as an `{alert_id}` by any GET
    declared on that path — the trap `/catalog`, `/fired` and `/latency` all
    carry a note about. Derived from the router's own table, never from a
    reading of the file."""
    from api.routers.indicator_alerts import router

    paths = [r.path for r in router.routes]
    literals = [p for p in paths if p.endswith("/delivery-health")]
    assert literals, f"the route is not registered at all: {paths}"
    parametrised = [i for i, p in enumerate(paths) if "{alert_id}" in p]
    if parametrised:
        assert paths.index(literals[0]) < min(parametrised), (
            f"/delivery-health is declared after a parametrised route: {paths}")

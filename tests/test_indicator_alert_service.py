import pytest

from api.services import indicator_alert_service as ias


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db_path))
    monkeypatch.setattr(ias, "_DB_PATH", str(db_path))
    ias.init_schema()
    return db_path


def test_create_and_list(tmp_db):
    alert_id = ias.create(
        user_id="user-abc", sym="AAPL", indicator="rsi",
        condition="above", threshold=70, tf="D",
    )
    assert alert_id > 0
    alerts = ias.list_for_user("user-abc")
    assert len(alerts) == 1
    assert alerts[0]["indicator"] == "rsi"


def test_active_only_filter(tmp_db):
    a1 = ias.create(user_id="user-abc", sym="AAPL", indicator="rsi",
                    condition="above", threshold=70, tf="D")
    a2 = ias.create(user_id="user-abc", sym="MSFT", indicator="rsi",
                    condition="below", threshold=30, tf="D")
    ias.set_active(a2, False)
    active = ias.list_active()
    assert len(active) == 1
    assert active[0]["id"] == a1


def test_delete(tmp_db):
    a = ias.create(user_id="user-abc", sym="AAPL", indicator="rsi",
                   condition="above", threshold=70, tf="D")
    ias.delete(a)
    assert ias.get(a) is None


def test_record_trigger(tmp_db):
    a = ias.create(user_id="user-abc", sym="AAPL", indicator="rsi",
                   condition="above", threshold=70, tf="D")
    ias.record_trigger(a, last_value=72.5)
    row = ias.get(a)
    assert row["trigger_count"] == 1
    assert row["last_value"] == 72.5
    assert row["triggered_at"] is not None


def test_record_evaluation_no_trigger(tmp_db):
    a = ias.create(user_id="user-abc", sym="AAPL", indicator="rsi",
                   condition="above", threshold=70, tf="D")
    ias.record_evaluation(a, last_value=55.0)
    row = ias.get(a)
    assert row["trigger_count"] == 0
    assert row["last_value"] == 55.0
    assert row["last_evaluated_at"] is not None
    assert row["triggered_at"] is None


def test_list_for_user_filters_correctly(tmp_db):
    """Alerts for one user should not appear in another user's list."""
    a1 = ias.create(user_id="user-abc", sym="AAPL", indicator="rsi",
                    condition="above", threshold=70, tf="D")
    a2 = ias.create(user_id="user-xyz", sym="MSFT", indicator="rsi",
                    condition="below", threshold=30, tf="D")
    a3 = ias.create(user_id="user-abc", sym="NVDA", indicator="macd",
                    condition="cross_zero", threshold=None, tf="60")

    user1_alerts = ias.list_for_user("user-abc")
    user2_alerts = ias.list_for_user("user-xyz")

    assert len(user1_alerts) == 2
    assert {a["id"] for a in user1_alerts} == {a1, a3}

    assert len(user2_alerts) == 1
    assert user2_alerts[0]["id"] == a2


def test_set_active_persists(tmp_db):
    """Toggling active should persist across re-reads."""
    a = ias.create(user_id="user-abc", sym="AAPL", indicator="rsi",
                   condition="above", threshold=70, tf="D")
    # Newly created → active
    assert ias.get(a)["active"] is True

    ias.set_active(a, False)
    assert ias.get(a)["active"] is False

    ias.set_active(a, True)
    assert ias.get(a)["active"] is True


# ─── Router tests ───────────────────────────────────────────────────────────


@pytest.fixture
def client(tmp_db):
    """FastAPI TestClient with auth dependency overridden + the alert service
    DB redirected to a tmp file. The router imports the service module, which
    we monkeypatched in tmp_db, so writes from the route hit the tmp DB."""
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


def test_route_create_and_list(client):
    r = client.post(
        "/api/indicator-alerts",
        json={
            "sym": "aapl", "indicator": "rsi", "condition": "above",
            "threshold": 70, "tf": "D",
        },
    )
    assert r.status_code == 200, r.text
    alert_id = r.json()["id"]
    assert alert_id > 0

    r2 = client.get("/api/indicator-alerts")
    assert r2.status_code == 200
    alerts = r2.json()["alerts"]
    assert len(alerts) == 1
    assert alerts[0]["sym"] == "AAPL"  # uppercased by route
    assert alerts[0]["user_id"] == "user-abc"


def test_route_delete(client):
    # Create as the override user
    r = client.post(
        "/api/indicator-alerts",
        json={"sym": "AAPL", "indicator": "rsi", "condition": "above",
              "threshold": 70, "tf": "D"},
    )
    alert_id = r.json()["id"]

    # A different user creates their own alert directly via service
    other_id = ias.create(
        user_id="someone-else", sym="MSFT", indicator="rsi",
        condition="below", threshold=30, tf="D",
    )

    # The override user cannot delete the other user's alert → 404
    r404 = client.delete(f"/api/indicator-alerts/{other_id}")
    assert r404.status_code == 404

    # But can delete their own
    rok = client.delete(f"/api/indicator-alerts/{alert_id}")
    assert rok.status_code == 200
    assert ias.get(alert_id) is None
    # Other user's alert untouched
    assert ias.get(other_id) is not None


def test_route_toggle(client):
    r = client.post(
        "/api/indicator-alerts",
        json={"sym": "AAPL", "indicator": "rsi", "condition": "above",
              "threshold": 70, "tf": "D"},
    )
    alert_id = r.json()["id"]
    assert ias.get(alert_id)["active"] is True

    r2 = client.post(f"/api/indicator-alerts/{alert_id}/toggle")
    assert r2.status_code == 200
    assert r2.json()["active"] is False
    assert ias.get(alert_id)["active"] is False

    r3 = client.post(f"/api/indicator-alerts/{alert_id}/toggle")
    assert r3.status_code == 200
    assert r3.json()["active"] is True
    assert ias.get(alert_id)["active"] is True


# ═════════════════════════════════════════════════════════════════════════════
# PHASE C TASK 10 — SPEC §6/§8: THE DELETION GUARD, FROM THE OTHER SIDE.
#
# An orphaned binding is VISIBLE, never silently dead: the alert keeps
# evaluating from the `params_json` snapshot recorded when it was armed, and it
# asks to be re-pointed.
# ═════════════════════════════════════════════════════════════════════════════

import json as _json


def _prefs(monkeypatch, blobs: dict):
    """Stand in for the preferences store with a literal blob per user."""
    from api.services import auth_service
    monkeypatch.setattr(auth_service, "get_user_preferences",
                        lambda uid: dict(blobs.get(uid, {})), raising=False)


def _workspace(*instances) -> str:
    """A `charts_workspace_layout` blob shaped like the real one.

    ⛔ THE INSTANCES ARE NESTED UNDER `widgets[].opts.settings`, NOT AT THE TOP
    LEVEL, and that nesting is the reason the scan walks the whole blob instead
    of reading a known path: the global `chart_settings` is only a SEED and the
    user's live chart lives here. A path-based read would report every instance
    as deleted for every user who has a workspace.
    """
    return _json.dumps({
        "widgets": [
            {"id": "w1", "opts": {"settings": {"indicators": [
                {"instanceId": i, "defId": i.split(":")[-1]} for i in instances
            ]}}},
        ],
    })


def test_an_alert_whose_instance_was_DELETED_is_flagged_not_silent(tmp_db, monkeypatch):
    """⭐ THE HEADLINE OF THE GUARD, AND THE ALERT KEEPS WORKING.

    Deleting `RSI(7)` from the chart used to leave its alert armed, firing, and
    describing itself as "RSI" — indistinguishable on every surface from an
    alert bound to the `RSI(14)` still on the chart.
    """
    alert_id = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                          condition="above", threshold=70, tf="D",
                          params_json={"period": 7}, instance_id="chart-1:rsi#a")
    _prefs(monkeypatch, {"u1": {"charts_workspace_layout":
                                _workspace("chart-1:rsi#a", "chart-1:rsi#b")}})

    # …bound: not flagged, and the sweep says it actually LOOKED.
    out = ias.sweep_orphaned_instances()
    assert out["checked"] == 1, "the sweep did not check the alert at all"
    assert out["orphaned"] == 0
    assert ias.get(alert_id)["instance_missing"] is False

    # …now the user deletes that instance from the chart.
    _prefs(monkeypatch, {"u1": {"charts_workspace_layout":
                                _workspace("chart-1:rsi#b")}})
    out = ias.sweep_orphaned_instances()
    assert out["orphaned"] == 1
    row = ias.get(alert_id)
    assert row["instance_missing"] is True
    assert row["instance_missing_at"] is not None

    # ⛔ AND IT IS STILL EVALUATING, AND STILL ON RSI(7). `params_json` is the
    # snapshot precisely so the alert survives its instance; a guard that
    # silently disarmed the alert would be the same silence in a new place.
    assert row["active"] is True
    assert row["state"] == ias.STATE_ARMED
    assert ias.list_for_user("u1")[0]["instance_label"] == "RSI(7)"


def test_the_flag_CLEARS_when_the_instance_comes_back(tmp_db, monkeypatch):
    """An undo, a template re-applied, a workspace restored.

    This reports the CURRENT binding rather than accumulating a scar — a flag
    that only ever goes on is a flag every long-lived alert eventually carries.
    """
    alert_id = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                          condition="above", threshold=70, tf="D",
                          instance_id="i-1")
    _prefs(monkeypatch, {"u1": {"chart_settings": _workspace("i-2")}})
    assert ias.sweep_orphaned_instances()["orphaned"] == 1
    assert ias.get(alert_id)["instance_missing"] is True

    _prefs(monkeypatch, {"u1": {"chart_settings": _workspace("i-1", "i-2")}})
    out = ias.sweep_orphaned_instances()
    assert out["cleared"] == 1
    assert ias.get(alert_id)["instance_missing"] is False


def test_an_unreadable_preferences_store_flags_NOTHING(tmp_db, monkeypatch):
    """⛔ THE THREE-STATE RETURN, AND WHY IT IS NOT A BOOLEAN.

    "The user has a chart and it holds no instances" orphans every alert they
    own. "The store did not answer" must conclude nothing. Collapsing the two
    would flag every alert on the box the first time `auth.db` was busy — a
    fleet-wide false alarm produced by a diagnostic.
    """
    alert_id = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                          condition="above", threshold=70, tf="D",
                          instance_id="i-1")

    from api.services import auth_service
    monkeypatch.setattr(auth_service, "get_user_preferences",
                        lambda uid: (_ for _ in ()).throw(RuntimeError("db busy")),
                        raising=False)
    assert ias.chart_instance_ids("u1") is None
    out = ias.sweep_orphaned_instances()
    assert out["checked"] == 0 and out["orphaned"] == 0
    assert ias.get(alert_id)["instance_missing"] is False

    # …a user with NO chart blob at all is the same "cannot tell", not "empty".
    _prefs(monkeypatch, {"u1": {}})
    assert ias.chart_instance_ids("u1") is None
    assert ias.sweep_orphaned_instances()["orphaned"] == 0

    # ⛔ CONTROL: with a real blob present, an empty instance list DOES orphan —
    # otherwise every assertion above is satisfied by a guard that never fires.
    _prefs(monkeypatch, {"u1": {"chart_settings": _workspace()}})
    assert ias.chart_instance_ids("u1") == set()
    assert ias.sweep_orphaned_instances()["orphaned"] == 1


def test_an_alert_that_names_no_instance_is_never_orphaned(tmp_db, monkeypatch):
    """Every alert created before the column existed is in this branch.

    Which is why the migration does not have to guess a value for them, and why
    a box full of legacy rows does not light up on the first sweep after deploy.
    """
    alert_id = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                          condition="above", threshold=70, tf="D")
    assert ias.get(alert_id)["instance_id"] is None
    _prefs(monkeypatch, {"u1": {"chart_settings": _workspace("something-else")}})
    out = ias.sweep_orphaned_instances()
    assert out["considered"] == 1 and out["checked"] == 0 and out["orphaned"] == 0
    assert ias.get(alert_id)["instance_missing"] is False


def test_the_orphan_flag_is_NOT_a_state_because_a_state_would_be_cleared(tmp_db, monkeypatch):
    """🔴 MEASURED, AND IT CHANGED THE DESIGN.

    The obvious home was `state = 'needs_attention'`, which is what the brief
    specified. `record_evaluation` clears that state the moment a value arrives
    ("whatever was broken is not broken now") — and an orphaned alert KEEPS
    PRODUCING VALUES, because it evaluates from the snapshot. So the flag would
    have been green in the test that set it and gone within one 60-second cycle,
    before any user saw it. This test is that measurement, kept.
    """
    alert_id = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                          condition="above", threshold=70, tf="D",
                          instance_id="i-1")
    _prefs(monkeypatch, {"u1": {"chart_settings": _workspace("i-2")}})
    ias.sweep_orphaned_instances()
    ias.mark_needs_attention(alert_id, "pretend the flag lived in `state`")
    assert ias.get(alert_id)["state"] == ias.STATE_NEEDS_ATTENTION

    # one ordinary evaluation later…
    ias.record_evaluation(alert_id, 55.0)
    assert ias.get(alert_id)["state"] == ias.STATE_ARMED, (
        "the state machine cleared it, exactly as designed")
    # …and the durable flag is untouched, which is the whole reason it is a
    # column and not a state.
    assert ias.get(alert_id)["instance_missing"] is True


def test_the_silence_sweep_reports_the_instance_counters_under_their_own_keys(tmp_db, monkeypatch):
    """One scheduler job, two sweeps, and neither can be read as the other."""
    ias.create(user_id="u1", sym="AAPL", indicator="rsi", condition="above",
               threshold=70, tf="D", instance_id="i-1")
    _prefs(monkeypatch, {"u1": {"chart_settings": _workspace("i-2")}})
    out = ias.sweep_silent_alerts()
    assert out["instance_orphaned"] == 1
    assert {"considered", "silent", "flagged"} <= set(out)
    assert out["considered"] == out["instance_considered"] == 1

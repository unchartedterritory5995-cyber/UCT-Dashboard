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


# ─── PHASE C TASK 12 — `scope`: per-chart alert sets ─────────────────────────
#
# `scope` says which CHART an alert is DISPLAYED on. It says nothing whatever
# about whether the alert is EVALUATED, and the tests below are mostly about
# keeping those two questions apart, because the failure that matters is not
# "the filter is wrong" — it is "the filter reached a lane that had no business
# being filtered".


def test_a_new_alert_is_GLOBAL_and_that_is_stored_as_NULL(tmp_db):
    """Absent scope is global, and there is exactly ONE spelling of it.

    Every alert that exists in production predates this column, so global has to
    be the answer a caller gets by saying nothing. And blank has to normalise to
    NULL: if '' and None were both storable, `scope IS NULL` would miss half the
    global rows and `scope = ?` would match none of them, so a user's alert set
    would depend on which client wrote each row.
    """
    plain = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                       condition="above", threshold=70, tf="D")
    blank = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                       condition="above", threshold=70, tf="D", scope="")
    spaces = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                        condition="above", threshold=70, tf="D", scope="   ")
    for alert_id in (plain, blank, spaces):
        assert ias.get(alert_id)["scope"] is None


def test_a_scoped_alert_names_its_chart_and_survives_the_round_trip(tmp_db):
    alert_id = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                          condition="above", threshold=70, tf="D",
                          scope="chart-2")
    assert ias.get(alert_id)["scope"] == "chart-2"
    assert ias.list_for_user("u1")[0]["scope"] == "chart-2"


def test_an_alert_set_is_GLOBAL_PLUS_this_chart_never_this_chart_alone(tmp_db):
    """The additive rule, which is what makes the column a no-op migration."""
    g = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                   condition="above", threshold=70, tf="D")
    c1 = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                    condition="above", threshold=70, tf="D", scope="chart-1")
    c2 = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                    condition="above", threshold=70, tf="D", scope="chart-2")

    assert {a["id"] for a in ias.list_for_user("u1", scope="chart-1")} == {g, c1}
    assert {a["id"] for a in ias.list_for_user("u1", scope="chart-2")} == {g, c2}
    # …and asking for no chart at all is the alert MANAGER's view: everything.
    assert {a["id"] for a in ias.list_for_user("u1")} == {g, c1, c2}
    assert {a["id"] for a in ias.list_for_user("u1", scope=None)} == {g, c1, c2}
    # a chart nobody has scoped anything to still sees the global one
    assert {a["id"] for a in ias.list_for_user("u1", scope="chart-9")} == {g}


def test_the_scope_filter_does_not_reach_across_users(tmp_db):
    mine = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                      condition="above", threshold=70, tf="D", scope="chart-1")
    ias.create(user_id="u2", sym="AAPL", indicator="rsi",
               condition="above", threshold=70, tf="D", scope="chart-1")
    assert [a["id"] for a in ias.list_for_user("u1", scope="chart-1")] == [mine]


def test_a_scoped_alert_is_still_visible_to_list_active(tmp_db):
    """⭐⭐ THE RAIL. A scope filter here would BLIND THE SHADOW SOAK.

    `list_active()` feeds three readers and none of them is a screen:

      · `indicator_alert_evaluator._run_one_cycle` — what fires;
      · `alert_shadow_log.run_shadow_cycle` — the Task 6 shadow lane, whose
        three-session run is Task 8's cutover gate;
      · `tools/alert_soak_matrix` — 30 armed-then-snoozed rows that exist ONLY
        so those three sessions have something to observe, because production
        has zero armed alerts.

    So a `scope` filter in `list_active()` would not merely hide rows: it would
    make Task 8's gate pass on an empty set while reporting success, which is
    [[lesson_gate_that_cannot_fail]] in the one place this phase cannot afford
    it. The assertion is deliberately about ALL of them at once.
    """
    ids = {
        "global": ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                             condition="above", threshold=70, tf="D"),
        "chart-1": ias.create(user_id="u1", sym="MSFT", indicator="rsi",
                              condition="above", threshold=70, tf="D",
                              scope="chart-1"),
        "chart-2": ias.create(user_id="u2", sym="NVDA", indicator="rsi",
                              condition="below", threshold=30, tf="5",
                              scope="chart-2"),
    }
    active = ias.list_active()
    assert {a["id"] for a in active} == set(ids.values()), (
        "a scoped alert vanished from list_active() — the evaluator would stop "
        "firing it and the shadow soak would stop observing it")
    # …and each one still carries its scope, so the field is present-but-unused
    # rather than absent (a reader that needed it would get it).
    by_id = {a["id"]: a for a in active}
    assert by_id[ids["global"]]["scope"] is None
    assert by_id[ids["chart-1"]]["scope"] == "chart-1"
    assert by_id[ids["chart-2"]]["scope"] == "chart-2"
    # NON-VACUITY: the display filter really does hide it, so "visible to
    # list_active" is a statement about list_active and not about a filter that
    # never worked in the first place.
    assert {a["id"] for a in ias.list_for_user("u1", scope="chart-1")} == {
        ids["chart-1"], ids["global"]}
    assert ids["chart-1"] not in {
        a["id"] for a in ias.list_for_user("u1", scope="chart-9")}


def test_the_soak_matrix_stays_visible_when_every_row_is_scoped(tmp_db):
    """The same rail, driven through the tool whose gate depends on it.

    `alert_soak_matrix.verify()` reports `visible_to_shadow`, and its CLI exits
    non-zero when that is not the full matrix. Scoping every row must not move
    that number — asserted against the REAL verifier rather than against a
    re-implementation of its arithmetic.
    """
    from tools import alert_soak_matrix as soak

    specs = soak.catalog_addresses()
    assert len(specs) > 1, "the catalog is empty, so this proves nothing"
    for i, spec in enumerate(specs):
        alert_id = ias.create(
            user_id="soak-user", sym="SPY", indicator=spec["address"],
            condition=spec["condition"], threshold=spec["threshold"], tf="5",
            params_json={soak.SOAK_KEY: soak.SOAK_TAG},
            # every row scoped, and to DIFFERENT charts, so a filter of any
            # shape (equality, IS NULL, or both) would drop at least some
            scope=f"chart-{i % 3}",
        )
        ias.snooze(alert_id, 60)

    out = soak.verify()
    assert out["armed"] == len(specs)
    assert out["visible_to_shadow"] == out["armed"], (
        "scoping the soak matrix made it invisible to the shadow lane — Task 8's "
        "three-session gate would then pass on an empty set")
    assert out["deliverable_now"] == 0
    assert out["missing"] == []


def test_scope_is_not_in_the_fire_key_so_fire_once_is_unchanged(tmp_db):
    """Task 11's guarantee must not move: UNIQUE(alert_id, fire_key).

    A level condition keys on its armed EPISODE and a cross condition on its
    BAR. Neither mentions the chart, and neither should: the same alert on two
    charts is one alert row and one delivery, and folding a chart id into the
    key would turn "fires once" into "fires once per chart".
    """
    from api.services import alert_fired_log

    scoped = ias.create(user_id="u1", sym="AAPL", indicator="rsi",
                        condition="above", threshold=70, tf="D",
                        scope="chart-1")
    plain = ias.create(user_id="u1", sym="MSFT", indicator="rsi",
                       condition="above", threshold=70, tf="D")
    for alert_id in (scoped, plain):
        assert ias.record_trigger(alert_id, last_value=72.5) is True
        # the SAME armed episode, three more cycles: still one row, still quiet
        for _ in range(3):
            assert ias.record_trigger(alert_id, last_value=73.0) is False
        rows = alert_fired_log.fires_for_alert(alert_id, 50)
        assert len(rows) == 1
        assert rows[0]["fire_key"] == "ep:0"
    # …and the two alerts' keys are identical, i.e. the scope is not in them
    assert (alert_fired_log.fires_for_alert(scoped, 1)[0]["fire_key"]
            == alert_fired_log.fires_for_alert(plain, 1)[0]["fire_key"])


def test_the_column_is_added_by_MIGRATION_to_a_table_that_already_exists(tmp_db):
    """CREATE TABLE IF NOT EXISTS is a no-op on every box that has the table.

    So the ALTER is the only thing that reaches a production row, and an existing
    row has to come out GLOBAL — which is what it already was.
    """
    import sqlite3

    with sqlite3.connect(str(tmp_db)) as db:
        db.execute("DROP TABLE indicator_alerts")
        db.execute(
            "CREATE TABLE indicator_alerts ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,"
            " sym TEXT NOT NULL, indicator TEXT NOT NULL, condition TEXT NOT NULL,"
            " threshold REAL, tf TEXT NOT NULL, params_json TEXT,"
            " active INTEGER NOT NULL DEFAULT 1, last_value REAL,"
            " last_evaluated_at INTEGER, triggered_at INTEGER,"
            " trigger_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)")
        db.execute(
            "INSERT INTO indicator_alerts"
            " (user_id, sym, indicator, condition, threshold, tf, trigger_count, created_at)"
            " VALUES ('u1','AAPL','rsi','above',70,'D',0,1)")
    ias.init_schema()

    row = ias.list_for_user("u1")[0]
    assert row["scope"] is None
    assert [a["id"] for a in ias.list_active()] == [row["id"]]
    # a pre-existing row is in EVERY chart's alert set, which is what it meant
    # before the column existed
    assert [a["id"] for a in ias.list_for_user("u1", scope="chart-7")] == [row["id"]]


def test_route_scope_round_trips_and_narrows_to_one_charts_ALERT_SET(client):
    """`POST scope` stores it; `GET ?scope=` returns global + that chart.

    The two halves have to be tested together: a scope that is stored but never
    filtered on is dead data, and a filter over a field nothing writes is a
    filter that can only ever return everything.
    """
    def _make(**extra):
        r = client.post("/api/indicator-alerts", json={
            "sym": "aapl", "indicator": "rsi", "condition": "above",
            "threshold": 70, "tf": "D", **extra})
        assert r.status_code == 200, r.text
        return r.json()["id"]

    glob = _make()
    c1 = _make(scope="chart-1")
    c2 = _make(scope="chart-2")

    served = {a["id"]: a for a in client.get("/api/indicator-alerts").json()["alerts"]}
    assert served[glob]["scope"] is None
    assert served[c1]["scope"] == "chart-1"

    def _ids(url):
        return {a["id"] for a in client.get(url).json()["alerts"]}

    # no parameter = the alert MANAGER's view, unchanged from before this shipped
    assert _ids("/api/indicator-alerts") == {glob, c1, c2}
    assert _ids("/api/indicator-alerts?scope=chart-1") == {glob, c1}
    assert _ids("/api/indicator-alerts?scope=chart-2") == {glob, c2}
    # a chart with nothing of its own still sees the global alert
    assert _ids("/api/indicator-alerts?scope=chart-9") == {glob}
    # …and a blank scope is not a chart id, so it cannot narrow anything
    assert _ids("/api/indicator-alerts?scope=") == {glob, c1, c2}


# ─── THE CREATE PATH REFUSES WHAT CAN NEVER FIRE ─────────────────────────────
#
# Phase C closed every hole in this lane except the first one: a user could arm
# an alert that was structurally mute and nothing anywhere said so. These tests
# close it — and the ORDER they are written in is the argument. The silence is
# MEASURED first, through the shipped evaluator on both lanes; only then is it
# refused. A validation test that constructs a request nobody would send proves
# nothing at all.

import ast          # noqa: E402
import datetime     # noqa: E402
import inspect      # noqa: E402
import math         # noqa: E402

from api.services import alert_series                             # noqa: E402
from api.services import indicator_alert_evaluator as ev          # noqa: E402


def _daily_bars(n=260):
    """The two encodings `_fetch_bars_for_alert` really hands the evaluator.

    Identical OHLCV; `t` is a `YYYYMMDD` calendar int for D/W/M and unix
    seconds for 1/5/15/30/60. Built here rather than imported from the service
    so the tests below are measuring the evaluator, not agreeing with the
    module under test about what a bar looks like.
    """
    base = datetime.date(2024, 1, 2)
    calendar, instant = [], []
    for i in range(n):
        day = base + datetime.timedelta(days=i)
        close = 100.0 + 10.0 * math.sin(i / 9.0) + i * 0.05
        ohlcv = {"o": close - 0.4, "h": close + 1.1, "l": close - 1.3,
                 "c": close, "v": 1_000_000 + i * 137}
        calendar.append({"t": int(day.strftime("%Y%m%d")), **ohlcv})
        instant.append({"t": int(datetime.datetime(
            day.year, day.month, day.day, 14, 30,
            tzinfo=datetime.timezone.utc).timestamp()), **ohlcv})
    return calendar, instant


_FUTURE = datetime.datetime(2030, 1, 1, tzinfo=datetime.timezone.utc).timestamp()


def _alert(indicator, condition="above", threshold=-1e9, tf="D"):
    return {"indicator": indicator, "condition": condition,
            "threshold": threshold, "tf": tf, "last_value": None,
            "params_json": None}


def test_the_refused_combination_IS_silently_inert_first_MEASURED_both_lanes():
    """⭐ THE NON-VACUITY PROOF, and it predates the refusal below it.

    A `vwap` alert on `tf="D"` is armed, active, and produces NOTHING — through
    the SHIPPED evaluator, on the forming lane that is live today AND on the
    closed lane Task 8 will flip to. The threshold is -1e9, so any number at all
    would have fired: `(None, False)` is the value lane having no answer, not
    the condition being unmet.

    THREE CONTROLS, because "returns None" is worth nothing on its own:
      1. `rsi` on the IDENTICAL bars fires on BOTH lanes — so neither lane is
         simply dead on this fixture.
      2. The identical OHLCV with a real unix-second `t` makes vwap fire on the
         forming lane — so the defect is the ENCODING, not the indicator.
      3. The column itself: 0 of 260 values on the calendar encoding, 260 of 260
         on the instant one.
    """
    calendar, instant = _daily_bars()

    # 1. both lanes are alive on these bars
    assert ev._evaluate_one(_alert("rsi"), calendar, mode="forming")[1] is True
    assert ev._evaluate_one_closed(
        _alert("rsi"), calendar, now_epoch=_FUTURE)[1] is True
    assert ev.closed_bar_index(calendar, "D", _FUTURE) == len(calendar) - 1

    # THE MEASUREMENT: mute in both modes.
    assert ev._evaluate_one(_alert("vwap"), calendar, mode="forming") == (None, False)
    assert ev._evaluate_one_closed(
        _alert("vwap"), calendar, now_epoch=_FUTURE)[:2] == (None, False)

    # 2 + 3. the encoding is the whole difference
    on_calendar = alert_series.SERIES_FUNCS["vwap"](calendar, {})
    on_instant = alert_series.SERIES_FUNCS["vwap"](instant, {})
    assert sum(v is not None for v in on_calendar) == 0
    assert sum(v is not None for v in on_instant) == len(instant)
    value, triggered = ev._evaluate_one(_alert("vwap"), instant, mode="forming")
    assert value is not None and triggered is True


def test_ichimoku_chikou_is_refused_ONLY_by_the_lane_that_cannot_answer_it(
        client, monkeypatch):
    """🔴 THE ONE THE VALIDATOR MUST NOT TOUCH — measured on both lanes, and the
    lane is DRIVEN rather than assumed.

    `ichimoku.chikou` has a 26-bar trailing pad, so the CLOSED bar's value is
    always `None` and it cannot fire after the cutover — Task 6 priced that at
    19,574 fires lost / 0 gained and the live production shadow lane confirmed
    it independently (30 of 31 addresses observed; the absentee was this one).
    But it fires NORMALLY on the forming lane. Both facts are true at once;
    which of them is the user's problem is `eval_mode()`'s answer, at call time,
    because the rollback lever moves that answer with no deploy.

    The mechanical difference from `vwap` is asserted, not asserted-about: an
    ALL-None column is dead in BOTH lanes (`instant_only_addresses`), a
    TRAILING-None column is dead in exactly one (`closed_lane_dead_addresses`).
    """
    calendar, _ = _daily_bars()
    column = alert_series.SERIES_FUNCS["ichimoku.chikou"](calendar, {})
    assert any(v is not None for v in column)          # NOT an empty column …
    assert column[-1] is None                          # … but padded at the end

    # alive on the forming lane
    assert ev._evaluate_one(
        _alert("ichimoku.chikou"), calendar, mode="forming")[1] is True
    # dead on the closed one — and THAT is the difference the gate reads
    assert ev._evaluate_one_closed(
        _alert("ichimoku.chikou"), calendar, now_epoch=_FUTURE)[:2] == (None, False)

    assert "ichimoku.chikou" not in ias.instant_only_addresses()
    assert "ichimoku.chikou" in ias.closed_lane_dead_addresses()

    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "forming")
    assert ias.refusal_for("ichimoku.chikou", "above", "D", 0.0) is None
    r = client.post("/api/indicator-alerts", json={
        "sym": "SPY", "indicator": "ichimoku.chikou", "condition": "above",
        "threshold": 0.0, "tf": "D"})
    assert r.status_code == 200, r.text

    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "closed")
    refusal = ias.refusal_for("ichimoku.chikou", "above", "D", 0.0)
    assert refusal is not None and ias.CLOSED_LANE_TRAILING_PAD in refusal
    r = client.post("/api/indicator-alerts", json={
        "sym": "SPY", "indicator": "ichimoku.chikou", "condition": "above",
        "threshold": 0.0, "tf": "D"})
    assert r.status_code == 400, r.text
    assert ias.CLOSED_LANE_TRAILING_PAD in r.text


def test_the_validator_refuses_nothing_that_is_alive_on_the_forming_lane(
        monkeypatch):
    """⛔ THE OVER-REFUSAL RAIL, over every catalog address at once.

    Walks the whole catalog on daily bars with the soak matrix's own
    (condition, threshold) choices. Any address whose column carries a value is
    ALIVE under `"forming"` and must be accepted there — `ichimoku.chikou` is in
    this set, and the mode is pinned explicitly so this rail keeps measuring the
    forming lane after the cutover rather than quietly changing subject.

    The last assertion is the non-vacuity floor: the loop has to have EXCLUDED
    something, or it is a rail over an empty exception set.
    """
    from tools import alert_soak_matrix as soak
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "forming")
    calendar, _ = _daily_bars()

    mute_on_forming = set()
    for spec in soak.catalog_addresses():
        column = alert_series.SERIES_FUNCS[spec["address"]](calendar, {})
        refusal = ias.refusal_for(spec["address"], spec["condition"], "D",
                                  spec["threshold"])
        if any(v is not None for v in column):
            assert refusal is None, (
                f"{spec['address']} produces a value on the live lane and was "
                f"refused anyway: {refusal}")
        else:
            mute_on_forming.add(spec["address"])
            assert refusal is not None, f"{spec['address']} is mute and accepted"

    assert mute_on_forming == {"vwap"}, (
        "the rail must have excluded something or it proves nothing")


def test_the_validator_refuses_EXACTLY_TWO_addresses_on_the_closed_lane(
        monkeypatch):
    """The same rail, run against the lane the cutover flipped to.

    ⛔ THE SET IS DERIVED FROM THE TWO MEASUREMENTS, NOT TYPED HERE. `vwap` is
    all-None on a calendar timeframe (dead in both lanes) and `ichimoku.chikou`
    is trailing-None (dead in this one only); the assertion compares what the
    gate actually refused against the union of the two measured sets, so a
    future address joining either one is covered on the day it lands and this
    number moves as a finding rather than as a literal somebody forgot.
    """
    from tools import alert_soak_matrix as soak
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "closed")

    refused = {spec["address"] for spec in soak.catalog_addresses()
               if ias.refusal_for(spec["address"], spec["condition"], "D",
                                  spec["threshold"]) is not None}
    assert refused == set(ias.instant_only_addresses()) | set(
        ias.closed_lane_dead_addresses())
    assert refused == {"vwap", "ichimoku.chikou"}, refused
    # …and the rail is not a rail over everything: 29 of 31 stay armable.
    assert len(soak.catalog_addresses()) - len(refused) == 29


def test_the_probe_resolves_every_catalog_address():
    """`instant_only_addresses()` classifies from a MEASUREMENT — so the
    measurement has to succeed for every address, or the safe branch ("could
    not tell") is quietly doing the work and the guard is a guard over nothing.
    """
    instant, calendar = ias._probe_series()
    unresolved = [a for a in ev.all_addresses()
                  if not any(v is not None
                             for v in alert_series.SERIES_FUNCS[a](instant, {}))]
    assert unresolved == []
    assert len(ev.all_addresses()) == 31
    assert len(instant) == len(calendar) == ias._PROBE_BARS
    # the two probe series differ in `t` and in NOTHING else
    assert [{k: v for k, v in b.items() if k != "t"} for b in instant] == \
           [{k: v for k, v in b.items() if k != "t"} for b in calendar]


def test_the_measured_instant_only_set_is_exactly_vwap_today():
    """The set is DERIVED, and this pins what it currently measures to.

    If a future address gains the same dependency it is covered on the day it
    lands and this number moves — which is a finding to read, not a literal to
    keep in step by hand.
    """
    assert ias.instant_only_addresses() == frozenset({"vwap"})


def test_the_offered_rules_are_exactly_the_ones_check_condition_handles():
    """⛔ EQUALITY BOTH WAYS, derived by AST from `check_condition` itself.

    `evaluable_conditions()` reads the CATALOG. Refusing on it is only sound if
    the catalog union and `check_condition`'s branches are the same set:

      * a branch with no catalog row  → the gate OVER-refuses a rule that fires;
      * a catalog row with no branch  → the dropdown offers a rule that cannot.

    The branches are read off the function's own AST **by name**, never by line
    slice — a co-worker inserting lines above it returned the wrong slice for
    real this phase.
    """
    from api.services import alert_conditions
    tree = ast.parse(inspect.getsource(alert_conditions))
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "check_condition")
    branches = {
        node.comparators[0].value
        for node in ast.walk(fn)
        if isinstance(node, ast.Compare)
        and isinstance(node.left, ast.Name) and node.left.id == "condition"
        and len(node.ops) == 1 and isinstance(node.ops[0], ast.Eq)
        and isinstance(node.comparators[0], ast.Constant)
        and isinstance(node.comparators[0].value, str)
    }
    assert branches, "the AST scan found no branches — it is not reading the fn"
    assert branches == set(ias.evaluable_conditions())


def test_check_condition_is_the_SOLE_DECIDER_in_BOTH_lanes():
    """Why every refusal here can claim "in either evaluation mode".

    Each gate's argument ends at `check_condition` answering False. That is only
    a both-modes claim if both lanes route `triggered` through it — asserted
    structurally, on the FunctionDefs found BY NAME. (`git grep -c` counted
    prose comments as call sites twice this phase; an AST does not.)
    """
    tree = ast.parse(inspect.getsource(ev))
    for name in ("_evaluate_one", "_evaluate_one_closed"):
        fn = next(n for n in ast.walk(tree)
                  if isinstance(n, ast.FunctionDef) and n.name == name)
        calls = [n for n in ast.walk(fn)
                 if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                 and n.func.id == "check_condition"]
        assert len(calls) == 1, f"{name} decides `triggered` some other way"


def test_the_derived_rule_reproduces_the_catalogs_needs_threshold_column():
    """Two independent authorities agreeing, across every offered pair.

    `needs_threshold` is hand-declared per (address, condition) in
    `ALERT_CONDITIONS`. The gate never reads it: it measures `check_condition`
    with `threshold=None` and subtracts the pairs `THRESHOLD_OPERAND` declares a
    right-hand side for. If those two ever disagree, one of them is lying about
    whether the user has to type a number.
    """
    needs_level = ias.conditions_needing_a_level()
    assert needs_level == frozenset(
        {"above", "below", "cross_above", "cross_below",
         "touch_upper", "touch_lower"})
    assert "cross_zero" not in needs_level      # it needs no right-hand side

    checked = 0
    for address, conditions in ev.ALERT_CONDITIONS.items():
        for cond in conditions:
            derived = (cond["value"] in needs_level
                       and (address, cond["value"]) not in ev.THRESHOLD_OPERAND)
            assert derived is cond["needs_threshold"], (
                f"{address}/{cond['value']}: declared "
                f"{cond['needs_threshold']}, measured {derived}")
            checked += 1
    assert checked >= 31, "the reconciliation walked almost nothing"


def test_the_route_REFUSES_a_daily_vwap_alert_and_says_why(client):
    """THE NAMED GAP. 400, a message that explains itself, and nothing stored."""
    r = client.post("/api/indicator-alerts", json={
        "sym": "SPY", "indicator": "vwap", "condition": "above",
        "threshold": 400.0, "tf": "D"})
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    assert ias.REFUSAL_INTRADAY_ONLY in detail
    assert "VWAP" in detail and "calendar date" in detail
    assert client.get("/api/indicator-alerts").json()["alerts"] == []
    # W and M are the same store encoding and are refused the same way …
    for tf in ("W", "M", "d"):
        rr = client.post("/api/indicator-alerts", json={
            "sym": "SPY", "indicator": "vwap", "condition": "above",
            "threshold": 400.0, "tf": tf})
        assert rr.status_code == 400, (tf, rr.text)
    # … while every intraday timeframe still arms, which is the point
    for tf in sorted(ev._TF_MINUTES):
        rr = client.post("/api/indicator-alerts", json={
            "sym": "SPY", "indicator": "vwap", "condition": "above",
            "threshold": 400.0, "tf": tf})
        assert rr.status_code == 200, (tf, rr.text)


def test_the_route_REFUSES_a_rule_the_evaluator_cannot_judge(client):
    r = client.post("/api/indicator-alerts", json={
        "sym": "SPY", "indicator": "rsi", "condition": "crosses_sideways",
        "threshold": 70.0, "tf": "5"})
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    assert ias.REFUSAL_UNJUDGEABLE_CONDITION in detail
    assert "cross_above" in detail          # it names what it WOULD accept
    assert client.get("/api/indicator-alerts").json()["alerts"] == []


def test_the_route_REFUSES_a_level_rule_with_no_level(client):
    r = client.post("/api/indicator-alerts", json={
        "sym": "SPY", "indicator": "rsi", "condition": "above", "tf": "5"})
    assert r.status_code == 400, r.text
    assert ias.REFUSAL_NO_LEVEL in r.json()["detail"]
    assert client.get("/api/indicator-alerts").json()["alerts"] == []


def test_the_route_STILL_ACCEPTS_every_combination_that_works(client):
    """⛔ THE ACCEPTANCE HALF. Each of these would fire, and three of them carry
    NO threshold on purpose — `THRESHOLD_OPERAND` supplies their right-hand side
    and a gate that did not know that would refuse three shipped alert types.
    """
    working = [
        {"indicator": "rsi", "condition": "above", "threshold": 70.0, "tf": "D"},
        {"indicator": "vwap", "condition": "cross_above", "threshold": 400.0, "tf": "5"},
        {"indicator": "bb", "condition": "touch_upper", "tf": "D"},
        {"indicator": "sar.priceCrossedSar", "condition": "above", "tf": "5"},
        {"indicator": "sar.trendFlipped", "condition": "above", "tf": "D"},
        {"indicator": "macd", "condition": "cross_zero", "tf": "D"},
        {"indicator": "obv", "condition": "cross_zero", "tf": "W"},
        {"indicator": "close", "condition": "below", "threshold": 400.0, "tf": "M"},
        {"indicator": "ADX.PLUSDI", "condition": "above", "threshold": 25.0, "tf": "60"},
    ]
    for body in working:
        r = client.post("/api/indicator-alerts",
                        json={"sym": "SPY", **body})
        assert r.status_code == 200, (body, r.text)
    assert len(client.get("/api/indicator-alerts").json()["alerts"]) == len(working)


def test_the_three_refusals_are_DISJOINT(monkeypatch):
    """🔑 THE TASK 9 LESSON, made mechanical.

    Two gates shared a refusal phrase there, so `pytest.raises(match=…)` still
    matched with the second safety DELETED — the test would have passed on a
    tree with the guard gone. Each anchor must appear in ITS message and in no
    other, so a test that anchors on one cannot be satisfied by another gate.

    ⚠️ FOUR ANCHORS SINCE THE CUTOVER. The displaced-column gate only speaks
    under `"closed"`, so the lane is pinned here — and it has to be pinned to
    the one lane in which ALL FOUR can produce a message at once, or one of them
    would be `None` and its row would be vacuously disjoint from everything.
    """
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "closed")
    messages = {
        "condition": ias.refusal_for("rsi", "nonsense", "5", 70.0),
        "timeframe": ias.refusal_for("vwap", "above", "D", 400.0),
        "level": ias.refusal_for("rsi", "above", "5", None),
        "displaced": ias.refusal_for("ichimoku.chikou", "above", "5", 0.0),
    }
    anchors = {
        "condition": ias.REFUSAL_UNJUDGEABLE_CONDITION,
        "timeframe": ias.REFUSAL_INTRADAY_ONLY,
        "level": ias.REFUSAL_NO_LEVEL,
        "displaced": ias.CLOSED_LANE_TRAILING_PAD,
    }
    assert all(messages.values()), "a gate produced no refusal at all"
    for gate, anchor in anchors.items():
        for other, message in messages.items():
            assert (anchor in message) is (gate == other), (
                f"anchor {anchor!r} matches the {other} refusal")
    for a, b in ((x, y) for x in anchors.values() for y in anchors.values()
                 if x is not y):
        assert a not in b


def test_create_ITSELF_is_not_gated_so_the_31_armed_rows_are_untouched(tmp_db):
    """⛔ THE REFUSAL IS THE API SURFACE, NOT THE WRITER.

    Thirty-one soak alerts are armed on production and internal tooling writes
    through `create()`. Gating the writer would change what an already-shipped
    tool can do and would make this fix a migration. `refusal_for` is the gate;
    `create` still inserts what it is handed, and this pins the difference.
    """
    aid = ias.create(user_id="u1", sym="SPY", indicator="vwap",
                     condition="above", threshold=1.0, tf="D")
    assert ias.get(aid)["indicator"] == "vwap"
    assert ias.refusal_for("vwap", "above", "D", 1.0) is not None


def test_the_soak_matrix_still_arms_31_and_stays_IDEMPOTENT(tmp_db):
    """⭐ THE MATRIX'S OWN LOGIC, RUN — not a re-description of it.

    31 rows are armed on production right now and Task 8's cutover gate rests on
    them. `--arm` has to keep working and keep being idempotent.
    """
    from tools import alert_soak_matrix as soak

    first = soak.arm("owner-1", soak.DEFAULT_SYM, soak.DEFAULT_TF, 30)
    assert len(first["created"]) == 31 and first["kept"] == []

    second = soak.arm("owner-1", soak.DEFAULT_SYM, soak.DEFAULT_TF, 30)
    assert second["created"] == [] and len(second["kept"]) == 31

    out = soak.verify()
    assert out["armed"] == 31
    assert out["visible_to_shadow"] == 31
    assert out["deliverable_now"] == 0
    assert out["missing"] == []
    assert out["addresses_covered"] == out["addresses_expected"] == 31


def test_the_validation_accepts_every_row_the_soak_matrix_arms(client,
                                                                monkeypatch):
    """The same 31 specs, pushed through the REAL create path this time.

    `arm()` calls `ias.create` directly, so the test above proves the tool is
    unbroken but says nothing about the gate. This runs the matrix's own
    `catalog_addresses()` — its condition and threshold choices, at its own
    `DEFAULT_TF` — through the HTTP route, which is where every refusal lives.

    🔴 AND SINCE THE CLOSED-BAR CUTOVER THE HONEST ANSWER IS 30, NOT 31, WHICH IS
    A REAL CONSEQUENCE AND NOT A TEST BEING RELAXED. `ichimoku.chikou` is
    displaced 26 bars, so the lane that now ships can never produce a value for
    it, and the create path refuses a NEW one. The soak matrix's `arm()` is
    deliberately NOT gated (it writes through `create`), so the 31 armed rows on
    production are untouched — the gate is the API surface, not the writer, and
    this test now pins BOTH halves of that split.

    ⛔ THE REFUSED SET IS DERIVED FROM THE MEASUREMENT, not listed here, so a
    future address with the same shape is covered on the day it lands.
    """
    from tools import alert_soak_matrix as soak
    from api.services import indicator_alert_evaluator as _ev

    specs = soak.catalog_addresses()
    assert len(specs) == 31

    monkeypatch.setenv(_ev.ALERT_EVAL_MODE_ENV, "closed")
    refused_addresses = set(ias.closed_lane_dead_addresses())
    assert refused_addresses == {"ichimoku.chikou"}, refused_addresses

    refused = []
    for spec in specs:
        r = client.post("/api/indicator-alerts", json={
            "sym": soak.DEFAULT_SYM, "indicator": spec["address"],
            "condition": spec["condition"], "threshold": spec["threshold"],
            "tf": soak.DEFAULT_TF})
        if spec["address"] in refused_addresses:
            assert r.status_code == 400, (spec, r.text)
            assert ias.CLOSED_LANE_TRAILING_PAD in r.text
            refused.append(spec["address"])
        else:
            assert r.status_code == 200, (spec, r.text)
    assert sorted(refused) == sorted(refused_addresses)
    assert len(client.get("/api/indicator-alerts").json()["alerts"]) == 30

    # …and on the ROLLBACK lane the whole catalog is armable again, with no
    # deploy and no code change. The gate reads `eval_mode()`, so this is one
    # environment variable rather than a revert.
    monkeypatch.setenv(_ev.ALERT_EVAL_MODE_ENV, "forming")
    for spec in specs:
        assert ias.refusal_for(spec["address"], spec["condition"],
                               soak.DEFAULT_TF, spec["threshold"]) is None, spec


# ─── THE SNOOZE IS A WINDOW, NOT A LABEL ─────────────────────────────────────
#
# Three defects, all reproduced on real rows before being fixed. The snooze was
# enforced by one mutable text column while fire-once was enforced by a UNIQUE
# constraint — and that asymmetry is the whole story: anything that rewrote the
# state cancelled the snooze, and nothing anywhere noticed.

_T0 = 1_800_000_000.0
_DAY = 86400


def _snoozed_alert(user_id="u1", **kw):
    aid = ias.create(user_id=user_id, sym="SPY", indicator="rsi",
                     condition="above", threshold=0.0, tf="5", **kw)
    ias.snooze(aid, ias.SNOOZE_MAX_MINUTES, now=_T0)
    return aid


def test_a_snooze_SURVIVES_mark_needs_attention(tmp_db):
    """🔴 P0-2, MEASURED FIRST. The sweep that rewrites the state must not
    silence-cancel a snooze the user is still inside.

    `sweep_silent_alerts` runs unconditionally every 300 s from `api/main.py`
    and calls `mark_needs_attention` for any active alert that produced no value
    — one failed bars fetch. It writes `state='needs_attention'` and leaves
    `snooze_until` untouched, so an enforcement keyed on the STATE let the very
    next true reading through. All 31 production soak rows share one `(SPY,"5")`
    bar group, so one fetch failure un-muzzled all 31 at once.
    """
    aid = _snoozed_alert()
    assert ias.record_trigger(aid, 99.0, now=_T0 + 60) is False   # baseline: quiet

    ias.mark_needs_attention(aid, "bars fetch returned nothing", now=_T0 + 120)
    row = ias.get(aid)
    # the state really did move — the mutation this survives is real, not staged
    assert row["state"] == ias.STATE_NEEDS_ATTENTION
    assert row["snooze_until"] is not None
    assert row["snooze_until"] - (_T0 + 120) > 28 * _DAY   # still deep inside it

    assert ias.snooze_active(row, _T0 + 120) is True
    assert ias.record_trigger(aid, 99.0, now=_T0 + 180) is False
    assert ias.claim_delivery(aid) is False
    assert ias.get(aid)["trigger_count"] == 0


def test_a_STALE_undelivered_fire_is_not_delivered_inside_a_snooze(tmp_db):
    """🔴 P0-3's CONSEQUENCE, closed at the delivery boundary.

    `_run_one_cycle` discards `record_trigger`'s return and calls
    `_dispatch_delivery` regardless, so delivery is gated by *"is there an
    undelivered fire row"* rather than by the snooze. A fire recorded BEFORE the
    snooze began was therefore claimed — and delivered — inside the window.

    ⚠️ THE CALL SITE IS TASK 8's FILE AND IS DELIBERATELY UNCHANGED. This pins
    the boundary guard, which every channel is downstream of.
    """
    aid = ias.create(user_id="u1", sym="SPY", indicator="rsi",
                     condition="above", threshold=0.0, tf="5")
    assert ias.record_trigger(aid, 99.0, now=_T0) is True   # a real, undelivered fire
    ias.snooze(aid, 60, now=_T0 + 60)

    assert ias.claim_delivery(aid) is False                 # muzzled …
    ias.rearm(aid, now=_T0 + 120)                           # … until asked otherwise
    assert ias.get(aid)["snooze_until"] is None
    assert ias.claim_delivery(aid) is True


def test_an_EXPIRED_snooze_still_re_arms_whatever_the_state_drifted_to(tmp_db):
    """The other direction, and it is the one a fix like this usually breaks.

    "Quiet for N minutes" has to end. The re-arm now keys on `snooze_until`
    having passed rather than on the state still reading `snoozed`, so it fires
    exactly once (`_rearm` clears the column) even if the sweep moved the state
    in between.
    """
    aid = _snoozed_alert()
    ias.mark_needs_attention(aid, "quiet", now=_T0 + 60)
    past = _T0 + 31 * _DAY
    assert ias.snooze_active(ias.get(aid), past) is False
    assert ias.record_trigger(aid, 99.0, now=past) is True
    row = ias.get(aid)
    assert row["snooze_until"] is None and row["trigger_count"] == 1

    # …and a NON-triggering evaluation re-arms an expired snooze the same way
    other = _snoozed_alert()
    assert ias.record_evaluation(other, 1.0, now=_T0 + 60) is False
    assert ias.record_evaluation(other, 1.0, now=past) is True
    assert ias.get(other)["state"] == ias.STATE_ARMED


def test_the_manual_rearm_button_still_CANCELS_a_snooze(tmp_db, client):
    """`_rearm` clears the window — the one place a human asked for it."""
    aid = _snoozed_alert(user_id="user-abc")   # the id the `client` fixture owns
    assert ias.snooze_active(ias.get(aid)) is True
    r = client.post(f"/api/indicator-alerts/{aid}/rearm")
    assert r.status_code == 200, r.text
    assert ias.get(aid)["snooze_until"] is None
    assert ias.snooze_active(ias.get(aid)) is False


def test_verify_goes_RED_BEFORE_the_muzzle_expires_not_after(tmp_db, monkeypatch):
    """🔴 P0-1: a health check that reads green right up to the failure.

    `deliverable_now` was `state != snoozed`, so it said **0** on the cycle
    before the emails went out, and `snooze_until` appeared nowhere in the tool.
    Both numbers now come from `ias.snooze_active` — the same predicate the
    service enforces with — and the countdown is itself an exit-1.

    Blast radius if it were left silent: 27 of the 31 catalog specs fire on the
    first cycle past expiry.
    """
    from tools import alert_soak_matrix as soak
    import time as _time

    for spec in soak.catalog_addresses():
        aid = ias.create(user_id="owner-1", sym="SPY", indicator=spec["address"],
                         condition=spec["condition"], threshold=spec["threshold"],
                         tf="5", params_json={soak.SOAK_KEY: soak.SOAK_TAG})
        ias.snooze(aid, ias.SNOOZE_MAX_MINUTES)

    out = soak.verify()
    assert out["armed"] == 31 and out["deliverable_now"] == 0
    assert out["expiring_soon"] == 0
    assert out["muzzle_expires_in_days"] > soak.EXPIRY_WARN_DAYS
    assert soak.main(["--verify"]) == 0

    # …now stand inside the warning horizon. Nothing has been delivered yet and
    # `state` still reads `snoozed` — the old check would have said 0 and 0.
    late = _time.time() + (30 - 1) * _DAY
    monkeypatch.setattr(soak.time, "time", lambda: late)
    monkeypatch.setattr(ias.time, "time", lambda: late)
    warned = soak.verify()
    assert all(a["state"] == ias.STATE_SNOOZED for a in soak.soak_rows())
    assert warned["deliverable_now"] == 0        # still muzzled …
    assert warned["expiring_soon"] == 31         # … and it says the clock is running
    assert soak.main(["--verify"]) == 1

    # past the window: deliverable, and still red
    gone = _time.time() + 31 * _DAY
    monkeypatch.setattr(soak.time, "time", lambda: gone)
    monkeypatch.setattr(ias.time, "time", lambda: gone)
    assert soak.verify()["deliverable_now"] == 31
    assert soak.main(["--verify"]) == 1


def test_the_soak_stays_VISIBLE_to_the_shadow_lane_through_all_of_it(tmp_db):
    """⛔ THE CONSTRAINT THAT OUTRANKS THE FIX. Task 8's cutover gate reads
    `list_active()`; a muzzle that hid rows from it would make that gate
    vacuous. Muzzled and invisible are different things and must stay so.
    """
    from tools import alert_soak_matrix as soak
    soak.arm("owner-1", soak.DEFAULT_SYM, soak.DEFAULT_TF, 30)
    ids = {a["id"] for a in soak.soak_rows()}
    assert len(ids) == 31
    assert ids <= {a["id"] for a in ias.list_active()}

    # even after the sweep rewrites every state, they stay visible AND muzzled
    for aid in ids:
        ias.mark_needs_attention(aid, "no bars this cycle")
    assert ids <= {a["id"] for a in ias.list_active()}
    assert all(ias.snooze_active(a) for a in soak.soak_rows())
    assert soak.verify()["deliverable_now"] == 0
    assert all(ias.record_trigger(aid, 99.0) is False for aid in ids)

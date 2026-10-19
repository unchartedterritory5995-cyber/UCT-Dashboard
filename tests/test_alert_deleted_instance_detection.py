"""A0 — an alert whose chart indicator was DELETED is detected, never silently bound.

The chart records a removal as a tombstone, `{instanceId, deleted: true}`
(`app/src/components/chart/instanceShape.js`). The orphan sweep's walker collected
every `instanceId` in the blob, tombstones included, so the alert of a deleted
indicator always looked bound: `instance_missing` was never set, and the alert went
on describing itself as an instance that no longer existed. Measured on master on
2026-10-13 (Phase A, PA3 N6). These tests hold the repaired reading:

  * a tombstoned instance flags its alert, and the alert KEEPS EVALUATING (the sweep
    is a disclosure, not a disarm — firing behaviour does not change);
  * a re-add (`deleted: false`, or a full instance) clears the flag;
  * a HIDDEN instance is still on the chart, so it is not an orphan;
  * a tombstone in one blob does not orphan the same id still live in another.
"""
from __future__ import annotations

import json

import pytest

from api.services import indicator_alert_service as ias


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db_path))
    monkeypatch.setattr(ias, "_DB_PATH", str(db_path))
    ias.init_schema()
    return db_path


def _prefs(monkeypatch, blobs: dict):
    from api.services import auth_service
    monkeypatch.setattr(auth_service, "get_user_preferences",
                        lambda uid: dict(blobs.get(uid, {})), raising=False)


def _workspace(*instances) -> str:
    """`charts_workspace_layout` with the instances where the real one keeps them."""
    return json.dumps({"widgets": [{"id": "w1", "opts": {"settings": {
        "indicatorInstances": list(instances)}}}]})


def _live(iid, **extra):
    return {"instanceId": iid, "defId": "rsi", "inputs": {"period": 7}, **extra}


def _tombstone(iid):
    return {"instanceId": iid, "deleted": True}


def _alert(instance_id):
    return ias.create(user_id="u1", sym="AAPL", indicator="rsi", condition="above",
                      threshold=70, tf="D", params_json={"period": 7},
                      instance_id=instance_id)


def test_a_TOMBSTONED_instance_flags_its_alert_and_the_alert_keeps_evaluating(tmp_db, monkeypatch):
    alert_id = _alert("inst:rsi:1")
    _prefs(monkeypatch, {"u1": {"charts_workspace_layout":
                                _workspace(_live("inst:rsi:1"), _live("inst:rsi:2"))}})
    assert ias.sweep_orphaned_instances()["orphaned"] == 0

    # The member deletes RSI(7): the chart writes a tombstone, not an absence.
    _prefs(monkeypatch, {"u1": {"charts_workspace_layout":
                                _workspace(_tombstone("inst:rsi:1"), _live("inst:rsi:2"))}})
    out = ias.sweep_orphaned_instances()
    assert out["checked"] == 1 and out["orphaned"] == 1
    row = ias.get(alert_id)
    assert row["instance_missing"] is True
    # ⛔ A disclosure, not a disarm: nothing about firing changes.
    assert row["active"] is True and row["state"] == ias.STATE_ARMED


def test_a_RE_ADD_clears_the_flag(tmp_db, monkeypatch):
    alert_id = _alert("inst:rsi:1")
    _prefs(monkeypatch, {"u1": {"chart_settings": _workspace(_tombstone("inst:rsi:1"))}})
    assert ias.sweep_orphaned_instances()["orphaned"] == 1

    _prefs(monkeypatch, {"u1": {"chart_settings":
                                _workspace({"instanceId": "inst:rsi:1", "deleted": False,
                                            "defId": "rsi", "inputs": {"period": 7}})}})
    assert ias.sweep_orphaned_instances()["cleared"] == 1
    assert ias.get(alert_id)["instance_missing"] is False


def test_a_HIDDEN_instance_is_still_on_the_chart(tmp_db, monkeypatch):
    alert_id = _alert("inst:rsi:1")
    _prefs(monkeypatch, {"u1": {"chart_settings": _workspace(_live("inst:rsi:1", hidden=True))}})
    assert ias.sweep_orphaned_instances()["orphaned"] == 0
    assert ias.get(alert_id)["instance_missing"] is False


def test_a_tombstone_in_one_blob_does_not_orphan_a_live_copy_in_another(tmp_db, monkeypatch):
    """The global `chart_settings` is only a SEED; the live chart is the workspace."""
    alert_id = _alert("inst:rsi:1")
    _prefs(monkeypatch, {"u1": {
        "chart_settings": _workspace(_tombstone("inst:rsi:1")),
        "charts_workspace_layout": _workspace(_live("inst:rsi:1")),
    }})
    assert ias.sweep_orphaned_instances()["orphaned"] == 0
    assert ias.get(alert_id)["instance_missing"] is False

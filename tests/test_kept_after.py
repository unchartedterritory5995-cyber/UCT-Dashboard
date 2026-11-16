"""L7, the rest (Studio plan, section 7): was it wanted? Of the indicators saved from the dock a
week or more ago, how many are still stored. The 'saved' event carries the stored definition's
own id, held to the store's id pattern so no text can ride on it."""
from __future__ import annotations

import pytest

from api.services import auth_db, indicator_telemetry as tel
from api.services import user_definitions as defs


@pytest.fixture(autouse=True)
def stores(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    auth_db.init_db()
    monkeypatch.setattr(defs, "_DB_PATH", str(tmp_path / "defs.db"))
    defs._init_db()


def defn(def_id):
    return {"schemaVersion": 1, "id": def_id, "version": 1,
            "meta": {"name": "Kept", "shortName": "K", "repaint": "non-repainting"},
            "compute": {"kind": "ast", "ast": {"type": "call", "name": "sma", "args": [
                {"type": "series", "name": "close"}, {"type": "num", "value": 20}]}},
            "placement": {"target": "price"}, "plots": [{"key": "value", "style": "line", "role": "primary"}],
            "inputs": []}


def saved(uid, def_id, days_ago, lineage):
    assert tel.log_event(uid, "studio_action", import_id=f"{lineage}:saved",
                         conversation_id=lineage, action="saved", surface="studio", def_id=def_id) is True
    conn = auth_db.get_connection()
    try:
        conn.execute("UPDATE landing_events SET created_at = datetime('now', ?) WHERE event='studio_action'"
                     " AND json_extract(props, '$.def_id') = ?", (f"-{days_ago} days", def_id))
        conn.commit()
    finally:
        conn.close()


def test_saved_a_week_ago_and_still_stored_counts_and_a_deleted_one_does_not():
    for d in ("u_00000000000a", "u_00000000000b"):
        defs.save("u1", d, defn(d))
    saved("u1", "u_00000000000a", 9, "auth_aaaaaaaaaaaa")
    saved("u1", "u_00000000000b", 10, "auth_bbbbbbbbbbbb")
    defs.soft_delete("u1", "u_00000000000b")
    k = tel.kept_after(7, 30)
    assert k["saved"] == 2 and k["still_stored"] == 1 and k["still_stored_rate"] == 0.5


def test_a_save_younger_than_a_week_is_not_judged_yet():
    defs.save("u1", "u_00000000000c", defn("u_00000000000c"))
    saved("u1", "u_00000000000c", 2, "auth_cccccccccccc")
    assert tel.kept_after(7, 30)["saved"] == 0
    assert tel.kept_after(7, 30)["still_stored_rate"] is None


def test_the_id_must_be_the_stores_own_shape_or_it_is_not_stored_at_all():
    tel.log_event("u1", "studio_action", import_id="auth_dddddddddddd:saved", conversation_id="auth_dddddddddddd",
                  action="saved", surface="studio", def_id="My secret strategy")
    conn = auth_db.get_connection()
    try:
        (props,) = conn.execute("SELECT props FROM landing_events WHERE event='studio_action'").fetchone()
    finally:
        conn.close()
    assert "secret" not in (props or "")


def test_the_owner_report_carries_it():
    assert set(tel.rollout_report(7)["kept_after_7_days"]) == {
        "min_age_days", "window_days", "saved", "still_stored", "still_stored_rate"}

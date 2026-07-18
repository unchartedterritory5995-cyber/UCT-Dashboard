"""charts_layout_service — user-scope saves must work with auth.db's UUID user ids.

Regression for the 2026-07-17 "Chart layouts won't save" support ticket:
upsert() coerced user_id with int(), but users.id is a UUID string, so every
scope='user' save 500'd while scope='global' (uid=0) saves worked.
"""
import uuid

import pytest

from api.services import charts_layout_service as svc

UUID_USER = "7a6d0299-fd98-4017-b8dc-51b849d1ab1d"


@pytest.fixture(autouse=True)
def _tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "charts_layouts.db"))
    svc._init_db()


def test_user_scope_upsert_accepts_uuid_user_id():
    row = svc.upsert("user", UUID_USER, "My Layout",
                     {"widgets": [], "cols": 24}, None, "Tester")
    assert row["name"] == "My Layout"
    assert row["user_id"] == UUID_USER
    assert [r["name"] for r in svc.list_for_user(UUID_USER)["mine"]] == ["My Layout"]
    # another user's list must not see it
    assert svc.list_for_user(str(uuid.uuid4()))["mine"] == []


def test_user_scope_upsert_updates_existing_row():
    svc.upsert("user", UUID_USER, "L", {"widgets": [], "cols": 24}, None, "T")
    svc.upsert("user", UUID_USER, "L", {"widgets": [{"id": "x"}], "cols": 12},
               {"A": "SPY"}, "T")
    mine = svc.list_for_user(UUID_USER)["mine"]
    assert len(mine) == 1
    assert mine[0]["layout"]["cols"] == 12
    assert mine[0]["groups"] == {"A": "SPY"}


def test_delete_roundtrip_with_uuid_owner():
    row = svc.upsert("user", UUID_USER, "Gone", {"widgets": []}, None, "T")
    assert svc.get(row["id"])["user_id"] == UUID_USER
    assert svc.delete(row["id"]) is True
    assert svc.list_for_user(UUID_USER)["mine"] == []


def test_global_scope_still_stored_under_uid_zero():
    row = svc.upsert("global", UUID_USER, "Prebuilt", {"widgets": []}, None, "Admin")
    assert row["user_id"] == 0
    assert [r["name"] for r in svc.list_for_user(UUID_USER)["global"]] == ["Prebuilt"]

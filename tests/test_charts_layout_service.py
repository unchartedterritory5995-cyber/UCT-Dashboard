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


def test_rename_updates_in_place_without_creating_a_second_row():
    """The whole reason rename() exists: upsert is keyed on (scope, user_id,
    name), so 'saving under a new name' creates a SECOND row rather than
    renaming the first."""
    row = svc.upsert("user", UUID_USER, "Main", {"widgets": [], "cols": 24}, None, "T")
    renamed = svc.rename(row["id"], "Day Trading")
    assert renamed["id"] == row["id"]
    assert renamed["name"] == "Day Trading"
    mine = svc.list_for_user(UUID_USER)["mine"]
    assert [r["name"] for r in mine] == ["Day Trading"]


def test_rename_keeps_the_layout_body_intact():
    row = svc.upsert("user", UUID_USER, "Main", {"widgets": [{"id": "a"}], "cols": 12},
                     {"A": "SPY"}, "T")
    renamed = svc.rename(row["id"], "Renamed")
    assert renamed["layout"] == {"widgets": [{"id": "a"}], "cols": 12}
    assert renamed["groups"] == {"A": "SPY"}


def test_rename_onto_a_name_you_already_use_raises_rather_than_merging():
    """UNIQUE(scope, user_id, name). The router turns this into a 409 — silently
    merging two layouts would destroy one of them."""
    import sqlite3
    svc.upsert("user", UUID_USER, "Keep", {"widgets": []}, None, "T")
    other = svc.upsert("user", UUID_USER, "Rename me", {"widgets": []}, None, "T")
    with pytest.raises(sqlite3.IntegrityError):
        svc.rename(other["id"], "Keep")
    assert sorted(r["name"] for r in svc.list_for_user(UUID_USER)["mine"]) == ["Keep", "Rename me"]


def test_rename_a_layout_that_is_gone_returns_none():
    assert svc.rename(999999, "Ghost") is None


def test_two_users_may_hold_the_same_layout_name():
    """The UNIQUE is per (scope, user_id) — a rename must not collide with a
    DIFFERENT member's layout of that name."""
    other_user = str(uuid.uuid4())
    svc.upsert("user", other_user, "Shared Name", {"widgets": []}, None, "T")
    mine = svc.upsert("user", UUID_USER, "Mine", {"widgets": []}, None, "T")
    renamed = svc.rename(mine["id"], "Shared Name")
    assert renamed["name"] == "Shared Name"


# ═══ sharing (terminal-grade property 3) ═════════════════════════════════════


def test_share_mints_a_token_that_resolves_to_the_layout():
    row = svc.upsert("user", UUID_USER, "Swing Setup",
                     {"widgets": [{"id": "a"}], "cols": 24}, {"A": "NVDA"}, "T")
    out = svc.share(UUID_USER, row["id"])
    assert out["token"].startswith("cl_")
    resolved = svc.resolve_share(out["token"])
    assert resolved["name"] == "Swing Setup"
    assert resolved["groups"] == {"A": "NVDA"}


def test_share_is_idempotent_pressing_twice_returns_the_same_token():
    row = svc.upsert("user", UUID_USER, "L", {"widgets": []}, None, "T")
    first = svc.share(UUID_USER, row["id"])
    second = svc.share(UUID_USER, row["id"])
    assert first["token"] == second["token"]


def test_share_refuses_a_layout_you_do_not_own():
    other_user = str(uuid.uuid4())
    row = svc.upsert("user", other_user, "Not Yours", {"widgets": []}, None, "T")
    assert svc.share(UUID_USER, row["id"]) is None


def test_share_refuses_a_global_prebuilt_layout():
    """Global layouts are already visible to everyone via list_for_user — a
    personal share link on top of that is a different, unbuilt permission
    model, not a natural extension of it."""
    row = svc.upsert("global", UUID_USER, "Prebuilt", {"widgets": []}, None, "Admin")
    assert svc.share(UUID_USER, row["id"]) is None


def test_unshare_revokes_and_the_token_no_longer_resolves():
    row = svc.upsert("user", UUID_USER, "L", {"widgets": []}, None, "T")
    out = svc.share(UUID_USER, row["id"])
    assert svc.unshare(UUID_USER, row["id"]) is True
    assert svc.resolve_share(out["token"]) is None


def test_unshare_when_never_shared_returns_false_not_an_error():
    row = svc.upsert("user", UUID_USER, "L", {"widgets": []}, None, "T")
    assert svc.unshare(UUID_USER, row["id"]) is False


def test_share_status_is_read_only_and_never_mints():
    """Opening a share panel must not itself publish a layout."""
    row = svc.upsert("user", UUID_USER, "L", {"widgets": []}, None, "T")
    assert svc.share_status(UUID_USER, row["id"]) is None
    assert svc.resolve_share("cl_" + "0" * 32) is None  # nothing was minted


def test_share_status_reflects_revocation_as_a_distinct_state():
    row = svc.upsert("user", UUID_USER, "L", {"widgets": []}, None, "T")
    svc.share(UUID_USER, row["id"])
    svc.unshare(UUID_USER, row["id"])
    assert svc.share_status(UUID_USER, row["id"]) is None


def test_resolve_share_returns_none_for_an_unknown_token():
    assert svc.resolve_share("cl_does_not_exist") is None


def test_resharing_after_the_layout_is_edited_keeps_the_same_token():
    """The link is the stable thing; the content behind it is not — mirrors
    user_definitions' own re-share behavior."""
    row = svc.upsert("user", UUID_USER, "L", {"widgets": []}, None, "T")
    out = svc.share(UUID_USER, row["id"])
    svc.upsert("user", UUID_USER, "L", {"widgets": [{"id": "new"}]}, None, "T")
    resolved = svc.resolve_share(out["token"])
    assert resolved["layout"] == {"widgets": [{"id": "new"}]}
    # re-sharing explicitly still returns the same token
    assert svc.share(UUID_USER, row["id"])["token"] == out["token"]


def test_deleting_the_layout_makes_its_share_token_resolve_to_none():
    row = svc.upsert("user", UUID_USER, "L", {"widgets": []}, None, "T")
    out = svc.share(UUID_USER, row["id"])
    svc.delete(row["id"])
    assert svc.resolve_share(out["token"]) is None

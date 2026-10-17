"""P3a Task 10 fix round 1: a reviewer sees a held revision (P3a-T10-R1), an adopted copy is not the
adopter's to share (P3a-T10-R3), and "Update my copy" applies the version the member previewed (M-8)."""
from __future__ import annotations

import json

import pytest

from api.services.journal_two import journal_styles as js
from api.services.journal_two import template_gallery as gallery
from tests._style_library_helpers import _style, api, bump_and_approve, conn, lib_on, listed_style  # noqa: F401

URL = "/api/j2/template-gallery"


def _as(api, user_id, role="member"):
    from api.middleware import auth_middleware as authmw
    user = {"id": user_id, "role": role, "plan": "pro"}
    api.app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    api.app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def _blk(block):
    return {"block": block, "enabled": True, "settings": {}}


def _hold(conn, item, **style_patch):
    """The author edits and shares again WITHOUT an approval: the revision is held."""
    js.update_style("author", item["sourceStyleId"], style_patch, conn)
    gallery.publish_style("author", item["sourceStyleId"], title="Weekend Prep, revised", description="Now with rules.",
                          category="review", trading_style="day", conn=conn)


# ── P3a-T10-R1: the held revision, to admins only ────────────────────────────────────────


def test_an_admin_reads_the_held_revision_and_its_version(conn, lib_on):
    item = listed_style(conn)
    _hold(conn, item, blocks=[_blk("myRules")])
    out = gallery.get_item("admin", item["id"], is_admin=True, conn=conn)
    rev = out["pendingRevision"]
    assert rev["version"] == out["version"] + 1 == 2
    assert (rev["title"], rev["description"], rev["category"], rev["tradingStyle"]) == (
        "Weekend Prep, revised", "Now with rules.", "review", "day")
    assert [b["block"] for b in rev["payload"]["blocks"]] == ["myRules"]
    # the listed payload beside it is still the listed one
    assert out["payload"]["blocks"] == [] and out["title"] == "Weekend Prep"


def test_the_revision_never_reaches_a_member_and_the_listed_payload_is_byte_identical(conn, lib_on):
    item = listed_style(conn)
    before = gallery.get_item("viewer", item["id"], conn=conn)
    _hold(conn, item, blocks=[_blk("myRules")])
    after = gallery.get_item("viewer", item["id"], conn=conn)
    author = gallery.get_item("author", item["id"], conn=conn)
    assert "pendingRevision" not in after and "pendingRevision" not in author
    for key in ("payload", "bodyJson", "title", "description", "category", "tradingStyle", "version"):
        assert json.dumps(after[key], sort_keys=True) == json.dumps(before[key], sort_keys=True), key
    # control: the same read as an admin does carry it, so "absent" above is about the caller
    assert "pendingRevision" in gallery.get_item("admin", item["id"], is_admin=True, conn=conn)


def test_no_revision_means_no_field_even_for_an_admin(conn, lib_on):
    item = listed_style(conn)
    assert "pendingRevision" not in gallery.get_item("admin", item["id"], is_admin=True, conn=conn)


def test_an_unreadable_revision_is_absent_not_a_500(conn, lib_on):
    item = listed_style(conn)
    conn.execute("UPDATE j2_template_gallery SET pending_json = '{not json', pending_at = '2026-10-17' WHERE id = ?",
                 (item["id"],))
    conn.commit()
    assert "pendingRevision" not in gallery.get_item("admin", item["id"], is_admin=True, conn=conn)


def test_the_queue_still_carries_no_payload_and_no_revision(conn, lib_on):
    item = listed_style(conn)
    _hold(conn, item, blocks=[_blk("myRules")])
    row = next(r for r in gallery.admin_queue(conn=conn)["pending"] if r["id"] == item["id"])
    assert row["hasRevision"] is True and row["revisionTitle"] == "Weekend Prep, revised"
    assert not ({"pendingRevision", "payload", "bodyJson"} & set(row))


def test_get_item_over_http_gives_the_revision_to_an_admin_only(api, conn, lib_on):
    item = listed_style(conn)
    _hold(conn, item, blocks=[_blk("myRules")])
    _as(api, "viewer")
    member = api.get(f"{URL}/{item['id']}")
    assert member.status_code == 200 and "pendingRevision" not in member.json()["template"]
    _as(api, "author")
    assert "pendingRevision" not in api.get(f"{URL}/{item['id']}").json()["template"]
    _as(api, "admin", role="admin")
    admin = api.get(f"{URL}/{item['id']}")
    assert admin.json()["template"]["pendingRevision"]["title"] == "Weekend Prep, revised"


# ── P3a-T10-R3: an adopted copy is not the adopter's to share ────────────────────────────


def test_an_adopted_copy_of_another_authors_listing_cannot_be_shared(conn, lib_on):
    item = listed_style(conn)
    copy = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    n = conn.execute("SELECT COUNT(*) FROM j2_template_gallery").fetchone()[0]
    with pytest.raises(gallery.GalleryError) as e:
        gallery.publish_style("member", copy["id"], title="Mine now", description="", category="journal",
                              trading_style=None, conn=conn)
    assert str(e.value) == gallery.ADOPTED_SHARE_SENTENCE == "This style came from the library, so it can't be shared again."
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery").fetchone()[0] == n


def test_the_member_s_own_style_still_shares_and_a_copy_of_their_own_listing_too(conn, lib_on):
    s = _style(conn, "member")
    assert gallery.publish_style("member", s["id"], title="Own", description="", category="journal",
                                 trading_style=None, conn=conn)["status"] == "pending"
    item = listed_style(conn)
    own_copy = gallery.adopt_style("author", item["id"], notify=False, conn=conn)["style"]
    assert gallery.publish_style("author", own_copy["id"], title="Again", description="", category="journal",
                                 trading_style=None, conn=conn) is not None


def test_a_direct_post_of_an_adopted_copy_is_refused_and_not_charged(api, conn, lib_on):
    item = listed_style(conn)
    copy = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    _as(api, "member")
    r = api.post(f"{URL}/styles", json={"styleId": copy["id"], "title": "Mine now", "description": "",
                                        "category": "journal"})
    assert r.status_code == 400 and r.json()["detail"] == gallery.ADOPTED_SHARE_SENTENCE
    from api.routers import notebook_template_gallery as r
    from api.services import daily_counters
    from api.services.journal_two.calendar import et_today
    assert daily_counters.value(et_today(), r.DAILY_PUBLISH_SCOPE, "member") == 0


# ── M-8: the previewed version ──────────────────────────────────────────────────────────


def test_apply_refuses_when_a_newer_version_was_listed_since_the_preview(conn, lib_on):
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    bump_and_approve(conn, item, blocks=[_blk("myRules")])
    previewed = gallery.plan_update("member", mine["id"], conn=conn)["toVersion"]
    item = gallery.get_item("author", item["id"], conn=conn)
    bump_and_approve(conn, item, blocks=[_blk("myRules"), _blk("chart")])
    with pytest.raises(gallery.GalleryConflict) as e:
        gallery.apply_update("member", mine["id"], take_outline=False, base_updated_at=mine["updatedAt"],
                             to_version=previewed, conn=conn)
    assert str(e.value) == gallery.UPDATE_MOVED_SENTENCE
    after = js.get_style("member", mine["id"], conn)
    assert after["sourceVersion"] == 1 and after["blocks"] == mine["blocks"]
    # the version on screen now applies
    now = gallery.plan_update("member", mine["id"], conn=conn)["toVersion"]
    assert now == previewed + 1
    done = gallery.apply_update("member", mine["id"], take_outline=False, base_updated_at=mine["updatedAt"],
                                to_version=now, conn=conn)
    assert done["sourceVersion"] == now


def test_post_apply_with_a_moved_version_is_409_and_a_bad_one_is_400(api, conn, lib_on):
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    bump_and_approve(conn, item, blocks=[_blk("myRules")])
    _as(api, "member")
    moved = api.post(f"{URL}/updates/{mine['id']}", json={"takeOutline": False, "baseUpdatedAt": mine["updatedAt"],
                                                           "toVersion": 1})
    assert moved.status_code == 409 and moved.json()["detail"] == gallery.UPDATE_MOVED_SENTENCE
    for bad in ("2", True, 2.5):
        r = api.post(f"{URL}/updates/{mine['id']}", json={"takeOutline": False, "baseUpdatedAt": mine["updatedAt"],
                                                         "toVersion": bad})
        assert r.status_code == 400, bad
    assert js.get_style("member", mine["id"], conn)["sourceVersion"] == 1
    ok = api.post(f"{URL}/updates/{mine['id']}", json={"takeOutline": False, "baseUpdatedAt": mine["updatedAt"],
                                                        "toVersion": 2})
    assert ok.status_code == 200 and ok.json()["style"]["sourceVersion"] == 2


# ── M-7: what the share answer tells the client ─────────────────────────────────────────


def test_sharing_a_listed_style_again_answers_has_revision_and_a_first_share_does_not(conn, lib_on):
    s = _style(conn, "author")
    first = gallery.publish_style("author", s["id"], title="T", description="", category="journal",
                                  trading_style=None, conn=conn)
    assert first["hasRevision"] is False and first["status"] == "pending"
    gallery.admin_act("admin", first["id"], "approve", reviewed_updated_at=first["updatedAt"], conn=conn)
    again = gallery.publish_style("author", s["id"], title="T2", description="", category="journal",
                                  trading_style=None, conn=conn)
    assert again["hasRevision"] is True and again["status"] == "approved"


# ── P3a-T10-R4: toVersion is required on apply ──────────────────────────────────────────


def test_post_apply_without_to_version_is_400_and_writes_nothing(api, conn, lib_on):
    from api.routers import notebook_template_gallery as r
    item = listed_style(conn)
    mine = gallery.adopt_style("member", item["id"], notify=False, conn=conn)["style"]
    bump_and_approve(conn, item, blocks=[_blk("myRules")])
    _as(api, "member")
    for body in ({"takeOutline": False, "baseUpdatedAt": mine["updatedAt"]},
                 {"takeOutline": False, "baseUpdatedAt": mine["updatedAt"], "toVersion": None}):
        res = api.post(f"{URL}/updates/{mine['id']}", json=body)
        assert res.status_code == 400 and res.json()["detail"] == r.TO_VERSION_SENTENCE, body
    after = js.get_style("member", mine["id"], conn)
    assert after["sourceVersion"] == 1 and after["blocks"] == mine["blocks"]
    # control: the same body with the previewed version applies
    ok = api.post(f"{URL}/updates/{mine['id']}", json={"takeOutline": False, "baseUpdatedAt": mine["updatedAt"],
                                                        "toVersion": 2})
    assert ok.status_code == 200

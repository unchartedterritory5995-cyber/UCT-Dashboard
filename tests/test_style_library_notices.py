"""P3a Task 7: the community library's bell rows.

A member who adopted a style with "tell me about updates" hears once when the author's next version is
approved, and once if the author takes the style down. The ring is the private in-app bell
(`alerts.add_alert` with a user_id), patched here at the module the service imports it from.
"""
from __future__ import annotations

from unittest import mock

from api.services.journal_two import journal_styles as js
from api.services.journal_two import template_gallery as gallery
from tests._style_library_helpers import bump_and_approve, conn, lib_on, listed_style  # noqa: F401  (fixtures + helpers)

ADD = "api.services.alerts.add_alert"
NEXT = {"blocks": [{"block": "myRules", "enabled": True, "settings": {}}]}


def _watch(conn, user_id, gid):
    return conn.execute("SELECT notified_version FROM j2_gallery_watches WHERE gallery_id = ? AND user_id = ?",
                        (gid, user_id)).fetchone()


def test_an_approved_revision_rings_each_watcher_once(conn, lib_on):
    item = listed_style(conn)
    w1 = gallery.adopt_style("w1", item["id"], notify=True, conn=conn)["style"]
    gallery.adopt_style("w2", item["id"], notify=True, conn=conn)
    gallery.adopt_style("quiet", item["id"], notify=False, conn=conn)
    with mock.patch(ADD) as add:
        bump_and_approve(conn, item, **NEXT)
    assert sorted(c.kwargs["user_id"] for c in add.call_args_list) == ["w1", "w2"]
    assert all(c.args[0] == gallery.LIBRARY_NOTICE_SOURCE for c in add.call_args_list)
    call = next(c for c in add.call_args_list if c.kwargs["user_id"] == "w1")
    assert call.args[1] == item["title"]
    assert call.args[2] == gallery.UPDATE_NOTICE.format(title=item["title"])
    assert call.kwargs["severity"] == "info"
    # The link opens THIS member's copy, through the path the client's door follows.
    assert call.kwargs["data"]["research_url"] == f"/journal/notebook?styles=1&libraryUpdate={w1['id']}"
    assert call.kwargs["data"]["source"] == gallery.LIBRARY_NOTICE_SOURCE
    assert _watch(conn, "w1", item["id"])[0] == 2 and _watch(conn, "w2", item["id"])[0] == 2
    with mock.patch(ADD) as add:
        gallery.admin_act("admin", item["id"], "feature", conn=conn)     # no new version: no ring
    assert add.call_count == 0


def test_a_failed_delivery_is_retried_by_the_next_review_action(conn, lib_on):
    item = listed_style(conn)
    gallery.adopt_style("w1", item["id"], notify=True, conn=conn)
    with mock.patch(ADD, side_effect=RuntimeError("down")):
        bump_and_approve(conn, item, **NEXT)                             # the approval itself still lands
    assert gallery.get_item("w1", item["id"], conn=conn)["version"] == 2
    assert _watch(conn, "w1", item["id"])[0] == 1                       # not delivered: still behind
    with mock.patch(ADD) as add:
        gallery.admin_act("admin", item["id"], "feature", conn=conn)
    assert [c.kwargs["user_id"] for c in add.call_args_list] == ["w1"]
    assert _watch(conn, "w1", item["id"])[0] == 2
    with mock.patch(ADD) as add:
        gallery.admin_act("admin", item["id"], "unfeature", conn=conn)
    assert add.call_count == 0                                           # delivered once, never again


def test_hide_and_reject_do_not_ring(conn, lib_on):
    item = listed_style(conn)
    gallery.adopt_style("w1", item["id"], notify=True, conn=conn)
    js.update_style("author", item["sourceStyleId"], NEXT, conn)
    gallery.publish_style("author", item["sourceStyleId"], title=item["title"], description="",
                          category="journal", trading_style=None, conn=conn)
    with mock.patch(ADD) as add:
        gallery.admin_act("admin", item["id"], "reject", note="Not yet", conn=conn)
        gallery.admin_act("admin", item["id"], "hide", conn=conn)
    assert add.call_count == 0


def test_the_author_and_a_deleted_copy_are_not_rung(conn, lib_on):
    item = listed_style(conn)
    gone = gallery.adopt_style("w1", item["id"], notify=True, conn=conn)["style"]
    gallery.adopt_style("w2", item["id"], notify=True, conn=conn)
    js.delete_style("w1", gone["id"], conn)
    conn.execute("INSERT INTO j2_gallery_watches (gallery_id, user_id, style_id, notified_version, created_at)"
                 " VALUES (?, 'author', ?, 1, '2026-10-17T00:00:00+00:00')", (item["id"], item["sourceStyleId"]))
    conn.commit()
    with mock.patch(ADD) as add:
        bump_and_approve(conn, item, **NEXT)
    assert [c.kwargs["user_id"] for c in add.call_args_list] == ["w2"]


def test_withdraw_keeps_copies_and_tells_watchers_once(conn, lib_on):
    item = listed_style(conn)
    copy = gallery.adopt_style("w1", item["id"], notify=True, conn=conn)["style"]
    quiet = gallery.adopt_style("quiet", item["id"], notify=False, conn=conn)["style"]
    with mock.patch(ADD) as add:
        assert gallery.unpublish("author", item["id"], conn=conn) is True
    assert add.call_count == 1 and gallery.WITHDRAW_NOTICE.format(title=item["title"]) in add.call_args.args
    assert add.call_args.kwargs["user_id"] == "w1"
    assert "research_url" not in add.call_args.kwargs["data"]           # nothing left to open
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_watches").fetchone()[0] == 0
    assert js.get_style("w1", copy["id"], conn)["id"] == copy["id"]
    assert js.get_style("quiet", quiet["id"], conn)["id"] == quiet["id"]
    with mock.patch(ADD) as add:
        assert gallery.unpublish("author", item["id"], conn=conn) is False
    assert add.call_count == 0


def test_a_failed_withdraw_notice_still_takes_the_style_down(conn, lib_on):
    item = listed_style(conn)
    gallery.adopt_style("w1", item["id"], notify=True, conn=conn)
    with mock.patch(ADD, side_effect=RuntimeError("down")):
        assert gallery.unpublish("author", item["id"], conn=conn) is True
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery WHERE id = ?", (item["id"],)).fetchone()[0] == 0


def test_only_the_author_can_withdraw_and_no_one_hears_a_refused_one(conn, lib_on):
    item = listed_style(conn)
    gallery.adopt_style("w1", item["id"], notify=True, conn=conn)
    with mock.patch(ADD) as add:
        assert gallery.unpublish("w1", item["id"], conn=conn) is False
    assert add.call_count == 0
    assert _watch(conn, "w1", item["id"]) is not None


def test_every_library_notice_is_private(conn, lib_on):
    """A user_id on every call: a bell row with none is a broadcast to every member and posts to Discord."""
    item = listed_style(conn)
    gallery.adopt_style("w1", item["id"], notify=True, conn=conn)
    with mock.patch(ADD) as add:
        bump_and_approve(conn, item, **NEXT)
        gallery.unpublish("author", item["id"], conn=conn)
    assert add.call_count == 2
    assert all(c.kwargs.get("user_id") == "w1" for c in add.call_args_list)

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


def test_hide_and_reject_do_not_ring_and_unhide_does(conn, lib_on):
    """A watcher is put BEHIND first (the approval's delivery failed), so a hide or reject that rang would be
    seen. Unhide is the case ruling P3a-T7-R1 adds: it is a review action, and it retries."""
    item = listed_style(conn)
    gallery.adopt_style("w1", item["id"], notify=True, conn=conn)
    with mock.patch(ADD, side_effect=RuntimeError("down")):
        bump_and_approve(conn, item, **NEXT)
    assert _watch(conn, "w1", item["id"])[0] == 1                       # non-vacuity: w1 is behind
    js.update_style("author", item["sourceStyleId"], {"blocks": []}, conn)
    gallery.publish_style("author", item["sourceStyleId"], title=item["title"], description="",
                          category="journal", trading_style=None, conn=conn)
    with mock.patch(ADD) as add:
        gallery.admin_act("admin", item["id"], "reject", note="Not yet", conn=conn)
        gallery.admin_act("admin", item["id"], "hide", conn=conn)
    assert add.call_count == 0
    with mock.patch(ADD) as add:
        gallery.admin_act("admin", item["id"], "unhide", conn=conn)
    assert [c.kwargs["user_id"] for c in add.call_args_list] == ["w1"]


def test_every_watcher_gets_a_durable_notice_and_the_ring_never_waits_on_its_own_lock(conn, lib_on, monkeypatch):
    """Review C1. The REAL add_alert, whose durable copy is written through a SECOND connection to the same
    database. An open write transaction across the loop would make each later insert wait out its busy timeout
    and fail silently, while the watch was marked delivered. Five watchers, so ids minted in one millisecond
    would collide too."""
    from api.services import alert_durability
    monkeypatch.setattr(alert_durability, "_DB_PATH", conn.execute("PRAGMA database_list").fetchone()[2])
    alert_durability.init_schema()
    item = listed_style(conn)
    names = [f"w{i}" for i in range(5)]
    for name in names:
        gallery.adopt_style(name, item["id"], notify=True, conn=conn)
    import time
    started = time.monotonic()
    bump_and_approve(conn, item, **NEXT)
    assert time.monotonic() - started < 1.5                              # no 2 s busy wait per watcher
    rows = conn.execute("SELECT user_id FROM user_alerts WHERE type = ?", (gallery.LIBRARY_NOTICE_SOURCE,)).fetchall()
    assert sorted(r[0] for r in rows) == names
    assert all(_watch(conn, n, item["id"])[0] == 2 for n in names)


def test_the_rings_run_after_the_review_and_the_delete_have_committed(conn, lib_on):
    """Review M4: inside the delivery, a SECOND connection already sees the approval and the deletion."""
    import sqlite3
    path = conn.execute("PRAGMA database_list").fetchone()[2]
    item = listed_style(conn)
    gallery.adopt_style("w1", item["id"], notify=True, conn=conn)
    seen: list = []

    def look(*a, **k):
        other = sqlite3.connect(path)
        try:
            seen.append(other.execute("SELECT version FROM j2_template_gallery WHERE id = ?", (item["id"],)).fetchone())
        finally:
            other.close()
    with mock.patch(ADD, side_effect=look):
        bump_and_approve(conn, item, **NEXT)
        gallery.unpublish("author", item["id"], conn=conn)
    assert seen == [(2,), None]                                          # approved v2 visible; then the row is gone


def test_a_failing_ring_pass_never_fails_the_approval(conn, lib_on):
    """Review I1: the ring's own SQL raising after the review committed is logged, not a 500."""
    item = listed_style(conn)
    gallery.adopt_style("w1", item["id"], notify=True, conn=conn)
    with mock.patch.object(gallery, "_ring_update_watchers", side_effect=RuntimeError("boom")):
        bump_and_approve(conn, item, **NEXT)
    assert gallery.get_item("w1", item["id"], conn=conn)["version"] == 2


def test_a_member_whose_copy_is_gone_hears_no_withdraw(conn, lib_on):
    """Review M1: one rule for both rings. "Your copy is yours" is about a copy that still exists."""
    item = listed_style(conn)
    gone = gallery.adopt_style("w1", item["id"], notify=True, conn=conn)["style"]
    gallery.adopt_style("w2", item["id"], notify=True, conn=conn)
    js.delete_style("w1", gone["id"], conn)
    with mock.patch(ADD) as add:
        assert gallery.unpublish("author", item["id"], conn=conn) is True
    assert [c.kwargs["user_id"] for c in add.call_args_list] == ["w2"]


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

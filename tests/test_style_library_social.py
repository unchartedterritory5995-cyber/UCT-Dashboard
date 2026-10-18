"""P3a Task 6: Helpful votes, opaque author handles, follows and the feed."""
from __future__ import annotations

import json
import re

import pytest

from api.services.journal_two import template_gallery as gallery
from tests._style_library_helpers import _publish, _row, _style, api, conn, lib_on, listed_style  # noqa: F401

URL = "/api/j2/template-gallery"


# ── helpers ──────────────────────────────────────────────────────────────────────────────

def _listed(conn, uid, title="Weekend Prep", listed_at=None):
    """A style by `uid`, published and approved; returns the author's own read of it."""
    s = _style(conn, uid)
    item = _publish(conn, s["id"], uid, title=title)
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    if listed_at:
        conn.execute("UPDATE j2_template_gallery SET listed_at = ? WHERE id = ?", (listed_at, item["id"]))
        conn.commit()
    return gallery.get_item(uid, item["id"], conn=conn)


def _user(conn, uid, email, display_name):
    conn.execute("INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'x', ?)",
                 (uid, email, display_name))
    conn.commit()


def _as(api, user_id, plan="pro"):
    from api.middleware import auth_middleware as authmw
    user = {"id": user_id, "role": "member", "plan": plan}
    api.app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    api.app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


# ── the brief's tests ────────────────────────────────────────────────────────────────────

def test_helpful_is_one_per_member_and_never_your_own(conn, lib_on):
    item = listed_style(conn)
    assert gallery.set_helpful("author", item["id"], True, conn=conn) is None
    assert gallery.set_helpful("m1", item["id"], True, conn=conn) == {"helpful": True, "count": 1}
    assert gallery.set_helpful("m1", item["id"], True, conn=conn) == {"helpful": True, "count": 1}
    gallery.set_helpful("m2", item["id"], True, conn=conn)
    s = next(t for t in gallery.list_gallery("m1", conn=conn) if t["id"] == item["id"])
    assert s["helpfulCount"] == 2 and s["helpedByMe"] is True
    assert gallery.set_helpful("m1", item["id"], False, conn=conn) == {"helpful": False, "count": 1}


def test_a_handle_is_opaque_and_stable(conn, lib_on):
    item = listed_style(conn)
    h = item["authorHandle"]
    assert h and "author" not in h and "@" not in h and len(h) >= 10
    assert gallery.author_handle("author", conn) == h
    assert conn.execute("SELECT handle FROM j2_gallery_authors WHERE user_id = 'author'").fetchone()[0] == h


def test_an_author_page_lists_only_what_is_listed(conn, lib_on):
    item = listed_style(conn)
    conn.execute("INSERT INTO j2_template_gallery (id, user_id, kind, title, description, category,"
                 " body_json, status, created_at, updated_at, item_type) VALUES"
                 " ('p', 'author', 'member', 'Pending', '', 'journal', '{}', 'pending', 'x', 'x', 'style')")
    conn.commit()
    page = gallery.author_page("viewer", item["authorHandle"], conn=conn)
    assert [i["title"] for i in page["items"]] == [item["title"]]
    assert page["author"]["label"] == item["author"] and page["author"]["mine"] is False
    assert "user_id" not in json.dumps(page) and "author\"" not in json.dumps(page["author"])
    assert gallery.author_page("viewer", "nope", conn=conn) is None


def test_follow_and_the_feed(conn, lib_on):
    item = listed_style(conn)
    h = item["authorHandle"]
    assert gallery.set_follow("author", h, True, conn=conn) is None          # not yourself
    assert gallery.set_follow("m1", h, True, conn=conn) == {"following": True}
    assert [i["id"] for i in gallery.feed("m1", conn=conn)] == [item["id"]]
    assert gallery.feed("m2", conn=conn) == []
    assert gallery.author_page("m1", h, conn=conn)["author"]["following"] is True
    gallery.set_follow("m1", h, False, conn=conn)
    assert gallery.feed("m1", conn=conn) == []


def test_social_routes_are_404_with_the_library_off(conn, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    assert gallery.feed("m1", conn=conn) == []
    assert gallery.author_page("m1", "anything", conn=conn) is None


# ── the handle ───────────────────────────────────────────────────────────────────────────

def test_a_new_and_a_resubmitted_item_always_has_a_handle_and_it_never_changes(conn, lib_on):
    # publish_style mints one before it writes (a first publish), and a second publish by the same member
    # finds the same one. Listing before the row existed is the "no handle yet" case, below.
    s = _style(conn, "w1")
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_authors WHERE user_id = 'w1'").fetchone()[0] == 0
    first = _publish(conn, s["id"], "w1")
    handle = conn.execute("SELECT handle FROM j2_gallery_authors WHERE user_id = 'w1'").fetchone()[0]
    assert first["authorHandle"] == handle
    again = _publish(conn, s["id"], "w1", title="Edited")
    assert again["authorHandle"] == handle
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_authors WHERE user_id = 'w1'").fetchone()[0] == 1


def test_publishing_an_outline_mints_the_handle_too(conn, lib_on):
    conn.execute("INSERT INTO j2_note_templates (id, user_id, name, title, body_json, created_at, updated_at)"
                 " VALUES ('t1', 'o1', 'Plan', 'Plan', ?, 'x', 'x')",
                 (json.dumps({"type": "doc", "content": [{"type": "paragraph"}]}),))
    conn.commit()
    out = gallery.publish("o1", "t1", title="Plan", description="", category="trade_plan", conn=conn)
    row = conn.execute("SELECT handle FROM j2_gallery_authors WHERE user_id = 'o1'").fetchone()
    assert row and out["authorHandle"] == row[0]


def test_an_item_whose_author_has_no_handle_row_still_lists_with_a_null_handle(conn, lib_on):
    gid = _row(conn, item_type="style", user_id="legacy-author")
    s = next(t for t in gallery.list_gallery("viewer", conn=conn) if t["id"] == gid)
    assert s["authorHandle"] is None
    assert gallery.get_item("viewer", gid, conn=conn)["authorHandle"] is None


def test_a_firm_item_has_no_handle_and_no_author_page(conn, lib_on):
    conn.execute("INSERT INTO j2_template_gallery (id, user_id, kind, title, description, category, body_json,"
                 " status, featured, listed_at, created_at, updated_at, preview_json)"
                 " VALUES ('firm1', NULL, 'firm', 'UCT pick', '', 'journal', '{}', 'approved', 1, 'x', 'x', 'x', '[]')")
    conn.commit()
    s = next(t for t in gallery.list_gallery("viewer", conn=conn) if t["id"] == "firm1")
    assert s["firm"] is True and s["authorHandle"] is None and s["author"] == gallery.FIRM_AUTHOR
    # nothing a firm item carries resolves to an author page
    assert gallery.author_page("viewer", None, conn=conn) is None
    assert gallery.author_page("viewer", "", conn=conn) is None


def test_a_member_item_under_the_anonymous_label_still_carries_the_handle(conn, lib_on):
    # The label is what is anonymous, not the link: an author whose display name is an email address reads
    # "A UCT member" and still has a page.
    _user(conn, "u-anon", "anon@example.com", "anon@example.com")
    item = _listed(conn, "u-anon")
    assert item["author"] == gallery.ANONYMOUS_AUTHOR and item["authorHandle"]
    page = gallery.author_page("viewer", item["authorHandle"], conn=conn)
    assert page["author"]["label"] == gallery.ANONYMOUS_AUTHOR and len(page["items"]) == 1


def test_a_handle_that_collides_is_minted_again_and_a_run_of_collisions_is_loud(conn, lib_on, monkeypatch):
    taken = gallery.author_handle("first", conn)
    answers = iter([taken, taken, "FreshHandle12"])
    monkeypatch.setattr(gallery.secrets, "token_urlsafe", lambda n: next(answers))
    assert gallery.author_handle("second", conn) == "FreshHandle12"
    monkeypatch.setattr(gallery.secrets, "token_urlsafe", lambda n: taken)
    with pytest.raises(RuntimeError):
        gallery.author_handle("third", conn)
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_authors WHERE user_id = 'third'").fetchone()[0] == 0


def test_the_handle_is_url_safe_and_unique_across_authors(conn, lib_on):
    handles = [gallery.author_handle(f"u{i}", conn) for i in range(40)]
    assert len(set(handles)) == 40
    assert all(re.fullmatch(r"[A-Za-z0-9_-]{12}", h) for h in handles)


# ── helpful ──────────────────────────────────────────────────────────────────────────────

def test_helpful_is_refused_for_anything_the_member_cannot_see(conn, lib_on):
    item = _listed(conn, "a1")
    assert gallery.set_helpful("m1", "no-such-id", True, conn=conn) is None
    pending = _publish(conn, _style(conn, "a2")["id"], "a2")
    assert gallery.set_helpful("m1", pending["id"], True, conn=conn) is None
    conn.execute("UPDATE j2_template_gallery SET hidden = 1 WHERE id = ?", (item["id"],))
    conn.commit()
    assert gallery.set_helpful("m1", item["id"], True, conn=conn) is None
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_helpful").fetchone()[0] == 0


def test_helpful_is_refused_while_the_library_is_off(conn, lib_on, monkeypatch):
    item = _listed(conn, "a1")
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    assert gallery.set_helpful("m1", item["id"], True, conn=conn) is None
    assert gallery.set_follow("m1", item["authorHandle"], True, conn=conn) is None
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_helpful").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_follows").fetchone()[0] == 0


def test_helped_by_me_is_the_viewers_own_and_a_removal_is_idempotent(conn, lib_on):
    item = _listed(conn, "a1")
    gallery.set_helpful("m1", item["id"], True, conn=conn)

    def read(viewer):
        return next(t for t in gallery.list_gallery(viewer, conn=conn) if t["id"] == item["id"])

    assert read("m1")["helpedByMe"] is True
    assert read("m2")["helpedByMe"] is False and read("m2")["helpfulCount"] == 1
    assert gallery.get_item("m1", item["id"], conn=conn)["helpedByMe"] is True
    assert gallery.get_item("m2", item["id"], conn=conn)["helpedByMe"] is False
    assert gallery.set_helpful("m2", item["id"], False, conn=conn) == {"helpful": False, "count": 1}   # never voted
    assert gallery.set_helpful("m1", item["id"], False, conn=conn) == {"helpful": False, "count": 0}
    assert gallery.set_helpful("m1", item["id"], False, conn=conn) == {"helpful": False, "count": 0}


def test_the_count_is_the_whole_listing_not_the_viewers_page(conn, lib_on):
    item = _listed(conn, "a1")
    for i in range(5):
        gallery.set_helpful(f"v{i}", item["id"], True, conn=conn)
    assert gallery.get_item("anyone", item["id"], conn=conn)["helpfulCount"] == 5
    assert gallery.set_helpful("v9", item["id"], True, conn=conn)["count"] == 6


def test_the_admin_queue_still_reads_after_the_select_takes_a_viewer(conn, lib_on):
    item = listed_style(conn)
    gallery.set_helpful("m1", item["id"], True, conn=conn)
    s = _style(conn, "author2")
    pend = _publish(conn, s["id"], "author2", title="Waiting")
    queue = gallery.admin_queue(conn=conn)
    assert [i["id"] for i in queue["pending"]] == [pend["id"]]
    assert queue["pending"][0]["helpfulCount"] == 0
    conn.execute("UPDATE j2_template_gallery SET hidden = 1 WHERE id = ?", (item["id"],))
    conn.commit()
    assert [i["id"] for i in gallery.admin_queue(conn=conn)["hidden"]] == [item["id"]]
    assert gallery.admin_queue(conn=conn)["hidden"][0]["helpfulCount"] == 1


def test_every_select_shape_binds_exactly_the_viewer_and_still_reads_no_body():
    for kwargs in ({}, {"list_only": True}, {"list_only": True, "queue": True}):
        sql = gallery._select(**kwargs)
        assert sql.count("?") == 1, kwargs                      # the helped-by-me viewer, and nothing else
        assert "j2_gallery_helpful" in sql and "j2_gallery_authors" in sql
    for kwargs in ({"list_only": True}, {"list_only": True, "queue": True}):
        sql = gallery._select(**kwargs)
        assert "g.*" not in sql and "body_json" not in sql and "payload_json" not in sql, kwargs
    assert "g.*" in gallery._select()                           # the single-template read keeps its full row
    assert "pending_json" not in gallery._select(list_only=True)


# ── the author page ──────────────────────────────────────────────────────────────────────

def test_the_author_page_shape_and_the_hidden_item_that_leaves_it(conn, lib_on):
    _user(conn, "u-sam", "sam.private@example.com", "Sam Trader")
    one = _listed(conn, "u-sam", title="One", listed_at="2026-10-11T00:00:00+00:00")
    two = _listed(conn, "u-sam", title="Two", listed_at="2026-10-12T00:00:00+00:00")
    page = gallery.author_page("viewer", one["authorHandle"], conn=conn)
    assert set(page) == {"author", "items"}
    assert set(page["author"]) == {"handle", "label", "itemCount", "following", "mine"}
    assert page["author"] == {"handle": one["authorHandle"], "label": "Sam Trader", "itemCount": 2,
                              "following": False, "mine": False}
    assert [i["title"] for i in page["items"]] == ["Two", "One"]                # newest first
    conn.execute("UPDATE j2_template_gallery SET hidden = 1 WHERE id = ?", (two["id"],))
    conn.commit()
    page = gallery.author_page("viewer", one["authorHandle"], conn=conn)
    assert [i["title"] for i in page["items"]] == ["One"] and page["author"]["itemCount"] == 1
    assert gallery.author_page("u-sam", one["authorHandle"], conn=conn)["author"]["mine"] is True


def test_an_author_with_nothing_listed_has_a_page_with_the_anonymous_label(conn, lib_on):
    s = _style(conn, "quiet")
    _publish(conn, s["id"], "quiet")                                            # pending: not listed
    handle = conn.execute("SELECT handle FROM j2_gallery_authors WHERE user_id = 'quiet'").fetchone()[0]
    page = gallery.author_page("viewer", handle, conn=conn)
    assert page["items"] == [] and page["author"]["label"] == gallery.ANONYMOUS_AUTHOR
    assert page["author"]["itemCount"] == 0


def test_an_author_page_never_reads_a_body(conn, lib_on):
    item = _listed(conn, "a1")
    statements = []
    conn.set_trace_callback(statements.append)
    try:
        gallery.author_page("viewer", item["authorHandle"], conn=conn)
        gallery.feed("viewer", conn=conn)
    finally:
        conn.set_trace_callback(None)
    selects = [s for s in statements if "j2_template_gallery g" in s]
    assert selects and not any("body_json" in s or "payload_json" in s or "g.*" in s for s in selects)


def test_an_unusable_handle_is_just_unknown(conn, lib_on):
    for bad in (None, "", " ", "x" * 500, 12, "'; DROP TABLE j2_gallery_authors; --"):
        assert gallery.author_page("viewer", bad, conn=conn) is None
        assert gallery.set_follow("viewer", bad, True, conn=conn) is None
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_authors").fetchone()[0] == 0


# ── follow and the feed ──────────────────────────────────────────────────────────────────

def test_the_feed_is_the_followed_authors_listed_items_newest_first(conn, lib_on):
    a = _listed(conn, "a1", title="A old", listed_at="2026-10-01T00:00:00+00:00")
    b = _listed(conn, "b1", title="B mid", listed_at="2026-10-05T00:00:00+00:00")
    a2 = _listed(conn, "a1", title="A new", listed_at="2026-10-09T00:00:00+00:00")
    c = _listed(conn, "c1", title="C never followed", listed_at="2026-10-10T00:00:00+00:00")
    gallery.set_follow("m1", a["authorHandle"], True, conn=conn)
    gallery.set_follow("m1", b["authorHandle"], True, conn=conn)
    gallery.set_follow("m1", b["authorHandle"], True, conn=conn)                  # a repeat is not a second follow
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_follows WHERE follower_id = 'm1'").fetchone()[0] == 2
    assert [i["title"] for i in gallery.feed("m1", conn=conn)] == ["A new", "B mid", "A old"]
    # a hidden item leaves the feed; a pending one is never in it
    conn.execute("UPDATE j2_template_gallery SET hidden = 1 WHERE id = ?", (a2["id"],))
    pend = _publish(conn, _style(conn, "b1")["id"], "b1", title="B pending")
    conn.commit()
    assert [i["title"] for i in gallery.feed("m1", conn=conn)] == ["B mid", "A old"]
    assert pend["id"] not in [i["id"] for i in gallery.feed("m1", conn=conn)]
    assert c["id"] not in [i["id"] for i in gallery.feed("m1", conn=conn)]
    assert gallery.set_follow("m1", a["authorHandle"], False, conn=conn) == {"following": False}
    assert [i["title"] for i in gallery.feed("m1", conn=conn)] == ["B mid"]


def test_a_feed_item_carries_the_viewers_own_helpful_state(conn, lib_on):
    a = _listed(conn, "a1")
    gallery.set_follow("m1", a["authorHandle"], True, conn=conn)
    gallery.set_helpful("m1", a["id"], True, conn=conn)
    row = gallery.feed("m1", conn=conn)[0]
    assert row["helpedByMe"] is True and row["helpfulCount"] == 1


def test_follow_refuses_an_unknown_handle_and_yourself(conn, lib_on):
    a = _listed(conn, "a1")
    assert gallery.set_follow("m1", "no-such-handle", True, conn=conn) is None
    assert gallery.set_follow("a1", a["authorHandle"], True, conn=conn) is None
    assert gallery.set_follow("m1", a["authorHandle"], False, conn=conn) == {"following": False}   # never followed
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_follows").fetchone()[0] == 0


# ── R-P3-2: nothing here returns a user id or an email ───────────────────────────────────

def test_no_response_this_task_adds_carries_a_user_id_or_an_email(conn, lib_on):
    _user(conn, "uid-7f3a91c2-sam", "sam.private@example.com", "Sam Trader")
    _user(conn, "uid-0d44be10-lee", "lee.private@example.com", "lee.private@example.com")
    sam = _listed(conn, "uid-7f3a91c2-sam", title="Sam's")
    lee = _listed(conn, "uid-0d44be10-lee", title="Lee's")
    ids = {"uid-7f3a91c2-sam", "uid-0d44be10-lee", "uid-5b9e-viewer"}
    emails = {"sam.private@example.com", "lee.private@example.com"}
    viewer = "uid-5b9e-viewer"

    responses = {
        "helpful": gallery.set_helpful(viewer, sam["id"], True, conn=conn),
        "follow": gallery.set_follow(viewer, sam["authorHandle"], True, conn=conn),
        "follow-anon": gallery.set_follow(viewer, lee["authorHandle"], True, conn=conn),
        "page": gallery.author_page(viewer, sam["authorHandle"], conn=conn),
        "page-anon": gallery.author_page(viewer, lee["authorHandle"], conn=conn),
        "my-own-page": gallery.author_page("uid-7f3a91c2-sam", sam["authorHandle"], conn=conn),
        "feed": gallery.feed(viewer, conn=conn),
        "list": gallery.list_gallery(viewer, conn=conn),
        "item": gallery.get_item(viewer, sam["id"], conn=conn),
        "queue": gallery.admin_queue(conn=conn),
    }
    assert responses["page"]["items"] and responses["feed"] and responses["page-anon"]["items"]   # non-vacuity
    forbidden_keys = {"user_id", "userId", "author_id", "authorId", "follower_id", "followerId", "email", "owner", "ownerId"}

    def walk(node, where):
        if isinstance(node, dict):
            for k, v in node.items():
                assert k not in forbidden_keys, f"{where}: a key named {k!r}"
                walk(v, where)
        elif isinstance(node, list):
            for v in node:
                walk(v, where)

    for name, out in responses.items():
        text = json.dumps(out)
        for needle in ids | emails:
            assert needle not in text, f"{name} carries {needle!r}"
        walk(out, name)


# ── the routes ───────────────────────────────────────────────────────────────────────────

def test_the_social_constants_are_the_ruled_values():
    from api.routers import notebook_template_gallery as r
    assert (r.HELPFUL_RATE, r.SCOPE_HELPFUL) == ("60/hour", "notebook-gallery-helpful")
    assert (r.FOLLOW_RATE, r.SCOPE_FOLLOW) == ("60/hour", "notebook-gallery-follow")


def test_the_helpful_routes(api, conn, lib_on):
    item = _listed(conn, "a1")
    _as(api, "m1")
    r = api.post(f"{URL}/{item['id']}/helpful")
    assert r.status_code == 200 and r.json() == {"helpful": True, "count": 1}
    assert api.post(f"{URL}/{item['id']}/helpful").json() == {"helpful": True, "count": 1}
    assert api.delete(f"{URL}/{item['id']}/helpful").json() == {"helpful": False, "count": 0}
    assert api.post(f"{URL}/nope/helpful").status_code == 404
    _as(api, "a1")
    assert api.post(f"{URL}/{item['id']}/helpful").status_code == 404             # your own


def test_the_author_and_follow_routes_and_the_feed(api, conn, lib_on):
    item = _listed(conn, "a1")
    h = item["authorHandle"]
    _as(api, "m1")
    page = api.get(f"{URL}/authors/{h}")
    assert page.status_code == 200 and page.json()["author"]["handle"] == h
    assert [i["id"] for i in page.json()["items"]] == [item["id"]]
    assert api.get(f"{URL}/authors/unknown").status_code == 404
    assert api.get(f"{URL}/feed").json() == {"templates": []}
    assert api.post(f"{URL}/authors/{h}/follow").json() == {"following": True}
    assert [i["id"] for i in api.get(f"{URL}/feed").json()["templates"]] == [item["id"]]
    assert api.get(f"{URL}/authors/{h}").json()["author"]["following"] is True
    assert api.delete(f"{URL}/authors/{h}/follow").json() == {"following": False}
    assert api.post(f"{URL}/authors/unknown/follow").status_code == 404
    _as(api, "a1")
    assert api.post(f"{URL}/authors/{h}/follow").status_code == 404               # yourself


def test_the_literal_social_paths_are_not_taken_by_the_item_route(api, conn, lib_on):
    # `GET /{gallery_id}` exists: declared first, it would take "feed" as an item id and answer ITS 404.
    item = _listed(conn, "a1")
    _as(api, "m1")
    feed = api.get(f"{URL}/feed")
    assert feed.status_code == 200 and "templates" in feed.json() and "template" not in feed.json()
    assert api.get(f"{URL}/{item['id']}").json()["template"]["id"] == item["id"]    # non-vacuity


def test_every_social_route_is_the_one_404_for_everyone_while_the_library_is_off(api, conn, lib_on, monkeypatch):
    # R-P3-10: a route dependency, ahead of the plan check and the body -- a paid member, an unpaid member
    # and a signed-out caller with a malformed body all get the same 404, and nothing is written.
    from api.middleware import auth_middleware as authmw
    item = _listed(conn, "a1")
    h = item["authorHandle"]
    monkeypatch.setenv("NOTEBOOK_STYLE_LIBRARY_ENABLED", "0")
    calls = (("POST", f"{URL}/{item['id']}/helpful"), ("DELETE", f"{URL}/{item['id']}/helpful"),
             ("GET", f"{URL}/authors/{h}"), ("POST", f"{URL}/authors/{h}/follow"),
             ("DELETE", f"{URL}/authors/{h}/follow"), ("GET", f"{URL}/feed"))
    for method, url in calls:
        _as(api, "m1")
        paid = api.request(method, url)
        _as(api, "m1", plan="free")
        unpaid = api.request(method, url)
        api.app.dependency_overrides.pop(authmw.get_current_user, None)
        api.app.dependency_overrides.pop(authmw.get_current_user_with_plan, None)
        signed_out = api.request(method, url, content=b"{bad")
        assert (paid.status_code, unpaid.status_code, signed_out.status_code) == (404, 404, 404), (method, url)
        assert paid.json() == unpaid.json() == signed_out.json(), (method, url)
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_helpful").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM j2_gallery_follows").fetchone()[0] == 0


def test_the_social_routes_need_a_paid_plan_while_the_library_is_on(api, conn, lib_on):
    item = _listed(conn, "a1")
    _as(api, "m1", plan="free")
    for method, url in (("POST", f"{URL}/{item['id']}/helpful"), ("DELETE", f"{URL}/{item['id']}/helpful"),
                        ("GET", f"{URL}/authors/x"), ("POST", f"{URL}/authors/x/follow"),
                        ("DELETE", f"{URL}/authors/x/follow"), ("GET", f"{URL}/feed")):
        assert api.request(method, url).status_code == 402, (method, url)


def test_helpful_and_follow_are_each_rate_limited_in_process_per_hour(api, conn, lib_on, monkeypatch):
    from api.routers import notebook_template_gallery as router_mod
    monkeypatch.setattr(router_mod, "HELPFUL_RATE", "2/hour")
    monkeypatch.setattr(router_mod, "FOLLOW_RATE", "2/hour")
    item = _listed(conn, "a1")
    h = item["authorHandle"]
    _as(api, "m1")
    assert [api.post(f"{URL}/{item['id']}/helpful").status_code for _ in range(3)] == [200, 200, 429]
    assert [api.post(f"{URL}/authors/{h}/follow").status_code for _ in range(3)] == [200, 200, 429]
    # the two budgets are separate scopes, and a refused one wrote nothing more
    assert api.get(f"{URL}/feed").status_code == 200
    # another member has a budget of their own
    _as(api, "m2")
    assert api.post(f"{URL}/{item['id']}/helpful").status_code == 200


def test_a_refused_unfollow_or_unvote_is_also_counted_against_the_budget(api, conn, lib_on, monkeypatch):
    from api.routers import notebook_template_gallery as router_mod
    monkeypatch.setattr(router_mod, "HELPFUL_RATE", "2/hour")
    item = _listed(conn, "a1")
    _as(api, "m1")
    assert [api.delete(f"{URL}/{item['id']}/helpful").status_code for _ in range(3)] == [200, 200, 429]


# ── account deletion ─────────────────────────────────────────────────────────────────────

def test_account_deletion_clears_the_votes_follows_and_handle_of_a_leaver_and_what_others_hold_on_them(conn, lib_on):
    from api.services.journal_two import account_purge as ap
    mine = _listed(conn, "leaver")
    theirs = _listed(conn, "stayer")
    gallery.set_helpful("leaver", theirs["id"], True, conn=conn)       # the leaver's own vote
    gallery.set_helpful("stayer2", mine["id"], True, conn=conn)         # someone's vote on the leaver's item
    gallery.set_helpful("stayer2", theirs["id"], True, conn=conn)       # must survive
    gallery.set_follow("leaver", theirs["authorHandle"], True, conn=conn)       # the leaver follows someone
    gallery.set_follow("stayer2", mine["authorHandle"], True, conn=conn)        # someone follows the leaver
    gallery.set_follow("stayer2", theirs["authorHandle"], True, conn=conn)      # must survive

    def votes():
        return {tuple(r) for r in conn.execute("SELECT item_id, user_id FROM j2_gallery_helpful")}

    def follows():
        return {tuple(r) for r in conn.execute("SELECT follower_id, author_id FROM j2_gallery_follows")}

    assert len(votes()) == 3 and len(follows()) == 3                          # non-vacuity
    for table in ("j2_gallery_helpful", "j2_gallery_authors"):
        assert table in ap._DIRECT_USER_TABLES
    out = ap.purge_user_data("leaver", conn)
    assert out["errors"] == [], out["errors"]
    assert votes() == {(theirs["id"], "stayer2")}
    assert follows() == {("stayer2", "stayer")}
    assert {r[0] for r in conn.execute("SELECT user_id FROM j2_gallery_authors")} == {"stayer"}
    assert {"j2_gallery_helpful", "j2_gallery_authors", "j2_gallery_follows"} <= set(out["rows_deleted"])


def test_unpublishing_takes_the_votes_on_that_item_with_it(conn, lib_on):
    item = _listed(conn, "a1")
    keep = _listed(conn, "a2")
    gallery.set_helpful("m1", item["id"], True, conn=conn)
    gallery.set_helpful("m1", keep["id"], True, conn=conn)
    assert gallery.unpublish("a1", item["id"], conn=conn) is True
    assert {r[0] for r in conn.execute("SELECT item_id FROM j2_gallery_helpful")} == {keep["id"]}


def test_the_new_tables_are_what_the_brief_names(conn):
    def cols(t):
        return {r[1] for r in conn.execute(f"PRAGMA table_info({t})")}

    def pk(t):
        return {r[1] for r in conn.execute(f"PRAGMA table_info({t})") if r[5]}

    assert cols("j2_gallery_helpful") == {"item_id", "user_id", "created_at"} and pk("j2_gallery_helpful") == {"item_id", "user_id"}
    assert cols("j2_gallery_authors") == {"user_id", "handle", "created_at"} and pk("j2_gallery_authors") == {"user_id"}
    assert cols("j2_gallery_follows") == {"follower_id", "author_id", "created_at"}
    assert pk("j2_gallery_follows") == {"follower_id", "author_id"}
    conn.execute("INSERT INTO j2_gallery_authors (user_id, handle, created_at) VALUES ('x', 'dup', 'now')")
    with pytest.raises(Exception):                                            # the handle is UNIQUE
        conn.execute("INSERT INTO j2_gallery_authors (user_id, handle, created_at) VALUES ('y', 'dup', 'now')")

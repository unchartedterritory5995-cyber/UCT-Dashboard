"""P3b Task 6: a style shows its approved example notes ("In use"), and a reviewer sees exactly the public copy.

The service is `template_gallery.get_item` (a style's `examples`, an example's `linkedStyle`); the route is
`GET /api/j2/template-gallery/{gallery_id}`.

* `examples`: up to 3 APPROVED, listed, non-hidden example items linked to the style, newest first, each exactly
  `{id, title, bodyJson, updatedAt}`. `bodyJson` is the stored LISTED example reduction (`payload.bodyJson`,
  ruling P3b-R13), never a gallery-mode re-reduction, and never a held revision (`pending_json`).
* absent while the example switch is off (`example_enabled()`, which needs the library switch too).
* an example item read by someone who may see its style carries `linkedStyle: {id, title}` (the reviewer's
  "the linked style's title"); None when they may not see the style.
"""
from __future__ import annotations

import json

import pytest

from api.services.journal_two import template_gallery as gallery
from tests._style_library_helpers import api, conn, lib_on  # noqa: F401  (fixtures)
from tests.test_example_notes import (  # noqa: F401  (fixtures + helpers)
    URL, _as, _attachments, _note, _para, _shared_style, _src, ex_on, ocr,
)

ENTRY_KEYS = {"id", "title", "bodyJson", "updatedAt"}


@pytest.fixture
def clock(monkeypatch):
    """Every `_now()` one minute after the last, so "newest first" is a fact about the rows, not a tie."""
    ticks = iter(range(10_000))

    def now():
        n = next(ticks)
        return f"2026-10-18T{10 + n // 60:02d}:{n % 60:02d}:00+00:00"

    monkeypatch.setattr(gallery, "_now", now)


def _example(conn, sid, *, title, text="Watching 132.40 on Monday.", images=(), approve=True, user="author"):
    """One example of style `sid`, published by its author from a note of its own (approved unless told not to)."""
    nid = _note(conn, user, text=text, images=images, title=title)
    out = gallery.publish_example(conn, user, nid, sid, [_src(user, nid, n) for n in images], title)
    if approve:
        gallery.admin_act("admin", out["id"], "approve", reviewed_updated_at=out["updatedAt"], conn=conn)
    return out["id"], nid


def _item(api, gid, who="reader", role="member"):
    _as(api, who, role=role)
    r = api.get(f"{URL}/{gid}")
    assert r.status_code == 200, r.text
    return r.json()["template"]


def _texts(doc):
    out = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "text":
                out.append(n.get("text") or "")
            for c in n.get("content") or []:
                walk(c)
    walk(doc)
    return out


# ── server: approved only, at most 3, newest first ─────────────────────────────────────────

def test_examples_holds_approved_ones_only_at_most_three_newest_first(api, conn, ex_on, ocr, clock):
    sid = _shared_style(conn, approve=True)
    listed = [_example(conn, sid, title=f"Plan {i}")[0] for i in range(1, 6)]
    _example(conn, sid, title="Waiting", approve=False)                     # pending: never shown
    rejected, _ = _example(conn, sid, title="Declined", approve=False)
    gallery.admin_act("admin", rejected, "reject", note="Not an example.", conn=conn,
                      reviewed_updated_at=conn.execute("SELECT updated_at FROM j2_template_gallery WHERE id = ?", (rejected,)).fetchone()[0])
    out = _item(api, sid)["examples"]
    assert [e["id"] for e in out] == [listed[4], listed[3], listed[2]]      # the three newest listed, newest first
    assert [e["title"] for e in out] == ["Plan 5", "Plan 4", "Plan 3"]
    assert all(set(e) == ENTRY_KEYS for e in out)
    assert all(_texts(e["bodyJson"]) == ["Watching 132.40 on Monday."] for e in out)
    rows = {r["id"]: r["updated_at"] for r in conn.execute("SELECT id, updated_at FROM j2_template_gallery")}
    assert all(e["updatedAt"] == rows[e["id"]] for e in out)


def test_a_hidden_example_is_excluded(api, conn, ex_on, ocr, clock):
    sid = _shared_style(conn, approve=True)
    first, _ = _example(conn, sid, title="First")
    second, _ = _example(conn, sid, title="Second")
    assert [e["id"] for e in _item(api, sid)["examples"]] == [second, first]          # control: both listed
    gallery.admin_act("admin", second, "hide", conn=conn)
    assert [e["id"] for e in _item(api, sid)["examples"]] == [first]
    assert [e["id"] for e in _item(api, sid, "admin", "admin")["examples"]] == [first]  # for a reviewer too
    gallery.admin_act("admin", second, "unhide", conn=conn)
    assert [e["id"] for e in _item(api, sid)["examples"]] == [second, first]


def test_a_style_with_no_examples_answers_an_empty_list(api, conn, ex_on, ocr):
    sid = _shared_style(conn, approve=True)
    other = _shared_style(conn, approve=True)
    _example(conn, other, title="Someone else's style")                     # linked to the OTHER style
    assert _item(api, sid)["examples"] == []
    assert len(_item(api, other)["examples"]) == 1                          # control: the link is what decides


def test_an_example_linked_by_anyone_but_the_styles_author_is_not_shown(api, conn, ex_on, ocr):
    """`linkedItemId` is only ever written by the style's own author (publish checks it); a row that names the
    style from anyone else's account is not that style's example, whatever its payload says."""
    sid = _shared_style(conn, approve=True)
    own, _ = _example(conn, sid, title="Own")
    conn.execute(
        "INSERT INTO j2_template_gallery (id, user_id, kind, title, description, category, body_json, status,"
        " created_at, updated_at, listed_at, preview_json, item_type, payload_json, version)"
        " VALUES ('forged', 'intruder', 'member', 'Forged', '', 'journal', '{}', 'approved', ?, ?, ?, '[]',"
        " 'example_note', ?, 1)",
        ("2099-01-01T00:00:00+00:00",) * 3 + (json.dumps({"bodyJson": {"type": "doc", "content": []},
                                                            "linkedItemId": sid, "noteKind": "weekend_prep"}),))
    conn.commit()
    assert [e["id"] for e in _item(api, sid)["examples"]] == [own]


# ── server: the listed reduction, never a held revision ────────────────────────────────────

def test_examples_carry_the_listed_reduction_and_never_pending_json(api, conn, ex_on, ocr):
    sid = _shared_style(conn, approve=True)
    gid, nid = _example(conn, sid, title="Plan", text="made $1,240 at Schwab", images=("a.png",))
    # the author edits the note and publishes again: the new version is HELD (pending_json), the listed one stays
    body = {"type": "doc", "content": [_para("REVISION ONLY made $9,999")]}
    conn.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?", (json.dumps(body), nid))
    conn.commit()
    gallery.publish_example(conn, "author", nid, sid, [], "Revised title")
    assert conn.execute("SELECT pending_json FROM j2_template_gallery WHERE id = ?", (gid,)).fetchone()[0]
    for who, role in (("reader", "member"), ("author", "member"), ("admin", "admin")):
        _as(api, who, role=role)
        r = api.get(f"{URL}/{sid}")
        assert r.status_code == 200, r.text
        text = r.text
        assert "REVISION ONLY" not in text and "Revised title" not in text and "9,999" not in text, who
        assert "pending" not in json.dumps(r.json()["template"]["examples"]).lower(), who
        [entry] = r.json()["template"]["examples"]
        assert set(entry) == ENTRY_KEYS and entry["title"] == "Plan"
        # R13: the STORED example reduction (its image kept, at the gallery route), never a gallery-mode re-reduce
        stored = json.loads(conn.execute("SELECT payload_json FROM j2_template_gallery WHERE id = ?",
                                         (gid,)).fetchone()[0])["bodyJson"]
        assert entry["bodyJson"] == stored
        assert _texts(entry["bodyJson"]) == ["made your value here at your broker"]
        images = [n["attrs"]["src"] for n in entry["bodyJson"]["content"] if n.get("type") == "image"]
        assert images == [f"{URL}/{gid}/images/0"]


# ── server: the switch ─────────────────────────────────────────────────────────────────────

def test_examples_are_absent_while_the_example_switch_is_off(api, conn, ex_on, ocr, monkeypatch):
    sid = _shared_style(conn, approve=True)
    _example(conn, sid, title="Plan")
    assert "examples" in _item(api, sid)                                    # control: on, it is there
    monkeypatch.setenv("NOTEBOOK_EXAMPLE_NOTES_ENABLED", "0")
    for who, role in (("reader", "member"), ("author", "member"), ("admin", "admin")):
        assert "examples" not in _item(api, sid, who, role), who            # the style still reads; the key does not


def test_an_outline_carries_no_examples(api, conn, ex_on):
    from tests._style_library_helpers import _row
    gid = _row(conn, item_type="outline")
    assert "examples" not in _item(api, gid)


# ── server: the reviewer's read of an example names its style ──────────────────────────────

def test_an_example_read_names_its_linked_style_for_whoever_may_see_it(api, conn, ex_on, ocr):
    sid = _shared_style(conn, approve=True)
    title = conn.execute("SELECT title FROM j2_template_gallery WHERE id = ?", (sid,)).fetchone()[0]
    gid, _ = _example(conn, sid, title="Plan")
    for who, role in (("admin", "admin"), ("author", "member"), ("reader", "member")):
        assert _item(api, gid, who, role)["linkedStyle"] == {"id": sid, "title": title}, who


def test_a_style_the_reader_may_not_see_is_never_named(api, conn, ex_on, ocr):
    """P3b-T6-R6: an example of a style a member may not see (here: still pending) is itself absent for them. The
    author and an admin still read it, with the style named."""
    sid = _shared_style(conn, approve=False)                                # the style is still waiting for review
    gid, _ = _example(conn, sid, title="Plan")                              # its example is approved
    _as(api, "reader")
    assert api.get(f"{URL}/{gid}").status_code == 404                       # absent, as a pending style is
    title = conn.execute("SELECT title FROM j2_template_gallery WHERE id = ?", (sid,)).fetchone()[0]
    for who, role in (("admin", "admin"), ("author", "member")):
        out = _item(api, gid, who, role)
        assert out["linkedStyle"] == {"id": sid, "title": title}, who
        assert out["payload"]["linkedItemId"] == sid, who                   # R7: seen style, seen id


# ── P3b-T6-R6: hiding the style hides what shows it in use ────────────────────────────────

def test_hiding_the_style_hides_its_examples_read_and_images_from_other_members(api, conn, ex_on, ocr):
    sid = _shared_style(conn, approve=True)
    gid, _ = _example(conn, sid, title="Plan", images=("a.png",))
    _as(api, "reader")
    assert api.get(f"{URL}/{gid}").status_code == 200                       # control: listed style, both public
    assert api.get(f"{URL}/{gid}/images/0").status_code == 200
    missing = api.get(f"{URL}/nope").json()
    gallery.admin_act("admin", sid, "hide", conn=conn)
    read, image = api.get(f"{URL}/{gid}"), api.get(f"{URL}/{gid}/images/0")
    assert (read.status_code, image.status_code) == (404, 404)
    assert read.json() == missing                                           # the same 404 as no such item
    assert image.json() == api.get(f"{URL}/nope/images/0").json()
    for who, role in (("author", "member"), ("admin", "admin")):
        _as(api, who, role=role)
        assert api.get(f"{URL}/{gid}").status_code == 200, who
        assert api.get(f"{URL}/{gid}/images/0").status_code == 200, who
    gallery.admin_act("admin", sid, "unhide", conn=conn)
    _as(api, "reader")
    assert api.get(f"{URL}/{gid}").status_code == 200                       # unhidden: back as it was
    assert api.get(f"{URL}/{gid}/images/0").status_code == 200


def test_an_example_whose_style_is_gone_is_absent_for_members(api, conn, ex_on, ocr):
    sid = _shared_style(conn, approve=True)
    gid, _ = _example(conn, sid, title="Plan", images=("a.png",))
    conn.execute("DELETE FROM j2_template_gallery WHERE id = ?", (sid,))     # a style row that is no longer there
    conn.commit()
    _as(api, "reader")
    assert api.get(f"{URL}/{gid}").status_code == 404
    assert api.get(f"{URL}/{gid}/images/0").status_code == 404


# ── P3b-T6-R7: the style's id travels only with a style the reader may see ─────────────────

def test_the_linked_style_id_is_left_out_for_a_reader_who_may_not_see_the_style(api, conn, ex_on, ocr):
    sid = _shared_style(conn, approve=True)
    gid, _ = _example(conn, sid, title="Plan")
    assert _item(api, gid)["payload"]["linkedItemId"] == sid                 # seen style: the id is there
    conn.execute("DELETE FROM j2_template_gallery WHERE id = ?", (sid,))
    conn.commit()
    for who, role in (("author", "member"), ("admin", "admin")):            # they still read the example ...
        out = _item(api, gid, who, role)
        assert out["linkedStyle"] is None, who
        assert "linkedItemId" not in out["payload"], who                     # ... but no id of a style they can't see
        assert sid not in json.dumps(out), who

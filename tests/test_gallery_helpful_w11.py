"""Task 11.11 (W11-R8, W11-R9, W11-R11): Helpful after use on three ET days, and the one-time 3rd-day prompt.

* A `style` item counts the distinct ET days (`trading_days.et_day_of`, never a UTC `substr`) of the member's live
  notes made from their copies of it; a widget, routine or tracker item counts `j2_gallery_use_days`.
* Below three days, marking is refused with `GalleryConflict` code `helpful_days`; unmarking always works; outline and
  page_layout items are unchanged; with wave 11 off it is the wave 10 behaviour exactly.
* The prompt shows only on a note made on the member's 3rd-or-later use day, once per (member, item), never on their
  own item; "yes" marks Helpful in the same transaction.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from api.services.journal_two import template_gallery as gallery
from tests._gallery_w11_helpers import (  # noqa: F401
    ALL_WAVES, AUTHOR, MEMBER, OTHER, db, list_template, list_tool, routine, style, tracker, waves, widget,
)
from tests._style_library_helpers import _row as raw_row

# ET days 10-19, 10-20, 10-21, 10-22 (EDT, UTC-4). The first is a UTC 10-20 stamp, the second a UTC 10-20 evening.
DAY1, DAY2, DAY3, DAY4 = ("2026-10-20T03:30:00Z", "2026-10-20T23:00:00Z", "2026-10-21T14:00:00Z",
                          "2026-10-22T15:00:00Z")


def _listed_style(db, title="Setup study"):
    return list_template(db, style(db)["id"], title=title)


#: Fix round 1 (W11-R39): only notes created at or after the copy count, so the fixtures' copies are made before
#: the fixtures' notes (adoption stamps the real clock; the notes below are dated 2026-10-19 onward).
COPY_MADE = "2026-10-01T00:00:00+00:00"


def _copy(db, gid, uid=MEMBER, made_at=COPY_MADE):
    sid = gallery.adopt_style(uid, gid, conn=db)["style"]["id"]
    db.execute("UPDATE j2_journal_styles SET created_at = ? WHERE id = ?", (made_at, sid))
    db.commit()
    return sid


def _note(db, style_id, created_at, uid=MEMBER, deleted=False):
    nid = uuid.uuid4().hex
    db.execute("INSERT INTO j2_notes (id, user_id, title, created_at, updated_at, style_id, deleted_at)"
               " VALUES (?, ?, 'n', ?, ?, ?, ?)", (nid, uid, created_at, created_at, style_id,
                                                   created_at if deleted else None))
    db.commit()
    return nid


def _helpful_rows(db, gid):
    return db.execute("SELECT COUNT(*) FROM j2_gallery_helpful WHERE item_id = ?", (gid,)).fetchone()[0]


def _prompt_rows(db, gid=None):
    if gid is None:
        return db.execute("SELECT COUNT(*) FROM j2_gallery_helpful_prompts").fetchone()[0]
    return db.execute("SELECT COUNT(*) FROM j2_gallery_helpful_prompts WHERE item_id = ?", (gid,)).fetchone()[0]


def _refused(fn):
    with pytest.raises(gallery.GalleryConflict) as e:
        fn()
    assert e.value.code == "helpful_days" and str(e.value) == gallery.S_HELPFUL_DAYS
    return e.value


def test_the_constants_are_the_briefs():
    assert gallery.HELPFUL_DAYS == 3
    assert gallery.S_HELPFUL_DAYS == "You can mark this helpful after using it on 3 different days."
    assert gallery.HELPFUL_RULE_TYPES == ("style", "widget_definition", "routine", "tracker")


def test_style_needs_three_et_days(db):
    gid = _listed_style(db)
    sid = _copy(db, gid)
    # Four notes on THREE UTC days (10-19, 10-20, 10-21) but TWO ET days (10-19, 10-20): two of them sit either side
    # of UTC midnight on ET 10-20 and count once. A UTC `substr` would count three and wrongly allow the mark.
    for ts in ("2026-10-19T15:00:00Z", DAY1, DAY2, "2026-10-21T02:00:00Z"):
        _note(db, sid, ts)
    _note(db, sid, "2026-10-23T15:00:00Z", deleted=True)          # a trashed note is not a use
    row = gallery._row(db, gid, MEMBER)
    assert gallery.use_days(MEMBER, row, conn=db) == 2
    _refused(lambda: gallery.set_helpful(MEMBER, gid, True, conn=db))
    assert _helpful_rows(db, gid) == 0 and not db.in_transaction
    _note(db, sid, DAY3)                                          # ET 10-21: the third day
    assert gallery.use_days(MEMBER, row, conn=db) == 3
    assert gallery.set_helpful(MEMBER, gid, True, conn=db) == {"helpful": True, "count": 1}


def test_style_days_come_from_every_copy_of_the_item(db):
    gid = _listed_style(db)
    a, b = _copy(db, gid), _copy(db, gid)                          # the member adopted it twice
    _note(db, a, DAY1)
    _note(db, b, DAY2)
    _note(db, b, DAY3)
    assert gallery.set_helpful(MEMBER, gid, True, conn=db)["helpful"] is True


@pytest.mark.parametrize("kind", ["widget", "routine", "tracker"])
def test_tool_types_read_use_days(db, kind):
    made = {"widget": widget, "routine": routine, "tracker": tracker}[kind](db)
    edits = {"routine": {"name": "Morning", "items": ["Coffee", "Read the plan"]},
             "tracker": {"name": "Sleep", "unit": "hours"}}.get(kind)
    gid = list_tool(db, kind, made["id"], edits=edits)
    gallery.adopt_tool(MEMBER, gid, answers={"p1": "Flag"} if kind == "widget" else None, conn=db)
    row = gallery._row(db, gid, MEMBER)
    days = [datetime(2026, 10, d, 15, tzinfo=timezone.utc) for d in (20, 21)]
    for now in (*days, days[0]):                                   # a second use on one day is one day
        gallery.record_use_day(MEMBER, gid, now=now, conn=db)
    assert gallery.use_days(MEMBER, row, conn=db) == 2
    _refused(lambda: gallery.set_helpful(MEMBER, gid, True, conn=db))
    assert _helpful_rows(db, gid) == 0
    gallery.record_use_day(MEMBER, gid, now=datetime(2026, 10, 22, 15, tzinfo=timezone.utc), conn=db)
    assert gallery.set_helpful(MEMBER, gid, True, conn=db) == {"helpful": True, "count": 1}


@pytest.mark.parametrize("item_type", ["outline", "page_layout"])
def test_outline_and_layout_unchanged(db, monkeypatch, item_type):
    monkeypatch.setenv("JOURNAL_PAGE_LAYOUTS_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_LAYOUT_SHARING_ENABLED", "1")
    gid = raw_row(db, item_type=item_type, user_id=AUTHOR, source_page="trade" if item_type == "page_layout" else None)
    row = gallery._row(db, gid, MEMBER)
    assert gallery.use_days(MEMBER, row, conn=db) == 0             # never used, and it does not matter
    assert gallery.set_helpful(MEMBER, gid, True, conn=db) == {"helpful": True, "count": 1}


def test_unmark_always_allowed(db):
    gid = _listed_style(db)
    sid = _copy(db, gid)
    for ts in (DAY1, DAY2, DAY3):
        _note(db, sid, ts)
    assert gallery.set_helpful(MEMBER, gid, True, conn=db)["count"] == 1
    db.execute("UPDATE j2_notes SET deleted_at = 'x' WHERE user_id = ?", (MEMBER,))   # the uses are gone
    db.commit()
    assert gallery.set_helpful(MEMBER, gid, False, conn=db) == {"helpful": False, "count": 0}
    assert gallery.set_helpful(MEMBER, gid, False, conn=db) == {"helpful": False, "count": 0}  # never marked: fine


def test_w11_off_behaves_as_wave10(db, monkeypatch):
    gid = _listed_style(db)
    sid = _copy(db, gid)
    for ts in (DAY1, DAY2, DAY3):
        _note(db, sid, ts)
    nid = _note(db, sid, DAY4)
    waves(monkeypatch, *(w for w in ALL_WAVES if w != 11))
    # no use needed, exactly as in wave 10 (the member's style notes are not even consulted)
    db.execute("UPDATE j2_notes SET deleted_at = 'x' WHERE user_id = ?", (MEMBER,))
    db.commit()
    assert gallery.set_helpful(MEMBER, gid, True, conn=db) == {"helpful": True, "count": 1}
    assert gallery.set_helpful(MEMBER, gid, False, conn=db) == {"helpful": False, "count": 0}
    assert gallery.set_helpful(AUTHOR, gid, True, conn=db) is None                      # never your own
    assert gallery.helpful_prompt(MEMBER, nid, conn=db) == {"show": False}
    assert gallery.answer_helpful_prompt(MEMBER, gid, "yes", conn=db) is None
    assert _prompt_rows(db) == 0


def test_prompt_only_on_third_day_note(db):
    gid = _listed_style(db, title="Pre-market prep")
    sid = _copy(db, gid)
    n1, n2 = _note(db, sid, DAY1), _note(db, sid, DAY2)
    assert gallery.helpful_prompt(MEMBER, n2, conn=db) == {"show": False}          # only two days so far
    n3, n4 = _note(db, sid, DAY3), _note(db, sid, DAY4)
    for nid in (n1, n2):
        assert gallery.helpful_prompt(MEMBER, nid, conn=db) == {"show": False}
    want = {"show": True, "itemId": gid, "title": "Pre-market prep", "line": "Was Pre-market prep helpful?"}
    for nid in (n3, n4):
        assert gallery.helpful_prompt(MEMBER, nid, conn=db) == want
    # asking writes nothing: still shown until it is ANSWERED
    assert _prompt_rows(db) == 0 and gallery.helpful_prompt(MEMBER, n3, conn=db)["show"] is True
    gallery.answer_helpful_prompt(MEMBER, gid, "dismissed", conn=db)
    for nid in (n1, n2, n3, n4):
        assert gallery.helpful_prompt(MEMBER, nid, conn=db) == {"show": False}


def test_prompt_never_for_own_item_or_after_answer(db):
    gid = _listed_style(db)
    # the author's own style pointing at their own listing: still their item, never prompted
    own = style(db, name="Own copy")["id"]
    db.execute("UPDATE j2_journal_styles SET source_gallery_id = ? WHERE id = ?", (gid, own))
    db.commit()
    own_notes = [_note(db, own, ts, uid=AUTHOR) for ts in (DAY1, DAY2, DAY3)]
    assert gallery.helpful_prompt(AUTHOR, own_notes[-1], conn=db) == {"show": False}
    assert gallery.answer_helpful_prompt(AUTHOR, gid, "yes", conn=db) is None
    # a member who already marked it Helpful is not asked
    sid = _copy(db, gid)
    notes = [_note(db, sid, ts) for ts in (DAY1, DAY2, DAY3)]
    assert gallery.helpful_prompt(MEMBER, notes[-1], conn=db)["show"] is True
    gallery.set_helpful(MEMBER, gid, True, conn=db)
    assert gallery.helpful_prompt(MEMBER, notes[-1], conn=db) == {"show": False}
    # unmarking does not bring it back once answered
    gallery.set_helpful(MEMBER, gid, False, conn=db)
    gallery.answer_helpful_prompt(MEMBER, gid, "not_really", conn=db)
    assert gallery.helpful_prompt(MEMBER, notes[-1], conn=db) == {"show": False}
    # a hidden or unlisted item is not asked about
    other_gid = _listed_style(db, title="Second")
    sid2 = _copy(db, other_gid)
    n = [_note(db, sid2, ts) for ts in (DAY1, DAY2, DAY3)][-1]
    db.execute("UPDATE j2_template_gallery SET hidden = 1 WHERE id = ?", (other_gid,))
    db.commit()
    assert gallery.helpful_prompt(MEMBER, n, conn=db) == {"show": False}
    # a trashed note and an unknown note are not asked about
    trashed = _note(db, sid, DAY4, deleted=True)
    assert gallery.helpful_prompt(MEMBER, trashed, conn=db) == {"show": False}
    assert gallery.helpful_prompt(MEMBER, "no-such-note", conn=db) == {"show": False}


def test_yes_marks_helpful_once(db):
    gid = _listed_style(db)
    sid = _copy(db, gid)
    for ts in (DAY1, DAY2, DAY3):
        _note(db, sid, ts)
    assert gallery.answer_helpful_prompt(MEMBER, gid, "yes", conn=db) == {"answer": "yes", "helpful": True,
                                                                          "count": 1}
    assert gallery.answer_helpful_prompt(MEMBER, gid, "yes", conn=db) == {"answer": "yes", "helpful": True,
                                                                          "count": 1}
    # a later answer changes nothing and reports the stored one
    assert gallery.answer_helpful_prompt(MEMBER, gid, "dismissed", conn=db)["answer"] == "yes"
    assert _prompt_rows(db, gid) == 1 and _helpful_rows(db, gid) == 1


def test_yes_before_three_days_is_refused_and_stores_nothing(db):
    gid = _listed_style(db)
    sid = _copy(db, gid)
    _note(db, sid, DAY1)
    _refused(lambda: gallery.answer_helpful_prompt(MEMBER, gid, "yes", conn=db))
    assert _prompt_rows(db) == 0 and _helpful_rows(db, gid) == 0 and not db.in_transaction


def test_not_really_and_dismissed_store_only(db):
    gid = _listed_style(db)
    for uid, answer in ((MEMBER, "not_really"), (OTHER, "dismissed")):
        assert gallery.answer_helpful_prompt(uid, gid, answer, conn=db) == {"answer": answer, "helpful": False,
                                                                            "count": 0}
    stored = dict(db.execute("SELECT user_id, answer FROM j2_gallery_helpful_prompts WHERE item_id = ?", (gid,)))
    assert stored == {MEMBER: "not_really", OTHER: "dismissed"} and _helpful_rows(db, gid) == 0
    for bad in ("no", "", None, "YES"):
        with pytest.raises(gallery.GalleryError) as e:
            gallery.answer_helpful_prompt(MEMBER, gid, bad, conn=db)
        assert str(e.value) == "Choose yes, not really or dismiss."
    assert gallery.answer_helpful_prompt(MEMBER, "no-such-item", "dismissed", conn=db) is None


def test_prompt_reads_no_other_member_notes(db):
    gid = _listed_style(db)
    other_sid = _copy(db, gid, uid=OTHER)
    other_notes = [_note(db, other_sid, ts, uid=OTHER) for ts in (DAY1, DAY2, DAY3)]
    sid = _copy(db, gid)
    mine = [_note(db, sid, ts) for ts in (DAY3, DAY4)]                 # two days of the member's own
    row = gallery._row(db, gid, MEMBER)
    assert gallery.use_days(MEMBER, row, conn=db) == 2 and gallery.use_days(OTHER, row, conn=db) == 3
    assert gallery.helpful_prompt(MEMBER, mine[-1], conn=db) == {"show": False}
    assert gallery.helpful_prompt(MEMBER, other_notes[-1], conn=db) == {"show": False}   # not their note
    _refused(lambda: gallery.set_helpful(MEMBER, gid, True, conn=db))
    # the member's note naming ANOTHER member's copy is not a use of it
    stray = _note(db, other_sid, "2026-10-23T15:00:00Z")
    assert gallery.use_days(MEMBER, row, conn=db) == 2
    assert gallery.helpful_prompt(MEMBER, stray, conn=db) == {"show": False}
    assert gallery.helpful_prompt(OTHER, other_notes[-1], conn=db)["show"] is True


def test_the_prompt_never_writes_the_note(db):
    gid = _listed_style(db)
    sid = _copy(db, gid)
    notes = [_note(db, sid, ts) for ts in (DAY1, DAY2, DAY3)]
    before = [tuple(r) for r in db.execute("SELECT * FROM j2_notes ORDER BY id")]
    db.set_trace_callback(None)
    written: list[str] = []
    db.set_trace_callback(lambda sql: written.append(sql))
    try:
        gallery.helpful_prompt(MEMBER, notes[-1], conn=db)
        gallery.answer_helpful_prompt(MEMBER, gid, "yes", conn=db)
    finally:
        db.set_trace_callback(None)
    assert not [s for s in written if "j2_notes" in s and not s.lstrip().upper().startswith("SELECT")]
    assert [tuple(r) for r in db.execute("SELECT * FROM j2_notes ORDER BY id")] == before


def test_a_later_yes_after_another_answer_changes_nothing(db):
    """Once per (member, item): a "yes" posted after "dismissed" neither replaces the answer nor marks Helpful."""
    gid = _listed_style(db)
    sid = _copy(db, gid)
    for ts in (DAY1, DAY2, DAY3):
        _note(db, sid, ts)
    assert gallery.answer_helpful_prompt(MEMBER, gid, "dismissed", conn=db)["answer"] == "dismissed"
    assert gallery.answer_helpful_prompt(MEMBER, gid, "yes", conn=db) == {"answer": "dismissed", "helpful": False,
                                                                          "count": 0}
    assert _helpful_rows(db, gid) == 0


# ── fix round 1 ──────────────────────────────────────────────────────────────────────────────────

def test_old_notes_switched_onto_a_copy_never_count(db):
    """Ruling W11-R39 (m-4): a use day is a note CREATED at or after the copy was made. Three old notes from three
    different days, switched onto the copy (their `created_at` kept, as `journal_styles` does), unlock nothing."""
    gid = _listed_style(db)
    sid = _copy(db, gid, made_at="2026-10-25T00:00:00Z")
    old = [_note(db, sid, ts) for ts in (DAY1, DAY2, DAY3)]              # 10-19, 10-20, 10-21: before the copy
    row = gallery._row(db, gid, MEMBER)
    assert gallery.use_days(MEMBER, row, conn=db) == 0
    _refused(lambda: gallery.set_helpful(MEMBER, gid, True, conn=db))
    assert gallery.helpful_prompt(MEMBER, old[-1], conn=db) == {"show": False}
    new = [_note(db, sid, ts) for ts in ("2026-10-25T14:00:00Z", "2026-10-26T14:00:00Z", "2026-10-27T14:00:00Z")]
    assert gallery.use_days(MEMBER, row, conn=db) == 3
    assert gallery.helpful_prompt(MEMBER, new[-1], conn=db)["show"] is True
    assert gallery.set_helpful(MEMBER, gid, True, conn=db) == {"helpful": True, "count": 1}


def _caller_write(db):
    """A pending write of the caller's own, in a transaction the CALLER opened."""
    db.execute("UPDATE users SET display_name = 'Pending' WHERE id = ?", (OTHER,))
    assert db.in_transaction


def _caller_value(db):
    return db.execute("SELECT display_name FROM users WHERE id = ?", (OTHER,)).fetchone()[0]


def test_a_refusal_never_rolls_back_the_callers_transaction(db):
    """m-1: a `helpful_days` refusal inside a caller's transaction undoes only its own writes (the prompt row), never
    the caller's pending write, and commits nothing."""
    gid = _listed_style(db)
    _note(db, _copy(db, gid), DAY1)
    for call in (lambda: gallery.set_helpful(MEMBER, gid, True, conn=db),
                 lambda: gallery.answer_helpful_prompt(MEMBER, gid, "yes", conn=db)):
        _caller_write(db)
        _refused(call)
        assert db.in_transaction and _caller_value(db) == "Pending"          # still the caller's, still pending
        assert _prompt_rows(db) == 0 and _helpful_rows(db, gid) == 0
        db.rollback()
        assert _caller_value(db) == "Other"                                  # nothing was committed for it


def test_a_success_never_commits_the_callers_transaction(db):
    """m-1: inside a caller's transaction the write stays the caller's to commit or discard."""
    gid = _listed_style(db)
    sid = _copy(db, gid)
    for ts in (DAY1, DAY2, DAY3):
        _note(db, sid, ts)
    _caller_write(db)
    assert gallery.set_helpful(MEMBER, gid, True, conn=db)["helpful"] is True
    assert gallery.answer_helpful_prompt(MEMBER, gid, "not_really", conn=db)["answer"] == "not_really"
    assert db.in_transaction
    db.rollback()                                                            # the caller discards: all of it goes
    assert _caller_value(db) == "Other" and _helpful_rows(db, gid) == 0 and _prompt_rows(db) == 0
    # and with no caller transaction, each call commits its own write
    assert gallery.answer_helpful_prompt(MEMBER, gid, "yes", conn=db)["helpful"] is True
    assert not db.in_transaction and _prompt_rows(db) == 1


@pytest.mark.parametrize("item_type", ["widget", "outline"])
def test_the_prompt_answer_is_for_templates_only(db, item_type):
    """m-5: the 3rd-day line is only ever shown for a template, so only a template's answer is stored."""
    if item_type == "widget":
        gid = list_tool(db, "widget", widget(db)["id"])
    else:
        gid = raw_row(db, item_type="outline", user_id=AUTHOR)
    assert gallery._votable_row(db, MEMBER, gid) is not None                 # votable: the refusal is the type's
    for answer in gallery.HELPFUL_ANSWERS:
        assert gallery.answer_helpful_prompt(MEMBER, gid, answer, conn=db) is None
    assert _prompt_rows(db) == 0 and _helpful_rows(db, gid) == 0

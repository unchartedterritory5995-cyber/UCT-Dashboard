"""Unlinked mentions (wave 6, Phase 2) — the matching rules, each on its own.

Word boundary, case, the short-title floor, the already-linked exclusion,
trash, archive (with and WITHOUT the column), and the note itself.
"""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest


@pytest.fixture
def svc(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.journal_two import notes as notes_service
    from api.services.journal_two import note_mentions
    yield notes_service, note_mentions
    os.unlink(tmp.name)


def _doc(*paragraphs):
    content = []
    for p in paragraphs:
        if isinstance(p, str):
            content.append({"type": "paragraph", "content": [{"type": "text", "text": p}]})
        else:
            content.append({"type": "paragraph", "content": p})
    return {"type": "doc", "content": content}


def _note(ns, uid, title, *paragraphs):
    return ns.create_note(uid, {"title": title, "bodyJson": _doc(*paragraphs)})["id"]


def _ids(result):
    return [n["id"] for n in result["notes"]]


def test_a_plain_mention_is_found_with_its_snippet(svc):
    ns, nm = svc
    target = _note(ns, "u1", "Cup and handle")
    other = _note(ns, "u1", "Tuesday", "NVDA formed a cup and handle on the daily chart today.")
    out = nm.get_unlinked_mentions("u1", target)
    assert _ids(out) == [other]
    snip = out["notes"][0]["snippet"]
    assert snip["match"] == "cup and handle"          # the note's own casing
    assert snip["before"] == "NVDA formed a "
    assert snip["after"] == " on the daily chart today."


def test_matching_is_case_insensitive(svc):
    ns, nm = svc
    target = _note(ns, "u1", "nvda thesis")
    other = _note(ns, "u1", "Log", "Re-read the NVDA THESIS before the open.")
    assert _ids(nm.get_unlinked_mentions("u1", target)) == [other]


def test_matching_respects_word_boundaries(svc):
    ns, nm = svc
    target = _note(ns, "u1", "NVDA")
    _note(ns, "u1", "Inside a word", "NVDAX is a different ticker, and so is XNVDA.")
    hit = _note(ns, "u1", "Real one", "Trimmed NVDA, kept the rest.")
    assert _ids(nm.get_unlinked_mentions("u1", target)) == [hit]


def test_the_matcher_itself_is_word_bounded_at_both_ends():
    """⛔ The FTS prefilter ALSO drops "NVDAX"-only notes, so the DB test above
    cannot tell whether the Python matcher is bounded — it would stay green with
    the matcher's boundaries deleted (mutation-measured). This asks the matcher
    directly, where nothing else can answer for it."""
    from api.services.journal_two import note_mentions as nm
    pat = nm.title_pattern("NVDA")
    doc = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "NVDAX first, then XNVDA, then the real NVDA."}]}]}
    n, snip = nm.find_mentions(doc, pat)
    assert n == 1
    assert snip["before"] == "NVDAX first, then XNVDA, then the real "
    assert snip["after"] == "."


def test_a_near_miss_before_a_real_mention_does_not_become_the_snippet(svc):
    ns, nm = svc
    target = _note(ns, "u1", "NVDA")
    hit = _note(ns, "u1", "Mixed", "Watching NVDAX closely.", "Added NVDA on the reclaim.")
    out = nm.get_unlinked_mentions("u1", target)
    assert _ids(out) == [hit]
    assert out["notes"][0]["occurrences"] == 1
    assert out["notes"][0]["snippet"]["after"] == " on the reclaim."


def test_a_title_with_punctuation_still_matches_as_a_phrase(svc):
    ns, nm = svc
    target = _note(ns, "u1", "S&P 500")
    hit = _note(ns, "u1", "Tape", "The S&P 500 closed at a high.")
    _note(ns, "u1", "Near miss", "The S&P closed; 500 names advanced.")
    assert _ids(nm.get_unlinked_mentions("u1", target)) == [hit]


def test_a_mark_boundary_is_not_a_word_boundary(svc):
    """`body_plain` joins text nodes with a space; the matcher must not, or a
    bolded title reads as two words and a mid-word mark splits one."""
    ns, nm = svc
    target = _note(ns, "u1", "base breakout")
    hit = _note(ns, "u1", "Setup", [
        {"type": "text", "text": "Clean "},
        {"type": "text", "text": "base", "marks": [{"type": "bold"}]},
        {"type": "text", "text": " breakout into the close"},
    ])
    out = nm.get_unlinked_mentions("u1", target)
    assert _ids(out) == [hit]
    assert out["notes"][0]["snippet"]["match"] == "base breakout"


def test_titles_under_three_characters_are_skipped(svc):
    ns, nm = svc
    target = _note(ns, "u1", "AI")
    _note(ns, "u1", "Other", "AI names led again.")
    out = nm.get_unlinked_mentions("u1", target)
    assert out["skipped"] == "short-title"
    assert out["notes"] == []
    # CONTROL: three characters is enough.
    three = _note(ns, "u1", "AMD")
    hit = _note(ns, "u1", "Other two", "Added AMD on the reclaim.")
    assert _ids(nm.get_unlinked_mentions("u1", three)) == [hit]


def test_a_note_that_already_links_here_is_excluded(svc):
    ns, nm = svc
    target = _note(ns, "u1", "Earnings playbook")
    _note(ns, "u1", "Linked", [
        {"type": "text", "text": "See the earnings playbook "},
        {"type": "noteLink", "attrs": {"noteId": target}},
    ])
    unlinked = _note(ns, "u1", "Unlinked", "Follow the earnings playbook this week.")
    assert _ids(nm.get_unlinked_mentions("u1", target)) == [unlinked]


def test_trash_is_excluded_and_so_is_the_note_itself(svc):
    ns, nm = svc
    target = _note(ns, "u1", "Momentum burst", "A momentum burst mention inside itself.")
    trashed = _note(ns, "u1", "Old", "That momentum burst failed.")
    ns.delete_note("u1", trashed)
    assert nm.get_unlinked_mentions("u1", target)["notes"] == []


def test_archive_is_excluded_when_the_column_exists(svc):
    ns, nm = svc
    from api.services import auth_db
    target = _note(ns, "u1", "Gap and go")
    archived = _note(ns, "u1", "Archived", "A gap and go that worked.")
    live = _note(ns, "u1", "Live", "Another gap and go.")
    conn = auth_db.get_connection()
    conn.execute("ALTER TABLE j2_notes ADD COLUMN archived_at TEXT")
    conn.execute("UPDATE j2_notes SET archived_at = '2026-09-20' WHERE id = ?", (archived,))
    conn.commit()
    conn.close()
    assert _ids(nm.get_unlinked_mentions("u1", target)) == [live]


def test_without_the_archive_column_the_read_still_works(svc):
    ns, nm = svc
    from api.services import auth_db
    conn = auth_db.get_connection()
    assert not nm.has_column(conn, "j2_notes", "archived_at")   # the branch under test
    conn.close()
    target = _note(ns, "u1", "Inside day")
    hit = _note(ns, "u1", "Log", "An inside day into earnings.")
    assert _ids(nm.get_unlinked_mentions("u1", target)) == [hit]


def test_another_members_notes_are_never_read(svc):
    ns, nm = svc
    target = _note(ns, "u1", "Short squeeze")
    _note(ns, "u2", "Theirs", "A short squeeze in their notebook.")
    assert nm.get_unlinked_mentions("u1", target)["notes"] == []
    # And a foreign note id answers empty, not with the owner's data.
    assert nm.get_unlinked_mentions("u2", target)["notes"] == []


def test_occurrences_are_counted_across_blocks(svc):
    ns, nm = svc
    target = _note(ns, "u1", "Pocket pivot")
    _note(ns, "u1", "Many", "A pocket pivot today.", "Another pocket pivot, and a POCKET PIVOT.")
    assert nm.get_unlinked_mentions("u1", target)["notes"][0]["occurrences"] == 3


def test_the_candidate_limit_applies_AFTER_the_filters_newest_first(svc, monkeypatch):
    """N-4: the LIMIT used to sit inside the FTS subquery, BEFORE the trash /
    self / already-linked filters and with no order — so trashed and linked
    notes used up the slots and the count was short. The limit now applies to
    the filtered set, newest first, with a stable tiebreak."""
    ns, nm = svc
    from api.services import auth_db
    monkeypatch.setattr(nm, "MAX_CANDIDATES", 2)
    target = _note(ns, "u1", "Flag breakout")
    trashed = [_note(ns, "u1", f"Old {i}", "A flag breakout that failed.") for i in range(3)]
    for t in trashed:
        ns.delete_note("u1", t)
    _note(ns, "u1", "Linked", [
        {"type": "text", "text": "Flag breakout, see "},
        {"type": "noteLink", "attrs": {"noteId": target}},
    ])
    live = [_note(ns, "u1", f"Live {i}", "Another flag breakout.") for i in range(3)]
    conn = auth_db.get_connection()
    for i, nid in enumerate(live):
        conn.execute("UPDATE j2_notes SET updated_at = ? WHERE id = ?", (f"2026-09-2{i} 10:00:00", nid))
    conn.commit()
    conn.close()
    out = nm.get_unlinked_mentions("u1", target)
    assert _ids(out) == [live[2], live[1]]                  # the two newest LIVE, unlinked notes

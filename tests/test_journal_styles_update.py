"""Update layout (spec P1.3): adds missing blocks only, never removes or reorders the member's text,
one compare-and-set write with the style stamp in it.

The route (`POST /api/j2/notes/{id}/apply-style-update`) belongs to Task 8's router and is not
built in this lane; these rails pin the SERVICE it calls. `_styled_note` makes a note the way
Task 9's `create_styled_note` does (compose, then ONE insert with the properties and the stamp)."""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)


def _styled_note(user, style_id, ticker):
    from api.services.journal_two import journal_styles as js, notes
    style = js.get_style(user, style_id)
    composed = js.compose(user, style, ticker=ticker, conn=None)
    return notes.create_note(user, {"title": "styled", "ticker": ticker, "bodyJson": composed["bodyJson"]},
                             properties=composed["properties"],
                             style_stamp=(composed["styleId"], composed["styleVersion"], composed["kindId"]))


def _note_from_v1(user="u1", ticker="NVDA"):
    from api.services.journal_two import journal_styles as js, notes
    s = js.create_style(user, {"name": "Mine", "kindId": "thesis", "blocks": [],
        "outlineBodyJson": {"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Thesis"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "prompt"}]}]}})
    n = _styled_note(user, s["id"], ticker)
    body = n["bodyJson"]
    body["content"].append({"type": "paragraph", "content": [{"type": "text", "text": "MY WORDS"}]})
    n = notes.update_note(user, n["id"], {"bodyJson": body}, client_schema=4)
    js.update_style(user, s["id"], {"blocks": [{"block": "chart", "enabled": True, "settings": {"tf": "W"}}]})
    return s, n


def test_plan_names_the_missing_block_and_versions(db_path):
    from api.services.journal_two import journal_styles as js
    s, n = _note_from_v1()
    p = js.plan_style_update("u1", n["id"])
    assert (p["fromVersion"], p["toVersion"], p["switching"], p["upToDate"]) == (1, 2, False, False)
    assert p["add"] == [{"block": "chart", "label": None}]
    assert (p["styleId"], p["styleName"], p["insertsOutline"], p["skipped"]) == (s["id"], "Mine", False, [])


def test_a_plan_writes_nothing(db_path):
    from api.services.journal_two import journal_styles as js, notes
    s, n = _note_from_v1()
    js.plan_style_update("u1", n["id"])
    after = notes.get_note("u1", n["id"])
    assert (after["updatedAt"], after["styleVersion"], after["bodyJson"]) == (n["updatedAt"], 1, n["bodyJson"])


def test_apply_adds_after_the_heading_keeps_every_word_and_stamps(db_path):
    from api.services.journal_two import journal_styles as js
    s, n = _note_from_v1()
    before = [x for x in n["bodyJson"]["content"]]
    note, plan = js.apply_style_update("u1", n["id"], expected_updated_at=n["updatedAt"])
    after = note["bodyJson"]["content"]
    assert after[1]["type"] == "widgetEmbed" and after[1]["attrs"]["params"]["tf"] == "W"
    assert after[1]["attrs"]["params"]["symbol"] == "NVDA"
    assert [x for x in after if x["type"] != "widgetEmbed"] == before           # nothing removed or moved
    assert (note["styleId"], note["styleVersion"]) == (s["id"], 2)
    assert js.plan_style_update("u1", n["id"])["upToDate"] is True


def test_a_block_already_in_the_note_is_not_added_twice(db_path):
    from api.services.journal_two import journal_styles as js
    s, n = _note_from_v1()
    note, _ = js.apply_style_update("u1", n["id"], expected_updated_at=n["updatedAt"])
    js.update_style("u1", s["id"], {"properties": {"builtin:confidence": "high"}})       # v3, no new block
    p = js.plan_style_update("u1", n["id"])
    assert (p["add"], p["upToDate"], p["toVersion"]) == ([], False, 3)
    note2, _ = js.apply_style_update("u1", n["id"], expected_updated_at=note["updatedAt"])
    assert note2["bodyJson"] == note["bodyJson"]                                  # the chart is not doubled


def test_a_stale_base_writes_nothing(db_path):
    from api.services.journal_two import journal_styles as js, notes
    s, n = _note_from_v1()
    with pytest.raises(notes.NoteConflictError):
        js.apply_style_update("u1", n["id"], expected_updated_at="2000-01-01T00:00:00+00:00")
    got = notes.get_note("u1", n["id"])
    assert got["styleVersion"] == 1 and got["bodyJson"] == n["bodyJson"]


def test_a_write_between_the_read_and_the_update_is_never_overwritten(db_path, monkeypatch):
    """⛔ No client baseline sent: the service still compares-and-sets against the revision IT read,
    so a second writer landing between that read and the write is a 409, never a clobber."""
    from api.services.journal_two import journal_styles as js, notes
    s, n = _note_from_v1()
    real = js._raw_note

    def read_then_someone_types(user_id, note_id, conn):
        got = real(user_id, note_id, conn)
        body = notes.get_note("u1", n["id"])["bodyJson"]
        body["content"].append({"type": "paragraph", "content": [{"type": "text", "text": "TYPED IN ANOTHER TAB"}]})
        notes.update_note("u1", n["id"], {"bodyJson": body}, client_schema=4)
        return got

    monkeypatch.setattr(js, "_raw_note", read_then_someone_types)
    with pytest.raises(notes.NoteConflictError):
        js.apply_style_update("u1", n["id"])
    texts = [c.get("content", [{}])[0].get("text") for c in notes.get_note("u1", n["id"])["bodyJson"]["content"]
             if c.get("content")]
    assert "TYPED IN ANOTHER TAB" in texts and "MY WORDS" in texts


def test_switching_sets_the_kind_and_an_empty_note_gets_the_outline(db_path):
    from api.services.journal_two import journal_styles as js, notes
    n = notes.create_note("u1", {"title": "empty", "ticker": "AMD"})
    note, plan = js.apply_style_update("u1", n["id"], style_id="builtin:watchlist_note",
                                       expected_updated_at=n["updatedAt"])
    assert plan["switching"] is True and plan["insertsOutline"] is True and plan["fromVersion"] is None
    assert note["propertiesJson"]["builtin:note_kind"] == "watchlist_note"
    assert note["bodyJson"]["content"][0]["type"] == "heading"
    assert any(x["type"] == "widgetEmbed" for x in note["bodyJson"]["content"])
    assert (note["styleId"], note["styleVersion"]) == ("builtin:watchlist_note", 1)


def test_switching_a_note_with_words_only_adds_blocks(db_path):
    from api.services.journal_two import journal_styles as js, notes
    words = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "mine"}]}]}
    n = notes.create_note("u1", {"title": "x", "ticker": "AMD", "bodyJson": words})
    note, plan = js.apply_style_update("u1", n["id"], style_id="builtin:thesis", expected_updated_at=n["updatedAt"])
    assert plan["insertsOutline"] is False
    assert [x["type"] for x in note["bodyJson"]["content"]] == ["widgetEmbed", "paragraph"]   # no heading: first
    assert note["bodyJson"]["content"][1] == words["content"][0]


def test_a_chart_needs_a_ticker_and_is_skipped_without_one(db_path):
    from api.services.journal_two import journal_styles as js
    s, n = _note_from_v1(ticker=None)
    p = js.plan_style_update("u1", n["id"])
    assert p["add"] == [] and p["skipped"] == [{"block": "chart", "reason": "needs-ticker"}]


def test_a_note_not_made_from_a_style_needs_a_style_id(db_path):
    from api.services.journal_two import journal_styles as js, notes
    n = notes.create_note("u1", {"title": "x"})
    with pytest.raises(js.StyleValidationError):
        js.plan_style_update("u1", n["id"])


def test_a_deleted_style_or_a_missing_note_is_not_found(db_path):
    from api.services.journal_two import journal_styles as js
    s, n = _note_from_v1()
    with pytest.raises(js.StyleNotFound):
        js.plan_style_update("u1", "no-such-note")
    with pytest.raises(js.StyleNotFound):
        js.plan_style_update("u2", n["id"])                                       # not their note
    js.delete_style("u1", s["id"])
    with pytest.raises(js.StyleNotFound):
        js.plan_style_update("u1", n["id"])
    with pytest.raises(js.StyleNotFound):
        js.apply_style_update("u1", n["id"], expected_updated_at=n["updatedAt"])


def test_a_locked_note_is_refused_and_the_plan_says_so(db_path):
    """Review I-2 (ruling 149): every server door that writes into an EXISTING note refuses a locked
    one, through the one predicate notes._refuse_if_locked."""
    from api.services.journal_two import journal_styles as js, notes
    s, n = _note_from_v1()
    locked = notes.update_note("u1", n["id"], {"locked": True})
    assert js.plan_style_update("u1", n["id"])["locked"] is True
    with pytest.raises(notes.NoteLockedError):
        js.apply_style_update("u1", n["id"], expected_updated_at=locked["updatedAt"])
    got = notes.get_note("u1", n["id"])
    assert got["styleVersion"] == 1 and got["bodyJson"] == n["bodyJson"] and got["updatedAt"] == locked["updatedAt"]


def test_an_unlocked_note_plans_unlocked(db_path):
    from api.services.journal_two import journal_styles as js
    s, n = _note_from_v1()
    assert js.plan_style_update("u1", n["id"])["locked"] is False


def _corrupt(db_path, note_id, raw):
    import sqlite3
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?", (raw, note_id))
        conn.commit()
    finally:
        conn.close()


@pytest.mark.parametrize("raw", ["{not json", '{"type": "doc", "content": {"oops": 1}}', '"a string"',
                                 '{"type": "paragraph", "content": []}'])
def test_an_unreadable_stored_body_is_refused_never_overwritten(db_path, raw):
    """Review M-1: an unparseable body, a non-list `content` or a non-doc is REFUSED (400), never
    treated as empty and written over, never a 500."""
    from api.services.journal_two import journal_styles as js, notes
    n = notes.create_note("u1", {"title": "x", "ticker": "AMD"})
    _corrupt(db_path, n["id"], raw)
    with pytest.raises(js.StyleValidationError):
        js.plan_style_update("u1", n["id"], style_id="builtin:watchlist_note")
    with pytest.raises(js.StyleValidationError):
        js.apply_style_update("u1", n["id"], style_id="builtin:watchlist_note")
    import sqlite3
    conn = sqlite3.connect(db_path)
    try:
        assert conn.execute("SELECT body_json FROM j2_notes WHERE id = ?", (n["id"],)).fetchone()[0] == raw
    finally:
        conn.close()


def test_an_absent_stored_body_is_an_empty_note(db_path):
    """`body_json` is NOT NULL; an empty string is the absent body, read as empty like the serving path."""
    from api.services.journal_two import journal_styles as js, notes
    n = notes.create_note("u1", {"title": "x", "ticker": "AMD"})
    _corrupt(db_path, n["id"], "")
    assert js.plan_style_update("u1", n["id"], style_id="builtin:watchlist_note")["insertsOutline"] is True


def test_a_client_base_other_than_the_read_revision_conflicts_before_any_write(db_path, monkeypatch):
    """Review M-2: the revision the body was derived from is the revision compared-and-set; a client
    base that differs from it is a conflict right away, update_note is never reached."""
    from api.services.journal_two import journal_styles as js, notes
    s, n = _note_from_v1()

    def must_not_write(*a, **kw):
        raise AssertionError("update_note reached with a stale base")

    monkeypatch.setattr(notes, "update_note", must_not_write)
    with pytest.raises(notes.NoteConflictError):
        js.apply_style_update("u1", n["id"], expected_updated_at="2000-01-01T00:00:00+00:00")


def test_the_plan_separates_version_from_missing_blocks(db_path):
    """Review M-4: `versionCurrent` and `missingBlocks` are separate facts; `upToDate` is both."""
    from api.services.journal_two import journal_styles as js, notes
    s, n = _note_from_v1()
    p = js.plan_style_update("u1", n["id"])
    assert (p["versionCurrent"], p["missingBlocks"], p["upToDate"]) == (False, True, False)
    note, _ = js.apply_style_update("u1", n["id"], expected_updated_at=n["updatedAt"])
    # The member deletes the chart on purpose at the CURRENT version: missing, but version current.
    body = note["bodyJson"]
    body["content"] = [x for x in body["content"] if x["type"] != "widgetEmbed"]
    notes.update_note("u1", n["id"], {"bodyJson": body}, client_schema=4)
    p = js.plan_style_update("u1", n["id"])
    assert (p["versionCurrent"], p["missingBlocks"], p["upToDate"]) == (True, True, False)


def test_apply_with_nothing_missing_writes_nothing(db_path):
    """Review M-4: no stamp-only revision -- other tabs would have to rebase for nothing."""
    from api.services.journal_two import journal_styles as js
    s, n = _note_from_v1()
    note, _ = js.apply_style_update("u1", n["id"], expected_updated_at=n["updatedAt"])
    js.update_style("u1", s["id"], {"properties": {"builtin:confidence": "high"}})     # v3, adds no block
    p = js.plan_style_update("u1", n["id"])
    assert (p["versionCurrent"], p["missingBlocks"]) == (False, False)
    again, plan = js.apply_style_update("u1", n["id"], expected_updated_at=note["updatedAt"])
    assert again["updatedAt"] == note["updatedAt"] and again["styleVersion"] == 2 and plan["add"] == []


def test_the_planner_asks_the_builder_whether_a_block_can_build(db_path, monkeypatch):
    """Review M-6: one source of truth. A builder that cannot build (for its own reason) is skipped
    with THAT reason in the plan, and the write never drops it silently."""
    from api.services.journal_two import journal_styles as js
    s, n = _note_from_v1()
    monkeypatch.setitem(js.BLOCK_BUILDERS, "chart", lambda block, ctx: (None, "chart-source-down"))
    p = js.plan_style_update("u1", n["id"])
    assert p["add"] == [] and p["skipped"] == [{"block": "chart", "reason": "chart-source-down"}]


def test_a_style_row_that_no_longer_exists_is_not_found_and_the_note_reads_unchanged(db_path):
    """Ruling R11: note_kinds.delete_kind hard-deletes the member's SOFT-deleted styles of that kind,
    so a note's style_id can name a row that is gone. Treated exactly like a soft-deleted style: no
    update is offered (StyleNotFound -> 404, no banner), nothing is written, the note still reads."""
    import sqlite3
    from api.services.journal_two import journal_styles as js, notes
    s, n = _note_from_v1()
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("DELETE FROM j2_journal_styles WHERE id = ?", (s["id"],))
        conn.commit()
    finally:
        conn.close()
    with pytest.raises(js.StyleNotFound):
        js.plan_style_update("u1", n["id"])
    with pytest.raises(js.StyleNotFound):
        js.apply_style_update("u1", n["id"], expected_updated_at=n["updatedAt"])
    got = notes.get_note("u1", n["id"])
    assert (got["bodyJson"], got["updatedAt"], got["styleId"]) == (n["bodyJson"], n["updatedAt"], s["id"])


def test_the_body_is_read_raw_from_the_row(db_path, monkeypatch):
    """The planner reads `body_json` itself, never get_note's SERVED body (which can differ: a
    withheld placeholder, an upgraded sample). With the served body blanked, the chart already in
    the stored body must still count as present, and an apply must still keep every stored word."""
    from api.services.journal_two import journal_styles as js, notes
    s, n = _note_from_v1()
    note, _ = js.apply_style_update("u1", n["id"], expected_updated_at=n["updatedAt"])
    js.update_style("u1", s["id"], {"properties": {"builtin:confidence": "low"}})
    stored = note["bodyJson"]
    with monkeypatch.context() as m:
        m.setattr(notes, "_served_body", lambda row: {"type": "doc", "content": []})
        assert js.plan_style_update("u1", n["id"])["add"] == []
        js.apply_style_update("u1", n["id"], expected_updated_at=note["updatedAt"])
    assert notes.get_note("u1", n["id"])["bodyJson"] == stored

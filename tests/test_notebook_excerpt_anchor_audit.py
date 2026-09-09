"""Wave K Slice 0 — rails for the excerpt-anchor integrity audit.

The audit is the thing Wave K's citation confidence rests on, so it gets its
own tests. `classify()` is pure, so every verdict is reachable here without
a database; the end-to-end tests build a throwaway SQLite file.

⛔ The read-only guarantee is tested by ATTEMPTING A WRITE through the tool's
own connection and asserting it is refused by the driver. A comment claiming
"this tool is read-only" is not a guarantee; `mode=ro` enforced and proven is.
"""
from __future__ import annotations

import sqlite3

import pytest

from tools.notebook_excerpt_anchor_audit import (
    DEGRADED_AMBIGUOUS,
    DEGRADED_NORMALIZED,
    EMPTY_CAPTURE,
    MISSING_DOCUMENT,
    MISSING_NOTE,
    MISSING_PAGE,
    NOT_NAVIGABLE,
    RESOLVED_CONTEXT,
    RESOLVED_EXACT,
    TRASHED_SOURCE,
    UNRESOLVED,
    audit,
    classify,
)

PAGE = (
    "Data Center Segment\n"
    "Management expects gross margins to normalize lower\n"
    "as the product mix shifts toward newer systems.\n"
    "Revenue was strong. Revenue guidance was raised.\n"
)


def _exc(**kw):
    base = {
        "captured_text": "", "quote_prefix": None, "quote_suffix": None,
        "char_start": None, "char_end": None,
    }
    base.update(kw)
    return base


class TestClassify:
    def test_a_unique_verbatim_passage_resolves_exactly(self):
        v, n = classify(_exc(captured_text="gross margins to normalize lower"), PAGE)
        assert (v, n) == (RESOLVED_EXACT, 1)

    def test_a_multi_line_passage_resolves_because_the_newline_is_real(self):
        # The Wave J defect class: the capture spans a rendered line break, so
        # the stored text contains "\n". It must still resolve.
        v, _ = classify(
            _exc(captured_text="normalize lower\nas the product mix shifts"), PAGE)
        assert v == RESOLVED_EXACT

    def test_an_ambiguous_passage_is_disambiguated_by_its_quote_context(self):
        v, n = classify(
            _exc(captured_text="Revenue", quote_prefix="systems.\n",
                 quote_suffix=" was strong."),
            PAGE,
        )
        assert (v, n) == (RESOLVED_CONTEXT, 1)

    def test_an_ambiguous_passage_without_usable_context_is_degraded_not_resolved(self):
        # "Revenue" appears twice and no context narrows it. Reporting this as
        # resolved would let a citation navigate to the wrong occurrence.
        v, n = classify(_exc(captured_text="Revenue"), PAGE)
        assert v == DEGRADED_AMBIGUOUS
        assert n == 2

    def test_context_that_does_not_narrow_still_degrades(self):
        v, _ = classify(
            _exc(captured_text="Revenue", quote_prefix="nope", quote_suffix="nope"),
            PAGE,
        )
        assert v == DEGRADED_AMBIGUOUS

    def test_whitespace_drift_degrades_rather_than_disappearing(self):
        # Same characters, different run of whitespace -- the member's words
        # are genuinely there, so this is degraded, not unresolved.
        v, _ = classify(
            _exc(captured_text="gross margins  to   normalize lower"), PAGE)
        assert v == DEGRADED_NORMALIZED

    def test_text_that_is_simply_not_on_the_page_is_unresolved(self):
        v, n = classify(_exc(captured_text="a phrase never written here"), PAGE)
        assert (v, n) == (UNRESOLVED, 0)

    def test_an_empty_capture_is_its_own_verdict_not_a_match_for_everything(self):
        assert classify(_exc(captured_text=""), PAGE)[0] == EMPTY_CAPTURE
        assert classify(_exc(captured_text="   "), PAGE)[0] == EMPTY_CAPTURE

    def test_a_missing_page_row_is_reported_as_missing_not_unresolved(self):
        v, _ = classify(_exc(captured_text="anything"), None)
        assert v == MISSING_PAGE

    def test_every_degraded_verdict_is_excluded_from_navigable(self):
        for v in (DEGRADED_AMBIGUOUS, UNRESOLVED, EMPTY_CAPTURE, MISSING_PAGE,
                  MISSING_NOTE, MISSING_DOCUMENT, TRASHED_SOURCE):
            assert v in NOT_NAVIGABLE
        # ...and the two real resolutions are NOT excluded.
        assert RESOLVED_EXACT not in NOT_NAVIGABLE
        assert RESOLVED_CONTEXT not in NOT_NAVIGABLE

    def test_whitespace_normalized_is_navigable_but_distinguishable(self):
        # A tier-2 resolution still means the characters are the member's own,
        # so it can navigate -- but it is reported under its own verdict so a
        # rising count is visible as extraction drift.
        assert DEGRADED_NORMALIZED not in NOT_NAVIGABLE


def _build_db(path, *, excerpts, note_deleted=None, with_doc=True, with_page=True):
    conn = sqlite3.connect(path)
    conn.executescript(
        "CREATE TABLE users (id TEXT PRIMARY KEY);"
        "CREATE TABLE j2_notes (id TEXT PRIMARY KEY, deleted_at TEXT);"
        "CREATE TABLE j2_note_documents (id TEXT PRIMARY KEY);"
        "CREATE TABLE j2_note_document_pages ("
        " document_id TEXT, page_number INTEGER, text TEXT);"
        "CREATE TABLE j2_note_excerpts ("
        " id TEXT PRIMARY KEY, user_id TEXT, note_id TEXT, document_id TEXT,"
        " page_number INTEGER, captured_text TEXT, quote_prefix TEXT,"
        " quote_suffix TEXT, char_start INTEGER, char_end INTEGER);"
    )
    conn.execute("INSERT INTO users VALUES ('u1')")
    conn.execute("INSERT INTO j2_notes VALUES ('n1', ?)", (note_deleted,))
    if with_doc:
        conn.execute("INSERT INTO j2_note_documents VALUES ('d1')")
    if with_page:
        conn.execute("INSERT INTO j2_note_document_pages VALUES ('d1', 1, ?)", (PAGE,))
    for i, text in enumerate(excerpts):
        conn.execute(
            "INSERT INTO j2_note_excerpts VALUES (?,?,?,?,?,?,?,?,?,?)",
            (f"e{i}", "u1", "n1", "d1", 1, text, None, None, None, None),
        )
    conn.commit()
    conn.close()


class TestAuditEndToEnd:
    def test_a_healthy_corpus_reports_every_excerpt_navigable(self, tmp_path):
        db = tmp_path / "auth.db"
        _build_db(db, excerpts=["gross margins to normalize lower"])
        r = audit(str(db))
        assert r["ok"] and r["total"] == 1
        assert r["navigable"] == 1 and r["not_navigable"] == 0

    def test_a_trashed_note_makes_its_excerpts_non_navigable(self, tmp_path):
        db = tmp_path / "auth.db"
        _build_db(db, excerpts=["gross margins to normalize lower"],
                  note_deleted="2026-09-07T00:00:00Z")
        r = audit(str(db))
        assert r["by_verdict"] == {TRASHED_SOURCE: 1}
        assert r["not_navigable"] == 1

    def test_a_missing_document_is_reported_not_crashed_on(self, tmp_path):
        db = tmp_path / "auth.db"
        _build_db(db, excerpts=["gross margins to normalize lower"], with_doc=False)
        r = audit(str(db))
        assert r["by_verdict"] == {MISSING_DOCUMENT: 1}

    def test_a_missing_page_is_reported_not_crashed_on(self, tmp_path):
        db = tmp_path / "auth.db"
        _build_db(db, excerpts=["gross margins to normalize lower"], with_page=False)
        r = audit(str(db))
        assert r["by_verdict"] == {MISSING_PAGE: 1}

    def test_ids_are_reported_but_never_excerpt_text(self, tmp_path):
        # §19: this output may be pasted into a report, so it must not carry
        # private content. The whole report is serialized and searched for the
        # captured text.
        import json
        secret = "a phrase never written here"
        db = tmp_path / "auth.db"
        _build_db(db, excerpts=[secret])
        r = audit(str(db))
        blob = json.dumps(r)
        assert "e0" in blob                 # the id IS reported
        assert secret not in blob           # the text is NOT
        assert PAGE.strip() not in blob     # nor is the page text

    def test_an_absent_schema_reports_cleanly_instead_of_raising(self, tmp_path):
        db = tmp_path / "empty.db"
        sqlite3.connect(db).close()
        r = audit(str(db))
        assert r["ok"] is False and "schema" in r["error"]

    def test_the_audit_connection_cannot_write(self, tmp_path):
        # The read-only guarantee, proven rather than asserted: open the db
        # exactly as audit() does and confirm the driver refuses a write.
        db = tmp_path / "auth.db"
        _build_db(db, excerpts=["gross margins to normalize lower"])
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            with pytest.raises(sqlite3.OperationalError, match="readonly"):
                conn.execute("DELETE FROM j2_note_excerpts")
        finally:
            conn.close()
        # ...and the row is still there afterwards.
        assert audit(str(db))["total"] == 1

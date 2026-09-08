"""Wave L Slice 1 — the capture write path, and the semantics it must preserve.

The directive's §14 list, each with a control where a control is what makes the
assertion mean anything.
"""
import sqlite3
import uuid

import pytest

from api.services import auth_db
from api.services.journal_two import notes as notes_service
from api.services.journal_two import web_capture as wc
from api.services.journal_two import web_capture_store as store

URL_A = "https://example.com/nvda-q3-results?id=7"
URL_B = "https://example.com/amd-q3-results?id=9"
P1 = "Management expects margins to normalize through fiscal 2027."
P2 = "Customer concentration remains the single largest disclosed risk."


@pytest.fixture()
def conn():
    auth_db.init_db()
    c = auth_db.get_connection()
    try:
        yield c
    finally:
        c.close()


def _user(conn) -> str:
    uid = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO users (id, email, password_hash, created_at)"
        " VALUES (?,?,?,datetime('now'))", (uid, f"{uid}@t.local", "x"),
    )
    conn.commit()
    return uid


def _note(conn, user_id: str, title="N") -> str:
    n = notes_service.create_note(user_id, {"title": title}, conn=conn)
    return n["id"]


def _cap(url=URL_A, passage=P1, tier="passage", **kw):
    d = {"tier": tier, "url": url, "title": "Article", "passage": passage}
    d.update(kw)
    return d


# ── §1 Coverage must stay truthful ───────────────────────────────────────────

class TestCoverageIsTruthful:
    def test_a_web_passage_capture_reports_SELECTED_PASSAGE_ONLY(self, conn):
        u = _user(conn); n = _note(conn, u)
        r = store.capture_web_source(u, n, _cap(), conn=conn)
        assert r["document"]["capture_type"] == store.CAPTURE_WEB_PASSAGE
        assert r["document"]["coverage"] == store.COVERAGE_PASSAGE_ONLY

    def test_a_reference_capture_reports_METADATA_ONLY(self, conn):
        u = _user(conn); n = _note(conn, u)
        r = store.capture_web_source(u, n, _cap(tier="reference", passage=""), conn=conn)
        assert r["document"]["coverage"] == store.COVERAGE_METADATA_ONLY
        assert r["page_number"] is None and r["excerpt"] is None

    def test_a_web_capture_NEVER_reports_document_complete(self, conn):
        u = _user(conn); n = _note(conn, u)
        for tier, passage in (("passage", P1), ("reference", "")):
            r = store.capture_web_source(u, _note(conn, u), _cap(tier=tier, passage=passage), conn=conn)
            assert r["document"]["coverage"] != store.COVERAGE_COMPLETE

    def test_the_coverage_probe_CAN_report_document_complete(self):
        # Non-vacuity: a PDF row still reports complete coverage, so the
        # assertions above are not passing because the function returns one
        # constant.
        assert store.capture_coverage({"capture_type": store.CAPTURE_PDF_FULL_TEXT}) == store.COVERAGE_COMPLETE
        assert store.capture_coverage({}) == store.COVERAGE_COMPLETE

    def test_page_count_counts_PASSAGES_not_article_length(self, conn):
        u = _user(conn); n = _note(conn, u)
        store.capture_web_source(u, n, _cap(passage=P1), conn=conn)
        r = store.capture_web_source(u, n, _cap(passage=P2), conn=conn)
        assert r["document"]["page_count"] == 2


# ── §3 Same URL, multiple passages ───────────────────────────────────────────

class TestSameSourceManyPassages:
    def test_same_source_same_passage_is_IDEMPOTENT(self, conn):
        u = _user(conn); n = _note(conn, u)
        a = store.capture_web_source(u, n, _cap(passage=P1), conn=conn)
        b = store.capture_web_source(u, n, _cap(passage=P1), conn=conn)
        assert b["deduped"] is True
        assert a["page_number"] == b["page_number"]
        assert a["document"]["id"] == b["document"]["id"]
        assert b["document"]["page_count"] == 1

    def test_same_source_DIFFERENT_passages_both_survive(self, conn):
        u = _user(conn); n = _note(conn, u)
        a = store.capture_web_source(u, n, _cap(passage=P1), conn=conn)
        b = store.capture_web_source(u, n, _cap(passage=P2), conn=conn)
        assert a["document"]["id"] == b["document"]["id"], "one source identity"
        assert a["page_number"] != b["page_number"], "two distinct passages"
        texts = {r["text"] for r in conn.execute(
            "SELECT text FROM j2_note_document_pages WHERE document_id = ?",
            (a["document"]["id"],))}
        assert texts == {P1, P2}

    def test_UNIQUE_note_plus_identity_did_not_cap_the_source_at_ONE_passage(self, conn):
        # The failure this rail exists for: UNIQUE(note_id, attachment_url)
        # correctly means one DOCUMENT per source per note — it must not come to
        # mean one PASSAGE per source.
        u = _user(conn); n = _note(conn, u)
        for i in range(4):
            r = store.capture_web_source(u, n, _cap(passage=f"passage number {i}"), conn=conn)
        assert conn.execute(
            "SELECT COUNT(*) FROM j2_note_document_pages WHERE document_id = ?",
            (r["document"]["id"],)).fetchone()[0] == 4

    def test_whitespace_only_differences_dedupe_but_CASE_does_not(self, conn):
        u = _user(conn); n = _note(conn, u)
        store.capture_web_source(u, n, _cap(passage="Gross margin  was\n73.5%."), conn=conn)
        same = store.capture_web_source(u, n, _cap(passage="Gross margin was 73.5%."), conn=conn)
        assert same["deduped"] is True, "whitespace runs are not part of the quote"
        cased = store.capture_web_source(u, n, _cap(passage="GROSS MARGIN WAS 73.5%."), conn=conn)
        assert cased["deduped"] is False, "capitalisation IS part of a quotation"

    def test_a_different_source_gets_a_distinct_identity(self, conn):
        u = _user(conn); n = _note(conn, u)
        a = store.capture_web_source(u, n, _cap(url=URL_A), conn=conn)
        b = store.capture_web_source(u, n, _cap(url=URL_B), conn=conn)
        assert a["document"]["id"] != b["document"]["id"]


# ── §4 Destination idempotency ───────────────────────────────────────────────

class TestDestination:
    def test_the_same_url_in_two_notes_is_two_member_relationships(self, conn):
        u = _user(conn)
        nvda, amd = _note(conn, u, "NVDA"), _note(conn, u, "AMD")
        a = store.capture_web_source(u, nvda, _cap(), conn=conn)
        b = store.capture_web_source(u, amd, _cap(), conn=conn)
        assert a["document"]["id"] != b["document"]["id"]
        assert a["document"]["attachment_url"] == b["document"]["attachment_url"], \
            "same source identity..."
        assert a["document"]["note_id"] != b["document"]["note_id"], "...different placement"


# ── §6 Tenant isolation ──────────────────────────────────────────────────────

class TestTenantIsolation:
    def test_the_same_public_url_for_two_members_stays_independent(self, conn):
        u1, u2 = _user(conn), _user(conn)
        n1, n2 = _note(conn, u1), _note(conn, u2)
        a = store.capture_web_source(u1, n1, _cap(), conn=conn)
        b = store.capture_web_source(u2, n2, _cap(), conn=conn)
        assert a["document"]["id"] != b["document"]["id"]
        assert a["document"]["user_id"] == u1 and b["document"]["user_id"] == u2
        assert b["deduped"] is False, "another tenant's capture must not dedupe mine"

    def test_a_document_row_owned_by_ANOTHER_user_is_never_reused(self, conn):
        # ⛔ This rail exists because a mutation check proved the earlier one
        # could not see the guard: note_id is a per-user UUID, so two members
        # never collide there and `AND user_id = ?` looked redundant. The threat
        # it actually defends is a row whose user_id has diverged from the
        # note's owner — a corrupted or planted row that matches
        # (note_id, attachment_url). Reusing it would attach one member's
        # capture to another member's document row.
        u1, u2 = _user(conn), _user(conn)
        n1 = _note(conn, u1)
        identity = wc.web_document_identity(URL_A)
        planted = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO j2_note_documents (id, user_id, note_id, attachment_url,"
            " name, status, page_count, extraction_version, created_at, source_kind,"
            " source_url, capture_type) VALUES (?,?,?,?,?,?,?,?,datetime('now'),?,?,?)",
            (planted, u2, n1, identity, "planted", "ready", 0, 1,
             "web", URL_A, store.CAPTURE_WEB_REFERENCE),
        )
        conn.commit()
        # The guard refuses to REUSE it. The non-user-scoped UNIQUE then makes a
        # fresh row impossible too, so the only correct outcome is a clean
        # refusal: never another member's row, never a raw database error.
        with pytest.raises(store.CaptureStoreError) as e:
            store.capture_web_source(u1, n1, _cap(), conn=conn)
        assert "IntegrityError" not in str(e.value), "a DB error must not reach a member"
        still = conn.execute(
            "SELECT user_id FROM j2_note_documents WHERE id = ?", (planted,)).fetchone()
        assert still["user_id"] == u2, "the other member's row is untouched"

    def test_capturing_into_a_FOREIGN_note_is_refused_and_writes_nothing(self, conn):
        u1, u2 = _user(conn), _user(conn)
        victim = _note(conn, u2)
        before = conn.execute("SELECT COUNT(*) FROM j2_note_documents").fetchone()[0]
        with pytest.raises(store.CaptureStoreError):
            store.capture_web_source(u1, victim, _cap(), conn=conn)
        assert conn.execute("SELECT COUNT(*) FROM j2_note_documents").fetchone()[0] == before

    def test_the_refusal_is_not_an_existence_oracle(self, conn):
        u1, u2 = _user(conn), _user(conn)
        real, fake = _note(conn, u2), uuid.uuid4().hex
        msgs = []
        for target in (real, fake):
            with pytest.raises(store.CaptureStoreError) as e:
                store.capture_web_source(u1, target, _cap(), conn=conn)
            msgs.append(str(e.value))
        assert msgs[0] == msgs[1], "a real foreign note and a nonexistent one must read alike"


# ── §5 Transactional write ───────────────────────────────────────────────────

class TestTransactionalWrite:
    def test_a_failure_mid_write_leaves_NO_orphan_document(self, conn, monkeypatch):
        u = _user(conn); n = _note(conn, u)
        def boom(*a, **k):
            raise RuntimeError("excerpt store exploded")
        monkeypatch.setattr(store.note_excerpts, "create_excerpt", boom)
        with pytest.raises(RuntimeError):
            store.capture_web_source(u, n, _cap(), conn=conn)
        # Scoped to THIS user: the fixture shares one database across tests, and
        # a global COUNT(*) would measure every earlier test's rows.
        assert conn.execute(
            "SELECT COUNT(*) FROM j2_note_documents WHERE user_id = ?", (u,)).fetchone()[0] == 0
        assert conn.execute(
            "SELECT COUNT(*) FROM j2_note_document_pages WHERE user_id = ?", (u,)).fetchone()[0] == 0

    def test_no_excerpt_ever_points_at_a_missing_document(self, conn):
        u = _user(conn); n = _note(conn, u)
        r = store.capture_web_source(u, n, _cap(), conn=conn)
        doc_ids = {d[0] for d in conn.execute("SELECT id FROM j2_note_documents")}
        for (did,) in conn.execute("SELECT document_id FROM j2_note_excerpts"):
            assert did in doc_ids
        assert r["excerpt"]["documentId"] == r["document"]["id"]


# ── §10 Source claim vs member belief ────────────────────────────────────────

class TestProvenanceSeparation:
    def test_the_members_annotation_never_enters_the_source_passage(self, conn):
        u = _user(conn); n = _note(conn, u)
        belief = "I think this assumption is too optimistic."
        r = store.capture_web_source(
            u, n, _cap(annotation=belief), conn=conn)
        page_text = conn.execute(
            "SELECT text FROM j2_note_document_pages WHERE document_id = ?",
            (r["document"]["id"],)).fetchone()[0]
        assert page_text == P1
        assert belief not in page_text
        assert r["excerpt"]["capturedText"] == P1
        assert r["excerpt"]["annotation"] == belief

    def test_the_source_passage_is_never_recorded_as_member_authored(self, conn):
        u = _user(conn); n = _note(conn, u)
        r = store.capture_web_source(u, n, _cap(annotation="my view"), conn=conn)
        assert r["excerpt"]["capturedText"] != r["excerpt"]["annotation"]


# ── §7 Conservative canonicalization, navigable URL preserved ────────────────

class TestUrlHandling:
    def test_the_navigable_url_keeps_the_members_fragment(self, conn):
        u = _user(conn); n = _note(conn, u)
        r = store.capture_web_source(
            u, n, _cap(url="https://example.com/a?id=7#risk-factors"), conn=conn)
        assert r["document"]["source_url"].endswith("#risk-factors")

    def test_identity_ignores_the_fragment_so_the_source_is_ONE_source(self, conn):
        u = _user(conn); n = _note(conn, u)
        a = store.capture_web_source(u, n, _cap(url="https://example.com/a?id=7#top", passage=P1), conn=conn)
        b = store.capture_web_source(u, n, _cap(url="https://example.com/a?id=7#bottom", passage=P2), conn=conn)
        assert a["document"]["id"] == b["document"]["id"]

    def test_a_meaningful_query_parameter_is_NOT_collapsed(self, conn):
        u = _user(conn); n = _note(conn, u)
        a = store.capture_web_source(u, n, _cap(url="https://example.com/a?id=7"), conn=conn)
        b = store.capture_web_source(u, n, _cap(url="https://example.com/a?id=8"), conn=conn)
        assert a["document"]["id"] != b["document"]["id"]


# ── §9 No entity inference from prose ────────────────────────────────────────

class TestNoProseEntityResolution:
    def test_the_capture_modules_never_reach_entity_resolution(self):
        # ⛔ The Wave K privacy defect in full: resolving ticker-shaped tokens
        # out of private member prose sent fragments of member questions to a
        # provider. An AST-free source read is enough here because the claim is
        # about IMPORTS and CALLS by name.
        import pathlib
        for mod in ("web_capture.py", "web_capture_store.py"):
            src = pathlib.Path("api/services/journal_two") / mod
            text = src.read_text(encoding="utf-8")
            for forbidden in ("entity_master", "resolve_symbol", "ticker_search",
                              "get_quote", "requests.", "httpx."):
                assert forbidden not in text, f"{mod} reaches {forbidden}"

    def test_a_passage_full_of_ticker_shaped_words_creates_no_association(self, conn):
        u = _user(conn); n = _note(conn, u)
        r = store.capture_web_source(
            u, n, _cap(passage="NVDA AMD INTC RS EMA GAP PEG are all mentioned here."),
            conn=conn)
        # Nothing about the capture claims an entity relationship; membership is
        # the destination note's job (Wave H union), not this module's.
        assert "ticker" not in r["document"]
        assert "entities" not in r["document"]


# ── §12 Lifecycle ────────────────────────────────────────────────────────────

class TestLifecycle:
    def test_deleting_the_note_removes_document_pages_and_excerpts(self, conn):
        u = _user(conn); n = _note(conn, u)
        r = store.capture_web_source(u, n, _cap(), conn=conn)
        did = r["document"]["id"]
        conn.execute("DELETE FROM j2_notes WHERE id = ?", (n,))
        conn.commit()
        assert conn.execute("SELECT COUNT(*) FROM j2_note_documents WHERE id = ?", (did,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM j2_note_document_pages WHERE document_id = ?", (did,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM j2_note_excerpts WHERE document_id = ?", (did,)).fetchone()[0] == 0

    def test_no_orphan_web_source_holding_private_captured_text(self, conn):
        u = _user(conn); n = _note(conn, u)
        store.capture_web_source(u, n, _cap(), conn=conn)
        conn.execute("DELETE FROM j2_notes WHERE id = ?", (n,))
        conn.commit()
        leftover = conn.execute(
            "SELECT COUNT(*) FROM j2_note_document_pages WHERE user_id = ? AND text != ''",
            (u,)).fetchone()[0]
        assert leftover == 0

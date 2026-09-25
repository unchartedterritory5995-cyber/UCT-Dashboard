"""Wave 7 lane G (G4) — image and .docx attachments as searchable documents.

What these rails hold, in the order a member would meet it:

  * the GATE. `NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED` unset (or off) means an
    image or a docx upload creates NO document row -- exactly today's
    behaviour. On, the two kinds get rows with their own `source_kind`.
  * DOCX TEXT is read with the standard library only: paragraphs, runs, tabs
    and line breaks, never tracked-deletion text or field codes; chunked into
    reading pages; refused whole when it is a zip bomb or carries a DOCTYPE.
  * IMAGE OCR goes through the EXISTING pipeline -- one scanned page, the
    real planner, the real FTS-safe replace, the real search -- with a
    deterministic fake engine injected at the same seam tesseract uses. No
    engine means the document lands `no_text`, never an error.

⛔ Every end-to-end rail here reads the answer through
`document_search.search_document_pages`, the production search path, and
carries the positive control that the phrase was NOT findable beforehand.
"""
from __future__ import annotations

import io
import sqlite3
import uuid
import zipfile

import pytest

from api.services import auth_db
from api.services.auth_db import get_connection
from api.services.journal_two import document_extraction as dx
from api.services.journal_two import document_ocr as ocr
from api.services.journal_two import document_search
from api.services.journal_two import notes as notes_svc

GATE = dx.IMAGE_DOCX_GATE
PHRASE = "kimberlitegabbro"
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


# ── fixtures and builders ────────────────────────────────────────────────────

def _docx(body_xml: str, *, prolog: str = "") -> bytes:
    xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + prolog
           + f'<w:document xmlns:w="{W_NS}"><w:body>' + body_xml
           + "</w:body></w:document>")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0"?><Types xmlns='
                   '"http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("word/document.xml", xml)
    return buf.getvalue()


def _p(*runs: str) -> str:
    return "<w:p>" + "".join(runs) + "</w:p>"


def _r(text: str) -> str:
    return f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>'


TAB = "<w:r><w:tab/></w:r>"
BR = "<w:r><w:br/></w:r>"


def _png(size=(40, 30), color=(200, 30, 30)) -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def fake_adapter(image) -> ocr.OcrPageResult:
    """Deterministic, and it RECORDS what it was handed so a rail can prove the
    engine saw the decoded (and orientation-corrected) image."""
    fake_adapter.seen.append(image.size)
    return ocr.OcrPageResult(
        text=f"Revenue rose sharply. {PHRASE} appears only in this image.",
        engine="fake-test-ocr", engine_version="1.0.0")


fake_adapter.seen = []


@pytest.fixture()
def env(tmp_path, monkeypatch):
    """Fresh tenants + an attachment root the write AND read sides agree on
    (the same alignment tests/test_document_ocr.py documents), the gate ON,
    no background threads, and no OCR engine unless a test wires one."""
    auth_db.init_db()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "j2_attachments")
    monkeypatch.setenv(GATE, "1")
    queued: list[str] = []
    monkeypatch.setattr(dx, "queue_extraction", lambda doc_id: queued.append(doc_id))
    ocr.set_adapter(None)
    fake_adapter.seen = []
    tok = uuid.uuid4().hex[:8]
    yield {"user": f"u-g4-{tok}", "other": f"u-g4-b-{tok}", "queued": queued}
    ocr.set_adapter(None)


def _note(user: str) -> str:
    return notes_svc.create_note(user, {
        "title": "Research", "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
    })["id"]


def _conn():
    c = get_connection()
    c.row_factory = sqlite3.Row
    return c


def _doc_row(doc_id: str) -> dict:
    c = _conn()
    try:
        return dict(c.execute("SELECT * FROM j2_note_documents WHERE id = ?", (doc_id,)).fetchone())
    finally:
        c.close()


def _pages(doc_id: str) -> list[dict]:
    c = _conn()
    try:
        return [dict(r) for r in c.execute(
            "SELECT page_number, text, text_origin FROM j2_note_document_pages"
            " WHERE document_id = ? ORDER BY page_number", (doc_id,)).fetchall()]
    finally:
        c.close()


def _upload_docx(user: str, note_id: str, data: bytes, name: str = "memo.docx") -> dict:
    att = notes_svc.save_note_attachment_bytes(user, note_id, data, name, dx.DOCX_MIME)
    return dx.on_attachment_saved(user, note_id, att, dx.DOCX_MIME, kind="file")


def _upload_image(user: str, note_id: str, data: bytes, mime: str = "image/png") -> dict:
    img = notes_svc.save_note_image_bytes(user, note_id, data, "shot.png", mime)
    return dx.on_attachment_saved(user, note_id, img, mime, kind="image")


# ── the gate ─────────────────────────────────────────────────────────────────

class TestGate:
    def _spy(self, monkeypatch):
        created, queued = [], []

        def _create(uid, nid, url, name, **kw):
            created.append((url, name, kw.get("source_kind")))
            return {"id": f"doc-{len(created)}"}

        monkeypatch.setattr(dx, "create_document", _create)
        monkeypatch.setattr(dx, "queue_extraction", lambda doc_id: queued.append(doc_id))
        return created, queued

    IMG = {"url": "/api/j2/notes/attachments/u1/n1/inline/abc.png", "width": 4, "height": 4}
    DOCX = {"url": "/api/j2/notes/attachments/u1/n1/file/def.docx", "name": "memo.docx", "size": 9}

    @pytest.mark.parametrize("value", [None, "", "0", "false", "off", "no", "maybe"])
    def test_gate_off_image_and_docx_create_nothing(self, monkeypatch, value):
        """⛔ OFF IS TODAY. Unset, empty, an explicit off word or a typo: no row,
        no extraction queued -- the member keeps exactly the pre-wave-7 upload."""
        if value is None:
            monkeypatch.delenv(GATE, raising=False)
        else:
            monkeypatch.setenv(GATE, value)
        created, queued = self._spy(monkeypatch)
        assert dx.on_attachment_saved("u1", "n1", dict(self.IMG), "image/png", kind="image") is None
        assert dx.on_attachment_saved("u1", "n1", dict(self.DOCX), dx.DOCX_MIME, kind="file") is None
        assert created == [] and queued == []

    @pytest.mark.parametrize("value", ["1", "true", "on", "YES", " 1 "])
    def test_gate_on_image_and_docx_become_documents_of_their_own_kind(self, monkeypatch, value):
        monkeypatch.setenv(GATE, value)
        created, queued = self._spy(monkeypatch)
        img = dx.on_attachment_saved("u1", "n1", dict(self.IMG), "image/png", kind="image")
        doc = dx.on_attachment_saved("u1", "n1", dict(self.DOCX), dx.DOCX_MIME, kind="file")
        assert img == {"id": "doc-1"} and doc == {"id": "doc-2"}
        assert created == [
            (self.IMG["url"], "Image", dx.SOURCE_KIND_IMAGE),
            (self.DOCX["url"], "memo.docx", dx.SOURCE_KIND_DOCX),
        ]
        assert queued == ["doc-1", "doc-2"]

    def test_the_gate_is_read_per_call_not_captured(self, monkeypatch):
        """A flip needs no restart: the SAME process answers differently the
        moment the environment does."""
        created, _ = self._spy(monkeypatch)
        monkeypatch.delenv(GATE, raising=False)
        assert dx.on_attachment_saved("u1", "n1", dict(self.IMG), "image/png", kind="image") is None
        monkeypatch.setenv(GATE, "1")
        assert dx.on_attachment_saved("u1", "n1", dict(self.IMG), "image/png", kind="image") is not None
        monkeypatch.setenv(GATE, "0")
        assert dx.on_attachment_saved("u1", "n1", dict(self.IMG), "image/png", kind="image") is None
        assert len(created) == 1

    def test_the_pdf_path_is_not_behind_the_gate(self, monkeypatch):
        monkeypatch.delenv(GATE, raising=False)
        created, queued = self._spy(monkeypatch)
        pdf = {"url": "/api/j2/notes/attachments/u1/n1/file/r.pdf", "name": "r.pdf", "size": 3}
        assert dx.on_attachment_saved("u1", "n1", pdf, "application/pdf", kind="file") is not None
        assert created == [(pdf["url"], "r.pdf", None)]

    def test_a_docx_whose_url_does_not_end_in_docx_stays_a_plain_attachment(self, monkeypatch):
        """⛔ The preview picks its viewer from the URL, so a row the URL cannot
        identify is never created (a docx saved under another name is `.bin`)."""
        monkeypatch.setenv(GATE, "1")
        created, _ = self._spy(monkeypatch)
        odd = {"url": "/api/j2/notes/attachments/u1/n1/file/x.bin", "name": "memo", "size": 9}
        assert dx.on_attachment_saved("u1", "n1", odd, dx.DOCX_MIME, kind="file") is None
        assert created == []

    def test_other_files_and_other_image_types_are_still_not_documents(self, monkeypatch):
        monkeypatch.setenv(GATE, "1")
        created, _ = self._spy(monkeypatch)
        csv = {"url": "/api/j2/notes/attachments/u1/n1/file/a.csv", "name": "a.csv", "size": 5}
        assert dx.on_attachment_saved("u1", "n1", csv, "text/csv", kind="file") is None
        heic = {"url": "/api/j2/notes/attachments/u1/n1/inline/a.heic"}
        assert dx.on_attachment_saved("u1", "n1", heic, "image/heic", kind="image") is None
        assert created == []


# ── docx text (stdlib) ───────────────────────────────────────────────────────

class TestDocxText:
    def test_paragraphs_runs_tabs_and_breaks_and_nothing_else(self):
        body = (
            _p(_r("Revenue"), TAB, _r("$9,242"), _r(" (51%)"))
            + _p(_r("Line one"), BR, _r("line two"))
            # tracked deletion + a field code: NOT the words on the page
            + "<w:p><w:r><w:delText>deleted words</w:delText></w:r>"
              "<w:r><w:instrText>HYPERLINK x</w:instrText></w:r>"
              + _r("kept") + "</w:p>"
            + "<w:tbl><w:tr><w:tc>" + _p(_r("in a table cell")) + "</w:tc></w:tr></w:tbl>"
        )
        out = dx.extract_docx_pages(_docx(body))
        assert out is not None
        pages, count = out
        assert count == 1
        assert pages == ["Revenue\t$9,242 (51%)\nLine one\nline two\nkept\nin a table cell"]

    def test_pages_break_between_paragraphs_at_about_three_thousand_characters(self):
        paras = [(f"w{i} " * 334).strip() for i in range(5)]      # ~1,000 chars each
        pages, count = dx.extract_docx_pages(_docx("".join(_p(_r(t)) for t in paras)))
        assert count == len(pages) == 3
        assert all(len(p) <= dx._DOCX_PAGE_CHARS for p in pages)
        assert "\n".join(pages).split("\n") == paras

    def test_one_long_paragraph_splits_on_whitespace_and_never_cuts_a_word(self):
        words = [f"tok{i:05d}" for i in range(1000)]               # 8,999 chars
        pages, count = dx.extract_docx_pages(_docx(_p(_r(" ".join(words)))))
        assert count == len(pages) >= 3
        assert all(len(p) <= dx._DOCX_PAGE_CHARS for p in pages)
        assert " ".join(pages).split() == words

    def test_pages_past_the_cap_are_not_stored_but_the_count_is_real(self, monkeypatch):
        monkeypatch.setattr(dx, "_MAX_PAGES", 2)
        paras = [(f"w{i} " * 700).strip() for i in range(5)]      # one page each
        pages, count = dx.extract_docx_pages(_docx("".join(_p(_r(t)) for t in paras)))
        assert count == 5
        assert len(pages) == 2

    def test_an_empty_document_is_one_empty_page(self):
        assert dx.extract_docx_pages(_docx(_p())) == ([""], 1)

    def test_a_document_xml_past_the_inflated_cap_is_refused_whole(self, monkeypatch):
        """⛔ ZIP BOMB. ~50 KB of text compresses to almost nothing; past the cap
        the WHOLE document is refused rather than partly read."""
        monkeypatch.setattr(dx, "_DOCX_MAX_XML_BYTES", 10_000)
        data = _docx(_p(_r("a" * 50_000)))
        assert len(data) < 10_000, "the fixture must be small on the wire to be a bomb at all"
        assert dx.extract_docx_pages(data) is None
        # control: under the cap the same builder reads fine
        assert dx.extract_docx_pages(_docx(_p(_r("a" * 5_000)))) is not None

    def test_a_doctype_is_refused_so_no_entity_can_expand(self):
        prolog = '<!DOCTYPE w:document [<!ENTITY boom "EXPANDED">]>'
        assert dx.extract_docx_pages(_docx(_p(_r("&boom;")), prolog=prolog)) is None

    @pytest.mark.parametrize("data", [b"not a zip at all", b"", _png()])
    def test_not_a_docx_is_none_never_a_raise(self, data):
        assert dx.extract_docx_pages(data) is None

    def test_a_zip_without_word_document_xml_is_none(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("word/other.xml", "<x/>")
        assert dx.extract_docx_pages(buf.getvalue()) is None


# ── end to end, through the production search path ───────────────────────────

class TestDocxEndToEnd:
    def test_a_docx_upload_becomes_searchable_pages_with_the_hit_on_its_page(self, env):
        user = env["user"]
        note_id = _note(user)
        filler = [(f"w{i} " * 997).strip() for i in range(2)]      # 2,990 chars: pages 1 and 2
        body = "".join(_p(_r(t)) for t in filler) + _p(_r(f"The {PHRASE} clause sits here."))
        doc = _upload_docx(user, note_id, _docx(body))
        assert doc is not None and env["queued"] == [doc["id"]]
        row = _doc_row(doc["id"])
        assert row["source_kind"] == dx.SOURCE_KIND_DOCX
        assert row["attachment_url"].endswith(".docx")

        assert document_search.search_document_pages(user, PHRASE) == [], (
            "positive control: nothing is findable before extraction runs")
        result = dx.process_document(doc["id"])
        assert result == {"ok": True, "status": "ready", "page_count": 3}
        assert [p["text_origin"] for p in _pages(doc["id"])] == ["native"] * 3

        hits = document_search.search_document_pages(user, PHRASE)
        assert [(h["document_id"], h["page_number"]) for h in hits] == [(doc["id"], 3)]
        # tenant scoping is the search path's own, unchanged
        assert document_search.search_document_pages(env["other"], PHRASE) == []

    def test_planning_claims_nothing_for_a_docx_even_with_an_engine(self, env):
        user = env["user"]
        note_id = _note(user)
        doc = _upload_docx(user, note_id, _docx(_p(_r("plain words here"))))
        dx.process_document(doc["id"])
        ocr.set_adapter(fake_adapter)
        plan = ocr.plan_document(doc["id"])
        assert plan["ocr_required"] == [] and plan["status"] == "ready"
        assert fake_adapter.seen == []

    def test_an_unreadable_docx_is_processing_failed_not_a_crash(self, env):
        user = env["user"]
        note_id = _note(user)
        doc = _upload_docx(user, note_id, b"PK\x03\x04 truncated nonsense")
        assert dx.process_document(doc["id"]) == {"ok": False, "status": "processing_failed"}


class TestImageEndToEnd:
    def test_without_an_engine_an_image_lands_no_text_never_an_error(self, env):
        """`J2_OCR_ENABLED` honoured exactly as a scanned PDF page does: no
        adapter, no promise -- the document says `no_text` and nothing waits."""
        user = env["user"]
        note_id = _note(user)
        doc = _upload_image(user, note_id, _png())
        row = _doc_row(doc["id"])
        assert row["source_kind"] == dx.SOURCE_KIND_IMAGE and row["name"] == "Image"
        assert "/inline/" in row["attachment_url"]
        assert dx.process_document(doc["id"])["status"] == "no_text"
        assert _pages(doc["id"]) == [{"page_number": 1, "text": "", "text_origin": "native"}]
        plan = ocr.plan_document(doc["id"])
        assert plan["ocr_required"] == [] and plan["status"] == "no_text"

    def test_with_an_engine_the_image_is_read_and_search_finds_it(self, env):
        user = env["user"]
        note_id = _note(user)
        doc = _upload_image(user, note_id, _png((40, 30)))
        dx.process_document(doc["id"])
        ocr.set_adapter(fake_adapter)
        plan = ocr.plan_document(doc["id"])
        assert plan["classes"] == {1: ocr.PAGE_SCANNED}
        assert plan["ocr_required"] == [1] and plan["status"] == "pending"
        assert document_search.search_document_pages(user, PHRASE) == [], "positive control"

        out = ocr.ocr_document(doc["id"], fake_adapter)
        assert out["pages_read"] == 1 and out["status"] == "ready"
        assert fake_adapter.seen == [(40, 30)]
        [page] = _pages(doc["id"])
        assert page["text_origin"] == ocr.ORIGIN_OCR and PHRASE in page["text"]
        hits = document_search.search_document_pages(user, PHRASE)
        assert [(h["document_id"], h["page_number"], h["text_origin"]) for h in hits] == [
            (doc["id"], 1, "ocr")]

    def test_a_phone_photo_is_read_the_right_way_up(self, env):
        """⭐ A camera stores most photos sideways with an EXIF rotation tag. The
        engine must be handed the image as a person sees it, or a document
        photographed in portrait is read rotated."""
        from PIL import Image
        im = Image.new("RGB", (60, 20), (10, 10, 10))
        exif = Image.Exif()
        exif[0x0112] = 6                        # "rotate 90 CW to display"
        buf = io.BytesIO()
        im.save(buf, "JPEG", exif=exif.tobytes())
        user = env["user"]
        doc = _upload_image(user, _note(user), buf.getvalue(), mime="image/jpeg")
        dx.process_document(doc["id"])
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc["id"])
        ocr.ocr_document(doc["id"], fake_adapter)
        assert fake_adapter.seen == [(20, 60)]

    def test_an_undecodable_image_is_failed_and_nothing_is_claimed(self, env):
        user = env["user"]
        doc = _upload_image(user, _note(user), b"\x89PNG not really an image")
        assert dx.process_document(doc["id"]) == {"ok": False, "status": "processing_failed"}
        ocr.set_adapter(fake_adapter)
        assert ocr.plan_document(doc["id"])["ok"] is False
        c = _conn()
        try:
            claimed = c.execute("SELECT COUNT(*) FROM j2_note_document_ocr_pages"
                                " WHERE document_id = ?", (doc["id"],)).fetchone()[0]
        finally:
            c.close()
        assert claimed == 0
        assert _doc_row(doc["id"])["status"] == "processing_failed"

    def test_an_image_past_the_pixel_cap_is_refused_before_it_is_decoded(self, env, monkeypatch):
        monkeypatch.setattr(dx, "_MAX_IMAGE_PIXELS", 100)
        assert dx.load_image_for_ocr(_png((20, 20))) is None
        assert dx.load_image_for_ocr(_png((5, 5))) is not None

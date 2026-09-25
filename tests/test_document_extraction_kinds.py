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

_ENCODE = {
    # name in the XML declaration -> how the bytes are made (a BOM where the
    # encoding needs one to be detected, exactly as a producer would write it)
    "UTF-8": lambda s: s.encode("utf-8"),
    "UTF-16": lambda s: s.encode("utf-16"),                     # BOM + little-endian
    "UTF-16BE": lambda s: b"\xfe\xff" + s.encode("utf-16-be"),  # BOM + big-endian
}


def _docx(body_xml: str, *, prolog: str = "", encoding: str = "UTF-8") -> bytes:
    decl = "UTF-16" if encoding.startswith("UTF-16") else encoding
    xml = (f'<?xml version="1.0" encoding="{decl}" standalone="yes"?>' + prolog
           + f'<w:document xmlns:w="{W_NS}"><w:body>' + body_xml
           + "</w:body></w:document>")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0"?><Types xmlns='
                   '"http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("word/document.xml", _ENCODE[encoding](xml))
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

    # ⛔⛔ I-3 (fix round 1). The first guard scanned the RAW BYTES for
    # `<!DOCTYPE` in the first 4 KB and `<!ENTITY` anywhere -- in ASCII. The
    # rail above used only UTF-8, so it could not see either hole below. The
    # guard now lives in the parser, after decoding; these rows are the
    # encodings and the offset the byte scan was blind to.

    @pytest.mark.parametrize("encoding", sorted(_ENCODE))
    def test_a_doctype_is_refused_in_every_encoding_expat_reads(self, encoding):
        prolog = '<!DOCTYPE w:document [<!ENTITY boom "EXPANDED">]>'
        data = _docx(_p(_r("&boom;")), prolog=prolog, encoding=encoding)
        assert dx.extract_docx_pages(data) is None, (
            f"a {encoding} document.xml declared an entity and it was READ -- "
            "the DOCTYPE guard is not looking at decoded text")
        # control: the SAME encoding without a DOCTYPE reads, so the None above
        # is the refusal and not an encoding the reader cannot handle
        assert dx.extract_docx_pages(_docx(_p(_r("plain words")), encoding=encoding)) == (
            ["plain words"], 1)

    def test_a_doctype_after_a_long_prolog_is_refused(self):
        """No entity at all, just an external DTD reference parked past the
        first 4 KB behind a comment -- the byte scan's offset hole."""
        pad = "<!-- " + "x" * 5000 + " -->"
        dtd = '<!DOCTYPE w:document SYSTEM "http://example.invalid/evil.dtd">'
        assert dx.extract_docx_pages(_docx(_p(_r("words")), prolog=pad + dtd)) is None
        # control: the same padding without the DOCTYPE reads fine
        assert dx.extract_docx_pages(_docx(_p(_r("words")), prolog=pad)) == (["words"], 1)

    # ⛔⛔ I-2 (fix round 1). The chunker re-sliced a long paragraph's remainder
    # once per page and built every page before the list was cut to
    # `_MAX_PAGES`: a 19 MB single-paragraph run cost 14.2 s (the reviewer's
    # box) and 23.7-30.6 s across two runs on this one, of GIL-holding copying
    # for a file a few KB on the wire. Three rails, one per property: the
    # output is unchanged, the time is linear, and the cap is applied WHILE
    # chunking.

    @staticmethod
    def _reference_chunk(paragraphs, size):
        """The pre-fix algorithm, verbatim, as an ORACLE for the output only."""
        pages, cur = [], ""
        for para in paragraphs:
            while len(para) > size:
                cut = para.rfind(" ", 0, size)
                if cut <= 0:
                    cut = size
                head, para = para[:cut].rstrip(), para[cut:].lstrip()
                if cur:
                    pages.append(cur)
                    cur = ""
                pages.append(head)
            if not cur:
                cur = para
            elif len(cur) + 1 + len(para) <= size:
                cur = f"{cur}\n{para}"
            else:
                pages.append(cur)
                cur = para
        if cur or not pages:
            pages.append(cur)
        return pages

    def test_the_linear_chunker_pages_exactly_as_the_original_did(self):
        """Same pages, same count, at every cap -- including Unicode whitespace
        (`\\u3000`, `\\x1c`, no-break space), which `str.lstrip` strips and the
        index walk must skip identically."""
        import random
        rng = random.Random(20260925)
        alphabet = ["a", "b", " ", "  ", "\t", "\n", " ", "　", "\x1c", "é", "xxxxx"]
        for _ in range(1500):
            size = rng.choice([1, 2, 3, 5, 8, 13, 40])
            paras = ["".join(rng.choice(alphabet) for _ in range(rng.randint(0, 60)))
                     for _ in range(rng.randint(0, 8))]
            want = self._reference_chunk(list(paras), size)
            for cap in (0, 1, 2, 1000):
                got, count = dx._chunk_pages(list(paras), size, cap)
                assert (got, count) == (want[:cap], len(want)), (size, cap, paras)

    @staticmethod
    def _big_paragraph() -> str:
        return ("lorem ipsum dolor " * (19_000_000 // 18 + 1))[:19_000_000]

    def test_a_19_mb_paragraph_is_paged_inside_a_cpu_budget(self):
        """The whole door -- unzip, parse, page -- on one 19 MB paragraph, in
        CPU seconds (`process_time`, so a busy box does not move it much; on
        Windows it ticks in ~15.6 ms steps). Measured after the fix across two
        runs: 0.047-0.078 s. Before, the chunker ALONE: 23.7-30.6 s."""
        import time
        data = _docx(_p(_r(self._big_paragraph())))
        assert len(data) < 100_000, "a bomb is small on the wire, or it proves nothing"
        t0 = time.process_time()
        out = dx.extract_docx_pages(data)
        spent = time.process_time() - t0
        assert out is not None
        pages, count = out
        assert len(pages) == dx._MAX_PAGES and count > dx._MAX_PAGES
        assert spent < 2.0, f"paging a 19 MB paragraph took {spent:.2f} s of CPU"

    def test_pages_past_the_cap_are_never_built(self):
        """⛔ The cap is applied WHILE chunking: past `_MAX_PAGES` only lengths
        are counted. Proved by what the chunker ALLOCATES -- a chunker that is
        linear but builds all 6,334 pages and then cuts the list passes the
        CPU budget above and fails here, because it holds 19 MB of page text."""
        import tracemalloc
        para = self._big_paragraph()
        tracemalloc.start()
        try:
            pages, count = dx._chunk_pages([para])
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        assert len(pages) == dx._MAX_PAGES and count > dx._MAX_PAGES
        stored = sum(len(p) for p in pages)
        assert peak < stored + 2_000_000, (
            f"chunking allocated {peak:,} bytes to keep {stored:,} characters of text")

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

    def test_the_budget_is_charged_in_bytes_at_the_widest_pixel(self, monkeypatch):
        """A 20x20 image costs 20*20*4 = 1,600 decoded bytes whatever its mode."""
        monkeypatch.setattr(dx, "_IMAGE_DECODE_BUDGET_BYTES", 1_599)
        assert dx.load_image_for_ocr(_png((20, 20))) is None
        assert dx.probe_image(_png((20, 20))) is False
        monkeypatch.setattr(dx, "_IMAGE_DECODE_BUDGET_BYTES", 1_600)
        assert dx.load_image_for_ocr(_png((20, 20))) is not None
        assert dx.probe_image(_png((20, 20))) is True


# ── I-4 (fix round 1): what one image is allowed to cost in memory ───────────
#
# ⛔ Measured by the reviewer: a 7000x7000 RGBA PNG is 199 KB on the wire and
# passed both the 5 MB upload cap and the old 50 MP pixel cap; one OCR pass then
# held ~440 MB (decode + an `exif_transpose` COPY + the adapter's grayscale), and
# extraction had already decoded the whole thing once just to see that it could.

def _blank_png(w: int, h: int) -> bytes:
    """A VALID 1-bit grayscale PNG of any size, built without ever holding its
    bitmap: a few KB for 36 MP, so a test can hand the code a big image without
    the test itself paying for one."""
    import struct
    import zlib

    def chunk(kind: bytes, body: bytes) -> bytes:
        return (struct.pack(">I", len(body)) + kind + body
                + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF))

    row = b"\x00" + b"\xff" * ((w + 7) // 8)          # filter 0 + one white row
    comp = zlib.compressobj(9)
    idat = b"".join(comp.compress(row) for _ in range(h)) + comp.flush()
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 1, 0, 0, 0, 0))
            + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


@pytest.fixture()
def pixel_decodes(monkeypatch):
    """Records every time Pillow DECODES an image file's pixels. `load()` is
    called again and again on an image already in memory (thumbnail, transpose
    and convert all call it) and does nothing then; only a call with tiles
    still pending is a decode, so only those are counted."""
    from PIL import ImageFile
    calls = []
    real = ImageFile.ImageFile.load

    def spy(self, *a, **kw):
        if getattr(self, "tile", None):
            calls.append(self.size)
        return real(self, *a, **kw)

    monkeypatch.setattr(ImageFile.ImageFile, "load", spy)
    return calls


class TestBoundedWorkers:
    """⛔ Fix round 1, I-1. `queue_extraction` and `queue_ocr` each started ONE
    THREAD PER DOCUMENT that then waited on a small semaphore -- so the
    semaphore bounded the work and nothing bounded the threads. Email-in can
    deliver 20 attachments a message."""

    @staticmethod
    def _live(name):
        import threading
        return sum(1 for t in threading.enumerate() if t.name == name and t.is_alive())

    @staticmethod
    def _wait(pred, timeout=10.0):
        import time
        end = time.monotonic() + timeout
        while time.monotonic() < end and not pred():
            time.sleep(0.005)
        return pred()

    def test_forty_documents_never_hold_more_extraction_threads_than_permits(self, monkeypatch):
        import threading
        release, done = threading.Event(), []
        monkeypatch.setattr(dx, "_process_document_bounded",
                            lambda doc_id: (release.wait(10), done.append(doc_id)))
        for i in range(40):
            dx.queue_extraction(f"doc-{i}")
        try:
            assert self._wait(lambda: self._live("j2-doc-extract") >= 1)
            assert self._live("j2-doc-extract") <= dx._MAX_CONCURRENT_EXTRACTIONS, (
                f"{self._live('j2-doc-extract')} extraction threads for "
                f"{dx._MAX_CONCURRENT_EXTRACTIONS} permits")
        finally:
            release.set()
        assert self._wait(lambda: len(done) == 40), "every queued document was extracted"
        assert self._wait(lambda: self._live("j2-doc-extract") == 0)

    def test_twenty_scans_never_hold_more_ocr_threads_than_permits(self, monkeypatch):
        import threading
        release, done = threading.Event(), []
        monkeypatch.setattr(ocr, "ocr_document",
                            lambda doc_id, adapter, **kw: (release.wait(10), done.append(doc_id)))
        for i in range(20):
            ocr.queue_ocr(f"scan-{i}", fake_adapter)
        try:
            assert self._wait(lambda: self._live("j2-doc-ocr") >= 1)
            assert self._live("j2-doc-ocr") <= ocr.OCR_MAX_CONCURRENCY, (
                f"{self._live('j2-doc-ocr')} OCR threads for {ocr.OCR_MAX_CONCURRENCY} permits")
        finally:
            release.set()
        assert self._wait(lambda: len(done) == 20)
        assert self._wait(lambda: self._live("j2-doc-ocr") == 0)


class TestImageMemory:
    def test_a_36_mp_image_the_old_cap_admitted_is_refused_before_any_decode(self, pixel_decodes):
        big = _blank_png(6000, 6000)                 # 36 MP -> 144 MB decoded at 4 B/px
        assert len(big) < 100_000, "a small file on the wire, or it proves nothing"
        assert dx.load_image_for_ocr(big) is None
        assert dx.probe_image(big) is False
        assert pixel_decodes == [], "the budget must refuse from the HEADER"
        # control: the same builder under the budget decodes (and is shrunk)
        ok = dx.load_image_for_ocr(_blank_png(5000, 1000))
        assert ok is not None and pixel_decodes == [(5000, 1000)]

    def test_extraction_validates_an_image_without_decoding_it(self, env, pixel_decodes):
        """⛔ The throwaway decode. Extraction only needs to know the image is
        readable; the pixels are OCR's to decode, once."""
        user = env["user"]
        doc = _upload_image(user, _note(user), _png((40, 30)))
        assert dx.process_document(doc["id"])["status"] == "no_text"
        assert pixel_decodes == [], (
            f"extraction decoded the image {len(pixel_decodes)} time(s) just to validate it")

    def test_ocr_is_handed_the_image_shrunk_to_the_ocr_long_edge(self, env):
        user = env["user"]
        doc = _upload_image(user, _note(user), _blank_png(5000, 1000))
        dx.process_document(doc["id"])
        ocr.set_adapter(fake_adapter)
        ocr.plan_document(doc["id"])
        ocr.ocr_document(doc["id"], fake_adapter)
        assert fake_adapter.seen == [(dx._OCR_LONG_EDGE, 800)]

    def test_a_large_phone_jpeg_is_decoded_at_reduced_scale_not_refused(self, pixel_decodes):
        """A JPEG is `draft()`-ed toward the OCR size before the budget is
        charged. 9000x3000 is 108 MB at full scale -- over budget -- and 27 MB
        at the half scale its decoder can produce directly. ⛔ The draft box
        keeps the photo's aspect: a square (4000, 4000) box asks for no
        reduction at all on a 3000-px-tall image, and the photo is refused."""
        from PIL import Image
        buf = io.BytesIO()
        Image.new("L", (9000, 3000), 255).save(buf, "JPEG")
        im = dx.load_image_for_ocr(buf.getvalue())
        assert im is not None, "a normal wide photo was refused"
        assert pixel_decodes == [(4500, 1500)], "the decoder was not asked to reduce"
        assert im.size == (dx._OCR_LONG_EDGE, 1333)

    # ⛔⛔ Fix round 2, N-1. The comment above `_IMAGE_DECODE_BUDGET_BYTES`
    # claimed "budget + 64 MB" from arithmetic; the re-review MEASURED +333 MiB
    # (RGBA) and +238 MiB (RGB) at the 25 MP maximum. The greyscale step before
    # the resize brought both to +121 MiB (measured 2026-09-25, this box, peak
    # commit, 3 runs each within 0.2 MiB). This rail is that measurement.
    #
    # ⛔ A FRESH PROCESS, AND THE PROCESS'S OWN COUNTER. tracemalloc cannot see
    # Pillow's pixel buffers (they are C allocations, not Python objects), so
    # the probe reads peak commit (Windows) / peak RSS (Linux) around ONE call,
    # in a subprocess whose PNG is built by streaming -- no bitmap exists before
    # the baseline. The reading is peak-after minus current-before, which can
    # only OVER-state the call's transient, never hide it.
    _PEAK_CEILING_MIB = 150    # measured 121 + a 29 MiB margin
    _PEAK_FLOOR_MIB = 90       # the 25 MP decode alone is 95.4 MiB: below this, the probe saw nothing

    @pytest.mark.parametrize("mode", ["RGBA", "RGB"])
    def test_one_image_at_the_budget_peaks_under_the_measured_ceiling(self, mode, tmp_path):
        import json
        import os
        import pathlib
        import subprocess
        import sys
        repo = pathlib.Path(__file__).resolve().parents[1]
        env = dict(os.environ)                       # carries the conftest's sandbox pins
        env["AUTH_DB_PATH"] = str(tmp_path / "auth.db")
        env["PYTHONPATH"] = str(repo)
        side = int((dx._IMAGE_DECODE_BUDGET_BYTES // dx._DECODED_BYTES_PER_PIXEL) ** 0.5)
        out = subprocess.run([sys.executable, "-c", _PEAK_PROBE, mode, str(side), str(side)],
                             cwd=str(repo), env=env, capture_output=True, text=True, timeout=300)
        assert out.returncode == 0, out.stderr[-2000:]
        lines = out.stdout.strip().splitlines()
        assert lines, "the probe printed nothing -- a reading of nothing is not a pass"
        got = json.loads(lines[-1])
        added = got["added"] / 2**20
        assert added > self._PEAK_FLOOR_MIB, f"+{added:.1f} MiB: the probe did not see the decode"
        assert added < self._PEAK_CEILING_MIB, (
            f"one {mode} {side}x{side} image peaked at +{added:.1f} MiB, over the "
            f"{self._PEAK_CEILING_MIB} MiB ceiling the comment's figure rests on")
        # and the engine is handed what it was always handed: greyscale, shrunk
        assert got["out"] == ["L", dx._OCR_LONG_EDGE, dx._OCR_LONG_EDGE], got


# The fresh-process probe for the rail above. argv: mode, width, height.
_PEAK_PROBE = r'''
import ctypes, json, struct, sys, zlib

def mem():
    """(current, peak) bytes: commit on Windows, RSS on Linux."""
    if sys.platform == "win32":
        from ctypes import wintypes
        class PMC(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                        ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                        ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]
        pmc = PMC(); pmc.cb = ctypes.sizeof(PMC)
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.GetCurrentProcess.restype = wintypes.HANDLE
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PMC), wintypes.DWORD]
        if not psapi.GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb):
            raise OSError(ctypes.get_last_error())
        return pmc.PagefileUsage, pmc.PeakPagefileUsage
    vals = {}
    with open("/proc/self/status") as fh:
        for line in fh:
            k, _, v = line.partition(":")
            if k in ("VmRSS", "VmHWM"):
                vals[k] = int(v.split()[0]) * 1024
    return vals["VmRSS"], vals["VmHWM"]

mode, w, h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ctype, px = {"RGBA": (6, b"\x10\x20\x30\xff"), "RGB": (2, b"\x10\x20\x30")}[mode]

def chunk(kind, body):
    return (struct.pack(">I", len(body)) + kind + body
            + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF))

row = b"\x00" + px * w
comp = zlib.compressobj(6)
idat = b"".join(comp.compress(row) for _ in range(h)) + comp.flush()
del row
png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0))
       + chunk(b"IDAT", idat) + chunk(b"IEND", b""))
del idat

from api.services.journal_two import document_extraction as dx
import PIL.Image  # noqa: F401
cur0, _ = mem()
im = dx.load_image_for_ocr(png)
_, peak1 = mem()
print(json.dumps({"added": peak1 - cur0,
                  "out": None if im is None else [im.mode, im.size[0], im.size[1]]}))
'''

"""Wave 10 lane 10B — G-160: .xlsx attachments as searchable documents.

Ruling R-4: stdlib only (`zipfile` + expat), the docx caps, and it rides the
SAME dark gate as images and .docx (`NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED`).

What these rails hold:

  * THE SHARED STRINGS ARE THE TEXT. A text cell stores an index into
    `xl/sharedStrings.xml`; a word that lives only there must reach the page.
  * numbers read as a person reads them (15 significant digits), a formula
    cell shows its CACHED value (and nothing when it was never calculated),
    booleans, errors and inline strings are their text, a date-styled number
    is an ISO date (the 1904 system too);
  * every sheet, in tab order, is its own run of pages headed by its name;
  * refused whole (None, never a raise) when a part is past the per-part or
    the whole-workbook cap, carries a DOCTYPE, or is not a workbook;
  * the GATE: off means an .xlsx upload is a plain attachment; on, it becomes
    a document of its own kind, only when its saved URL ends in `.xlsx`;
  * END TO END through `document_search.search_document_pages` (the
    production search path), with the positive control that the cell value
    was not findable before extraction; OCR never plans an xlsx page.
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
S_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
PHRASE = "kimberlitegabbro"


# ── a workbook, built part by part ──────────────────────────────────────────

def _xlsx(sheets: list[tuple[str, str]], shared: list[str] | None = None, *,
          styles: str | None = None, date1904: bool = False,
          extra: dict[str, str | bytes] | None = None,
          shared_xml: str | None = None) -> bytes:
    """`sheets` = [(name, <sheetData> inner xml)], in tab order."""
    wb_sheets = "".join(
        f'<sheet name="{n}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, (n, _) in enumerate(sheets))
    wbpr = '<workbookPr date1904="1"/>' if date1904 else ""
    workbook = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<workbook xmlns="{S_NS}" xmlns:r="{R_NS}">{wbpr}<sheets>{wb_sheets}</sheets></workbook>')
    rels = "".join(
        f'<Relationship Id="rId{i + 1}" Type="{R_NS}/worksheet" Target="worksheets/sheet{i + 1}.xml"/>'
        for i in range(len(sheets)))
    rels_xml = f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{PKG_NS}">{rels}</Relationships>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/_rels/workbook.xml.rels", rels_xml)
        if shared_xml is not None:
            z.writestr("xl/sharedStrings.xml", shared_xml)
        elif shared is not None:
            si = "".join(f"<si><t>{s}</t></si>" for s in shared)
            z.writestr("xl/sharedStrings.xml",
                       f'<?xml version="1.0" encoding="UTF-8"?><sst xmlns="{S_NS}">{si}</sst>')
        if styles is not None:
            z.writestr("xl/styles.xml", f'<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="{S_NS}">{styles}</styleSheet>')
        for i, (_n, data) in enumerate(sheets):
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml",
                       f'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="{S_NS}">'
                       f"<sheetData>{data}</sheetData></worksheet>")
        for name, body in (extra or {}).items():
            z.writestr(name, body)
    return buf.getvalue()


def _row(r: int, *cells: str) -> str:
    return f'<row r="{r}">{"".join(cells)}</row>'


def _s(ref: str, index: int, style: int | None = None) -> str:        # shared string
    st = f' s="{style}"' if style is not None else ""
    return f'<c r="{ref}" t="s"{st}><v>{index}</v></c>'


def _n(ref: str, value: str, style: int | None = None) -> str:        # number
    st = f' s="{style}"' if style is not None else ""
    return f'<c r="{ref}"{st}><v>{value}</v></c>'


def _pages_of(data: bytes) -> list[str]:
    out = dx.extract_xlsx_pages(data)
    assert out is not None
    return out[0]


# ── text ─────────────────────────────────────────────────────────────────────

class TestXlsxText:
    def test_a_word_that_lives_only_in_shared_strings_reaches_the_page(self):
        data = _xlsx([("Trades", _row(1, _s("A1", 0), _s("B1", 1)) + _row(2, _s("A2", 2), _n("B2", "120.5")))],
                     shared=["Sym", "Note", PHRASE])
        (page,) = _pages_of(data)
        assert PHRASE in page
        # …and the index is NOT what reaches it
        assert "Sheet: Trades\nSym\tNote\n" + PHRASE + "\t120.5" == page

    def test_rich_text_runs_join_and_a_phonetic_reading_is_skipped(self):
        shared_xml = (f'<sst xmlns="{S_NS}"><si><r><t>Kimber</t></r><r><t>lite</t></r>'
                      f"<rPh><t>ignored-reading</t></rPh></si></sst>")
        data = _xlsx([("S", _row(1, _s("A1", 0)))], shared_xml=shared_xml)
        (page,) = _pages_of(data)
        assert page == "Sheet: S\nKimberlite"

    def test_numbers_formulas_booleans_errors_and_inline_strings(self):
        cells = (
            _n("A1", "0.30000000000000004")                            # binary noise reads 0.3
            + '<c r="B1"><f>SUM(A1:A1)</f><v>42</v></c>'              # formula: cached value
            + '<c r="C1"><f>A1*2</f></c>'                             # never calculated: empty
            + '<c r="D1" t="b"><v>1</v></c>'
            + '<c r="E1" t="e"><v>#DIV/0!</v></c>'
            + '<c r="F1" t="inlineStr"><is><t>inline words</t></is></c>'
            + '<c r="G1" t="str"><f>"x"&amp;"y"</f><v>xy</v></c>'
        )
        (page,) = _pages_of(_xlsx([("S", _row(1, cells))], shared=[]))
        assert page.split("\n")[1] == "0.3\t42\t\tTRUE\t#DIV/0!\tinline words\txy"

    def test_a_gap_keeps_its_column_and_an_empty_row_is_skipped(self):
        data = _xlsx([("S", _row(1, _n("A1", "1"), _n("C1", "3")) + _row(2) + _row(3, _n("B3", "2")))],
                     shared=[])
        (page,) = _pages_of(data)
        assert page == "Sheet: S\n1\t\t3\n\t2"

    def test_a_date_styled_number_is_an_iso_date_and_1904_is_honoured(self):
        styles = ('<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts>'
                  '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs>')
        row = _row(1, _n("A1", "46291", style=1), _n("B1", "46291.5", style=2), _n("C1", "46291", style=0))
        (page,) = _pages_of(_xlsx([("S", row)], shared=[], styles=styles))
        assert page.split("\n")[1] == "2026-09-26\t2026-09-26 12:00\t46291"
        (page1904,) = _pages_of(_xlsx([("S", _row(1, _n("A1", "44829", style=1)))], shared=[],
                                      styles=styles, date1904=True))
        assert page1904.split("\n")[1] == "2026-09-26"

    def test_every_sheet_in_tab_order_starts_its_own_pages_headed_by_its_name(self):
        data = _xlsx([("Trades", _row(1, _n("A1", "1"))), ("Empty", ""), ("Watchlist", _row(1, _s("A1", 0)))],
                     shared=["NVDA"])
        pages = _pages_of(data)
        assert pages == ["Sheet: Trades\n1", "Sheet: Watchlist\nNVDA"]

    def test_a_long_sheet_continues_under_its_name_and_the_count_is_real(self, monkeypatch):
        rows = "".join(_row(i, _n(f"A{i}", str(10 ** 9 + i))) for i in range(1, 801))   # ~8.8k chars
        pages, count = dx.extract_xlsx_pages(_xlsx([("Big", rows)], shared=[]))
        assert count == len(pages) >= 3
        assert pages[0].startswith("Sheet: Big\n")
        assert all(p.startswith("Sheet: Big (continued)\n") for p in pages[1:])
        monkeypatch.setattr(dx, "_MAX_PAGES", 1)
        capped, capped_count = dx.extract_xlsx_pages(_xlsx([("Big", rows)], shared=[]))
        assert len(capped) == 1 and capped_count == count

    def test_a_workbook_with_no_cells_is_one_empty_page(self):
        assert dx.extract_xlsx_pages(_xlsx([("S", "")], shared=[])) == ([""], 1)


# ── refusals ─────────────────────────────────────────────────────────────────

class TestXlsxRefusals:
    def test_a_doctype_in_shared_strings_is_refused_so_no_entity_can_expand(self):
        shared_xml = ('<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY a "aaaaaaaaaa">]>'
                      f'<sst xmlns="{S_NS}"><si><t>&a;</t></si></sst>')
        assert dx.extract_xlsx_pages(_xlsx([("S", _row(1, _s("A1", 0)))], shared_xml=shared_xml)) is None

    def test_a_part_past_the_per_part_cap_is_refused_whole(self, monkeypatch):
        big = _row(1, *[_n(f"A{i}", "1") for i in range(1, 40)])
        assert dx.extract_xlsx_pages(_xlsx([("S", big)], shared=[])) is not None, "control: readable uncapped"
        monkeypatch.setattr(dx, "_DOCX_MAX_XML_BYTES", 400)
        assert dx.extract_xlsx_pages(_xlsx([("S", big)], shared=[])) is None

    def test_parts_that_add_up_past_the_workbook_cap_are_refused(self, monkeypatch):
        # every part fits the per-part cap; together they do not
        sheets = [(f"S{i}", _row(1, _n("A1", "1" * 40))) for i in range(8)]
        assert dx.extract_xlsx_pages(_xlsx(sheets, shared=[])) is not None, "control: readable uncapped"
        monkeypatch.setattr(dx, "_XLSX_MAX_TOTAL_XML_BYTES", 1200)
        assert dx.extract_xlsx_pages(_xlsx(sheets, shared=[])) is None

    @pytest.mark.parametrize("data", [b"", b"not a zip", b"PK\x03\x04 truncated"])
    def test_not_a_workbook_is_none_never_a_raise(self, data):
        assert dx.extract_xlsx_pages(data) is None

    def test_a_zip_without_a_workbook_part_is_none(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("word/document.xml", "<x/>")
        assert dx.extract_xlsx_pages(buf.getvalue()) is None


# ── the gate and the upload seam ────────────────────────────────────────────

@pytest.fixture()
def env(tmp_path, monkeypatch):
    auth_db.init_db()
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "j2_attachments")
    monkeypatch.setenv(GATE, "1")
    queued: list[str] = []
    monkeypatch.setattr(dx, "queue_extraction", lambda doc_id: queued.append(doc_id))
    ocr.set_adapter(None)
    tok = uuid.uuid4().hex[:8]
    yield {"user": f"u-g160-{tok}", "other": f"u-g160-b-{tok}", "queued": queued}
    ocr.set_adapter(None)


def _note(user: str) -> str:
    return notes_svc.create_note(user, {
        "title": "Research", "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
    })["id"]


def _upload_xlsx(user: str, note_id: str, data: bytes, name: str = "trades.xlsx") -> dict | None:
    att = notes_svc.save_note_attachment_bytes(user, note_id, data, name, dx.XLSX_MIME)
    return dx.on_attachment_saved(user, note_id, att, dx.XLSX_MIME, kind="file")


def _row_of(doc_id: str) -> dict:
    c = get_connection()
    c.row_factory = sqlite3.Row
    try:
        return dict(c.execute("SELECT * FROM j2_note_documents WHERE id = ?", (doc_id,)).fetchone())
    finally:
        c.close()


class TestXlsxGate:
    XLSX = {"url": "/api/j2/notes/attachments/u1/n1/file/abc_trades.xlsx", "name": "trades.xlsx"}

    @pytest.mark.parametrize("value", [None, "", "0", "false", "off"])
    def test_gate_off_an_xlsx_is_a_plain_attachment(self, monkeypatch, value):
        if value is None:
            monkeypatch.delenv(GATE, raising=False)
        else:
            monkeypatch.setenv(GATE, value)
        monkeypatch.setattr(dx, "create_document", lambda *a, **k: pytest.fail("no row while dark"))
        assert dx.on_attachment_saved("u1", "n1", dict(self.XLSX), dx.XLSX_MIME, kind="file") is None

    def test_gate_on_an_xlsx_becomes_a_document_of_its_own_kind(self, monkeypatch):
        monkeypatch.setenv(GATE, "1")
        created, queued = [], []
        monkeypatch.setattr(dx, "create_document",
                            lambda uid, nid, url, name, **kw: created.append((url, name, kw.get("source_kind")))
                            or {"id": "d1"})
        monkeypatch.setattr(dx, "queue_extraction", queued.append)
        assert dx.on_attachment_saved("u1", "n1", dict(self.XLSX), dx.XLSX_MIME, kind="file") == {"id": "d1"}
        assert created == [(self.XLSX["url"], "trades.xlsx", dx.SOURCE_KIND_XLSX)] and queued == ["d1"]

    def test_an_xlsx_whose_url_does_not_end_in_xlsx_stays_a_plain_attachment(self, monkeypatch):
        monkeypatch.setenv(GATE, "1")
        odd = {"url": "/api/j2/notes/attachments/u1/n1/file/abc_trades.bin", "name": "trades.bin"}
        assert dx.on_attachment_saved("u1", "n1", odd, dx.XLSX_MIME, kind="file") is None

    def test_xlsx_is_a_native_text_kind_ocr_never_plans(self):
        assert dx.SOURCE_KIND_XLSX in dx.NATIVE_TEXT_KINDS
        assert dx.SOURCE_KIND_DOCX in dx.NATIVE_TEXT_KINDS


# ── end to end: the cell value reaches document search ──────────────────────

class TestXlsxEndToEnd:
    def _book(self) -> bytes:
        return _xlsx(
            [("Trades", _row(1, _s("A1", 0), _s("B1", 1)) + _row(2, _s("A2", 2), _n("B2", "120.5"))),
             ("Notes", _row(1, _s("A1", 3)))],
            shared=["Sym", "Price", "NVDA", f"The {PHRASE} thesis"],
        )

    def test_an_xlsx_upload_becomes_searchable_pages_and_search_finds_a_cell(self, env):
        user = env["user"]
        note_id = _note(user)
        doc = _upload_xlsx(user, note_id, self._book())
        assert doc is not None and env["queued"] == [doc["id"]]
        row = _row_of(doc["id"])
        assert row["source_kind"] == dx.SOURCE_KIND_XLSX and row["attachment_url"].endswith(".xlsx")

        assert document_search.search_document_pages(user, PHRASE) == [], (
            "positive control: nothing is findable before extraction runs")
        assert dx.process_document(doc["id"]) == {"ok": True, "status": "ready", "page_count": 2}

        hits = document_search.search_document_pages(user, PHRASE)
        assert [(h["document_id"], h["page_number"]) for h in hits] == [(doc["id"], 2)]
        # a cell that came from sharedStrings is findable too, on the first sheet's page
        assert [h["page_number"] for h in document_search.search_document_pages(user, "NVDA")] == [1]
        assert document_search.search_document_pages(env["other"], PHRASE) == []

    def test_planning_claims_nothing_for_an_xlsx_even_with_an_engine(self, env):
        user = env["user"]
        note_id = _note(user)
        doc = _upload_xlsx(user, note_id, self._book())
        dx.process_document(doc["id"])
        seen = []

        def engine(image, *, page_number=1, lang="eng"):
            seen.append(page_number)
            return ocr.OcrPageResult(text="x", engine="fake", engine_version="1")

        ocr.set_adapter(engine)
        plan = ocr.plan_document(doc["id"])
        assert plan["ocr_required"] == [] and plan["status"] == "ready"
        assert seen == []

    def test_an_unreadable_xlsx_is_processing_failed_not_a_crash(self, env):
        user = env["user"]
        note_id = _note(user)
        doc = _upload_xlsx(user, note_id, b"PK\x03\x04 truncated nonsense")
        assert dx.process_document(doc["id"]) == {"ok": False, "status": "processing_failed"}

"""COV-04 -- filing-to-filing blacklining (api/services/filing_blackline.py and
GET /api/research/blackline/{sym}).

Fixtures under tests/fixtures/filing_blackline/ are REAL SEC documents recorded
2026-10-01 through the repo's own fair-access client (sec_client, declared
User-Agent): Apple's two most recent 10-Ks, accession 0000320193-25-000079
(filed 2025-10-31) and 0000320193-24-000123 (filed 2024-11-01). The only edits,
to stay under 500 KB: the hidden <ix:header> block removed; the attributes
style/id/contextref/name/format/scale/decimals/unitref/fontsize/class removed;
everything after the Item 8 heading (the financial statements and exhibits)
cut. The submissions document is AAPL's, trimmed to its 10-K/10-K/A/10-Q/8-K
rows filed since 2023. No test here touches the network: `_sec_get` and
`_resolve_cik` are replaced by name.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest

from api.services import filing_blackline as fb
from api.services.cache import cache
from api.services.fundamentals_pit.sec_client import SecError

FIX = Path(__file__).parent / "fixtures" / "filing_blackline"
AAPL_CIK = "0000320193"
NEWER_ACC, NEWER_FILED = "0000320193-25-000079", "2025-10-31"
OLDER_ACC, OLDER_FILED = "0000320193-24-000123", "2024-11-01"


def _b(name: str) -> bytes:
    return (FIX / name).read_bytes()


NEWER = _b(f"10k_aapl_{NEWER_ACC}.htm")
OLDER = _b(f"10k_aapl_{OLDER_ACC}.htm")
SUBMISSIONS = _b("submissions_aapl_trimmed.json")


def _fake_sec(calls: list, older: bytes = OLDER, newer: bytes = NEWER):
    def get(url: str) -> bytes:
        calls.append(url)
        if url.endswith(f"CIK{AAPL_CIK}.json"):
            return SUBMISSIONS
        if NEWER_ACC.replace("-", "") in url:
            return newer
        if OLDER_ACC.replace("-", "") in url:
            return older
        raise SecError(url, 404, "not found")
    return get


def _section(snap_or_sections, key):
    secs = snap_or_sections["sections"] if isinstance(snap_or_sections, dict) else snap_or_sections
    return next(s for s in secs if s["key"] == key)


def _blackline_threads():
    return [t for t in threading.enumerate() if t.name.startswith("filing-blackline")]


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv(fb.ENABLED_ENV, raising=False)
    for k in list(cache.keys_with_prefix(fb._CACHE_PREFIX)):
        cache.invalidate(k)
    fb._queued.clear()
    yield
    for k in list(cache.keys_with_prefix(fb._CACHE_PREFIX)):
        cache.invalidate(k)
    fb._queued.clear()


# ── extraction ──────────────────────────────────────────────────────────────

class TestExtract:
    def test_blocks_skip_the_hidden_xbrl_header_and_join_cells(self):
        doc = ("<html><body><ix:header><div>HIDDEN FACTS</div></ix:header>"
               "<div>Item&#160;1A.&#160;&#160;Risk Factors</div>"
               "<table><tr><td><span>Net sales</span></td><td>$</td><td>416,161</td></tr></table>"
               "<div>The Company&#8217;s business</div></body></html>")
        assert fb.html_blocks(doc) == ["Item 1A. Risk Factors", "Net sales $ 416,161",
                                       "The Company's business"]

    def test_risk_factors_located_in_both_real_filings(self):
        for doc, n in ((OLDER, 115), (NEWER, 106)):
            r = fb.locate_section(fb.html_blocks(doc), fb.SECTIONS[0])
            assert r["found"] and r["heading"] == "Item 1A. Risk Factors"
            assert len(r["paragraphs"]) == n
            assert r["furniture_dropped"] == 12          # running footers, counted not kept
            assert not any("Form 10-K |" in p for p in r["paragraphs"])

    def test_mdna_located_and_ends_before_item_7a(self):
        r = fb.locate_section(fb.html_blocks(NEWER), fb.SECTIONS[1])
        assert r["found"]
        assert r["heading"].startswith("Item 7. Management's Discussion and Analysis")
        assert "Total net sales $ 416,161 6 % $ 391,035 2 % $ 383,285" in r["paragraphs"]
        assert not any(p.startswith("Item 7A") for p in r["paragraphs"])

    def test_the_table_of_contents_entry_is_not_the_section(self):
        blocks = ["Item 1A. Risk Factors 5", "Item 1B. Unresolved Staff Comments 17",
                  "Item 1. Business", "We make things.",
                  "Item 1A. Risk Factors", "Risk one is long enough to matter.", "Risk two.",
                  "Item 1B. Unresolved Staff Comments", "None."]
        r = fb.locate_section(blocks, fb.SECTIONS[0])
        assert r["paragraphs"] == ["Risk one is long enough to matter.", "Risk two."]

    def test_a_sentence_that_mentions_an_item_is_not_a_heading(self):
        blocks = ["Item 1A. Risk Factors", "See Item 2 of this Form 10-K for properties.",
                  "Item 2. Properties"]
        r = fb.locate_section(blocks, fb.SECTIONS[0])
        assert r["paragraphs"] == ["See Item 2 of this Form 10-K for properties."]

    def test_no_heading_is_not_found_with_a_reason(self):
        r = fb.locate_section(["Item 1. Business", "text"], fb.SECTIONS[0])
        assert r == {"found": False, "reason": "no 'Item 1A. Risk Factors' heading in the document"}

    def test_a_heading_with_nothing_ending_it_is_not_trusted(self):
        r = fb.locate_section(["Item 1A. Risk Factors", "risk"], fb.SECTIONS[0])
        assert r["found"] is False and "no following item heading" in r["reason"]


# ── diff ────────────────────────────────────────────────────────────────────

class TestDiff:
    def test_word_marks_rebuild_both_sides(self):
        old, new = "results of operations and financial condition.", \
                   "results of operations, financial condition and stock price."
        segs = fb.word_diff(old, new)
        assert "".join(s["text"] for s in segs if s["op"] != "ins") == old
        assert "".join(s["text"] for s in segs if s["op"] != "del") == new

    def test_added_removed_changed_moved(self):
        older = ["Alpha risk about supply chains and component shortages in Asia.",
                 "Beta paragraph that will be removed entirely from the filing.",
                 "Gamma unchanged.", "Delta moved paragraph."]
        newer = ["Delta moved paragraph.",
                 "Alpha risk about supply chains and component shortages in Asia and India.",
                 "Gamma unchanged.", "Epsilon a brand new risk about artificial intelligence."]
        d = fb.diff_paragraphs(older, newer)
        assert d["counts"]["changed"] == 1 and d["counts"]["moved"] == 1
        assert d["counts"]["removed"] == 1 and d["counts"]["added"] == 1
        assert d["counts"]["unchanged"] == 1
        kinds = {p["kind"]: p for p in d["paragraphs"]}
        assert kinds["removed"]["text"].startswith("Beta")
        assert kinds["added"]["text"].startswith("Epsilon")
        inserted = "".join(s["text"] for s in kinds["changed"]["segments"] if s["op"] == "ins")
        assert "India." in inserted and "Alpha" not in inserted

    def test_a_year_only_change_is_boilerplate_and_still_listed(self):
        d = fb.diff_paragraphs(["Significant announcements during fiscal year 2024 included:"],
                               ["Significant announcements during fiscal year 2025 included:"])
        assert d["counts"]["changed"] == 1 and d["counts"]["boilerplate_changed"] == 1
        assert d["paragraphs"][0]["boilerplate"] is True

    def test_a_word_change_is_not_boilerplate(self):
        d = fb.diff_paragraphs(["Sales rose in 2024 due to iPhone."], ["Sales fell in 2025 due to iPhone."])
        assert d["paragraphs"][0]["boilerplate"] is False


class TestRealBlackline:
    """Apple FY2024 10-K -> FY2025 10-K, hand-checked against the documents."""

    @pytest.fixture(scope="class")
    def sections(self):
        return fb.blackline_sections(OLDER, NEWER)

    def test_both_sections_ok_with_measured_counts(self, sections):
        rf, md = _section(sections, "risk_factors"), _section(sections, "mdna")
        assert rf["state"] == md["state"] == "ok"
        assert rf["counts"] == {"added": 9, "removed": 18, "changed": 51, "boilerplate_changed": 0,
                                "moved": 0, "unchanged": 46, "older_paragraphs": 115, "newer_paragraphs": 106}
        assert md["counts"]["changed"] == 65 and md["counts"]["boilerplate_changed"] == 45

    def test_a_real_risk_factor_rewrite_has_word_marks(self, sections):
        rf = _section(sections, "risk_factors")
        hit = [p for p in rf["paragraphs"] if p["kind"] == "changed" and
               "depend significantly on global and regional economic conditions" in p["segments"][0]["text"]]
        assert len(hit) == 1
        segs = hit[0]["segments"]
        assert "".join(s["text"] for s in segs if s["op"] != "del").endswith(
            "results of operations, financial condition and stock price.")
        assert "".join(s["text"] for s in segs if s["op"] != "ins").endswith(
            "results of operations and financial condition.")

    def test_boilerplate_is_counted_and_not_hidden(self, sections):
        md = _section(sections, "mdna")
        listed = [p for p in md["paragraphs"] if p["kind"] == "changed" and p["boilerplate"]]
        assert len(listed) == md["counts"]["boilerplate_changed"] == 45
        assert any("".join(s["text"] for s in p["segments"] if s["op"] != "del") == "First Quarter 2025:"
                   for p in listed)

    def test_a_section_missing_from_one_side_is_not_found_never_no_changes(self):
        older = OLDER.replace(b"Item 7.&#160;&#160;&#160;&#160;Management", b"Section Seven Management")
        assert older != OLDER
        secs = fb.blackline_sections(older, NEWER)
        md = _section(secs, "mdna")
        assert md["state"] == "not_found"
        assert md["counts"] is None and md["paragraphs"] is None
        assert md["located"] == {"older": False, "newer": True}
        assert md["reason"].startswith("older filing: ")
        assert _section(secs, "risk_factors")["state"] == "ok"


# ── fetch (recorded SEC, no network) ────────────────────────────────────────

class TestFetch:
    def test_cites_both_filings_and_makes_three_requests(self, monkeypatch):
        calls = []
        monkeypatch.setattr(fb, "_sec_get", _fake_sec(calls))
        monkeypatch.setattr(fb, "_resolve_cik", lambda s: AAPL_CIK)
        snap = fb.fetch_blackline("aapl")
        assert snap["state"] == "ok"
        assert snap["newer"]["accession"] == NEWER_ACC and snap["newer"]["filing_date"] == NEWER_FILED
        assert snap["older"]["accession"] == OLDER_ACC and snap["older"]["filing_date"] == OLDER_FILED
        assert snap["newer"]["url"].endswith("/320193/000032019325000079/aapl-20250927.htm")
        assert len(calls) == 3

    def test_amendments_are_never_compared(self):
        sub = {"filings": {"recent": {"form": ["10-K/A", "10-K", "10-K"],
                                      "accessionNumber": ["a", "b", "c"],
                                      "filingDate": ["2026-01-01", "2025-10-31", "2024-11-01"],
                                      "primaryDocument": ["x", "y", "z"]}}}
        assert [f["accession"] for f in fb.list_filings(sub)["filings"]] == ["b", "c"]

    def test_partial_when_one_section_is_missing(self, monkeypatch):
        older = OLDER.replace(b"Item 7.&#160;&#160;&#160;&#160;Management", b"Section Seven Management")
        monkeypatch.setattr(fb, "_sec_get", _fake_sec([], older=older))
        monkeypatch.setattr(fb, "_resolve_cik", lambda s: AAPL_CIK)
        assert fb.fetch_blackline("AAPL")["state"] == "partial"

    def test_R9_both_filings_found_but_no_section_located_is_sections_unlocated(self, monkeypatch):
        # Both documents are read; neither carries a recognisable Item heading.
        # That is NOT "no filer" / "fewer than two filings" -- its own state,
        # still citing the two filings that were read.
        blank = b"<html><body><p>No item headings here.</p></body></html>"
        monkeypatch.setattr(fb, "_sec_get", _fake_sec([], older=blank, newer=blank))
        monkeypatch.setattr(fb, "_resolve_cik", lambda s: AAPL_CIK)
        snap = fb.fetch_blackline("AAPL")
        assert snap["state"] == "sections_unlocated"
        assert snap["newer"]["accession"] == NEWER_ACC and snap["older"]["accession"] == OLDER_ACC
        assert all(s["state"] == "not_found" for s in snap["sections"])

    def test_one_10k_is_not_found(self, monkeypatch):
        import json
        sub = json.loads(SUBMISSIONS)
        rec = sub["filings"]["recent"]
        keep = [i for i, f in enumerate(rec["form"]) if f != "10-K" or rec["accessionNumber"][i] == NEWER_ACC]
        sub["filings"]["recent"] = {k: [v[i] for i in keep] for k, v in rec.items()}
        sub["filings"]["files"] = []
        monkeypatch.setattr(fb, "_sec_get", lambda url: json.dumps(sub).encode())
        monkeypatch.setattr(fb, "_resolve_cik", lambda s: AAPL_CIK)
        snap = fb._refresh("AAPL")
        assert snap["state"] == "not_found" and "two are needed" in snap["detail"]
        assert "sections" not in snap

    def test_sec_down_is_unavailable_not_empty(self, monkeypatch):
        def down(url):
            raise SecError(url, 503, "down")
        monkeypatch.setattr(fb, "_sec_get", down)
        monkeypatch.setattr(fb, "_resolve_cik", lambda s: AAPL_CIK)
        snap = fb._refresh("AAPL")
        assert snap["state"] == "unavailable" and "sections" not in snap

    def test_no_filer_is_not_found_without_reaching_sec(self, monkeypatch):
        monkeypatch.setattr(fb, "_resolve_cik", lambda s: None)
        monkeypatch.setattr(fb, "_sec_get", lambda url: pytest.fail("must not reach SEC"))
        assert fb._refresh("ZZZZ")["state"] == "not_found"


# ── request path + flag ─────────────────────────────────────────────────────

class TestRequestPath:
    def test_request_path_never_touches_the_network(self, monkeypatch):
        monkeypatch.setenv(fb.ENABLED_ENV, "1")
        scheduled = []
        monkeypatch.setattr(fb, "_schedule", lambda sym, form="10-K": scheduled.append((sym, form)) or True)
        monkeypatch.setattr(fb, "_sec_get", lambda url: pytest.fail("request path reached SEC"))
        monkeypatch.setattr(fb, "_resolve_cik", lambda s: pytest.fail("request path resolved a CIK"))
        snap = fb.blackline_snapshot("aapl")
        assert snap == {"state": "pending", "sym": "AAPL", "vendor": "sec_edgar", "form": "10-K",
                        "queued": True}
        assert scheduled == [("AAPL", "10-K")]

    def test_armed_worker_fills_the_cache_once(self, monkeypatch):
        monkeypatch.setenv(fb.ENABLED_ENV, "1")
        monkeypatch.setattr(fb, "_sec_get", _fake_sec([]))
        monkeypatch.setattr(fb, "_resolve_cik", lambda s: AAPL_CIK)
        assert fb._schedule("AAPL") is True
        fb._executor.submit(lambda: None).result(timeout=30)     # the single worker drained
        assert fb.blackline_snapshot("AAPL")["state"] == "ok"

    def test_default_off(self):
        assert fb.is_enabled() is False

    def test_off_schedules_nothing_and_starts_no_thread(self, monkeypatch):
        monkeypatch.setattr(fb, "_executor", None)
        monkeypatch.setattr(fb, "_sec_get", lambda url: pytest.fail("flag off reached SEC"))
        before = len(_blackline_threads())
        assert fb._schedule("AAPL") is False
        assert fb.blackline_snapshot("AAPL")["queued"] is False
        assert fb._executor is None
        assert len(_blackline_threads()) == before


def _code_only(path: Path) -> str:
    """The module's source with every comment and string literal (docstrings
    included) removed, so a literal hunt cannot be satisfied or defeated by prose."""
    import io
    import tokenize
    keep = []
    for tok in tokenize.generate_tokens(io.StringIO(path.read_text(encoding="utf-8")).readline):
        if tok.type in (tokenize.COMMENT, tokenize.STRING):
            continue
        keep.append(tok.string)
    return " ".join(keep)


class TestOneTransport:
    SRC = Path(fb.__file__)

    def test_sec_is_reached_only_through_sec_client(self):
        code = _code_only(self.SRC)
        for banned in ("urllib", "requests", "httpx", "aiohttp", "urlopen", "socket"):
            assert banned not in code.split(), f"{banned} in filing_blackline.py code"
        assert "sec_client" in code.split() and "get_bytes" in code

    def test_the_hunt_ignores_prose(self, tmp_path):
        p = tmp_path / "m.py"
        p.write_text('"""uses urllib"""\n# import requests\nx = "httpx"\n', encoding="utf-8")
        code = _code_only(p)
        assert code.split() == ["x", "="]
        assert not any(w in code for w in ("urllib", "requests", "httpx"))


class TestRoute:
    PAID = {"id": 1, "email": "p@x.dev", "role": "admin", "plan": "pro"}

    @pytest.fixture()
    def client(self):
        from fastapi.testclient import TestClient
        from api.main import app
        from api.middleware.auth_middleware import get_current_user_with_plan
        app.dependency_overrides[get_current_user_with_plan] = lambda: self.PAID
        try:
            yield TestClient(app)
        finally:
            app.dependency_overrides.pop(get_current_user_with_plan, None)

    def test_off_is_404_before_identity(self):
        from fastapi.testclient import TestClient
        from api.main import app
        r = TestClient(app).get("/api/research/blackline/AAPL")
        assert r.status_code == 404

    def test_off_auth_payload_has_no_key(self, monkeypatch):
        from api.routers import auth
        assert auth._filing_blackline_flag() == {}
        monkeypatch.setenv(fb.ENABLED_ENV, "1")
        assert auth._filing_blackline_flag() == {"filing_blackline_enabled": True}

    def test_free_member_is_402(self, monkeypatch):
        from fastapi.testclient import TestClient
        from api.main import app
        from api.middleware.auth_middleware import get_current_user_with_plan
        monkeypatch.setenv(fb.ENABLED_ENV, "1")
        app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": 2, "role": "user", "plan": "free"}
        try:
            assert TestClient(app).get("/api/research/blackline/AAPL").status_code == 402
        finally:
            app.dependency_overrides.pop(get_current_user_with_plan, None)

    def test_on_miss_is_pending(self, client, monkeypatch):
        monkeypatch.setenv(fb.ENABLED_ENV, "1")
        monkeypatch.setattr(fb, "_schedule", lambda sym, form="10-K": True)
        body = client.get("/api/research/blackline/aapl").json()
        assert body["state"] == "pending" and body["ticker"] == "AAPL" and "sections" not in body

    def test_on_hit_serves_the_cited_blackline(self, client, monkeypatch):
        monkeypatch.setenv(fb.ENABLED_ENV, "1")
        monkeypatch.setattr(fb, "_sec_get", _fake_sec([]))
        monkeypatch.setattr(fb, "_resolve_cik", lambda s: AAPL_CIK)
        fb._refresh("AAPL")
        body = client.get("/api/research/blackline/AAPL").json()
        assert body["state"] == "ok"
        assert (body["newer"]["accession"], body["newer"]["filing_date"]) == (NEWER_ACC, NEWER_FILED)
        assert (body["older"]["accession"], body["older"]["filing_date"]) == (OLDER_ACC, OLDER_FILED)
        assert [s["key"] for s in body["sections"]] == ["risk_factors", "mdna"]

    def test_form_10q_is_served_and_other_forms_are_400(self, client, monkeypatch):
        monkeypatch.setenv(fb.ENABLED_ENV, "1")
        seen = []
        monkeypatch.setattr(fb, "_schedule", lambda sym, form="10-K": seen.append((sym, form)) or True)
        body = client.get("/api/research/blackline/AAPL?form=10-Q").json()
        assert body["state"] == "pending" and body["form"] == "10-Q" and seen == [("AAPL", "10-Q")]
        assert "10-Q" in body["source"]
        assert client.get("/api/research/blackline/AAPL?form=8-K").status_code == 400


# ── slice 2: heading coverage, measured over 42 issuers ─────────────────────
#
# Each rail below pins a fix to the measured miss it closes (evidence:
# docs/terminal-research/10-roadmap/evidence/2026-10-01-cov04-blackline-coverage).
# The *_excerpt.htm fixtures are REAL SEC documents recorded 2026-10-01 through
# sec_client, cut to byte windows around the headings that matter (the bodies
# in between are dropped) with presentational attributes removed -- except an
# inline `display:inline-block` style, which is the markup under test.

CALM_K = _b("10k_calm_0001562762-25-000170_excerpt.htm")     # converter-made, one line per element
GE_K = _b("10k_ge_0000040545-26-000008_excerpt.htm")         # cross-reference index, run-in titles
AAPL_Q_NEW, AAPL_Q_NEW_ACC = _b("10q_aapl_0000320193-26-000020_excerpt.htm"), "0000320193-26-000020"
AAPL_Q_OLD, AAPL_Q_OLD_ACC = _b("10q_aapl_0000320193-26-000013_excerpt.htm"), "0000320193-26-000013"
JNJ_Q = _b("10q_jnj_0000200406-26-000153_excerpt.htm")       # Part II has no Item 1A at all
CAVA_Q = _b("10q_cava_0001628280-26-055864_excerpt.htm")     # Item 1A: "no material changes"
Q10 = {s["key"]: s for s in fb.FORM_SECTIONS["10-Q"]}


class TestSplitLineLayouts:
    """CALM: every printed line is its own absolutely-positioned <div>, and
    words are spaced with <div style="display:inline-block">."""

    @pytest.fixture(scope="class")
    def blocks(self):
        return fb.html_blocks(CALM_K)

    def test_inline_block_spacers_do_not_split_a_line(self, blocks):
        assert "ITEM 1A. RISK FACTORS" in blocks

    def test_split_headings_are_located_and_the_text_is_reflowed(self, blocks):
        rf = fb.locate_section(blocks, fb.SECTIONS[0])
        assert rf["found"] and rf["heading"] == "ITEM 1A. RISK FACTORS"
        assert rf["paragraphs"][0].startswith("Our business and results of operations are subject")
        assert rf["fragmented"] is True and len(rf["paragraphs"]) == 13
        md = fb.locate_section(blocks, fb.SECTIONS[1])
        assert md["heading"] == ("ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL "
                                 "CONDITION AND RESULTS OF OPERATIONS")

    def test_a_cross_reference_inside_a_sentence_is_not_the_heading(self, blocks):
        ref = "Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations - HPAI"
        assert ref in blocks                       # "...and" | "Part II." | <this> | "."
        md = fb.locate_section(blocks, fb.SECTIONS[1])
        assert md["heading"].startswith("ITEM 7.") and len(md["paragraphs"]) == 9

    def test_a_table_heavy_section_is_not_reflowed(self):
        rf = fb.locate_section(fb.html_blocks(NEWER), fb.SECTIONS[0])
        assert rf["fragmented"] is False


class TestCrossReferenceIndexFiler:
    """GE: Item headings exist only in a cross-reference index with page
    numbers; the sections open with ALL-CAPS run-in titles."""

    @pytest.fixture(scope="class")
    def blocks(self):
        return fb.html_blocks(GE_K)

    def test_the_index_line_is_not_the_section(self, blocks):
        assert "Item 1A. Risk Factors 24-31" in blocks
        rf = fb.locate_section(blocks, fb.SECTIONS[0])
        assert rf["found"] and rf["heading"] == "RISK FACTORS." and rf["heading_shape"] == "title"
        assert rf["paragraphs"][0].startswith("The following discussion of the material factors")
        assert len(rf["paragraphs"]) == 8

    def test_run_in_mdna_runs_past_its_own_subheadings(self, blocks):
        md = fb.locate_section(blocks, fb.SECTIONS[1])
        assert md["heading"].startswith("MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION")
        assert md["paragraphs"][0].startswith("The consolidated financial statements of GE Aerospace")
        # a subheading that merely STARTS with an item word is not the next item
        assert any(p.startswith("BUSINESS OVERVIEW AND ENVIRONMENT.") for p in md["paragraphs"])
        assert len(md["paragraphs"]) == 14

    def test_a_title_bounding_no_prose_is_not_trusted(self):
        blocks = ["RISK FACTORS", "Strategic risks", "Operational risks", "LEGAL PROCEEDINGS"]
        r = fb.locate_section(blocks, fb.SECTIONS[0])
        assert r["found"] is False and "bounds no prose" in r["reason"]

    def test_running_footer_variants_are_furniture(self):
        for f in ("24 2025 FORM 10-K", "2025 FORM 10-K 23", "Goldman Sachs June 2026 Form 10-Q",
                  "Apple Inc. | Q3 2026 Form 10-Q | 23", "Apple Inc. | 2025 Form 10-K | 7"):
            assert fb._is_furniture(f), f
        assert not fb._is_furniture("Our risks are described in our 2025 Form 10-K and elsewhere.")


class TestTenQ:
    def test_both_sections_located_in_both_apple_quarterlies(self):
        for doc, (n_md, n_rf) in ((AAPL_Q_NEW, (23, 23)), (AAPL_Q_OLD, (30, 27))):
            b = fb.html_blocks(doc)
            md, rf = fb.locate_section(b, Q10["mdna"]), fb.locate_section(b, Q10["risk_factors"])
            assert md["heading"].startswith("Item 2. Management's Discussion and Analysis")
            assert rf["heading"] == "Item 1A. Risk Factors"
            assert (len(md["paragraphs"]), len(rf["paragraphs"])) == (n_md, n_rf)

    def test_fetch_compares_the_two_newest_10qs_and_cites_both(self, monkeypatch):
        calls = []

        def get(url):
            calls.append(url)
            if url.endswith(f"CIK{AAPL_CIK}.json"):
                return SUBMISSIONS
            if AAPL_Q_NEW_ACC.replace("-", "") in url:
                return AAPL_Q_NEW
            if AAPL_Q_OLD_ACC.replace("-", "") in url:
                return AAPL_Q_OLD
            raise SecError(url, 404, "not found")
        monkeypatch.setattr(fb, "_sec_get", get)
        monkeypatch.setattr(fb, "_resolve_cik", lambda s: AAPL_CIK)
        snap = fb.fetch_blackline("AAPL", "10-Q")
        assert snap["form"] == "10-Q" and snap["state"] == "ok" and len(calls) == 3
        assert (snap["newer"]["accession"], snap["newer"]["filing_date"]) == (AAPL_Q_NEW_ACC, "2026-07-31")
        assert (snap["older"]["accession"], snap["older"]["filing_date"]) == (AAPL_Q_OLD_ACC, "2026-05-01")
        assert snap["newer"]["form"] == snap["older"]["form"] == "10-Q"
        assert [s["key"] for s in snap["sections"]] == ["mdna", "risk_factors"]

    def test_an_item_1a_neither_10q_includes_is_omitted_never_no_changes(self):
        rf = _section(fb.blackline_sections(JNJ_Q, JNJ_Q, "10-Q"), "risk_factors")
        assert rf["state"] == "omitted" and rf["counts"] is None and rf["paragraphs"] is None
        assert rf["reason"].startswith("neither filing includes it: ")

    def test_a_section_that_only_refers_back_has_no_counts(self):
        rf = _section(fb.blackline_sections(CAVA_Q, CAVA_Q, "10-Q"), "risk_factors")
        assert rf["state"] == "reference_only" and rf["counts"] is None and rf["paragraphs"] is None
        assert rf["excerpt"]["newer"].startswith("There have been no material changes")

    def test_a_cross_reference_index_filer_is_not_omitted(self):
        """USB lists "2) Risk Factors (Item 1A)" in an index: the section exists
        somewhere we cannot locate. That is not_found, never omitted."""
        part2 = ["PART II. OTHER INFORMATION", "Item 1. Legal Proceedings", "See Note 12.",
                 "Item 2. Unregistered Sales of Equity Securities and Use of Proceeds", "None."]
        assert fb.locate_section(part2, Q10["risk_factors"]).get("omitted") is True
        indexed = ["2) Risk Factors (Item 1A) 76"] + part2
        r = fb.locate_section(indexed, Q10["risk_factors"])
        assert r["found"] is False and not r.get("omitted")

    def test_an_item_marked_not_applicable_is_omitted(self):
        r = fb.locate_section(["Item 1A. Risk Factors Not applicable(a)",
                               "Item 2. Unregistered Sales of Equity Securities Not applicable"],
                              Q10["risk_factors"])
        assert r.get("omitted") is True and "'Not applicable'" in r["reason"]


class TestHeavyFilerIndexPages:
    """JPM's `recent` block holds about a month of filings; its previous 10-K
    is on an older index page. Recorded 2026-10-01, trimmed to 10-K/10-Q rows."""

    MAIN = json.loads(_b("submissions_jpm_trimmed.json"))
    PAGE = _b("submissions_jpm_page_007_trimmed.json")

    def test_recent_block_alone_is_short(self):
        listing = fb.list_filings(self.MAIN, "10-K")
        assert len(listing["filings"]) == 1 and listing["index_short"] is True

    def test_the_due_page_is_read_and_only_that_page(self):
        calls = []

        def get(url):
            calls.append(url)
            return self.PAGE
        listing = fb.find_filings(self.MAIN, "10-K", get)
        assert calls == ["https://data.sec.gov/submissions/CIK0000019617-submissions-007.json"]
        assert [f["accession"] for f in listing["filings"]] == ["0001628280-26-008131", "0000019617-25-000270"]
        assert listing["pages_read"] == 1 and listing["index_short"] is False

    def test_pages_read_are_bounded_and_the_miss_says_so(self, monkeypatch):
        calls = []

        def get(url):
            calls.append(url)
            if "submissions-" in url:
                return json.dumps({"form": [], "accessionNumber": [], "filingDate": []}).encode()
            return json.dumps(self.MAIN).encode()
        monkeypatch.setattr(fb, "_sec_get", get)
        monkeypatch.setattr(fb, "_resolve_cik", lambda s: "0000019617")
        snap = fb._refresh("JPM")
        assert snap["state"] == "not_found"
        assert f"{fb._MAX_OLDER_PAGES} older page(s)" in snap["detail"]
        assert sum("submissions-" in u for u in calls) == fb._MAX_OLDER_PAGES


class TestFormSelection:
    def test_each_form_has_its_own_cache_entry_and_queue_slot(self, monkeypatch):
        monkeypatch.setenv(fb.ENABLED_ENV, "1")
        seen = []
        monkeypatch.setattr(fb, "_schedule", lambda sym, form="10-K": seen.append((sym, form)) or True)
        assert fb.blackline_snapshot("AAPL", "10-Q")["form"] == "10-Q"
        assert seen == [("AAPL", "10-Q")]
        assert fb._key("AAPL") == "filing_blackline::AAPL"            # the slice-1 10-K key, unchanged
        assert fb._key("AAPL", "10-Q") == "filing_blackline::AAPL::10-Q"

    def test_an_unsupported_form_is_refused(self):
        with pytest.raises(ValueError):
            fb.blackline_snapshot("AAPL", "8-K")

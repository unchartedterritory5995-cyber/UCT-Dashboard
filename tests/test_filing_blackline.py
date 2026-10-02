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
        monkeypatch.setattr(fb, "_schedule", lambda sym: scheduled.append(sym) or True)
        monkeypatch.setattr(fb, "_sec_get", lambda url: pytest.fail("request path reached SEC"))
        monkeypatch.setattr(fb, "_resolve_cik", lambda s: pytest.fail("request path resolved a CIK"))
        snap = fb.blackline_snapshot("aapl")
        assert snap == {"state": "pending", "sym": "AAPL", "vendor": "sec_edgar", "form": "10-K",
                        "queued": True}
        assert scheduled == ["AAPL"]

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
        monkeypatch.setattr(fb, "_schedule", lambda sym: True)
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

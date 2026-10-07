"""FT-058/059/060 filing search: the query language, indexing over RECORDED SEC
filings (tests/fixtures/filing_blackline, read from EDGAR by the COV-04 lane),
search honesty, and the dark route. No network: the one SEC transport is
replaced by a reader of those fixtures."""
from __future__ import annotations

import inspect
import json
from pathlib import Path

import pytest

from api.services import filing_search as fs

FIX = Path(__file__).resolve().parent / "fixtures" / "filing_blackline"
TEN_K = FIX / "10k_aapl_0000320193-25-000079.htm"
TEN_Q = FIX / "10q_aapl_0000320193-26-000020_excerpt.htm"
SUBMISSIONS = FIX / "submissions_aapl_trimmed.json"


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("FILING_SEARCH_DB_PATH", str(tmp_path / "fs.db"))
    return tmp_path


def _recorded_sec(url: str) -> bytes:
    if url.endswith("/submissions/CIK0000320193.json"):
        return SUBMISSIONS.read_bytes()
    if url.endswith("/000032019325000079/aapl-20250927.htm"):
        return TEN_K.read_bytes()
    if url.endswith("/000032019326000020/aapl-20260627.htm"):
        return TEN_Q.read_bytes()
    raise AssertionError(f"unrecorded SEC url {url}")


@pytest.fixture
def indexed(store, monkeypatch):
    from api.services import filing_blackline as fb
    monkeypatch.setattr(fb, "_resolve_cik", lambda s: "320193" if s == "AAPL" else None)
    monkeypatch.setattr(fs, "_sec_get", _recorded_sec)
    out = fs.index_symbol("AAPL")
    assert out["state"] == "ok", out
    return out


# ── the query language ──────────────────────────────────────────────────────

class TestCompile:
    def test_and_is_implicit_and_or_is_grouped(self):
        c = fs.compile_query("=apple OR =banana =cherry")
        assert c["fts"] == '("apple" OR ("banana" AND "cherry"))'

    def test_not_and_minus_exclude(self):
        assert fs.compile_query("=apple NOT =pear")["fts"] == '("apple" NOT "pear")'
        assert fs.compile_query("=apple -=pear")["fts"] == '("apple" NOT "pear")'

    def test_a_bare_not_is_refused_with_a_sentence(self):
        with pytest.raises(fs.QueryError, match="exclude from"):
            fs.compile_query("NOT apple")

    def test_near_with_distance_and_synonyms_expands_to_alternatives(self):
        c = fs.compile_query("tariff NEAR/5 =margin")
        assert c["fts"].startswith('(NEAR("tariff" "margin", 5) OR NEAR("tariffs" "margin", 5)')
        assert c["expanded"] == {"tariff": list(fs.SYNONYMS["tariff"])}

    def test_near_default_distance_is_ten(self):
        assert fs.compile_query("=a NEAR =b")["fts"] == 'NEAR("a" "b", 10)'

    def test_near_refuses_a_group(self):
        with pytest.raises(fs.QueryError, match="NEAR joins"):
            fs.compile_query("(=a OR =b) NEAR/3 =c")

    def test_a_synonym_is_reported_and_an_equals_suppresses_it(self):
        c = fs.compile_query("guidance")
        assert c["expanded"] == {"guidance": list(fs.SYNONYMS["guidance"])}
        assert '"outlook"' in c["fts"]
        assert fs.compile_query("=guidance")["expanded"] == {}
        assert fs.compile_query("=guidance")["fts"] == '"guidance"'

    def test_scope_tokens_are_pulled_out_anywhere(self):
        c = fs.compile_query("section:risk =china form:10-q")
        assert (c["section"], c["form"], c["fts"]) == ("risk_factors", "10-Q", '"china"')

    def test_unknown_scope_values_are_refused(self):
        with pytest.raises(fs.QueryError, match="unknown section"):
            fs.compile_query("section:footnotes x")
        with pytest.raises(fs.QueryError, match="unknown form"):
            fs.compile_query("form:8-K x")

    def test_unbalanced_and_empty_are_refused(self):
        for q in ("(=a OR =b", '"', "", "   ", "section:risk"):
            with pytest.raises(fs.QueryError):
                fs.compile_query(q)

    def test_a_quote_inside_a_word_cannot_break_out_of_the_fts_string(self):
        c = fs.compile_query("=o'neil")
        assert c["fts"] == '"o\'neil"'


# ── indexing the recorded filings ───────────────────────────────────────────

class TestIndex:
    def test_both_forms_and_every_section_are_indexed_with_citations(self, indexed):
        k, q = indexed["forms"]["10-K"], indexed["forms"]["10-Q"]
        assert k["accession"] == "0000320193-25-000079" and q["accession"] == "0000320193-26-000020"
        assert {s["key"]: s["state"] for s in k["sections"]} == {"risk_factors": "ok", "mdna": "ok"}
        assert k["paragraphs"] > 100 and q["paragraphs"] > 20

    def test_an_unknown_filer_is_recorded_not_found(self, store, monkeypatch):
        from api.services import filing_blackline as fb
        monkeypatch.setattr(fb, "_resolve_cik", lambda s: None)
        out = fs.index_symbol("ZZZZ")
        assert out["state"] == "not_found" and "no SEC filer" in out["reason"]

    def test_a_failed_sec_read_is_recorded_unavailable_never_raised(self, store, monkeypatch):
        from api.services import filing_blackline as fb
        monkeypatch.setattr(fb, "_resolve_cik", lambda s: "320193")

        def boom(url):
            raise OSError("connection reset")
        monkeypatch.setattr(fs, "_sec_get", boom)
        out = fs.index_symbol("AAPL")
        assert out["state"] == "unavailable" and "connection reset" in out["reason"]


# ── search ──────────────────────────────────────────────────────────────────

class TestSearch:
    def test_hits_name_their_filing_and_section(self, indexed):
        r = fs.search("tariff", sym="AAPL")
        assert r["index_state"] == "indexed" and r["count"] > 0
        h = r["hits"][0]
        assert h["sym"] == "AAPL" and h["form"] in fs.FORMS and h["accession"]
        assert h["url"].startswith("https://www.sec.gov/Archives/edgar/data/320193/")
        assert h["filed"] and h["section"] in fs.SECTION_LABELS
        assert fs.SNIP_OPEN in h["snippet"] and fs.SNIP_CLOSE in h["snippet"]
        assert r["source"].startswith("SEC EDGAR")

    def test_the_as_of_is_the_ticker_documents_index_fill_never_now(self, indexed):
        """TERM-019: a ticker-scoped search is dated by when THAT ticker's filings were indexed."""
        with fs._conn() as c:
            c.execute("UPDATE fs_doc SET indexed_at = 1700000000 WHERE sym = 'AAPL'")
            c.execute("INSERT INTO fs_doc (sym, form, accession, cik, filed, report_date, url, "
                      "indexed_at, sections_json) VALUES ('ZZZZ','10-K','x','1','2026-01-01',"
                      "'2025-12-31','u',1800000000,'[]')")
            c.commit()
        assert fs.search("tariff", sym="AAPL")["as_of"] == 1700000000
        assert fs.search("tariff")["as_of"] == 1800000000                # corpus: newest fill

    def test_section_scope_restricts_to_that_section(self, indexed):
        everywhere = fs.search("=litigation", sym="AAPL", limit=200)
        risk_only = fs.search("=litigation section:risk", sym="AAPL", limit=200)
        assert {h["section"] for h in risk_only["hits"]} == {"risk_factors"}
        assert risk_only["count"] <= everywhere["count"]
        assert fs.search("tariff", sym="AAPL", section="mdna", form="10-Q")["hits"]
        assert {h["form"] for h in fs.search("tariff form:10-Q", sym="AAPL")["hits"]} == {"10-Q"}

    def test_near_finds_fewer_paragraphs_than_and(self, indexed):
        both = fs.search("=tariffs =gross", sym="AAPL", limit=200)["count"]
        near = fs.search("=tariffs NEAR/20 =gross", sym="AAPL", limit=200)["count"]
        far_apart = fs.search("=tariffs NEAR/10 =margin", sym="AAPL", limit=200)["count"]
        assert both >= near > 0 and far_apart == 0

    def test_exactness_is_enforced_on_the_paragraph_text(self, indexed):
        # the index stems ("margins" matches "margin"); `=margin` must not
        stemmed = fs.search("margins", sym="AAPL", limit=200)["count"]
        exact = fs.search("=margins", sym="AAPL", limit=200)["count"]
        assert stemmed > exact >= 0
        assert fs.search('"supply chain"', sym="AAPL", limit=200)["count"] > 0

    def test_the_exact_filter_is_word_bounded(self):
        assert fs._passes("Gross margin rose", [("word", "margin")])
        assert not fs._passes("Gross margins rose", [("word", "margin")])
        assert fs._passes("our Supply  Chain risk", [("phrase", "supply chain")])
        assert not fs._passes("supply chains", [("phrase", "supply chain")])

    def test_an_unindexed_symbol_is_pending_not_an_empty_list(self, store, monkeypatch):
        monkeypatch.setenv("FILING_SEARCH_ENABLED", "1")
        queued = []
        monkeypatch.setattr(fs, "schedule_index", lambda s: queued.append(s) or True)
        r = fs.search("tariff", sym="MSFT")
        assert r["index_state"] == "pending" and r["count"] is None and r["hits"] == []
        assert "not indexed" in r["reason"] and queued == ["MSFT"]

    def test_a_symbol_with_no_filer_says_so_and_is_not_requeued(self, store, monkeypatch):
        from api.services import filing_blackline as fb
        monkeypatch.setattr(fb, "_resolve_cik", lambda s: None)
        fs.index_symbol("ZZZZ")
        monkeypatch.setattr(fs, "schedule_index", lambda s: pytest.fail("requeued a known not_found"))
        r = fs.search("tariff", sym="ZZZZ")
        assert r["index_state"] == "not_found" and r["count"] is None

    def test_scheduling_refuses_while_dark(self, monkeypatch):
        monkeypatch.delenv("FILING_SEARCH_ENABLED", raising=False)
        assert fs.schedule_index("AAPL") is False

    def test_reindex_job_is_a_no_op_while_dark(self, monkeypatch):
        monkeypatch.delenv("FILING_SEARCH_ENABLED", raising=False)
        assert fs.run_reindex() == {"skipped": "flag off"}


# ── the dark route ──────────────────────────────────────────────────────────

class TestRoute:
    @pytest.fixture
    def client(self, monkeypatch):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.routers import research_depth as route
        app = FastAPI()
        app.include_router(route.router)
        app.dependency_overrides[route.require_paid] = lambda: {"id": "u1"}
        return route, TestClient(app)

    def test_dark_by_default_is_a_404(self, client, monkeypatch):
        _, c = client
        monkeypatch.delenv("FILING_SEARCH_ENABLED", raising=False)
        assert c.get("/api/research/filing-search", params={"q": "x"}).status_code == 404

    def test_armed_serves_hits(self, client, indexed, monkeypatch):
        _, c = client
        monkeypatch.setenv("FILING_SEARCH_ENABLED", "1")
        r = c.get("/api/research/filing-search", params={"q": "tariffs NEAR/20 gross", "sym": "aapl"})
        assert r.status_code == 200 and r.json()["scope"]["sym"] == "AAPL" and r.json()["count"] > 0

    def test_a_bad_query_is_a_400_with_the_sentence(self, client, monkeypatch):
        _, c = client
        monkeypatch.setenv("FILING_SEARCH_ENABLED", "1")
        r = c.get("/api/research/filing-search", params={"q": "NOT apple"})
        assert r.status_code == 400 and "exclude from" in r.json()["detail"]

    def test_a_non_ticker_is_refused(self, client, monkeypatch):
        _, c = client
        monkeypatch.setenv("FILING_SEARCH_ENABLED", "1")
        assert c.get("/api/research/filing-search", params={"q": "x", "sym": "A;B"}).status_code == 400

    def test_the_handler_is_sync(self, client):
        route, _ = client
        assert not inspect.iscoroutinefunction(route.filing_search_route)

    def test_the_auth_payload_carries_the_key_only_when_on(self, monkeypatch):
        from api.routers import auth
        monkeypatch.delenv("FILING_SEARCH_ENABLED", raising=False)
        assert "filing_search_enabled" not in auth._research_depth_flags()
        monkeypatch.setenv("FILING_SEARCH_ENABLED", "1")
        assert auth._research_depth_flags().get("filing_search_enabled") is True


def test_the_client_flag_list_mirrors_the_server_tuple():
    """researchDepthFlags.js must name every key auth.py can send."""
    from api.routers import auth
    js = (Path(__file__).resolve().parents[1] / "app" / "src" / "pages" / "research" / "depth"
          / "researchDepthFlags.js").read_text(encoding="utf-8")
    for key, _mod in auth._RESEARCH_DEPTH_SURFACES:
        assert f"'{key}'" in js, key

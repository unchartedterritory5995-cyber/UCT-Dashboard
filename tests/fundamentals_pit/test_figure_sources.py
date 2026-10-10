"""TERM-043 (owner ruling T-13): a quarterly statement figure links to the SEC filing it
appears in, from the PIT store, link only. Dark by default; no SEC or FMP call here."""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services.fundamentals_pit import publish as P, serving, store as S
from api.services.fundamentals_pit.derive import DERIVATION_VERSION
from api.services.research import figure_sources as F

from .test_pipeline import ACCNS, CIK, FACTS, _run

Q1 = ("2023-01-01", "2023-03-31", 100, "0001234567-23-000011", "10-Q", "2023-05-01")
Q1_ACC = ("0001234567-23-000011", "2023-05-01", "2023-05-01T20:00:00.000Z", "10-Q")
Q1_URL = ("https://www.sec.gov/Archives/edgar/data/1234567/000123456723000011/"
          "0001234567-23-000011-index.htm")


@pytest.fixture
def pit(tmp_path, monkeypatch):
    _run(tmp_path, facts=[Q1, *FACTS], accns=[Q1_ACC, *ACCNS])
    monkeypatch.setenv("FUNDAMENTALS_PIT_SOURCE", "db")
    monkeypatch.setenv("FUNDAMENTALS_PIT_DB_PATH", str(tmp_path / "pit.db"))
    monkeypatch.setenv("FUNDAMENTALS_PIT_SERVE", "v4")
    serving.clear_cache()
    yield tmp_path
    serving.clear_cache()


def _history(rev_q1=100.0, rev_q4=130.0):
    return {"sym": "TST", "period": "quarter", "periods": ["Q1 2023", "Q4 2023"],
            "dates": ["2023-03-31", "2023-12-31"], "series": {"revenue": [rev_q1, rev_q4]}}


# ── the artifact: byte-identical unless the worker publishes sources ─────────

def test_artifact_has_no_sources_unless_the_worker_flag_is_set(pit, monkeypatch):
    c = S.connect(str(pit / "pit.db"))
    monkeypatch.delenv(P.SOURCES_ENV, raising=False)
    off = P.artifact(c, CIK, DERIVATION_VERSION)
    assert "sources" not in off
    monkeypatch.setenv(P.SOURCES_ENV, "1")
    on = P.artifact(c, CIK, DERIVATION_VERSION)
    assert {k: v for k, v in on.items() if k != "sources"} == off
    rev = on["sources"]["revenue_q"]
    assert len(rev) == len(on["metrics"]["revenue_q"])                 # index-aligned
    by_pe = {pt[2]: src for pt, src in zip(on["metrics"]["revenue_q"], rev)}
    assert by_pe["2023-03-31"] == ["0001234567-23-000011"]               # read from one 10-Q
    assert len(by_pe["2023-12-31"]) == 2                                  # Q4 = FY - 9M: two filings


# ── matching (pure) ──────────────────────────────────────────────────────────

ART = {"cik": 1234567,
       "metrics": {"revenue_q": [[1, 100.0, "2023-03-31", "reported"], [2, 130.0, "2023-12-31", "q4"]],
                   "eps_diluted_q": [[1, 1.234, "2023-03-31", "reported"]]},
       "sources": {"revenue_q": [["0001234567-23-000011"], ["A-1", "A-2"]],
                   "eps_diluted_q": [["0001234567-23-000011"]]}}


def test_links_only_single_filing_figures_that_match_within_rounding():
    out = F.links_for(ART, ["2023-03-31", "2023-12-31"], {"revenue": [100.2, 130.0]})
    assert out == {"revenue": [Q1_URL, None]}                            # Q4 is derived: no link


def test_a_figure_that_does_not_match_gets_no_link():
    assert F.links_for(ART, ["2023-03-31"], {"revenue": [101.0]}) == {}


def test_eps_matches_to_the_cent_and_a_date_a_few_days_off_still_joins():
    out = F.links_for(ART, ["2023-04-01"], {"eps_diluted": [1.23]})
    assert out == {"eps_diluted": [Q1_URL]}
    assert F.links_for(ART, ["2023-05-15"], {"eps_diluted": [1.23]}) == {}


def test_no_accession_list_means_no_claim():
    art = {**ART, "sources": {}}
    assert F.links_for(art, ["2023-03-31"], {"revenue": [100.0]}) == {}


# ── attach(): the payload ────────────────────────────────────────────────────

def test_attach_is_a_no_op_while_dark(pit, monkeypatch):
    monkeypatch.delenv(F.ENABLED_ENV, raising=False)
    monkeypatch.setenv(P.SOURCES_ENV, "1")
    h = _history()
    assert F.attach(h) is h


def test_attach_adds_links_from_the_pit_store_and_never_mutates_the_cached_payload(pit, monkeypatch):
    monkeypatch.setenv(F.ENABLED_ENV, "1")
    monkeypatch.setenv(P.SOURCES_ENV, "1")
    h = _history()
    snapshot = json.dumps(h, sort_keys=True)
    out = F.attach(h)
    assert out["source_links"] == {"revenue": [Q1_URL, None]}
    assert out["series"] == h["series"]                                   # the shown figure stays FMP's
    assert json.dumps(h, sort_keys=True) == snapshot


def test_attach_without_published_sources_adds_nothing(pit, monkeypatch):
    monkeypatch.setenv(F.ENABLED_ENV, "1")
    monkeypatch.delenv(P.SOURCES_ENV, raising=False)
    h = _history()
    assert "source_links" not in F.attach(h)


def test_attach_skips_annual_and_survives_a_store_failure(pit, monkeypatch):
    monkeypatch.setenv(F.ENABLED_ENV, "1")
    annual = {**_history(), "period": "annual"}
    assert F.attach(annual) is annual

    def boom():
        raise RuntimeError("r2 down")
    monkeypatch.setattr(serving, "current_source", boom)
    h = _history()
    assert F.attach(h) is h


def test_the_route_carries_links_only_when_armed(pit, monkeypatch):
    from api.routers import research as R
    from api.services.research import financial_history as fh
    monkeypatch.setattr(fh, "get_history", lambda sym, period="quarter": _history())
    monkeypatch.setenv(P.SOURCES_ENV, "1")
    app = FastAPI()
    app.include_router(R.router)
    c = TestClient(app)
    monkeypatch.delenv(F.ENABLED_ENV, raising=False)
    assert "source_links" not in c.get("/api/research/financial-history/TST").json()
    monkeypatch.setenv(F.ENABLED_ENV, "1")
    body = c.get("/api/research/financial-history/TST").json()
    assert body["source_links"]["revenue"] == [Q1_URL, None]

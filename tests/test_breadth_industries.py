"""Tests for the universe industry map behind the breadth "group by industry"
drill view, plus the POST /api/breadth/industries endpoint.

The Finviz bulk fetch is stubbed — no network. Verifies the map seeds from a
bulk source, classifies the whole list, returns None + warms a fallback for
stragglers, and never blocks on the request path.
"""
import os
import tempfile
from unittest import mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import industry_map as im
from tests.authclients import PAID_MEMBER, authorize


FAKE_FINVIZ = [
    {"Ticker": "NVDA", "Company": "NVIDIA Corp", "Sector": "Technology", "Industry": "Semiconductors"},
    {"Ticker": "AMD", "Company": "Advanced Micro Devices", "Sector": "Technology", "Industry": "Semiconductors"},
    {"Ticker": "XOM", "Company": "Exxon Mobil", "Sector": "Energy", "Industry": "Oil & Gas Integrated"},
    {"Ticker": "", "Company": "junk row", "Sector": "X", "Industry": "Y"},  # skipped
]


@pytest.fixture
def imap(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(im, "_DB_PATH", os.path.join(d, "industry_map.db"))
        monkeypatch.setattr(im, "_INIT_DONE", False)
        monkeypatch.setattr(im, "_LAST_REFRESH_AT", 0.0)
        # Stub the bulk source + fallback so nothing hits the network.
        monkeypatch.setattr(im, "_fetch_finviz_universe", lambda: list(FAKE_FINVIZ))
        monkeypatch.setattr(im, "_maybe_self_heal", lambda: None)
        im._init_db()
        yield im


def test_bulk_refresh_seeds_map(imap):
    n = imap.bulk_refresh_from_finviz()
    assert n == 3  # junk empty-ticker row skipped
    assert imap._count() == 3


def test_get_industries_classifies_from_map(imap):
    imap.bulk_refresh_from_finviz()
    out = imap.get_industries(["NVDA", "AMD", "XOM"])
    assert out == {
        "NVDA": "Semiconductors",
        "AMD": "Semiconductors",
        "XOM": "Oil & Gas Integrated",
    }


def test_miss_returns_none_and_enqueues_fallback(imap, monkeypatch):
    imap.bulk_refresh_from_finviz()
    enq = []
    monkeypatch.setattr(imap, "_enqueue_fallback", lambda t: enq.append(t))
    out = imap.get_industries(["NVDA", "ZZZZ"])
    assert out["NVDA"] == "Semiconductors"
    assert out["ZZZZ"] is None
    assert enq == ["ZZZZ"]


def test_request_path_does_not_block(imap, monkeypatch):
    imap.bulk_refresh_from_finviz()
    calls = []
    monkeypatch.setattr(imap, "_fetch_fallback",
                        lambda t: calls.append(t) or (None, None, None))
    monkeypatch.setattr(imap, "_enqueue_fallback", lambda t: None)  # don't spawn pool
    imap.get_industries(["COLD"])
    assert calls == []  # no synchronous fetch on the request path


def test_uppercases_and_dedupes(imap):
    imap.bulk_refresh_from_finviz()
    out = imap.get_industries(["nvda", "NVDA", ""])
    assert out == {"NVDA": "Semiconductors"}


def test_prewarm_bulk_loads_when_empty(imap, monkeypatch):
    # prewarm() gained a second phase (warm_universe_gaps) that walks the
    # ~3.7k-ticker cap_universe and resolves every Finviz miss through the LIVE
    # per-ticker fallback with a 0.4s sleep between calls. Unstubbed, this one
    # test fired ~1450 real yfinance/Finnhub requests, ran for ~10 minutes, and
    # left 1453 rows instead of 3. Gap-warming has its own test below
    # (test_warm_universe_gaps_fills_finviz_misses) -- here we assert only that
    # prewarm performs the Finviz bulk load when the map is empty.
    monkeypatch.setattr(imap, "warm_universe_gaps", lambda *a, **k: 0)
    assert imap._count() == 0
    imap.prewarm()
    assert imap._count() == 3


def test_fallback_persists_industry(imap, monkeypatch):
    imap.bulk_refresh_from_finviz()
    monkeypatch.setattr(imap, "_fetch_fallback",
                        lambda t: ("Healthcare", "Biotechnology", "yfinance"))
    # Run the fallback job inline rather than via the pool.
    monkeypatch.setattr(imap._FALLBACK_POOL, "submit", lambda fn: fn())
    imap._enqueue_fallback("NEWCO")
    assert imap.get_industries(["NEWCO"])["NEWCO"] == "Biotechnology"


# ── FMP `stable/profile` migration (2026-08-05, plan Task 8) ─────────────────
# _fetch_fallback now tries yfinance -> FMP stable/profile -> Finnhub profile2
# (last resort), instead of yfinance -> Finnhub directly.

def test_fetch_fallback_tries_fmp_before_finnhub(imap, monkeypatch):
    """FMP is the new PRIMARY of the two remaining legs: when yfinance has
    nothing, FMP resolving both sector+industry means Finnhub is never called."""
    def _fh_should_not_be_called(*a, **k):
        raise AssertionError("Finnhub must not be reached when FMP resolves")

    with mock.patch("yfinance.Ticker") as YF, \
         mock.patch.object(imap, "_fmp_profile_row",
                           return_value={"sector": "Technology", "industry": "Semiconductors"}), \
         mock.patch("api.services.finnhub_client.fh_get", side_effect=_fh_should_not_be_called):
        YF.return_value.info = {}  # yfinance has nothing -> falls to FMP
        sec, ind, src = imap._fetch_fallback("NEWCO")
    assert (sec, ind, src) == ("Technology", "Semiconductors", "fmp")


def test_fetch_fallback_falls_through_to_finnhub_when_fmp_has_no_industry(imap, monkeypatch):
    """FMP returning a row without an industry (e.g. sector-only, or no row at
    all) must fall through to the Finnhub leg -- never fabricate an industry."""
    with mock.patch("yfinance.Ticker") as YF, \
         mock.patch.object(imap, "_fmp_profile_row", return_value={"sector": "Technology"}), \
         mock.patch("api.services.finnhub_client.fh_get",
                    return_value={"finnhubIndustry": "Semiconductors"}):
        YF.return_value.info = {}
        sec, ind, src = imap._fetch_fallback("NEWCO")
    assert (sec, ind, src) == (None, "Semiconductors", "finnhub")


def test_fetch_fallback_fmp_none_row_yields_none_not_fabricated(imap, monkeypatch):
    """`_fmp_profile_row` returning None entirely (no FMP_API_KEY, or a clean
    miss) must not raise and must not fabricate a placeholder industry."""
    with mock.patch("yfinance.Ticker") as YF, \
         mock.patch.object(imap, "_fmp_profile_row", return_value=None), \
         mock.patch("api.services.finnhub_client.fh_get", return_value=None):
        YF.return_value.info = {}
        sec, ind, src = imap._fetch_fallback("ZZZZ")
    assert (sec, ind, src) == (None, None, None)


# ── C26 clobber-guard regression: weekly bulk refresh must never overwrite a
# good sector/industry with a NULL from a partial FMP/Finviz row ────────────

def test_upsert_coalesce_preserves_existing_sector_on_null_overwrite(imap):
    """THE clobber bug (cache-poison audit C26): a second write for the same
    ticker with sector/industry=None (e.g. a Finviz row that doesn't classify
    it, or a partial per-ticker fallback) must NOT blank out a previously-good
    value. `_upsert_many`'s ON CONFLICT clause must COALESCE, not overwrite."""
    imap._upsert_many([("NEWCO", "Healthcare", "Biotechnology", "yfinance", 100)])
    assert imap.get_industries(["NEWCO"])["NEWCO"] == "Biotechnology"
    assert imap.get_groups(["NEWCO"])["NEWCO"] == {"sector": "Healthcare", "industry": "Biotechnology"}

    # A later write for the SAME ticker with NULL sector/industry (source
    # changed to "finviz", but the row didn't classify it) must preserve the
    # prior good values, only bumping source/fetched_at.
    imap._upsert_many([("NEWCO", None, None, "finviz", 200)])

    assert imap.get_industries(["NEWCO"])["NEWCO"] == "Biotechnology"
    groups = imap.get_groups(["NEWCO"])["NEWCO"]
    assert groups == {"sector": "Healthcare", "industry": "Biotechnology"}


def test_upsert_coalesce_still_applies_a_real_replacement_value(imap):
    """Control direction for the COALESCE test above: a NON-null new value
    still overwrites the old one (COALESCE only protects against NULL, it
    doesn't pin the first-ever value forever)."""
    imap._upsert_many([("NEWCO", "Healthcare", "Biotechnology", "yfinance", 100)])
    imap._upsert_many([("NEWCO", "Technology", "Biotech Tools", "finviz", 200)])
    assert imap.get_groups(["NEWCO"])["NEWCO"] == {"sector": "Technology", "industry": "Biotech Tools"}


def test_status_shape(imap):
    imap.bulk_refresh_from_finviz()
    s = imap.status()
    assert s["rows"] == 3
    assert s["stale"] is False


def test_get_groups_returns_both_dims(imap):
    imap.bulk_refresh_from_finviz()
    out = imap.get_groups(["NVDA", "XOM", "ZZZZ"])
    assert out["NVDA"] == {"sector": "Technology", "industry": "Semiconductors"}
    assert out["XOM"] == {"sector": "Energy", "industry": "Oil & Gas Integrated"}
    assert out["ZZZZ"] == {"sector": None, "industry": None}


def test_warm_universe_gaps_fills_finviz_misses(imap, monkeypatch, tmp_path):
    imap.bulk_refresh_from_finviz()  # seeds NVDA/AMD/XOM
    # cap_universe includes a name Finviz didn't cover.
    uni = tmp_path / "cap_universe.json"
    uni.write_text('["NVDA", "AMD", "XOM", "BK"]')
    monkeypatch.setattr(imap, "_cap_universe_path", lambda: str(uni))
    monkeypatch.setattr(imap, "_fetch_fallback",
                        lambda t: ("Financial Services", "Banks - Diversified", "yfinance"))
    filled = imap.warm_universe_gaps(sleep_s=0)
    assert filled == 1  # only BK was missing
    assert imap.get_industries(["BK"])["BK"] == "Banks - Diversified"


def test_warm_universe_gaps_noop_when_complete(imap, monkeypatch, tmp_path):
    imap.bulk_refresh_from_finviz()
    uni = tmp_path / "cap_universe.json"
    uni.write_text('["NVDA", "AMD", "XOM"]')  # all already classified
    monkeypatch.setattr(imap, "_cap_universe_path", lambda: str(uni))
    called = []
    monkeypatch.setattr(imap, "_fetch_fallback", lambda t: called.append(t) or (None, None, None))
    assert imap.warm_universe_gaps(sleep_s=0) == 0
    assert called == []


# ── Endpoint ────────────────────────────────────────────────────────────────

@pytest.fixture
def client(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(im, "_DB_PATH", os.path.join(d, "industry_map.db"))
        monkeypatch.setattr(im, "_INIT_DONE", False)
        monkeypatch.setattr(im, "_maybe_self_heal", lambda: None)
        monkeypatch.setattr(im, "_enqueue_fallback", lambda t: None)
        im._init_db()
        from api.routers import breadth_monitor
        app = FastAPI()
        app.include_router(breadth_monitor.router)
        # `POST /api/breadth/industries` + `/industries/status` are
        # `require_paid` since the 2026-08-09 auth sweep. This app is built here
        # rather than imported, so it needs the caller installed on it directly
        # — the identity, never the gate, so the real `require_paid` still runs.
        authorize(app, PAID_MEMBER)
        yield TestClient(app)


def test_endpoint_shape(client):
    im._upsert_many([("MSFT", "Technology", "Software - Infrastructure", "finviz", 1)])
    r = client.post("/api/breadth/industries", json={"tickers": ["MSFT", "NOPE"]})
    assert r.status_code == 200
    body = r.json()
    assert body["industries"]["MSFT"] == "Software - Infrastructure"
    assert body["industries"]["NOPE"] is None
    # sectors map returned alongside for the dimension toggle
    assert body["sectors"]["MSFT"] == "Technology"
    assert body["sectors"]["NOPE"] is None


def test_endpoint_caps_at_500(client):
    r = client.post("/api/breadth/industries", json={"tickers": [f"T{i}" for i in range(900)]})
    assert r.status_code == 200
    assert len(r.json()["industries"]) == 500


def test_endpoint_bad_body(client):
    r = client.post("/api/breadth/industries", json={"tickers": "notalist"})
    assert r.status_code == 400


def test_status_endpoint(client):
    im._upsert_many([("AAPL", "Technology", "Consumer Electronics", "finviz", 1)])
    r = client.get("/api/breadth/industries/status")
    assert r.status_code == 200
    assert r.json()["rows"] == 1

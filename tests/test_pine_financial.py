"""Track 4, unit F1a: `api/services/pine_financial.py` and `GET /api/pine/financial/{ticker}`.

What must hold, each with a test that goes red when it breaks:
  * a request is never a store read: a cold symbol answers `pending` and queues ONE background refresh;
  * POINT IN TIME: a value is known from the first session whose close is at or after its filing's PUBLIC instant,
    never its fiscal period end; an after-close filing, a holiday and a half-day close all land it later, never
    earlier; `staleFrom` is the store's staleness cap; a GAP is unknown (null), never the older value carried;
  * the map is the catalog's (`pineDataCatalog.json` `financial.fields`), each entry a series the store derives;
  * per-share and share-count figures are withheld while the company's split history is unverified;
  * a store failure keeps the previous copy, marked `unavailable` with `staleSince`, never an empty answer;
  * the family is read only when the licence catalog passes it; the disclosure says UCT data, not TradingView's;
  * the snapshot is atomic; the stage is dark for members (404), admins by default, paid at `all`, nobody at `off`
    or a typo.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import pine_financial as route
from api.services import pine_financial as pf

ET = ZoneInfo("America/New_York")


def et(y, m, d, hh, mm=0) -> int:
    return int(datetime(y, m, d, hh, mm, tzinfo=ET).timestamp())


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("PINE_FINANCIAL_DIR", str(tmp_path / "pine_financial"))
    monkeypatch.delenv("PINE_FINANCIAL_SUPPLY_ENABLED", raising=False)
    pf._MEM.clear()
    with pf._INFLIGHT_LOCK:
        pf._INFLIGHT.clear()
    yield
    pf._MEM.clear()


# 10-Q public 2024-08-01 16:30 ET (after the close: known 08-02), 10-K public 2024-11-01 06:00 ET (known that day)
REV_Q = [[et(2024, 8, 1, 16, 30), 8.58e10, "2024-06-29", "direct"],
         [et(2024, 11, 1, 6, 0), 9.49e10, "2024-09-28", "derived"]]
EPS_Q = [[et(2024, 8, 1, 16, 30), 1.40, "2024-06-29", "direct"]]


@pytest.fixture
def store(monkeypatch):
    """A synthetic store read in the artifact's shapes; every read counted."""
    calls = {"n": 0}
    state = {"company": {"cik": 320193, "name": "Apple Inc.", "builtAt": 1.0, "splitStatus": "verified",
                         "withheldSplitSensitive": False},
             "metrics": {"revenue_q": REV_Q, "eps_diluted_q": EPS_Q},
             "source": {"store": "fundamentals_pit", "derivationVersion": 4, "serving": "v4"}}

    def read_store(sym):
        calls["n"] += 1
        return json.loads(json.dumps(state))
    monkeypatch.setattr(pf, "_read_store", read_store)
    monkeypatch.setattr(pf, "_refusal", lambda: None)
    calls["state"] = state
    return calls


def test_a_cold_symbol_answers_pending_and_queues_one_refresh_never_a_store_read(store, monkeypatch):
    queued = []
    monkeypatch.setattr(pf._POOL, "submit", lambda fn: queued.append(fn))
    a = pf.read("AAPL")
    b = pf.read("AAPL")
    assert a["state"] == "pending" and b["state"] == "pending"
    assert len(queued) == 1, "a second read of the same symbol must not queue a second refresh"
    assert store["n"] == 0, "a request read the store"
    queued[0]()
    c = pf.read("AAPL")
    assert c["state"] == "ready" and store["n"] == 1


def test_known_from_is_the_fiscal_period_end_session_and_published_from_the_filings(store):
    """⭐ e99 PLACEMENT (coordinator ruling 2026-11-26): the Pine supply places a value at its fiscal period end, as
    TradingView does; the filing's own session stays on the point as `publishedFrom` (and its instant as `publicAt`)."""
    f = pf.refresh("AAPL")["fields"]["TOTAL_REVENUE:FQ"]
    assert f["state"] == "ok" and f["series"] == "revenue_q" and f["unit"] == "usd"
    p0, p1 = f["points"]
    assert p0["periodEnd"] == "2024-06-29"
    # the quarter ended Saturday 2024-06-29: the last session on or before the month end (Sunday 06-30) is Friday 06-28
    assert p0["knownFrom"] == "2024-06-28" and p1["knownFrom"] == "2024-09-30"
    assert f["knownFrom"] == "2024-06-28"
    assert p0["publishedFrom"] == "2024-08-02", "a filing public after the close was published to the NEXT session"
    assert p1["publishedFrom"] == "2024-11-01", "a filing public before the close was published that session"
    assert p0["publicAt"] == et(2024, 8, 1, 16, 30)


@pytest.mark.parametrize("public,want", [
    (et(2024, 8, 1, 15, 59), "2024-08-01"),     # before the close
    (et(2024, 8, 1, 16, 0), "2024-08-01"),      # at the close: known by the close
    (et(2024, 8, 1, 16, 1), "2024-08-02"),      # after it
    (et(2024, 8, 2, 18, 0), "2024-08-05"),      # Friday evening -> Monday
    (et(2024, 3, 29, 10, 0), "2024-04-01"),     # Good Friday: EDGAR open, the exchange closed
    (et(2024, 11, 29, 14, 0), "2024-12-02"),    # a half-day closes 13:00: 14:00 is after it
    (et(2024, 11, 29, 12, 0), "2024-11-29"),    # ... and 12:00 before it
])
def test_known_from_uses_the_exchange_close(public, want):
    assert pf.known_from(public) == want


def test_stale_from_is_the_store_cap_and_a_gap_is_unknown_never_carried(store):
    store["state"]["metrics"]["revenue_q"] = [
        [et(2024, 2, 2, 6, 0), None, "2023-12-30", "gap"],            # a leading gap is not a value
        *REV_Q,
        [et(2025, 2, 1, 6, 0), None, "2024-12-28", "gap"]]
    f = pf.refresh("AAPL")["fields"]["TOTAL_REVENUE:FQ"]
    assert f["knownFrom"] == "2024-06-28", "the field is known from its first VALUE, not a leading gap"
    assert [p["method"] for p in f["points"]] == ["direct", "derived", "gap"]
    gap = f["points"][-1]
    assert gap["v"] is None and gap["staleFrom"] is None
    # asof.MAX_PERIOD_AGE = 200 days: in force while (bar day - period end) <= 200
    assert f["points"][0]["staleFrom"] == "2025-01-16"


def test_the_v5_period_end_shape_reads_too(store):
    store["state"]["metrics"]["revenue_ttm"] = [[et(2024, 8, 1, 10, 0), 3.85e11, 20240629, "derived"]]
    f = pf.refresh("AAPL")["fields"]["TOTAL_REVENUE:TTM"]
    assert f["points"][0]["periodEnd"] == "2024-06-29" and f["knownFrom"] == "2024-06-28"


def test_a_figure_the_filings_do_not_yield_is_missing_by_name(store):
    f = pf.refresh("AAPL")["fields"]["FREE_CASH_FLOW:TTM"]
    assert f["state"] == "missing" and f["points"] == [] and f["knownFrom"] is None and f["why"]


def test_per_share_and_share_counts_are_withheld_while_splits_are_unverified(store):
    store["state"]["company"]["withheldSplitSensitive"] = True
    store["state"]["metrics"]["shares_outstanding"] = [[et(2024, 8, 1, 10, 0), 1.5e10, "2024-07-19", "direct"]]
    f = pf.refresh("AAPL")["fields"]
    assert f["EARNINGS_PER_SHARE_DILUTED:FQ"]["state"] == "withheld"
    assert f["TOTAL_SHARES_OUTSTANDING:FQ"]["state"] == "withheld"
    assert f["TOTAL_REVENUE:FQ"]["state"] == "ok", "revenue is not split-sensitive"


def test_a_symbol_with_no_sec_company_is_none(store):
    store["state"].update({"company": None, "metrics": {}})
    doc = pf.refresh("SPY")
    assert doc["familyState"] == "none"
    assert {f["state"] for f in doc["fields"].values()} == {"none"}


def test_a_store_failure_keeps_the_previous_copy_by_name(store, monkeypatch):
    pf.refresh("AAPL", now=1_000)

    def boom(sym):
        raise RuntimeError("store down")
    monkeypatch.setattr(pf, "_read_store", boom)
    doc = pf.refresh("AAPL", now=2_000)
    assert doc["familyState"] == "unavailable" and doc["staleSince"] == 1_000 and doc["error"] == "RuntimeError"
    assert doc["fields"]["TOTAL_REVENUE:FQ"]["points"], "the kept copy lost its values"
    assert pf._read_disk("AAPL")["familyState"] == "unavailable"


def test_a_store_failure_with_no_copy_is_unavailable_not_empty_values(store, monkeypatch):
    monkeypatch.setattr(pf, "_read_store", lambda sym: (_ for _ in ()).throw(TimeoutError()))
    doc = pf.refresh("MU")
    assert doc["familyState"] == "unavailable" and doc["fields"] == {}


def test_an_unavailable_copy_is_retried_soon_not_only_after_the_ttl(store, monkeypatch):
    monkeypatch.setattr(pf, "_read_store", lambda sym: (_ for _ in ()).throw(TimeoutError()))
    pf.refresh("MU", now=1_000)
    kicked = []
    monkeypatch.setattr(pf, "kick", lambda sym: kicked.append(sym) or True)
    assert pf.read("MU", now=1_030)["refreshing"] is False
    assert pf.read("MU", now=1_100)["refreshing"] is True and kicked == ["MU"]


def test_a_refused_family_is_never_read(store, monkeypatch):
    monkeypatch.setattr(pf, "_refusal", lambda: {"guard": "pine-data:licence", "sentence": "Not served."})
    doc = pf.refresh("AAPL")
    assert doc["familyState"] == "refused" and doc["refusal"]["guard"] == "pine-data:licence"
    assert store["n"] == 0


def test_the_live_catalog_passes_financial_and_says_uct_data():
    """Not mocked: the committed catalog and the live licensing table serve the family, in the member's words."""
    assert pf._refusal() is None
    said = pf._disclosure()
    assert said.startswith("Financial figures are UCT data from company filings") and said.endswith("not TradingView's.")
    assert "placed at the fiscal period end, as TradingView does" in said and said.count(pf.placement()) == 1


def test_the_map_is_the_catalogs_twelve_pairs_each_a_stored_series_or_a_fiscal_year_view_of_one():
    from api.services.fundamentals_pit import catalog as C
    got = pf.field_map()
    assert {k: v["series"] for k, v in got.items()} == {
        "TOTAL_REVENUE:FQ": "revenue_q", "TOTAL_REVENUE:TTM": "revenue_ttm",
        "EARNINGS_PER_SHARE_DILUTED:FQ": "eps_diluted_q", "EARNINGS_PER_SHARE_DILUTED:TTM": "eps_diluted_ttm",
        "TOTAL_EQUITY:FQ": "equity", "TOTAL_SHARES_OUTSTANDING:FQ": "shares_outstanding",
        "FREE_CASH_FLOW:TTM": "fcf_ttm",
        # e99 FY — a fiscal-year VIEW of a stored series (pine_financial.fy_view_rows; the V5 methodology is frozen)
        "TOTAL_REVENUE:FY": "revenue_ttm@fy", "EARNINGS_PER_SHARE_DILUTED:FY": "eps_diluted_ttm@fy",
        "TOTAL_EQUITY:FY": "equity@fy", "TOTAL_SHARES_OUTSTANDING:FY": "shares_outstanding@fy",
        "FREE_CASH_FLOW:FY": "fcf_ttm@fy"}
    stored = C.stored_series_ids()
    for key, spec in got.items():
        base = pf.fy_base(spec["series"]) or spec["series"]
        assert base in stored, f"{key} names {spec['series']}, which the store does not derive"
        # a view is the fiscal year only, and of the field's own stored figure
        assert (pf.fy_base(spec["series"]) is not None) == (spec["period"] == "FY"), key
    # the unit is the store catalogue's own for that series (a view's: its stored series')
    unit_of = {m.series: m.unit for m in C.V1 if m.series}
    for key, spec in got.items():
        assert spec["unit"] == unit_of[pf.fy_base(spec["series"]) or spec["series"]], key


def test_the_real_store_read_through_serving(tmp_path, monkeypatch):
    """Not mocked below `_read_store`: a V4 artifact laid out as the publisher writes it, read by serving."""
    from api.services.fundamentals_pit import publish as P
    from api.services.fundamentals_pit import serving
    root = tmp_path / "art"
    P._put_local(str(root), P.index_key(), json.dumps({"tickers": {"AAPL": 320193}}).encode())
    P._put_local(str(root), P.key_for(320193), json.dumps({
        "v": 1, "cik": 320193, "tickers": ["AAPL"], "name": "Apple Inc.", "built_at": 5.0, "split_status": "verified",
        "withheld_split_sensitive": False, "metrics": {"revenue_q": REV_Q}}).encode())
    monkeypatch.setenv("FUNDAMENTALS_PIT_SOURCE", "local")
    monkeypatch.setenv("FUNDAMENTALS_PIT_ARTIFACT_DIR", str(root))
    monkeypatch.setenv("FUNDAMENTALS_PIT_SERVE", "v4")
    serving.clear_cache()
    try:
        doc = pf.refresh("AAPL")
    finally:
        serving.clear_cache()
    assert doc["familyState"] == "ok" and doc["company"]["cik"] == 320193
    assert doc["fields"]["TOTAL_REVENUE:FQ"]["knownFrom"] == "2024-06-28"
    assert doc["source"]["serving"] == "v4"


def test_a_stale_copy_is_served_and_kicks_a_refresh(store, monkeypatch):
    pf.refresh("AAPL", now=1_000)
    kicked = []
    monkeypatch.setattr(pf, "kick", lambda sym: kicked.append(sym) or True)
    r = pf.read("AAPL", now=1_000 + pf.TTL_S + 1)
    assert r["state"] == "ready" and r["refreshing"] is True and kicked == ["AAPL"]
    r = pf.read("AAPL", now=1_000 + 10)
    assert r["refreshing"] is False and kicked == ["AAPL"]


def test_the_snapshot_is_written_atomically(store, monkeypatch):
    pf.refresh("AAPL", now=1_000)
    path = pf._path("AAPL")
    before = open(path, "rb").read()

    def bad_dump(*a, **k):
        raise OSError("disk full")
    monkeypatch.setattr(pf.json, "dump", bad_dump)
    with pytest.raises(OSError):
        pf.refresh("AAPL", now=2_000)
    assert open(path, "rb").read() == before, "a failed write tore the snapshot"
    assert [n for n in os.listdir(os.path.dirname(path)) if n.endswith(".tmp")] == []


def test_a_snapshot_survives_a_restart(store):
    pf.refresh("AAPL", now=time.time())
    pf._MEM.clear()
    assert pf.read("AAPL")["state"] == "ready"


def test_the_file_name_is_safe_for_any_ticker():
    assert os.path.basename(pf._path("BRK.B")) == "s-BRK_2EB.json"
    assert os.path.basename(pf._path("CON")) == "s-CON.json"


@pytest.mark.parametrize("value,want", [(None, "admins"), ("", "admins"), ("admins", "admins"), ("all", "all"),
                                        ("1", "all"), ("on", "all"), ("off", "off"), ("al", "off")])
def test_the_stage(monkeypatch, value, want):
    if value is None:
        monkeypatch.delenv("PINE_FINANCIAL_SUPPLY_ENABLED", raising=False)
    else:
        monkeypatch.setenv("PINE_FINANCIAL_SUPPLY_ENABLED", value)
    assert pf.stage() == want


# ── the route ───────────────────────────────────────────────────────────────────────────────────────────────────
def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    app.dependency_overrides[route.require_paid] = lambda: user
    return TestClient(app)


MEMBER = {"id": "m", "role": "member", "plan": "pro"}
ADMIN = {"id": "a", "role": "admin", "plan": "pro"}


def test_dark_by_default_a_member_gets_404_an_admin_gets_the_answer(store):
    pf.refresh("AAPL")
    assert _client(MEMBER).get("/api/pine/financial/AAPL").status_code == 404
    r = _client(ADMIN).get("/api/pine/financial/AAPL")
    assert r.status_code == 200 and r.json()["fields"]["TOTAL_REVENUE:FQ"]["knownFrom"] == "2024-06-28"


def test_at_all_every_paid_member_and_at_off_nobody(store, monkeypatch):
    pf.refresh("AAPL")
    monkeypatch.setenv("PINE_FINANCIAL_SUPPLY_ENABLED", "all")
    assert _client(MEMBER).get("/api/pine/financial/AAPL").status_code == 200
    monkeypatch.setenv("PINE_FINANCIAL_SUPPLY_ENABLED", "off")
    assert _client(ADMIN).get("/api/pine/financial/AAPL").status_code == 404


def test_pending_is_202_with_retry_after(store, monkeypatch):
    monkeypatch.setattr(pf._POOL, "submit", lambda fn: None)
    r = _client(ADMIN).get("/api/pine/financial/MSFT")
    assert r.status_code == 202 and r.headers["retry-after"] == "5" and r.json()["state"] == "pending"


def test_an_unpaid_member_is_402(monkeypatch):
    monkeypatch.setattr(route, "is_paid_user", lambda u: False)
    with pytest.raises(Exception) as e:
        route.require_paid({"id": "f", "role": "member", "plan": "free"})
    assert getattr(e.value, "status_code", None) == 402


def test_a_non_ticker_is_400(store):
    assert _client(ADMIN).get("/api/pine/financial/%20%3B").status_code == 400

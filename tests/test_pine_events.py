"""Track 4, unit E1: `api/services/pine_events.py` and `GET /api/pine/events/{ticker}`.

What must hold, each with a test that goes red when it breaks:
  * a request is never a vendor call: a cold symbol answers `pending` and queues ONE background refresh;
  * the snapshot is written atomically (a failed write leaves the previous file and no temp file);
  * a vendor failure keeps the previous copy, marked `unavailable` with `staleSince`, never an empty list;
  * a family the licence catalog refuses is never fetched and answers its guard and sentence;
  * the shapes: earnings only once reported; dividends as declared; splits numerator = new, denominator = old;
    `knownFrom` = the first held event, `null` when the vendor holds none;
  * the stage: dark for members (404), admins by default, everyone paid at `all`, nobody at `off` or a typo.
"""
from __future__ import annotations

import json
import os
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import pine_events as route
from api.services import pine_events as pe


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("PINE_EVENTS_DIR", str(tmp_path / "pine_events"))
    monkeypatch.delenv("PINE_EVENTS_SUPPLY_ENABLED", raising=False)
    pe._MEM.clear()
    with pe._INFLIGHT_LOCK:
        pe._INFLIGHT.clear()
    yield
    pe._MEM.clear()


@pytest.fixture
def vendors(monkeypatch):
    """Synthetic vendors in the shapes the real readers return; every call counted."""
    calls = {"earnings": 0, "dividends": 0, "splits": 0}

    def earnings(sym):
        calls["earnings"] += 1
        return {"rows": [{"date": "2024-05-22", "actual": 6.12, "estimate": 5.59},
                         {"date": "2024-08-28", "actual": 0.68, "estimate": 0.65}],
                "basis": "vendor"}

    def dividends(sym):
        calls["dividends"] += 1
        return {"rows": [{"exDate": "2020-02-07", "gross": 0.77, "type": "CD", "currency": "USD", "frequency": 4}],
                "basis": "as declared"}

    def splits(sym):
        calls["splits"] += 1
        return {"rows": [{"date": "2024-06-10", "numerator": 10.0, "denominator": 1.0}]}

    monkeypatch.setattr(pe, "FETCHERS", {"earnings": earnings, "dividends": dividends, "splits": splits})
    monkeypatch.setattr(pe, "_refusal", lambda fam: None)
    monkeypatch.setattr(pe, "_disclosure", lambda fam: f"{fam} are UCT data")
    return calls


def test_a_cold_symbol_answers_pending_and_queues_one_refresh_never_a_vendor_call(vendors, monkeypatch):
    queued = []
    monkeypatch.setattr(pe._POOL, "submit", lambda fn: queued.append(fn))
    a = pe.read("NVDA")
    b = pe.read("NVDA")
    assert a["state"] == "pending" and b["state"] == "pending"
    assert len(queued) == 1, "a second read of the same symbol must not queue a second refresh"
    assert vendors == {"earnings": 0, "dividends": 0, "splits": 0}, "a request made a vendor call"
    queued[0]()                                    # the background lane runs it
    c = pe.read("NVDA")
    assert c["state"] == "ready" and sum(vendors.values()) == 3


def test_the_shapes_and_knownFrom(vendors):
    doc = pe.refresh("NVDA", now=1_800_000_000)
    f = doc["families"]
    assert f["earnings"]["knownFrom"] == "2024-05-22" and f["earnings"]["state"] == "ok"
    assert f["dividends"]["rows"][0]["gross"] == 0.77 and f["dividends"]["basis"] == "as declared"
    assert f["splits"]["rows"][0] == {"date": "2024-06-10", "numerator": 10.0, "denominator": 1.0}
    assert all(f[k]["disclosure"] for k in pe.FAMILIES)


def test_the_real_readers_orient_splits_and_drop_unreported_earnings(monkeypatch):
    from api.services import reference_corp_actions as rca
    from api.services import fmp_client

    class R:
        def __init__(self, v):
            self.value = v
    monkeypatch.setattr(fmp_client, "get_earnings", lambda sym, limit, timeout: R([
        {"date": "2024-05-22", "epsActual": 6.12, "epsEstimated": 5.59},
        {"date": "2026-12-01", "epsActual": None, "epsEstimated": 1.0}]))     # scheduled, not an event
    monkeypatch.setattr(rca, "fetch_ticker_splits", lambda sym: [
        {"execution_date": "2021-08-02", "split_from": 8, "split_to": 1},        # GE's reverse split
        {"execution_date": "2024-06-10", "split_from": 1, "split_to": 10}])
    monkeypatch.setattr(rca, "fetch_ticker_dividends", lambda sym: [
        {"ex_dividend_date": "2020-02-07", "cash_amount": 0.77, "dividend_type": "CD", "currency": "USD",
         "frequency": 4}])
    e = pe._fetch_earnings("X")["rows"]
    s = pe._fetch_splits("X")["rows"]
    d = pe._fetch_dividends("X")["rows"]
    assert e == [{"date": "2024-05-22", "actual": 6.12, "estimate": 5.59}]
    assert s == [{"date": "2021-08-02", "numerator": 1.0, "denominator": 8.0},
                 {"date": "2024-06-10", "numerator": 10.0, "denominator": 1.0}]
    assert d[0]["gross"] == 0.77


def test_a_family_the_vendor_holds_none_of_has_no_knownFrom(vendors, monkeypatch):
    monkeypatch.setitem(pe.FETCHERS, "splits", lambda sym: {"rows": []})
    f = pe.refresh("AAPL")["families"]["splits"]
    assert f["state"] == "empty" and f["knownFrom"] is None


def test_a_vendor_failure_keeps_the_previous_copy_by_name(vendors, monkeypatch):
    pe.refresh("NVDA", now=1_000)

    def boom(sym):
        raise RuntimeError("vendor down")
    monkeypatch.setitem(pe.FETCHERS, "dividends", boom)
    f = pe.refresh("NVDA", now=2_000)["families"]["dividends"]
    assert f["state"] == "unavailable" and f["staleSince"] == 1_000 and f["rows"], f
    assert f["error"] == "RuntimeError"


def test_a_vendor_failure_with_no_copy_is_unavailable_not_empty(vendors, monkeypatch):
    monkeypatch.setitem(pe.FETCHERS, "earnings", lambda sym: (_ for _ in ()).throw(TimeoutError()))
    f = pe.refresh("MU")["families"]["earnings"]
    assert f["state"] == "unavailable" and f["rows"] == []


def test_a_refused_family_is_never_fetched(vendors, monkeypatch):
    monkeypatch.setattr(pe, "_refusal", lambda fam: {"guard": "pine-data:licence", "sentence": "Not served."}
                        if fam == "earnings" else None)
    f = pe.refresh("NVDA")["families"]
    assert f["earnings"]["state"] == "refused" and f["earnings"]["refusal"]["guard"] == "pine-data:licence"
    assert vendors["earnings"] == 0 and vendors["dividends"] == 1


def test_the_live_catalog_passes_all_three_families():
    """Not mocked: the committed catalog and the live licensing table serve earnings, dividends and splits."""
    for fam in pe.FAMILIES:
        assert pe._refusal(fam) is None, fam
        assert "UCT" in pe._disclosure(fam)


def test_a_stale_copy_is_served_and_kicks_a_refresh(vendors, monkeypatch):
    pe.refresh("NVDA", now=1_000)
    kicked = []
    monkeypatch.setattr(pe, "kick", lambda sym: kicked.append(sym) or True)
    r = pe.read("NVDA", now=1_000 + pe.TTL_S + 1)
    assert r["state"] == "ready" and r["refreshing"] is True and kicked == ["NVDA"]
    r = pe.read("NVDA", now=1_000 + 10)
    assert r["refreshing"] is False and kicked == ["NVDA"]


def test_the_snapshot_is_written_atomically(vendors, monkeypatch):
    pe.refresh("NVDA", now=1_000)
    path = pe._path("NVDA")
    before = open(path, "rb").read()

    def bad_dump(*a, **k):
        raise OSError("disk full")
    monkeypatch.setattr(pe.json, "dump", bad_dump)
    with pytest.raises(OSError):
        pe.refresh("NVDA", now=2_000)
    assert open(path, "rb").read() == before, "a failed write tore the snapshot"
    assert [n for n in os.listdir(os.path.dirname(path)) if n.endswith(".tmp")] == []


def test_a_snapshot_survives_a_restart(vendors):
    pe.refresh("NVDA", now=time.time())
    pe._MEM.clear()
    assert pe.read("NVDA")["state"] == "ready"


def test_the_file_name_is_safe_for_any_ticker():
    assert os.path.basename(pe._path("BRK.B")) == "s-BRK_2EB.json"
    assert os.path.basename(pe._path("CON")) == "s-CON.json"


@pytest.mark.parametrize("value,want", [(None, "admins"), ("", "admins"), ("admins", "admins"), ("all", "all"),
                                        ("1", "all"), ("on", "all"), ("off", "off"), ("al", "off")])
def test_the_stage(monkeypatch, value, want):
    if value is None:
        monkeypatch.delenv("PINE_EVENTS_SUPPLY_ENABLED", raising=False)
    else:
        monkeypatch.setenv("PINE_EVENTS_SUPPLY_ENABLED", value)
    assert pe.stage() == want


# ── the route ───────────────────────────────────────────────────────────────────────────────────────────────────
def _client(user):
    app = FastAPI()
    app.include_router(route.router)
    app.dependency_overrides[route.require_paid] = lambda: user
    return TestClient(app)


MEMBER = {"id": "m", "role": "member", "plan": "pro"}
ADMIN = {"id": "a", "role": "admin", "plan": "pro"}


def test_dark_by_default_a_member_gets_404_an_admin_gets_the_answer(vendors):
    pe.refresh("NVDA")
    assert _client(MEMBER).get("/api/pine/events/NVDA").status_code == 404
    r = _client(ADMIN).get("/api/pine/events/NVDA")
    assert r.status_code == 200 and r.json()["families"]["splits"]["rows"][0]["numerator"] == 10.0


def test_at_all_every_paid_member_and_at_off_nobody(vendors, monkeypatch):
    pe.refresh("NVDA")
    monkeypatch.setenv("PINE_EVENTS_SUPPLY_ENABLED", "all")
    assert _client(MEMBER).get("/api/pine/events/NVDA").status_code == 200
    monkeypatch.setenv("PINE_EVENTS_SUPPLY_ENABLED", "off")
    assert _client(ADMIN).get("/api/pine/events/NVDA").status_code == 404


def test_pending_is_202_with_retry_after(vendors, monkeypatch):
    monkeypatch.setattr(pe._POOL, "submit", lambda fn: None)
    r = _client(ADMIN).get("/api/pine/events/AAPL")
    assert r.status_code == 202 and r.headers["retry-after"] == "5" and r.json()["state"] == "pending"


def test_an_unpaid_member_is_402(monkeypatch):
    monkeypatch.setattr(route, "is_paid_user", lambda u: False)
    with pytest.raises(Exception) as e:
        route.require_paid({"id": "f", "role": "member", "plan": "free"})
    assert getattr(e.value, "status_code", None) == 402


def test_a_non_ticker_is_400(vendors):
    assert _client(ADMIN).get("/api/pine/events/%20%3B").status_code == 400

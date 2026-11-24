"""Track 4, unit E1: `api/services/pine_events.py` and `GET /api/pine/events/{ticker}`.

What must hold, each with a test that goes red when it breaks:
  * a request is never a vendor call: a cold symbol answers `pending` and queues ONE background refresh;
  * the snapshot is written atomically (a failed write leaves the previous file and no temp file);
  * a vendor failure keeps the previous copy, marked `unavailable` with `staleSince`, never an empty list;
  * a family the licence catalog refuses is never fetched and answers its guard and sentence;
  * the shapes: earnings only once reported; dividends as declared; splits numerator = new, denominator = old;
    `knownFrom` = the first held event, `null` when the vendor holds none;
  * the stage: dark for members (404), admins by default, everyone paid at `all`, nobody at `off` or a typo;
  * a fund (ETF or fund, by the company profile) holds no earnings and says so (`notReported`), with no vendor call;
    a profile that cannot say keeps the vendor read and is logged once per symbol per day;
  * a copy held under older rules is not served (it answers pending and is rebuilt), but is still the copy a
    family keeps when its vendor read fails.
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
    # the company profile is a vendor read: every test answers it here ("cannot say"), a fund test overrides it
    from api.services.catalyst import ticker_metadata
    monkeypatch.setattr(ticker_metadata, "profile_facts", lambda sym: None)
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


# ── a fund reports no earnings (2026-11-24) ───────────────────────────────────────────────────────────────────────
# Read on production as the member account: SPY's earnings held one 2005 row (1.81), XLK's one, GLD's seven (one of
# them an "EPS" of 15,071.92). TradingView's request.earnings is na on every bar of a fund.

class _R:
    def __init__(self, v):
        self.value = v


#: the vendor's junk for SPY, as production held it
_SPY_JUNK = [{"date": "2005-02-15", "epsActual": 1.81, "epsEstimated": None}]


@pytest.fixture
def real_earnings(monkeypatch):
    """The real earnings reader over a counted vendor that answers SPY's junk row; the other families stubbed."""
    from api.services import fmp_client
    calls = []
    monkeypatch.setattr(fmp_client, "get_earnings", lambda sym, limit, timeout: calls.append(sym) or _R(list(_SPY_JUNK)))
    monkeypatch.setattr(pe, "FETCHERS", {**pe.FETCHERS,
                                         "dividends": lambda sym: {"rows": [{"exDate": "2024-12-20", "gross": 1.9658}]},
                                         "splits": lambda sym: {"rows": []}})
    monkeypatch.setattr(pe, "_refusal", lambda fam: None)
    monkeypatch.setattr(pe, "_disclosure", lambda fam: f"{fam} are UCT data")
    return calls


def _profile(monkeypatch, facts):
    from api.services.catalyst import ticker_metadata
    asked = []
    monkeypatch.setattr(ticker_metadata, "profile_facts", lambda sym: asked.append(sym) or facts)
    return asked


@pytest.mark.parametrize("facts,kind", [({"is_etf": True, "is_fund": False}, "etf"),
                                        ({"is_etf": False, "is_fund": True}, "fund"),
                                        ({"is_etf": True, "is_fund": None}, "etf")])
def test_a_funds_earnings_rows_never_reach_the_family(real_earnings, monkeypatch, facts, kind):
    asked = _profile(monkeypatch, facts)
    f = pe.refresh("SPY", now=1_000)["families"]
    e = f["earnings"]
    assert e["rows"] == [] and e["state"] == "empty" and e["knownFrom"] is None, e
    assert e["notReported"] == kind
    assert real_earnings == [], "a fund's earnings were asked of the vendor"
    assert asked == ["SPY"]
    # a fund still pays dividends and splits: those families are untouched
    assert f["dividends"]["state"] == "ok" and f["dividends"]["rows"]


def test_a_company_keeps_its_vendor_earnings_and_is_not_counted(real_earnings, monkeypatch, caplog):
    _profile(monkeypatch, {"is_etf": False, "is_fund": False, "name": "Apple Inc."})
    caplog.set_level("INFO", logger="pine_events")
    e = pe.refresh("AAPL", now=1_000)["families"]["earnings"]
    assert e["rows"] == [{"date": "2005-02-15", "actual": 1.81, "estimate": None}] and "notReported" not in e
    assert real_earnings == ["AAPL"]
    assert "NO fund answer" not in caplog.text


@pytest.mark.parametrize("facts", [None, {}, {"is_etf": None, "is_fund": False}, {"is_etf": False}])
def test_a_profile_that_cannot_say_keeps_the_vendor_read(real_earnings, monkeypatch, facts):
    """Real companies must not lose their earnings to a profile that did not answer (coordinator 2026-11-24). A FUND
    whose profile cannot say is the residual: its vendor rows are kept, as before the rule."""
    _profile(monkeypatch, facts)
    monkeypatch.setattr(pe, "_UNKNOWN_PROFILE", {})
    e = pe.refresh("NEWCO", now=1_000)["families"]["earnings"]
    assert e["rows"] and e["state"] == "ok" and "notReported" not in e
    assert real_earnings == ["NEWCO"]


def test_an_unknown_profile_is_logged_once_per_symbol_per_day(real_earnings, monkeypatch, caplog):
    _profile(monkeypatch, None)
    monkeypatch.setattr(pe, "_UNKNOWN_PROFILE", {})
    day = ["2026-11-24"]
    monkeypatch.setattr(pe, "_et_day", lambda: day[0])
    caplog.set_level("INFO", logger="pine_events")
    lines = lambda: [r.getMessage() for r in caplog.records if "NO fund answer" in r.getMessage()]
    pe.refresh("NEWCO", now=1_000)
    pe.refresh("NEWCO", now=2_000)
    assert lines() == ["pine_events earnings read with NO fund answer from the profile: NEWCO (1 such symbols today)"]
    pe.refresh("OTHER", now=3_000)
    assert len(lines()) == 2 and lines()[-1].endswith("OTHER (2 such symbols today)")
    day[0] = "2026-11-25"                       # a new day: counted again, yesterday's set let go
    pe.refresh("NEWCO", now=4_000)
    assert len(lines()) == 3 and lines()[-1].endswith("NEWCO (1 such symbols today)")
    assert pe._UNKNOWN_PROFILE == {"NEWCO": "2026-11-25"}


def _write_pre_fix_copy(sym: str, now: float) -> None:
    """A copy as production held it before the rule: schema v1, no `rules`, the vendor's junk in earnings."""
    path = pe._path(sym)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    doc = {"schema": pe.SCHEMA, "symbol": sym, "refreshedAt": now, "families": {
        "earnings": {"state": "ok", "rows": [{"date": "2005-02-15", "actual": 1.81, "estimate": None}],
                     "knownFrom": "2005-02-15", "fetchedAt": now},
        "dividends": {"state": "ok", "rows": [{"exDate": "2024-12-20", "gross": 1.9658}], "knownFrom": "2024-12-20",
                      "fetchedAt": now},
        "splits": {"state": "empty", "rows": [], "knownFrom": None, "fetchedAt": now}}}
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh)


def test_a_pre_fix_cached_fund_copy_is_not_served_after_the_fix(real_earnings, monkeypatch):
    """The rule reaches a symbol already held on deploy, not when its copy expires (coordinator 2026-11-24)."""
    _profile(monkeypatch, {"is_etf": True, "is_fund": False})
    _write_pre_fix_copy("SPY", time.time())
    queued = []
    monkeypatch.setattr(pe._POOL, "submit", lambda fn: queued.append(fn))
    first = pe.read("SPY")
    assert first["state"] == "pending", "a copy made under the old rules was served"
    assert len(queued) == 1
    queued[0]()                                    # the background lane rebuilds it under the new rules
    after = pe.read("SPY")
    assert after["state"] == "ready" and after["rules"] == pe.RULES
    assert after["families"]["earnings"]["rows"] == [] and after["families"]["earnings"]["notReported"] == "etf"
    assert after["families"]["dividends"]["rows"], "the dividends were lost in the rebuild"


def test_a_pre_fix_copy_is_still_the_copy_a_failed_family_keeps(real_earnings, monkeypatch):
    """Not served, but not thrown away: a family whose vendor read fails during the rebuild keeps it, by name."""
    _profile(monkeypatch, {"is_etf": True, "is_fund": False})
    _write_pre_fix_copy("SPY", 1_000.0)

    def boom(sym):
        raise RuntimeError("vendor down")
    monkeypatch.setitem(pe.FETCHERS, "dividends", boom)
    f = pe.refresh("SPY", now=2_000)["families"]
    assert f["dividends"]["state"] == "unavailable" and f["dividends"]["rows"] and f["dividends"]["staleSince"] == 1_000
    assert f["earnings"]["rows"] == [], "a fund's old junk came back through the kept copy"


def test_a_copy_under_the_current_rules_is_served():
    """Control for the two above: the gate refuses old rules only."""
    path = pe._path("QQQ")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"schema": pe.SCHEMA, "rules": pe.RULES, "symbol": "QQQ", "refreshedAt": time.time(),
                   "families": {}}, fh)
    assert pe.read("QQQ")["state"] == "ready"

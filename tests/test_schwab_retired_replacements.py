"""Every path that read Schwab reads Massive (or its next existing source) now. Each one, four ways.

Schwab was retired from the product on 2026-11-17 (owner: "Move it, fix the status and remove
schwab from everything"). For every replaced path this file holds:

  * Massive answers                 -> the value is served / stored, in the shape readers know;
  * Massive has nothing             -> null or absent, never a 0, and stored history is untouched;
  * Massive raises or hangs         -> the path returns; a job never raises out of its scheduler;
  * the response / stored shape     -> unchanged keys.

The paths: the contract-history recorder (daily_tracker), open-interest snapshots (oi_snapshots),
POST /api/schwab/options-quotes, GET /api/schwab/options-quote, GET /api/schwab/market-summary,
spot prices (Live Flow P/L, the Bullflow worker), market caps (Dark Pool).
The Flow Record sweep has its own file (tests/test_top_flow_snapshot_source.py) and GEX has two
(tests/test_gex_chain_source.py, tests/test_gex_massive_lcq02.py).

No network anywhere: every vendor function is replaced, and the real transports raise if reached.
"""
from __future__ import annotations

import asyncio
import copy
import datetime as _dt
import json
import pathlib
import sqlite3
import types

import pytest

import api.daily_tracker as daily
import api.massive_oi_snapshots as massive
import api.oi_snapshots as oi
import api.schwab_router as schwab_router
import api.top_flow_tracker as tracker
import api.uw_service as uw
from api.services import flow_market_data as fmd

REPO = pathlib.Path(__file__).resolve().parents[1]
TODAY_STR = "11/17/2026"
FUTURE = _dt.date.today() + _dt.timedelta(days=45)
FUTURE_ISO = FUTURE.isoformat()
FUTURE_MDY = f"{FUTURE.month}/{FUTURE.day}/{FUTURE.year}"


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    def _boom(*a, **k):
        raise AssertionError("a test reached the network")
    monkeypatch.setattr(massive.urllib.request, "urlopen", _boom)
    monkeypatch.setattr(massive, "MASSIVE_API_KEY", "test-key-not-a-secret")


# ══ 1. the contract-history recorder (daily_tracker.store_daily_snapshot) ══════

M_FIELDS = {"oi": 1500, "mid": 6.25, "last": 6.1, "underlying": 231.4, "volume": 320.0}
SCHWAB_ERA = [{"date": "11/13/2026", "oi": 900, "price": 5.5, "spot": 228.0, "volume": 40},
              {"date": "11/16/2026", "oi": 950, "price": 5.9, "spot": 229.0, "volume": 55}]


def _contract(sym="AAPL", cp="C", k=200.0, exp=None):
    return {"sym": sym, "cp": cp, "K": k, "exp": exp or FUTURE_MDY, "grade": "A", "dir": "BULL", "hits": 1, "prem": 0}


@pytest.fixture
def recorder(monkeypatch, tmp_path):
    store = tmp_path / "contract_history.json"
    monkeypatch.setattr(daily, "HISTORY_FILE", str(store))
    monkeypatch.setattr(daily, "_data", {"registered": [], "snapshots": {}})
    monkeypatch.setattr(tracker, "_et_date_str", lambda: TODAY_STR)
    sleeps = []

    async def _no_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(daily.asyncio, "sleep", _no_sleep)
    calls = []
    state = types.SimpleNamespace(fields={}, default=None, raises=None)

    async def _fake(batch):
        batch = list(batch)
        calls.append(batch)
        if state.raises is not None:
            raise state.raises
        return {massive._contract_key(*e): copy.deepcopy(state.fields.get(massive._contract_key(*e), state.default))
                for e in batch}

    monkeypatch.setattr(massive, "_fetch_fields_all_async", _fake)
    return types.SimpleNamespace(store=store, calls=calls, sleeps=sleeps, state=state,
                                 run=lambda: asyncio.run(daily.store_daily_snapshot()))


def test_recorder_massive_answers_and_the_entry_keeps_the_stored_keys(recorder):
    c = _contract()
    daily._data["registered"] = [c]
    recorder.state.fields = {massive._contract_key("AAPL", "C", 200.0, FUTURE_MDY): M_FIELDS}
    result = recorder.run()

    key = daily._key("AAPL", "C", 200.0, FUTURE_MDY)
    entry = daily._data["snapshots"][key][0]
    assert entry == {"date": TODAY_STR, "oi": 1500, "price": 6.25, "spot": 231.4, "volume": 320, "src": "massive"}
    assert list(entry)[:5] == ["date", "oi", "price", "spot", "volume"]      # the keys this file always wrote
    assert result == {"status": "ok", "source": "Massive", "date": TODAY_STR, "saved": 1, "skipped": 0,
                      "failed": 0, "total": 1}
    assert json.loads(recorder.store.read_text(encoding="utf-8"))["snapshots"][key] == [entry]
    assert daily.get_history("AAPL", "C", 200.0, FUTURE_MDY) == [entry]     # what GET /contract-history serves
    assert recorder.calls == [[("AAPL", "C", 200.0, FUTURE_MDY)]]


def test_recorder_a_rerun_overwrites_today_and_older_entries_stay_as_recorded(recorder):
    c = _contract()
    key = daily._key("AAPL", "C", 200.0, FUTURE_MDY)
    daily._data["registered"] = [c]
    daily._data["snapshots"][key] = copy.deepcopy(SCHWAB_ERA)
    recorder.state.fields = {massive._contract_key("AAPL", "C", 200.0, FUTURE_MDY): M_FIELDS}
    recorder.run()
    recorder.state.fields = {massive._contract_key("AAPL", "C", 200.0, FUTURE_MDY): {**M_FIELDS, "mid": 7.0}}
    recorder.run()
    hist = daily._data["snapshots"][key]
    assert hist[:2] == SCHWAB_ERA and len(hist) == 3 and hist[2]["price"] == 7.0


@pytest.mark.parametrize("fields", [None, {}, {"oi": 10, "mid": None, "last": None}, {"mid": 0, "last": 0}])
def test_recorder_massive_has_nothing_so_history_is_untouched_and_no_zero_is_written(recorder, fields):
    c = _contract()
    key = daily._key("AAPL", "C", 200.0, FUTURE_MDY)
    daily._data["registered"] = [c]
    daily._data["snapshots"][key] = copy.deepcopy(SCHWAB_ERA)
    recorder.state.fields = {massive._contract_key("AAPL", "C", 200.0, FUTURE_MDY): fields}
    result = recorder.run()
    assert daily._data["snapshots"][key] == SCHWAB_ERA
    assert result["status"] == "ok" and result["saved"] == 0 and result["skipped"] == 1
    assert not recorder.store.exists()                                      # nothing changed, nothing rewritten


def test_recorder_a_field_massive_did_not_send_is_null_never_zero(recorder):
    daily._data["registered"] = [_contract()]
    recorder.state.fields = {massive._contract_key("AAPL", "C", 200.0, FUTURE_MDY): {"mid": None, "last": 3.1}}
    recorder.run()
    entry = daily.get_history("AAPL", "C", 200.0, FUTURE_MDY)[0]
    assert entry == {"date": TODAY_STR, "oi": None, "price": 3.1, "spot": None, "volume": None, "src": "massive"}


@pytest.mark.parametrize("boom", [RuntimeError("vendor down"), TimeoutError(), KeyError("x")])
def test_recorder_massive_raising_never_raises_out_of_the_job(recorder, boom):
    key = daily._key("AAPL", "C", 200.0, FUTURE_MDY)
    daily._data["registered"] = [_contract()]
    daily._data["snapshots"][key] = copy.deepcopy(SCHWAB_ERA)
    recorder.state.raises = boom
    result = recorder.run()                                                 # returned, not raised
    assert result["status"] == "ok" and result["saved"] == 0 and result["failed"] == 1
    assert daily._data["snapshots"][key] == SCHWAB_ERA


def test_recorder_its_own_failure_is_a_status_never_an_exception(recorder, monkeypatch):
    daily._data["registered"] = [_contract()]

    async def _blow_up(*a, **k):
        raise RuntimeError("the recorder itself blew up")

    monkeypatch.setattr(tracker, "_massive_chunk", _blow_up)
    assert recorder.run() == {"status": "error", "reason": "RuntimeError"}


def test_recorder_without_a_key_or_contracts_asks_nothing(recorder, monkeypatch):
    assert recorder.run() == {"status": "skipped", "reason": "no registered contracts"}
    daily._data["registered"] = [_contract()]
    monkeypatch.setattr(massive, "MASSIVE_API_KEY", "")
    assert recorder.run() == {"status": "error", "reason": "MASSIVE_API_KEY not set"}
    assert recorder.calls == []


def test_recorder_is_capped_and_paced_like_the_flow_record_sweep(recorder):
    assert daily.SNAPSHOT_CAP == tracker.SNAPSHOT_CAP == 200
    daily._data["registered"] = [_contract(f"S{i:03d}") for i in range(230)]
    recorder.state.default = M_FIELDS
    result = recorder.run()
    assert [len(c) for c in recorder.calls] == [50, 50, 50, 50] and recorder.sleeps == [2, 2, 2]
    assert result["saved"] == 200 and result["skipped"] == 30 and result["total"] == 230


def test_recorder_expiry_rule_is_the_one_it_always_used(monkeypatch):
    today = _dt.date.today()
    assert daily._expiry_date("6/20/2031") == _dt.date(2031, 6, 20)
    assert daily._expiry_date("6/20/31") == _dt.date(2031, 6, 20)
    ahead = today + _dt.timedelta(days=10)
    assert daily._expiry_date(f"{ahead.month}/{ahead.day}") == ahead         # year-less: this year if still ahead
    behind = today - _dt.timedelta(days=10)
    rolled = daily._expiry_date(f"{behind.month}/{behind.day}")
    assert rolled is not None and rolled > today                             # else next year
    for junk in ("", None, "6", "a/b", "13/45"):
        assert daily._expiry_date(junk) is None, junk


# ══ 2. open-interest snapshots (oi_snapshots) ═════════════════════════════════

@pytest.fixture
def oi_db(monkeypatch, tmp_path):
    monkeypatch.setattr(oi, "DB_PATH", str(tmp_path / "oi_snapshots.db"))
    monkeypatch.setattr(oi, "OI_DB_PATH", str(tmp_path / "oi_snapshots.db"))
    monkeypatch.setattr(oi, "FLOW_DB_PATH", str(tmp_path / "missing_flow.db"))
    monkeypatch.setattr(oi, "_migrated", False)
    monkeypatch.delenv("MASSIVE_OI_FALLBACK_DISABLED", raising=False)
    oi.init_db()
    return tmp_path / "oi_snapshots.db"


def _fake_massive_oi(monkeypatch, answers=None, raises=None, hang=False):
    calls = []

    async def _fake(batch):
        batch = list(batch)
        calls.append(batch)
        if hang:
            await asyncio.Event().wait()
        if raises is not None:
            raise raises
        return [(massive._contract_key(s, cp, k, x), (answers or {}).get((s, cp, float(k), x))) for s, cp, k, x in batch]

    monkeypatch.setattr(massive, "_fetch_oi_all_async", _fake)
    return calls


CONTRACTS = [("AAPL", "CALL", 200.0, "12/18/2026"), ("NVDA", "P", 120.0, "12/18/2026")]


def test_oi_massive_answers_whatever_the_hour(monkeypatch):
    calls = _fake_massive_oi(monkeypatch, {("AAPL", "C", 200.0, "12/18/2026"): 8004,
                                           ("NVDA", "P", 120.0, "12/18/2026"): 77})
    for in_hours in (True, False):                     # Schwab used to be asked first during the session
        monkeypatch.setattr(oi, "_in_market_hours", lambda v=in_hours: v)
        out = asyncio.run(oi._fetch_oi_all_async(CONTRACTS))
        assert out == [("AAPL|C|200.0|12/18/2026", 8004), ("NVDA|P|120.0|12/18/2026", 77)]
    assert calls == [[("AAPL", "C", 200.0, "12/18/2026"), ("NVDA", "P", 120.0, "12/18/2026")]] * 2


def test_oi_massive_has_nothing_is_none_never_zero(monkeypatch):
    _fake_massive_oi(monkeypatch, {("AAPL", "C", 200.0, "12/18/2026"): 0})       # 0 and missing
    out = asyncio.run(oi._fetch_oi_all_async(CONTRACTS))
    assert out == [("AAPL|C|200.0|12/18/2026", None), ("NVDA|P|120.0|12/18/2026", None)]


@pytest.mark.parametrize("kw", [{"raises": RuntimeError("vendor down")}, {"hang": True}])
def test_oi_massive_raising_or_hanging_returns_all_none(monkeypatch, kw):
    _fake_massive_oi(monkeypatch, **kw)
    real_wait_for = asyncio.wait_for
    monkeypatch.setattr(oi.asyncio, "wait_for", lambda coro, timeout: real_wait_for(coro, 0.05))
    out = asyncio.run(oi._fetch_oi_all_async(CONTRACTS))                         # returned, not raised
    assert [v for _, v in out] == [None, None] and len(out) == 2


def test_oi_kill_switch_still_stops_the_massive_read(monkeypatch):
    calls = _fake_massive_oi(monkeypatch, {("AAPL", "C", 200.0, "12/18/2026"): 8004})
    monkeypatch.setenv("MASSIVE_OI_FALLBACK_DISABLED", "1")
    out = asyncio.run(oi._fetch_oi_all_async(CONTRACTS))
    assert calls == [] and [v for _, v in out] == [None, None]


def test_oi_on_demand_persists_a_massive_reading_and_never_a_miss(monkeypatch, oi_db):
    _fake_massive_oi(monkeypatch, {("AAPL", "C", 200.0, "12/18/2026"): 8004})
    assert asyncio.run(oi.fetch_and_persist_one_oi("AAPL", "C", 200.0, "2026-12-18")) == 8004
    assert asyncio.run(oi.fetch_and_persist_one_oi("NVDA", "P", 120.0, "2026-12-18")) is None
    rows = sqlite3.connect(str(oi_db)).execute(
        "SELECT contract_key, oi, source FROM contract_oi_snapshots").fetchall()
    assert rows == [("AAPL|C|200.0|12/18/2026", 8004, "ondemand-massive")]       # the miss stored nothing


def test_oi_rows_recorded_from_schwab_before_stay_and_the_cron_labels_new_ones_massive(oi_db):
    oi.record_batch([("AAPL|C|200.0|12/18/2026", 7000, "schwab")], "2026-11-14")
    oi.record_batch([("AAPL|C|200.0|12/18/2026", 8004, "massive")], "2026-11-17")
    assert oi.get_history("AAPL|C|200.0|12/18/2026", days=3650) == [
        {"date": "2026-11-14", "oi": 7000, "source": "schwab"},
        {"date": "2026-11-17", "oi": 8004, "source": "massive"}]
    src = (REPO / "api" / "oi_snapshots.py").read_text(encoding="utf-8")
    assert '(ck, oi, "massive") for ck, oi in fetched' in src                    # the 5:30 AM job's label


# ══ 3. POST /api/schwab/options-quotes ════════════════════════════════════════

BODY = [{"symbol": "AAPL", "strike": 200, "expDate": FUTURE_ISO, "cp": "C"},
        {"symbol": "NVDA", "strike": 120, "expDate": FUTURE_ISO, "cp": "P"}]
UW_QUOTE = {"mark": 6.3, "last": 6.2, "bid": 6.2, "ask": 6.4, "openInterest": 1400, "volume": 320,
            "underlyingPrice": 0, "iv": 0.31}


@pytest.fixture
def quotes(monkeypatch):
    state = types.SimpleNamespace(uw=[], uw_raises=None, uw_calls=[], massive={}, massive_raises=None,
                                  massive_calls=[], snapshot={})

    async def _uw(contracts):
        state.uw_calls.append(list(contracts))
        if state.uw_raises is not None:
            raise state.uw_raises
        return [copy.deepcopy(q) for q in state.uw[:len(contracts)]]

    async def _massive(batch):
        batch = list(batch)
        state.massive_calls.append(batch)
        if state.massive_raises is not None:
            raise state.massive_raises
        return {massive._contract_key(*e): copy.deepcopy(state.massive.get(e[0])) for e in batch}

    monkeypatch.setattr(uw, "get_batch_quotes", _uw)
    monkeypatch.setattr(massive, "_fetch_fields_all_async", _massive)
    monkeypatch.setattr(oi, "get_latest_oi_batch", lambda keys: {k: state.snapshot[k] for k in keys if k in state.snapshot})
    state.run = lambda body=BODY: asyncio.run(schwab_router.options_quotes_batch(copy.deepcopy(body)))
    return state


def test_quotes_unusual_whales_answers_first_and_massive_fills_what_it_lacks(quotes):
    quotes.uw = [dict(UW_QUOTE), dict(UW_QUOTE)]
    quotes.massive = {"AAPL": {"oi": 9, "mid": 1.0, "last": 1.0, "underlying": 231.4, "delta": 0.5,
                               "gamma": 0.01, "theta": -0.1, "iv": 0.9}}
    out = quotes.run()
    assert set(out) == {"quotes"} and len(out["quotes"]) == 2
    assert len(quotes.uw_calls) == 1 and len(quotes.uw_calls[0]) == 2          # every live contract goes to UW
    aapl = out["quotes"][0]
    # UW's numbers stand; Massive only fills what UW does not carry (the underlying, the greeks)
    assert aapl == {**UW_QUOTE, "_source": "uw", "underlyingPrice": 231.4, "delta": 0.5, "gamma": 0.01, "theta": -0.1}
    assert out["quotes"][1] == {**UW_QUOTE, "_source": "uw"}                   # Massive had nothing for NVDA


def test_quotes_a_contract_no_source_prices_stays_an_error_never_a_zero_price(quotes):
    quotes.uw = [{"error": "no_data"}, {"error": "HTTP 500"}]
    out = quotes.run()
    assert [q["error"] for q in out["quotes"]] == ["No quote yet", "No quote yet"]
    assert all("mark" not in q and not q.get("expired") for q in out["quotes"])
    assert out["quotes"][0]["symbol"] == "AAPL" and out["quotes"][0]["strike"] == 200.0


def test_quotes_massive_prices_a_contract_unusual_whales_returned_without_a_price(quotes):
    quotes.uw = [{**UW_QUOTE, "mark": 0, "last": 0, "bid": 0, "ask": 0, "openInterest": 0}, dict(UW_QUOTE)]
    quotes.massive = {"AAPL": {"oi": 8004, "mid": 2.75, "last": 2.7, "underlying": 231.4}}
    out = quotes.run()
    aapl = out["quotes"][0]
    assert aapl["mark"] == 2.75 and aapl["last"] == 2.7 and aapl["_price_source"] == "massive"
    assert aapl["openInterest"] == 8004 and aapl["oi_estimated"] is True and aapl["underlyingPrice"] == 231.4


@pytest.mark.parametrize("which", ["uw", "massive", "both"])
def test_quotes_a_source_raising_never_fails_the_request(quotes, which):
    quotes.uw = [dict(UW_QUOTE), dict(UW_QUOTE)]
    if which in ("uw", "both"):
        quotes.uw_raises = RuntimeError("UW down")
    if which in ("massive", "both"):
        quotes.massive_raises = RuntimeError("Massive down")
    out = quotes.run()
    assert set(out) == {"quotes"} and len(out["quotes"]) == 2
    if which == "massive":
        assert out["quotes"][0] == {**UW_QUOTE, "_source": "uw"}
    else:
        assert all(q.get("error") for q in out["quotes"])


def test_quotes_an_expired_contract_is_marked_and_no_source_is_asked_for_it(quotes):
    body = [{"symbol": "AAPL", "strike": 200, "expDate": "2020-01-17", "cp": "C"},
            {"symbol": "AAPL", "strike": 200, "expDate": "not-a-date", "cp": "C"}]
    out = quotes.run(body)
    assert out == {"quotes": [
        {"symbol": "AAPL", "strike": 200.0, "cp": "C", "error": "Expired (2020-01-17)", "expired": True},
        {"symbol": "AAPL", "strike": 200.0, "cp": "C", "error": "Expired (not-a-date)", "expired": True}]}
    assert quotes.uw_calls == [] and quotes.massive_calls == []


def test_quotes_a_missing_open_interest_is_filled_from_the_stored_snapshot(quotes):
    quotes.uw = [{**UW_QUOTE, "openInterest": 0, "underlyingPrice": 231.0}, dict(UW_QUOTE)]
    quotes.snapshot = {f"AAPL|C|200.0|{FUTURE_MDY}": (5150, "2026-11-17")}
    aapl = quotes.run()["quotes"][0]
    assert aapl["openInterest"] == 5150 and aapl["oi_estimated"] is True and aapl["oi_snap_date"] == "2026-11-17"


# ══ 4. GET /api/schwab/options-quote (one contract) ═══════════════════════════

QUOTE_KEYS = ["symbol", "strike", "expDate", "cp", "bid", "ask", "last", "mark", "volume", "openInterest",
              "iv", "delta", "gamma", "theta", "underlyingPrice"]


def _one(monkeypatch, fields=None, raises=None):
    async def _fake(batch):
        if raises is not None:
            raise raises
        return {massive._contract_key(*e): fields for e in batch}
    monkeypatch.setattr(massive, "_fetch_fields_all_async", _fake)
    return asyncio.run(schwab_router.options_quote("aapl", 200.0, FUTURE_ISO, "c"))


def test_one_quote_massive_answers_in_the_keys_the_route_always_had(monkeypatch):
    out = _one(monkeypatch, {"oi": 1500, "mid": 6.25, "last": 6.1, "underlying": 231.4, "volume": 320.0,
                             "iv": 0.3, "delta": 0.5, "gamma": 0.01, "theta": -0.1})
    assert list(out) == QUOTE_KEYS
    assert out == {"symbol": "AAPL", "strike": 200.0, "expDate": FUTURE_ISO, "cp": "C", "bid": None, "ask": None,
                   "last": 6.1, "mark": 6.25, "volume": 320.0, "openInterest": 1500, "iv": 30.0, "delta": 0.5,
                   "gamma": 0.01, "theta": -0.1, "underlyingPrice": 231.4}


@pytest.mark.parametrize("sent,served", [(0.352, 35.2), (0.3, 30.0), (1.25, 125.0), (0.0712, 7.12), (0, 0.0),
                                         (None, None), ("n/a", None), (float("nan"), None)])
def test_one_quote_iv_is_the_percent_the_route_always_returned(monkeypatch, sent, served):
    """Schwab sent `volatility` as a percent (35.2) and this route passed it through as `iv`. Massive sends a
    fraction (0.352). The number's meaning must not change: x 100, and what Massive did not send stays null."""
    out = _one(monkeypatch, {"mid": 6.25, "last": 6.1, "iv": sent})
    assert out["iv"] == served and (served is None or isinstance(out["iv"], float))
    assert fmd._percent(sent) == served


def test_one_quote_what_massive_did_not_send_is_null_never_zero(monkeypatch):
    out = _one(monkeypatch, {"oi": None, "mid": None, "last": 3.1})
    assert out["mark"] == 3.1 and out["last"] == 3.1                           # no midpoint: the last trade
    for key in ("bid", "ask", "volume", "openInterest", "iv", "delta", "gamma", "theta", "underlyingPrice"):
        assert out[key] is None, key


def test_one_quote_nothing_raising_expired_and_no_key_are_errors_not_exceptions(monkeypatch):
    assert "No contract found" in _one(monkeypatch, None)["error"]
    assert _one(monkeypatch, raises=RuntimeError("down")) == {"error": "Option quote unavailable"}
    out = asyncio.run(schwab_router.options_quote("AAPL", 200.0, "2020-01-17", "C"))
    assert out == {"error": "Expired contract (2020-01-17)", "expired": True}
    assert "Bad date" in asyncio.run(schwab_router.options_quote("AAPL", 200.0, "1/17/2031", "C"))["error"]
    monkeypatch.setattr(massive, "MASSIVE_API_KEY", "")
    assert _one(monkeypatch, {"mid": 1.0}) == {"error": "MASSIVE_API_KEY not set"}


# ══ 5. spot prices and the index strip (Massive equities snapshot) ════════════

def _row(last=None, day_close=None, prev=None):
    return {"lastTrade": {"p": last}, "day": {"c": day_close}, "prevDay": {"c": prev}}


@pytest.fixture
def snapshot(monkeypatch):
    state = types.SimpleNamespace(rows={}, calls=[], raises=None)

    def _fake(symbols):
        state.calls.append(list(symbols))
        if state.raises is not None:
            raise state.raises
        return {s: state.rows[s] for s in symbols if s in state.rows}

    monkeypatch.setattr(fmd, "_batch_snapshot_blocking", _fake)
    return state


def test_spots_one_batch_call_prices_every_ticker_and_a_miss_is_absent(snapshot):
    snapshot.rows = {"AAPL": _row(231.4, 230.0, 229.0), "MU": _row(None, 105.2, 104.0),
                     "NVDA": _row(None, 0, 131.5), "ZZZZ": _row(None, 0, 0)}
    out = asyncio.run(fmd.equity_spots(["aapl", "MU", "NVDA", "ZZZZ", "GONE", "$SPX", "BRK.B", "AAPL", ""]))
    assert out == {"AAPL": 231.4, "MU": 105.2, "NVDA": 131.5}       # last trade, else day close, else prev close
    assert "ZZZZ" not in out and "GONE" not in out                  # no price is absent, never 0
    assert snapshot.calls == [["AAPL", "MU", "NVDA", "ZZZZ", "GONE"]]          # ONE vendor call; indexes never asked
    assert asyncio.run(fmd.equity_spot("MU")) == 105.2 and asyncio.run(fmd.equity_spot("GONE")) is None


def test_spots_a_failing_or_hanging_vendor_is_an_empty_answer(snapshot, monkeypatch):
    snapshot.raises = RuntimeError("vendor down")
    assert asyncio.run(fmd.equity_spots(["AAPL"])) == {} and asyncio.run(fmd.equity_spot("AAPL")) is None
    monkeypatch.setattr(fmd, "SPOT_TIMEOUT_S", 0.05)
    monkeypatch.setattr(fmd, "_batch_snapshot_blocking", lambda s: __import__("time").sleep(0.4) or {})
    assert asyncio.run(fmd.equity_spots(["AAPL"])) == {}


def test_the_massive_client_raising_is_swallowed_at_the_boundary(monkeypatch):
    from api.services import massive as equities

    def _no_client():
        raise RuntimeError("MASSIVE_API_KEY not set in environment")
    monkeypatch.setattr(equities, "_get_client", _no_client)
    assert fmd._batch_snapshot_blocking(["AAPL"]) == {}

    class _Client:
        def get_batch_quotes(self, tickers):
            return types.SimpleNamespace(value={"AAPL": _row(231.4)}, degraded=None)
    monkeypatch.setattr(equities, "_get_client", lambda: _Client())
    assert fmd._batch_snapshot_blocking(["AAPL"]) == {"AAPL": _row(231.4)}
    monkeypatch.setattr(equities, "_get_client",
                        lambda: types.SimpleNamespace(get_batch_quotes=lambda t: types.SimpleNamespace(value=None)))
    assert fmd._batch_snapshot_blocking(["AAPL"]) == {}                        # a degraded read is empty too


def test_live_flow_current_quotes_keeps_its_shape_and_makes_one_vendor_call(snapshot, monkeypatch):
    import api.live_massive_router as lmr
    monkeypatch.setattr(lmr, "_quote_cache", {})
    snapshot.rows = {"MSFT": _row(388.5), "MU": _row(105.2)}
    payload = lmr.CurrentQuotesPayload(tickers=["MSFT", "MU", "NVDA", "MSFT", "$SPX"])
    out = asyncio.run(lmr.current_quotes(payload, _auth={}))
    assert set(out) == {"quotes", "fetched_at", "requested"}
    assert out["quotes"] == {"MSFT": 388.5, "MU": 105.2} and out["requested"] == 4     # NVDA: absent, not 0
    assert snapshot.calls == [["MSFT", "MU", "NVDA"]]
    asyncio.run(lmr.current_quotes(payload, _auth={}))
    assert snapshot.calls[1:] == [["NVDA"]]                          # the 2-minute cache holds the priced ones
    snapshot.raises = RuntimeError("down")
    monkeypatch.setattr(lmr, "_quote_cache", {})
    assert asyncio.run(lmr.current_quotes(payload, _auth={}))["quotes"] == {}


def test_the_bullflow_worker_spot_reads_the_same_helper(snapshot, monkeypatch):
    import api.liveflow_worker as lf
    monkeypatch.setattr(lf, "_spot_cache", {})
    snapshot.rows = {"MU": _row(105.2)}
    assert asyncio.run(lf._get_cached_spot("MU")) == 105.2
    assert asyncio.run(lf._get_cached_spot("GONE")) is None and asyncio.run(lf._get_cached_spot("$SPX")) is None


def test_market_summary_serves_the_four_etfs_from_massive_and_leaves_vix_out(snapshot):
    snapshot.rows = {"SPY": _row(672.5, 671.0, 668.25), "QQQ": _row(610.0, None, 612.2),
                     "DIA": _row(None, 471.3, 470.0), "IWM": _row(None, 0, 0)}
    out = asyncio.run(schwab_router.market_summary())
    assert set(out) == {"indices"}
    assert out["indices"] == [
        {"symbol": "SPY", "name": "S&P 500", "price": 672.5, "change": 4.25, "pct": 0.64},
        {"symbol": "QQQ", "name": "NASDAQ", "price": 610.0, "change": -2.2, "pct": -0.36},
        {"symbol": "DIA", "name": "DOW 30", "price": 471.3, "change": 1.3, "pct": 0.28}]
    assert snapshot.calls == [["SPY", "QQQ", "DIA", "IWM"]]          # one call; no VIX symbol is asked
    assert "VIX" not in json.dumps(out)                              # never a 0 placeholder row


def test_market_summary_with_nothing_or_a_failure_is_the_error_row_not_an_exception(snapshot):
    assert asyncio.run(schwab_router.market_summary()) == {"indices": [{"error": "Market data unavailable"}]}
    snapshot.raises = RuntimeError("down")
    assert asyncio.run(schwab_router.market_summary()) == {"indices": [{"error": "Market data unavailable"}]}


# ══ 6. market caps (GET /api/schwab/mktcap-batch, the dark-pool EOD card) ═════

class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


def _fake_http(monkeypatch, v7=None, v10=None, raises=False):
    seen = []

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, **kw):
            seen.append(url)
            assert "schwab" not in url.lower()
            if raises:
                raise RuntimeError("no route to host")
            if "/v7/" in url:
                return _Resp(200, {"quoteResponse": {"result": v7 or []}})
            sym = url.rsplit("/", 1)[-1]
            cap = (v10 or {}).get(sym)
            return _Resp(200, {"quoteSummary": {"result": [{"price": {"marketCap": {"raw": cap}}}]}})

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    return seen


def _fake_flow_db(monkeypatch, caps=None, raises=False):
    import api.flow_db as flow_db

    class _DB:
        def get_mktcap_batch(self, symbols):
            if raises:
                raise RuntimeError("flow.db locked")
            return {s: caps[s] for s in symbols if s in (caps or {})}
    monkeypatch.setattr(flow_db, "FlowDB", _DB)


def test_mktcap_the_flow_db_answers_and_no_network_is_touched(monkeypatch):
    _fake_flow_db(monkeypatch, {"AAPL": 3_400_000_000_000, "MSFT": 3_100_000_000_000})
    seen = _fake_http(monkeypatch)
    out = asyncio.run(schwab_router.mktcap_batch("aapl, msft"))
    assert out == {"mktcap": {"AAPL": 3_400_000_000_000, "MSFT": 3_100_000_000_000}} and seen == []


def test_mktcap_the_remaining_legs_are_yahoo_and_a_miss_is_omitted(monkeypatch):
    _fake_flow_db(monkeypatch, {"AAPL": 3_400_000_000_000})
    seen = _fake_http(monkeypatch, v7=[{"symbol": "MSFT", "marketCap": 3_100_000_000_000}], v10={"RDDT": 28_000_000_000})
    out = asyncio.run(fmd.mktcap_batch(["AAPL", "MSFT", "RDDT", "GONE"]))
    assert out == {"AAPL": 3_400_000_000_000, "MSFT": 3_100_000_000_000, "RDDT": 28_000_000_000}
    assert "GONE" not in out                                          # omitted, never 0
    assert len(seen) == 3 and "/v7/finance/quote" in seen[0] and seen[1].endswith("/RDDT")


def test_mktcap_every_source_failing_is_an_empty_answer_not_an_exception(monkeypatch):
    _fake_flow_db(monkeypatch, raises=True)
    _fake_http(monkeypatch, raises=True)
    assert asyncio.run(fmd.mktcap_batch(["AAPL"])) == {}
    assert asyncio.run(fmd.mktcap_batch([])) == {}


def test_the_dark_pool_card_reads_the_same_function():
    src = (REPO / "api" / "darkpool_eod.py").read_text(encoding="utf-8")
    assert "from api.services.flow_market_data import mktcap_batch" in src

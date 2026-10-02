"""Owner ruling 2026-09-30: log the whole options universe forward, every trading day.

`api/services/options_universe_log.py` + the terminal-next-monitor `options-log` job.
No network: the vendor page source and the R2 upload are injected.
"""
from __future__ import annotations

import csv
import datetime as dt
import gzip
import io
import json
from zoneinfo import ZoneInfo

import pytest

from api.services import options_universe_log as log

ET = ZoneInfo("America/New_York")
WED = dt.datetime(2026, 9, 30, 16, 30, tzinfo=ET)          # a trading day


def rec(occ, und, exp, strike, typ, *, oi=10, iv=0.3, px=100.0):
    return {"details": {"ticker": occ, "expiration_date": exp, "strike_price": strike,
                        "contract_type": typ},
            "open_interest": oi, "implied_volatility": iv,
            "greeks": {"delta": 0.5, "gamma": 0.1, "theta": -0.02, "vega": 0.12},
            "last_quote": {"bid": 1.0, "ask": 1.2}, "last_trade": {"price": 1.1},
            "day": {"volume": 5, "vwap": 1.05}, "underlying_asset": {"ticker": und, "price": px}}


# ── one record, one row ─────────────────────────────────────────────────────────

def test_a_record_becomes_one_row_with_every_field():
    row = log.contract_row(rec("O:AAPL261030C00100000", "AAPL", "2026-10-30", 100, "call"))
    assert set(row) == set(log.CONTRACT_FIELDS)
    assert row["contract"] == "O:AAPL261030C00100000" and row["underlying"] == "AAPL"
    assert row["open_interest"] == 10 and row["iv"] == 0.3 and row["bid"] == 1.0


def test_a_record_with_no_contract_is_skipped_and_missing_greeks_stay_blank():
    assert log.contract_row({"details": {}}) is None
    r = rec("O:X", "X", "2026-10-30", 5, "put")
    r["greeks"] = {}
    r.pop("implied_volatility")
    row = log.contract_row(r)
    assert row["delta"] is None and row["iv"] is None          # blank, never zero


# ── the per-underlying summary ──────────────────────────────────────────────────

def test_atm_iv_is_the_expiry_CLOSEST_to_30_days_at_the_strike_closest_to_price():
    s = log._Summary(dt.date(2026, 9, 30))
    for r in [
        rec("a", "AAPL", "2026-10-02", 100, "call", iv=0.90, oi=5),   # 2 DTE: under the floor
        rec("b", "AAPL", "2026-10-30", 100, "call", iv=0.30, oi=7),   # 30 DTE, ATM
        rec("c", "AAPL", "2026-10-30", 100, "put", iv=0.34, oi=3),    # 30 DTE, ATM
        rec("d", "AAPL", "2026-10-30", 110, "call", iv=0.20, oi=1),   # further strike
        rec("e", "AAPL", "2026-11-06", 100, "call", iv=0.50, oi=1),   # 37 DTE: further from 30
    ]:
        s.add(log.contract_row(r))
    (row,) = list(s.rows())
    assert row["atm_expiration"] == "2026-10-30" and row["atm_strike"] == 100
    assert row["atm_iv"] == pytest.approx(0.32)                   # mean of call and put
    assert row["atm_dte"] == 30
    assert row["call_oi"] == 14 and row["put_oi"] == 3 and row["contracts"] == 5


def test_a_MONTHLIES_ONLY_name_still_gets_an_atm_iv():
    """2026-09-30: a fixed 20-45 day window found an ATM IV for 687 of 6,034 names,
    because the monthlies sat at 16 and 51 days. The closer one (16) is the read."""
    s = log._Summary(dt.date(2026, 9, 30))
    s.add(log.contract_row(rec("a", "CPK", "2026-10-16", 100, "call", iv=0.25)))   # 16 DTE
    s.add(log.contract_row(rec("b", "CPK", "2026-11-20", 100, "call", iv=0.28)))   # 51 DTE
    (row,) = list(s.rows())
    assert row["atm_expiration"] == "2026-10-16" and row["atm_dte"] == 16
    assert row["atm_iv"] == pytest.approx(0.25)


def test_a_summary_can_be_REBUILT_from_the_stored_contracts_file(tmp_path):
    """The contracts file is the authority: a changed summary rule loses no day."""
    stored = {}

    def upload(path, key, ctype):
        with open(path, "rb") as fh:
            stored[key] = fh.read()
    log.run(now=WED, api_key="K", workdir=str(tmp_path), upload=upload,
            get=lambda u: {"results": [rec("a", "CPK", "2026-10-16", 100, "call", iv=0.25, oi=4),
                                       rec("b", "CPK", "2026-10-16", 100, "put", iv=0.27, oi=6)]})
    keys = log.keys_for(dt.date(2026, 9, 30))
    src, out = tmp_path / "c.csv.gz", tmp_path / "u.csv.gz"
    src.write_bytes(stored[keys["contracts"]])
    assert log.resummarize(str(src), dt.date(2026, 9, 30), str(out)) == 1
    assert gzip.decompress(out.read_bytes()) == gzip.decompress(stored[keys["underlyings"]])


def _quoted(occ, und, exp, strike, typ, bid, ask, px=100.0):
    r = rec(occ, und, exp, strike, typ, px=px)
    r["last_quote"] = {"bid": bid, "ask": ask}
    return r


def test_the_FRONT_straddle_is_the_first_expiry_AFTER_the_session_with_both_legs_two_sided():
    """BRK-10's implied move: straddle / price at a print's pre-print close."""
    s = log._Summary(dt.date(2026, 9, 30))
    for r in [
        _quoted("a", "AAPL", "2026-09-30", 100, "call", 9.0, 9.2),   # expires TODAY: not front
        _quoted("b", "AAPL", "2026-09-30", 100, "put", 9.0, 9.2),
        _quoted("c", "AAPL", "2026-10-02", 100, "call", 2.0, 2.2),   # ATM, but the put
        _quoted("d", "AAPL", "2026-10-02", 100, "put", 0.0, 2.0),    # has no bid: one-sided
        _quoted("e", "AAPL", "2026-10-02", 101, "call", 1.5, 1.7),   # nearest strike with BOTH
        _quoted("f", "AAPL", "2026-10-02", 101, "put", 2.4, 2.6),
        _quoted("g", "AAPL", "2026-10-09", 100, "call", 3.0, 3.2),   # a later expiry
        _quoted("h", "AAPL", "2026-10-09", 100, "put", 3.0, 3.2),
    ]:
        s.add(log.contract_row(r))
    (row,) = list(s.rows())
    assert row["front_expiration"] == "2026-10-02" and row["front_dte"] == 2
    assert row["front_strike"] == 101
    assert row["front_straddle"] == pytest.approx(1.6 + 2.5)


def test_no_two_sided_front_quote_means_no_straddle_not_a_guess():
    s = log._Summary(dt.date(2026, 9, 30))
    s.add(log.contract_row(_quoted("a", "XYZ", "2026-10-02", 100, "call", 1.0, 1.2)))
    s.add(log.contract_row(_quoted("b", "XYZ", "2026-10-02", 100, "put", None, 1.2)))
    (row,) = list(s.rows())
    assert row["front_expiration"] == "2026-10-02"
    assert row["front_straddle"] is None and row["front_strike"] is None


def test_no_contract_in_the_window_means_no_atm_iv_not_a_guess():
    s = log._Summary(dt.date(2026, 9, 30))
    s.add(log.contract_row(rec("a", "XYZ", "2026-10-02", 10, "call")))
    (row,) = list(s.rows())
    assert row["atm_iv"] is None and row["atm_expiration"] is None


# ── the walk ────────────────────────────────────────────────────────────────────

def test_the_walk_follows_the_cursor_with_its_query_intact_and_says_complete():
    seen = []
    pages = {
        f"{log.BASE}/v3/snapshot?type=options&limit=250&apiKey=K":
            {"results": [rec("a", "A", "2026-10-30", 1, "call")], "next_url": "https://api.massive.com/v3/snapshot?cursor=abc"},
        "https://api.massive.com/v3/snapshot?cursor=abc&apiKey=K":
            {"results": [rec("b", "B", "2026-10-30", 1, "put")]},
    }

    def get(u):
        seen.append(u)
        return pages[u]
    out = list(log.walk(get, "K"))
    assert [r["details"]["ticker"] for r in out[:-1]] == ["a", "b"]
    assert out[-1] == {"_receipt": {"pages": 2, "complete": True, "reason": None}}
    assert seen[1] == "https://api.massive.com/v3/snapshot?cursor=abc&apiKey=K"


def test_a_time_budget_stop_is_PARTIAL_and_says_why():
    t = iter([0, 0, 100, 100])
    out = list(log.walk(lambda u: {"results": [], "next_url": "https://x/next?c=1"}, "K",
                        budget_s=50, clock=lambda: next(t)))
    assert out[-1]["_receipt"]["complete"] is False
    assert "time budget" in out[-1]["_receipt"]["reason"]


def test_a_page_that_keeps_failing_is_PARTIAL_and_names_the_error(monkeypatch):
    monkeypatch.setattr(log.time, "sleep", lambda s: None)

    def boom(u):
        raise ConnectionError("reset")
    out = list(log.walk(boom, "K"))
    assert out[-1]["_receipt"]["complete"] is False
    assert "ConnectionError" in out[-1]["_receipt"]["reason"]


# ── one day's run, end to end ───────────────────────────────────────────────────

def _run(tmp_path, results, now=WED):
    stored = {}

    def upload(path, key, ctype):
        with open(path, "rb") as fh:
            stored[key] = fh.read()
    m = log.run(now=now, api_key="K", workdir=str(tmp_path), upload=upload,
                get=lambda u: {"results": results})
    return m, stored


def test_a_run_uploads_contracts_underlyings_and_a_manifest_under_the_session_date(tmp_path):
    results = [rec("a", "AAPL", "2026-10-30", 100, "call"), rec("b", "AAPL", "2026-10-30", 100, "put"),
               rec("c", "MSFT", "2026-10-30", 400, "call", px=400.0)]
    m, stored = _run(tmp_path, results)
    keys = log.keys_for(dt.date(2026, 9, 30))
    assert set(stored) == set(keys.values())
    assert keys["contracts"] == "options_log/2026/2026-09-30.contracts.csv.gz"
    rows = list(csv.DictReader(io.StringIO(gzip.decompress(stored[keys["contracts"]]).decode())))
    assert [r["contract"] for r in rows] == ["a", "b", "c"]
    unds = list(csv.DictReader(io.StringIO(gzip.decompress(stored[keys["underlyings"]]).decode())))
    assert [u["underlying"] for u in unds] == ["AAPL", "MSFT"]
    man = json.loads(stored[keys["manifest"]])
    assert man["contracts"] == 3 and man["underlyings"] == 2 and man["complete"] is True
    assert m == man


def test_a_non_trading_day_skips_and_uploads_nothing(tmp_path):
    sat = dt.datetime(2026, 10, 3, 16, 30, tzinfo=ET)
    m, stored = _run(tmp_path, [rec("a", "A", "2026-10-30", 1, "call")], now=sat)
    assert m["skipped"] == "not a trading day" and stored == {}


def test_a_missing_key_raises_by_name(monkeypatch, tmp_path):
    monkeypatch.delenv("MASSIVE_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="MASSIVE_API_KEY"):
        log.run(now=WED, workdir=str(tmp_path), upload=lambda *a: None, get=lambda u: {})


def test_the_receipt_says_partial_as_an_alert():
    m = {"session": "2026-09-30", "contracts": 5, "underlyings": 1, "with_iv": 5, "pages": 1,
         "seconds": 3, "bytes": {"contracts": 1000}, "keys": log.keys_for(dt.date(2026, 9, 30)),
         "complete": False, "reason": "time budget 2400s reached after 9000 pages"}
    title, body, alert = log.receipt_text(m)
    assert alert is True and "PARTIAL" in title and "time budget" in body
    assert log.receipt_text({**m, "complete": True})[2] is False


# ── the monitor wiring ──────────────────────────────────────────────────────────

def test_the_monitor_runs_it_at_1630_ET_on_weekdays_and_it_is_DARK_by_default(monkeypatch):
    from api import terminal_next_monitor_main as mon
    assert "options-log" in mon.due_jobs(WED)
    assert "options-log" not in mon.due_jobs(dt.datetime(2026, 10, 3, 16, 30, tzinfo=ET))
    monkeypatch.delenv(log.FLAG, raising=False)
    assert mon.JOB_GATES["options-log"]() is False
    monkeypatch.setenv(log.FLAG, "1")
    assert mon.JOB_GATES["options-log"]() is True


def test_a_failing_run_is_an_alert_post_never_a_silent_crash(monkeypatch):
    from api import terminal_next_monitor_main as mon

    def boom(**k):
        raise RuntimeError("DATA_SYNC_* R2 credentials are not set on this service")
    monkeypatch.setattr(log, "run", boom)
    title, body, alert = mon.job_options_log()
    assert alert is True and "FAILED" in title and "DATA_SYNC" in body

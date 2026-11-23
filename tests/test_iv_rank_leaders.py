"""OSCR RICH / OSCR CHEAP: the market-wide IV rank list (`api/services/research/iv_rank_leaders.py`) and its
route (`GET /api/options-screener/iv-rank`).

Over a SEEDED local copy of the options log's layout, written with the logger's own column list
(`options_universe_log.UNDERLYING_FIELDS`). Every symbol and number is invented. No network.
"""
from __future__ import annotations

import csv
import datetime as dt
import gzip
import json
import os
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import options_screener as router_mod
from api.services import options_universe_log as log
from api.services import session_calendar
from api.services.options_analytics.vol import rank_label
from api.services.research import iv_history, iv_rank_leaders as ivr
from tests.authclients import FREE_MEMBER, PAID_MEMBER, signed_in_as

ET = ZoneInfo("America/New_York")
FLAG = "OPTIONS_SCREENER_ENABLED"
FASTAPI_404 = b'{"detail":"Not Found"}'
NOW = dt.datetime(2026, 11, 20, 21, 0, tzinfo=ET)          # a Friday evening, inside the quiet span
NOON = dt.datetime(2026, 11, 19, 12, 0, tzinfo=ET)         # a Thursday noon, outside it


def trading_days(start: str, n: int) -> list:
    d, out = dt.date.fromisoformat(start), []
    while len(out) < n:
        if session_calendar.is_trading_day(d):
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


def row(sym, iv, *, call_oi=100, put_oi=50, dte=30):
    return {"underlying": sym, "contracts": 10, "call_oi": call_oi, "put_oi": put_oi, "underlying_price": 40.0,
            "atm_iv": iv, "atm_expiration": "2026-12-18", "atm_strike": 40.0, "atm_dte": dte,
            "front_expiration": "2026-11-27", "front_dte": 7, "front_strike": 40.0, "front_straddle": 1.5}


class Log:
    def __init__(self, root):
        self.root = str(root)
        self.store = iv_history.LocalStore(self.root)

    def day(self, session, rows, *, legacy=False):
        ydir = os.path.join(self.root, "options_log", session[:4])
        os.makedirs(ydir, exist_ok=True)
        fields = log.UNDERLYING_FIELDS if not legacy else (
            "underlying", "contracts", "call_oi", "put_oi", "underlying_price", "atm_iv", "atm_expiration", "atm_strike")
        with gzip.open(os.path.join(ydir, f"{session}.underlyings.csv.gz"), "wt", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            for r in sorted(rows, key=lambda r: r["underlying"]):
                w.writerow(r)
        with open(os.path.join(ydir, f"{session}.manifest.json"), "w") as fh:
            json.dump({"session": session, "complete": True}, fh)


@pytest.fixture
def seeded(tmp_path, monkeypatch):
    lg = Log(tmp_path / "log")
    monkeypatch.setattr(iv_history, "_store_override", lg.store)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    os.makedirs(tmp_path / "data", exist_ok=True)
    ivr.reset_for_tests()
    yield lg
    ivr.drain()
    ivr.reset_for_tests()


def wave(i, base, amp):
    """An invented IV path: up and down around `base`, the last session at `i`."""
    return round(base + amp * ((i * 7) % 11 - 5) / 10, 4)


def build_25(lg):
    days = trading_days("2026-10-01", 25)
    for i, d in enumerate(days):
        rows = [row("AAQX", wave(i, 0.40, 0.10)), row("BBQX", wave(i + 3, 0.80, 0.30), call_oi=9000),
                row("CCQX", 0.20 + i / 1000), row("DDQX", 0.90 - i / 1000)]
        if i >= 6:
            rows.append(row("EEQX", 0.30 + i / 100))             # 19 sessions: under the minimum
        if i < 24:
            rows.append(row("FFQX", 0.5 + i / 100))              # not in the latest session
        rows.append(row("GGQX", 0.33))                           # never moves
        rows.append(row("HHQX", ""))                             # no ATM IV at all
        lg.day(d, rows)
    return days


# ── the rules are the service's ─────────────────────────────────────────────────────────────────

def test_every_ranked_symbol_reads_exactly_as_its_own_ivh_rank(seeded):
    days = build_25(seeded)
    out = ivr.build(now=NOW)
    assert out["status"] == "ok" and out["session"] == days[-1]
    rows = {r["symbol"]: r for r in out["high"]}
    assert set(rows) == {"AAQX", "BBQX", "CCQX", "DDQX"}
    for sym, r in rows.items():
        own = iv_history.iv_history(sym, now=NOW)["rank"]
        assert own is not None, sym
        assert (r["iv_rank"], r["iv_percentile"], r["low"], r["high"], r["sessions"], r["atm_iv"]) == (
            own["iv_rank"], own["iv_percentile"], own["low"], own["high"], own["window_sessions"], own["current"]), sym
        assert r["rank_word"] == rank_label(own["iv_rank"])
    assert rows["CCQX"]["iv_rank"] == 100.0 and rows["DDQX"]["iv_rank"] == 0.0
    assert rows["BBQX"]["open_interest"] == 9050 and rows["AAQX"]["atm_dte"] == 30


def test_what_is_left_out_is_counted_in_numbers(seeded):
    build_25(seeded)
    c = ivr.build(now=NOW)["counts"]
    # EEQX 19 sessions; GGQX flat; FFQX not in the latest session; HHQX no ATM IV in the latest session
    assert c == {"ranked": 4, "below_min": 1, "flat": 1, "not_in_latest": 1, "latest_rows": 7,
                 "latest_no_atm_iv": 1, "symbols_logged": 7}


def test_highest_and_lowest_are_the_two_ends_with_the_service_order(seeded, monkeypatch):
    build_25(seeded)
    monkeypatch.setattr(ivr, "MAX_PER_SIDE", 2)
    out = ivr.build(now=NOW)
    assert [r["symbol"] for r in out["high"]] == ["CCQX", sorted(
        ("AAQX", "BBQX"), key=lambda s: -iv_history.iv_history(s, now=NOW)["rank"]["iv_rank"])[0]]
    assert out["low"][0]["symbol"] == "DDQX" and len(out["low"]) == 2
    assert out["max_per_side"] == 2 and out["counts"]["ranked"] == 4


def test_a_tie_goes_to_the_percentile_then_to_more_open_interest(seeded):
    days = trading_days("2026-10-01", 21)
    for i, d in enumerate(days):
        last = i == len(days) - 1
        seeded.day(d, [row("KKQX", 0.5 if last else 0.2 + (i % 2) * 0.3, call_oi=10),
                       row("LLQX", 0.5 if last else 0.2 + (i % 2) * 0.3, call_oi=5000),
                       row("MMQX", 0.5 if last else 0.2 + ((i + 1) % 2) * 0.3, call_oi=1)])
    out = ivr.build(now=NOW)
    assert [r["iv_rank"] for r in out["high"]] == [100.0, 100.0, 100.0]
    # same rank and percentile for KKQX and LLQX: the one with more open interest first
    assert [r["symbol"] for r in out["high"]][:2] == ["LLQX", "KKQX"]


def test_a_first_run_day_is_left_out_of_every_rank_and_named(seeded):
    seeded.day("2026-09-30", [row("AAQX", 0.99)], legacy=True)
    days = trading_days("2026-10-01", 20)
    for i, d in enumerate(days):
        seeded.day(d, [row("AAQX", 0.30 + i / 100)])
    out = ivr.build(now=NOW)
    assert out["legacy_sessions"] == ["2026-09-30"] and out["rankable_sessions"] == 20
    r = out["high"][0]
    assert r["sessions"] == 20 and r["high"] == pytest.approx(0.49) and r["iv_rank"] == 100.0
    assert iv_history.iv_history("AAQX", now=NOW)["rank"]["window_sessions"] == 20


def test_the_window_is_the_service_window(seeded, monkeypatch):
    monkeypatch.setattr(iv_history, "RANK_WINDOW", 21)
    days = trading_days("2026-10-01", 30)
    for i, d in enumerate(days):
        seeded.day(d, [row("AAQX", 0.9 if i == 0 else 0.30 + (i % 5) / 100)])
    r = ivr.build(now=NOW)["high"][0]
    own = iv_history.iv_history("AAQX", now=NOW)["rank"]
    assert r["sessions"] == own["window_sessions"] == 21
    assert r["high"] == own["high"] and r["high"] < 0.9       # the old spike has left the window


def test_a_file_that_breaks_half_way_is_unread_never_half_a_day(seeded):
    days = build_25(seeded)
    good = ivr.build(now=NOW)
    broken = os.path.join(seeded.root, "options_log", days[10][:4], f"{days[10]}.underlyings.csv.gz")
    raw = open(broken, "rb").read()
    with open(broken, "wb") as fh:
        fh.write(raw[: len(raw) // 2])
    out = ivr.build(now=NOW)
    assert out["unread_sessions"] == [days[10]] and out["rankable_sessions"] == 24
    assert {r["symbol"]: r["sessions"] for r in out["high"]} == {
        r["symbol"]: r["sessions"] - 1 for r in good["high"]}


def test_an_empty_log_is_no_log(seeded):
    out = ivr.build(now=NOW)
    assert out["status"] == "no_log" and out["high"] == [] and out["low"] == [] and out["counts"]["ranked"] == 0


# ── built once an evening, held, never on the request ───────────────────────────────────────────

def test_the_scheduled_build_runs_only_switched_on_and_in_the_quiet_span(seeded, monkeypatch):
    build_25(seeded)
    monkeypatch.delenv(FLAG, raising=False)
    assert ivr.run_scheduled(NOW) == {"started": False, "reason": "off"}
    monkeypatch.setenv(FLAG, "1")
    assert ivr.run_scheduled(NOON) == {"started": False, "reason": "not_quiet"}
    assert ivr.get_leaders(NOON)["status"] == "not_built"
    assert ivr.run_scheduled(NOW) == {"started": True}
    ivr.drain()
    got = ivr.get_leaders(NOW)
    assert got["status"] == "ok" and got["counts"]["ranked"] == 4 and got["last_run"]["ok"] is True
    assert "v" not in got and got["building"] is False


def test_one_build_at_a_time(seeded, monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    import threading
    with ivr._lock:
        ivr._state["inflight"] = threading.Event()
    assert ivr.run_scheduled(NOW) == {"started": False, "reason": "running"}
    assert ivr.get_leaders(NOW)["building"] is True
    with ivr._lock:
        ivr._state["inflight"].set()
        ivr._state["inflight"] = None


def test_before_the_first_evening_it_says_when_the_build_runs(seeded):
    got = ivr.get_leaders(NOON)
    assert got["status"] == "not_built" and got["next_run"] == "2026-11-19T20:45-05:00"
    assert ivr.get_leaders(NOW)["next_run"] == "2026-11-21T20:45-05:00"
    assert got["rank_min_sessions"] == iv_history.RANK_MIN_SESSIONS and got["last_run"] is None


def test_a_failed_build_keeps_the_last_good_list_and_says_so(seeded, monkeypatch):
    build_25(seeded)
    monkeypatch.setenv(FLAG, "1")
    ivr.run_scheduled(NOW)
    ivr.drain()

    class Broken(iv_history.LocalStore):
        def sessions(self):
            raise RuntimeError("no R2 credentials")
    monkeypatch.setattr(iv_history, "_store_override", Broken("x"))
    ivr.run_scheduled(NOW)
    ivr.drain()
    got = ivr.get_leaders(NOW)
    assert got["status"] == "ok" and got["counts"]["ranked"] == 4
    assert got["last_run"]["ok"] is False and got["last_run"]["reason"] == "RuntimeError"


def test_a_restart_serves_the_last_evenings_list_from_disk(seeded, monkeypatch):
    build_25(seeded)
    monkeypatch.setenv(FLAG, "1")
    ivr.run_scheduled(NOW)
    ivr.drain()
    first = ivr.get_leaders(NOW)
    ivr.reset_for_tests()                      # a new process: nothing in memory
    monkeypatch.setattr(iv_history, "_store_override", None)
    monkeypatch.setattr(iv_history, "get_store", lambda: (_ for _ in ()).throw(AssertionError("read the log")))
    again = ivr.get_leaders(NOW)
    assert again["status"] == "ok" and again["high"] == first["high"] and again["built_at"] == first["built_at"]


def test_a_disk_file_of_another_shape_is_not_served(seeded):
    path = ivr._disk_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump({"v": ivr.DISK_VERSION, "held": {"v": ivr.DISK_VERSION, "status": "ok"}, "last_run": None}, fh)
    assert ivr.get_leaders(NOW)["status"] == "not_built"


# ── the door ────────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def app():
    a = FastAPI()
    a.include_router(router_mod.router)
    return a


URL = "/api/options-screener/iv-rank"


def test_the_route_is_dark_with_the_screener_paid_only_and_never_reads_the_log(seeded, app, monkeypatch):
    client = TestClient(app, raise_server_exceptions=False)
    monkeypatch.delenv(FLAG, raising=False)
    with signed_in_as(PAID_MEMBER, app=app):
        r = client.get(URL)
        assert r.status_code == 404 and r.content == FASTAPI_404
    monkeypatch.setenv(FLAG, "1")
    assert client.get(URL).status_code == 401
    with signed_in_as(FREE_MEMBER, app=app):
        assert client.get(URL).status_code == 402
    monkeypatch.setattr(iv_history, "get_store", lambda: (_ for _ in ()).throw(AssertionError("read the log")))
    monkeypatch.setattr(iv_history, "_store_override", None)
    with signed_in_as(PAID_MEMBER, app=app):
        body = client.get(URL).json()
        assert body["status"] == "not_built" and body["next_run"]
        with ivr._lock:
            ivr._state["held"] = {"v": 1, "status": "ok", "session": "2026-11-20", "high": [], "low": [], "counts": {}}
        body = client.get(URL).json()
        assert body["status"] == "ok" and body["session"] == "2026-11-20" and "v" not in body

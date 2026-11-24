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


def test_a_file_whose_compressed_data_is_damaged_is_unread_never_a_failed_build(seeded):
    # A damaged deflate stream raises zlib.error, which is not an OSError: it must cost that one day, like a file
    # cut short, and never the whole evening's list.
    import io
    import zlib
    days = build_25(seeded)
    good = ivr.build(now=NOW)
    path = os.path.join(seeded.root, "options_log", days[10][:4], f"{days[10]}.underlyings.csv.gz")
    raw = open(path, "rb").read()
    damaged = None
    for k in range(12, len(raw) - 8):
        cand = bytearray(raw)
        cand[k] ^= 0xFF
        try:
            with gzip.open(io.BytesIO(bytes(cand)), "rt", newline="", encoding="utf-8") as fh:
                fh.read()
        except zlib.error:
            damaged = bytes(cand)
            break
        except Exception:  # noqa: BLE001 -- another kind of damage: try the next byte
            continue
    assert damaged is not None, "no single-byte change gave a damaged deflate stream"
    with open(path, "wb") as fh:
        fh.write(damaged)
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


# ── the catch-up: a 20:45 build lost to a restart heals itself ──────────────────────────────────

FRI_SLOT = dt.datetime(2026, 11, 20, 20, 45, tzinfo=ET)    # Friday's build
SAT = dt.datetime(2026, 11, 21, 9, 0, tzinfo=ET)


def _held(session, built) -> dict:
    """A held list of `session`, built at `built`, its `built_at` written the way `build` writes it."""
    return {"v": ivr.DISK_VERSION, "status": "ok", "session": session, "high": [], "low": [], "counts": {},
            "built_at": built.astimezone(dt.timezone.utc).isoformat(timespec="seconds")}


def test_the_last_slot_is_stepped_from_next_run_across_midnight_and_the_2045_boundary():
    assert ivr.last_slot(FRI_SLOT) == FRI_SLOT                                              # at 20:45 the slot has come
    assert ivr.last_slot(FRI_SLOT - dt.timedelta(seconds=1)) == FRI_SLOT - dt.timedelta(days=1)
    assert ivr.last_slot(dt.datetime(2026, 11, 21, 3, 0, tzinfo=ET)) == FRI_SLOT           # after midnight
    assert ivr.last_slot(dt.datetime(2026, 11, 21, 2, 0, tzinfo=dt.timezone.utc)) == FRI_SLOT   # a UTC moment
    t = dt.datetime(2026, 10, 20, 0, 7, tzinfo=ET)            # three weeks, across the November clock change
    while t < dt.datetime(2026, 11, 10, tzinfo=ET):
        s = ivr.last_slot(t)
        assert s <= t < ivr.next_run(s) and ivr.next_run(t) == ivr.next_run(s), t
        assert (s.hour, s.minute) == ivr.RUN_AT_ET, t
        t += dt.timedelta(minutes=37)


def test_the_target_is_the_last_session_whose_log_was_due_at_the_last_slot():
    assert not session_calendar.is_trading_day(dt.date(2026, 11, 26))                      # Thanksgiving
    cases = {
        dt.datetime(2026, 11, 20, 21, 0, tzinfo=ET): "2026-11-20",     # Friday, after the build
        dt.datetime(2026, 11, 20, 20, 44, tzinfo=ET): "2026-11-19",    # before it: Thursday's
        dt.datetime(2026, 11, 22, 21, 0, tzinfo=ET): "2026-11-20",     # a weekend evening: Friday's
        dt.datetime(2026, 11, 23, 10, 0, tzinfo=ET): "2026-11-20",     # Monday morning: still Friday's
        dt.datetime(2026, 11, 26, 21, 0, tzinfo=ET): "2026-11-25",     # a holiday evening: the day before
        dt.datetime(2026, 11, 27, 21, 0, tzinfo=ET): "2026-11-27",     # a half day is a session
    }
    for now, want in cases.items():
        assert ivr.target_session(now) == want, now


def test_behind_with_no_list_held_is_the_first_build():
    assert ivr.behind(None, SAT) is True


def test_a_list_of_the_target_session_is_current_and_an_older_one_built_before_the_slot_is_behind():
    assert ivr.behind(_held("2026-11-20", FRI_SLOT + dt.timedelta(minutes=1)), SAT) is False
    thursday_build = FRI_SLOT - dt.timedelta(days=1) + dt.timedelta(minutes=1)
    assert ivr.behind(_held("2026-11-19", thursday_build), SAT) is True                    # Friday's fire was lost


def test_a_list_built_since_the_slot_is_that_slots_build_even_when_the_log_held_nothing_newer():
    after = FRI_SLOT + dt.timedelta(minutes=1)
    assert ivr.behind(_held("2026-11-19", after), SAT) is False
    assert ivr.behind(_held(None, after) | {"status": "no_log"}, SAT) is False
    assert ivr.behind(_held(None, FRI_SLOT - dt.timedelta(minutes=1)) | {"status": "no_log"}, SAT) is True


def test_the_2045_boundary():
    thursday = _held("2026-11-19", FRI_SLOT - dt.timedelta(days=1) + dt.timedelta(minutes=1))
    assert ivr.behind(thursday, FRI_SLOT - dt.timedelta(seconds=1)) is False
    assert ivr.behind(thursday, FRI_SLOT) is True


@pytest.mark.parametrize("session, built_at", [("junk", None), (None, "yesterday"),
                                               ("2026-11-19", "2026-11-19T20:50:00")])   # the last names no zone
def test_a_session_or_build_time_that_cannot_be_read_counts_as_older(session, built_at):
    held = {"v": ivr.DISK_VERSION, "status": "ok", "session": session, "built_at": built_at}
    assert ivr.behind(held, SAT) is True


def test_with_no_target_the_held_list_is_kept(monkeypatch):
    monkeypatch.setattr(iv_history, "expected_sessions", lambda *a, **k: (_ for _ in ()).throw(KeyError("calendar")))
    assert ivr.target_session(SAT) is None
    assert ivr.behind(_held("2026-11-02", FRI_SLOT - dt.timedelta(days=9)), SAT) is False
    assert ivr.behind(None, SAT) is True


def test_behind_reads_the_build_time_build_writes(seeded):
    days = build_25(seeded)
    held = ivr.build(now=NOW)
    built = dt.datetime.fromisoformat(held["built_at"])
    assert held["session"] == days[-1]
    assert ivr.behind(held, built) is False                                         # built at or after its own slot
    assert ivr.behind({**held, "session": None}, built + dt.timedelta(days=2)) is True


def _stub_build(monkeypatch) -> list:
    started: list = []
    monkeypatch.setattr(ivr, "run_scheduled", lambda now=None: started.append(now) or {"started": True})
    return started


def test_the_catch_up_builds_when_no_list_is_held_and_is_current_after_it(seeded, monkeypatch):
    build_25(seeded)
    monkeypatch.setenv(FLAG, "1")
    assert ivr.catch_up(NOW) == {"started": True}
    ivr.drain()
    held = ivr._state["held"]
    assert held is not None and held["counts"]["ranked"] == 4
    monkeypatch.setattr(iv_history, "_store_override", None)
    monkeypatch.setattr(iv_history, "get_store", lambda: (_ for _ in ()).throw(AssertionError("read the log")))
    assert ivr.catch_up(dt.datetime.fromisoformat(held["built_at"])) == {"started": False, "reason": "current"}


def test_the_catch_up_keeps_every_guard_of_the_scheduled_build(seeded, monkeypatch):
    import threading
    build_25(seeded)
    monkeypatch.delenv(FLAG, raising=False)
    assert ivr.catch_up(NOW) == {"started": False, "reason": "off"}
    monkeypatch.setenv(FLAG, "1")
    assert ivr.catch_up(NOON) == {"started": False, "reason": "not_quiet"}
    with ivr._lock:
        ivr._state["inflight"] = threading.Event()
    assert ivr.catch_up(NOW) == {"started": False, "reason": "running"}
    with ivr._lock:
        ivr._state["inflight"].set()
        ivr._state["inflight"] = None
    assert ivr._state["held"] is None


def test_after_a_restart_the_catch_up_reads_the_disk_copy_and_builds_only_once_behind(seeded, monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    ivr._save_disk(_held("2026-11-20", FRI_SLOT + dt.timedelta(minutes=1)), {"at": None, "ok": True, "reason": None})
    ivr.reset_for_tests()                                                               # a new process
    started = _stub_build(monkeypatch)
    assert ivr.catch_up(SAT) == {"started": False, "reason": "current"}
    assert ivr.catch_up(dt.datetime(2026, 11, 22, 21, 0, tzinfo=ET)) == {"started": False, "reason": "current"}  # Sunday
    monday = dt.datetime(2026, 11, 23, 21, 0, tzinfo=ET)                              # Monday's 20:45 was lost
    assert started == [] and ivr.catch_up(monday) == {"started": True} and started == [monday]


def test_no_member_request_reaches_the_catch_up(seeded, monkeypatch):
    import inspect
    monkeypatch.setattr(ivr, "catch_up", lambda *a, **k: pytest.fail("a read path started the catch-up"))
    monkeypatch.setattr(ivr, "run_scheduled", lambda *a, **k: pytest.fail("a read path started a build"))
    assert ivr.get_leaders(NOW)["status"] == "not_built"
    assert "catch_up" not in inspect.getsource(router_mod)


def _boot_level_calls(life) -> list:
    """The names of the calls the lifespan makes itself (not inside a function it defines)."""
    import ast
    out: list = []

    def walk(node, nested):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                walk(child, True)
                continue
            if isinstance(child, ast.Call) and not nested:
                out.append(getattr(child.func, "attr", None) or getattr(child.func, "id", None) or "")
            walk(child, nested)
    walk(life, False)
    return out


def test_the_catch_up_is_a_date_job_after_boot_and_a_daily_retry_under_its_own_boot_mark():
    import ast
    from tests.test_insider_clusters_sec import _add_jobs, _kw, _lifespan, _lit
    src, life = _lifespan()
    jobs = _add_jobs(life)
    boot, retry = jobs["iv_rank_leaders_catchup_boot"], jobs["iv_rank_leaders_catchup"]
    assert "from api.services.research import iv_rank_leaders as _ivrl_cu" in src
    defs = {n.name: n for n in ast.walk(life) if isinstance(n, ast.FunctionDef)}
    for call in (boot, retry):
        body = ast.get_source_segment(src, defs[call.args[0].id])
        assert ".catch_up()" in body and "run_scheduled" not in body
    assert _lit(boot, "trigger") == "date" and _lit(boot, "kwargs") == {"source": "boot"}
    run_date = ast.unparse(_kw(boot, "run_date"))
    assert "now(_ET)" in run_date and "seconds=_ivrl_cu.CATCHUP_BOOT_DELAY_S" in run_date
    assert _lit(boot, "max_instances") == 1 and _lit(boot, "misfire_grace_time") >= 60
    assert ast.unparse(_kw(retry, "trigger")) == (
        "CronTrigger(hour=_ivrl_cu.CATCHUP_AT_ET[0], minute=_ivrl_cu.CATCHUP_AT_ET[1], timezone=_ET)")
    assert _lit(retry, "kwargs") == {"source": "retry"}
    assert (_lit(retry, "coalesce"), _lit(retry, "max_instances")) == (True, 1) and _lit(retry, "misfire_grace_time") >= 60
    at_boot = _boot_level_calls(life)
    assert "_boot_mark" in at_boot and "add_job" in at_boot                 # control: the walk sees the boot's calls
    assert not {"catch_up", "run_scheduled", "_iv_rank_leaders_catch_up_job", "_iv_rank_leaders_job"} & set(at_boot)
    marks = sorted((c.lineno, c.args[0].value) for c in ast.walk(life)
                   if isinstance(c, ast.Call) and getattr(c.func, "id", "") == "_boot_mark")
    names = [n for _, n in marks]
    assert names.count("IVR-catch-up") == 1
    i = names.index("IVR-catch-up")
    for call in (boot, retry):
        assert marks[i][0] < call.lineno < marks[i + 1][0]


def test_the_daily_retry_is_inside_the_quiet_span_every_day_and_after_the_evening_build():
    for day in range(16, 23):                                                 # a whole week
        assert ivr.quiet(dt.datetime(2026, 11, day, *ivr.CATCHUP_AT_ET, tzinfo=ET)), day
    assert ivr.RUN_AT_ET < ivr.CATCHUP_AT_ET                                  # the same evening it can heal

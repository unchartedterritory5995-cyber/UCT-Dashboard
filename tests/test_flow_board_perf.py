"""The Open Flow board / Confluence flow leg, made answerable (2026-10-11).

Measured in the flow-worker pod 2026-10-11: `/api/live/massive/flow-board` took 201 s and
`/api/live/massive/confluence-flow` 99 s, every time a cache expired. Two changes, two kinds
of rail:

1. The loader got faster (loose-index date scan, plain tuples, memoised pure parsers, a
   streamed cursor). Its output must be IDENTICAL, so the old loader is kept verbatim as an
   oracle (tests/_weekly_flow_loader_reference.py) and compared on a fixture built to hit
   every branch -- odd spellings, scrubbed numbers, NULLs, spreads, deep arb, lottery kills.
   Live-pod parity on 2026-10-11: 60d/all 207,530 trades, 30d/large 66,798, 5d/mid_small
   4,920, 5d/etf 12,924 -- every list equal, same sha256.
2. The answer stopped waiting for the build: a result past its TTL is served at once while
   ONE rebuild runs behind it, and the newest good result survives a restart on disk.
"""
import random
import sqlite3
import threading
import time
from datetime import date

import pytest

from api import weekly_flow as wf
from tests._weekly_flow_loader_reference import REFERENCE_SRC


def _reference():
    ns = dict(wf.__dict__)
    exec(compile(REFERENCE_SRC, "weekly_flow_reference", "exec"), ns)
    return ns["load_directional_trades"], ns["_last_n_dates"]


_COLS = ("source, CreatedDate, CreatedTime, Symbol, Type, Volume, Side, CallPut, Strike, Spot, "
         "Premium, ExpirationDate, Color, Dte, StockEtf, MktCap, OI")


def _seed(path, n=8000, seed=7):
    rnd = random.Random(seed)
    conn = sqlite3.connect(path)
    conn.execute(f"CREATE TABLE flow({_COLS.replace(',', ' TEXT,')} TEXT)")
    conn.execute("CREATE INDEX idx_flow_source_date ON flow(source, CreatedDate)")
    dates = ["7/%d/2026" % d for d in range(1, 29)] + ["", None, "8/1/2026", "08/01/2026"]
    types = ["SWEEP", "Sweep", "BLOCK", "blk", "ML/", "ML/ SWEEP", "SWP", "", None, "SPLIT"]
    sides = ["A", "AA", "ASK", "Above Ask", "B", "BB", "BELOW BID", "", None, "MID"]
    cps = ["CALL", "PUT", "C", "P", "call", "", None, "X"]
    colors = ["WHITE", "YELLOW", "Y", "MAGENTA", "purple", "ORANGE", "ARB", "", None]
    syms = ["AAPL", "NVDA", "smci", " TSLA ", "MU", "", None, "SPY", "QQQ", "XYZ"]
    exps = ["8/21/2026", "9/18/2026", "12/18/2026", "1/15/2027", "6/18/2027", "7/3/2026", "bad", ""]
    nums = lambda lo, hi: str(rnd.choice([rnd.randint(lo, hi), "%s" % rnd.randint(lo, hi),
                                          "$%d" % rnd.randint(lo, hi), "{:,}".format(rnd.randint(lo, hi)),
                                          " %d " % rnd.randint(lo, hi), "", "nan", "-%d" % rnd.randint(lo, hi)]))
    rows = []
    for i in range(n):
        spot = rnd.choice([100, 50, 250, 0, 12.5])
        strike = rnd.choice([spot * 0.5, spot * 0.85, spot, spot * 1.12, spot * 1.6, 10])
        t = ("10:00:%02d" % rnd.randint(0, 2) if rnd.random() < 0.15       # collisions -> spreads
             else "%02d:%02d:%02d" % (rnd.randint(9, 15), rnd.randint(0, 59), rnd.randint(0, 59)))
        rows.append((
            rnd.choice(["stocks", "stocks", "stocks", "indexes"]), rnd.choice(dates), t,
            rnd.choice(syms), rnd.choice(types), nums(0, 500), rnd.choice(sides), rnd.choice(cps),
            str(strike), str(spot), rnd.choice([nums(1000, 20_000_000), "30000", "12000000"]),
            rnd.choice(exps), rnd.choice(colors), rnd.choice(["45", "200", "3", "-1", "", "x"]),
            rnd.choice(["", "ETF", "INDEX", "stock"]),
            rnd.choice(["5000000000", "50000000000", "300000000000", "600000000000", "", "0"]),
            nums(0, 90_000)))
    conn.executemany(f"INSERT INTO flow({_COLS}) VALUES({','.join('?' * 17)})", rows)
    conn.commit()
    conn.close()


@pytest.fixture
def flowdb(tmp_path, monkeypatch):
    p = str(tmp_path / "flow.db")
    _seed(p)
    monkeypatch.setattr(wf, "_flow_db_path", lambda: p)
    return p


@pytest.mark.parametrize("days,min_dte,cap,mp,clean", [
    (60, 30, "all", 25000.0, False), (30, 30, "large", 25000.0, False),
    (5, 30, "mid_small", 0.0, False), (5, 30, "etf", 25000.0, False),
    (20, 0, "mega", 0.0, True), (10, 30, None, 100000.0, False)])
def test_the_fast_loader_returns_exactly_what_the_old_one_did(flowdb, days, min_dte, cap, mp, clean):
    ref_load, _ = _reference()
    ref = date(2026, 7, 20)
    want = ref_load(days, min_dte, cap, today=ref, min_premium=mp, clean_only=clean)
    got = wf.load_directional_trades(days, min_dte, cap, today=ref, min_premium=mp, clean_only=clean)
    # repr, not ==: a stored "nan" premium parses to a float NaN on both sides, and NaN != NaN.
    assert repr(got) == repr(want)
    assert len(got[0]) == len(want[0])


def test_CONTROL_the_fixture_reaches_the_branches_it_claims(flowdb):
    """Without this, parity over an empty result would pass for a broken loader."""
    out, window = wf.load_directional_trades(60, 0, "all", today=date(2026, 7, 20))
    assert len(window) > 20 and len(out) > 100
    assert {t["D"] for t in out} == {"BULL", "BEAR"}
    assert {t["Ty"] for t in out} == {"SWP", "BLK"}


def test_the_loose_date_scan_lists_the_same_sessions_as_DISTINCT(flowdb):
    _, ref_dates = _reference()
    conn = sqlite3.connect(flowdb)
    try:
        for src in ("stocks", "indexes", "nope"):
            for n in (0, 1, 5, 60):
                assert wf._last_n_dates(conn, n, src) == ref_dates(conn, n, src)
    finally:
        conn.close()


@pytest.mark.parametrize("v", ["12", " 12 ", "1,200", "$1,200", "", None, "nan", "-3", "1e3",
                               "abc", "12.75", 7, 7.5, "1_000"])
def test_the_fast_number_parsers_are_the_originals(v):
    assert wf._pfloat_fast(v) == wf._pfloat(v) or (v == "nan")
    assert wf._pint_fast(v) == wf._pint(v)


# ── the board answers without waiting for its build ───────────────────────────
@pytest.fixture
def board(monkeypatch, tmp_path):
    monkeypatch.setenv("FLOW_PRODUCT_PERSIST_DIR", str(tmp_path / "products"))
    wf._BOARD_CACHE.clear()
    calls = []
    gate = threading.Event()
    gate.set()

    def fake_compute(days, cap, min_dte, frac, limit):
        calls.append((days, cap))
        gate.wait(5)
        return {"ok": True, "rows": [{"sym": "N%d" % len(calls)}], "window": [], "n_names": 1,
                "open_contracts": 1, "days": days, "cap": cap, "min_dte": min_dte}

    monkeypatch.setattr(wf, "_board_compute", fake_compute)
    yield calls, gate
    wf._BOARD_CACHE.clear()


def _wait(pred, s=5.0):
    t = time.time()
    while time.time() - t < s:
        if pred():
            return True
        time.sleep(0.01)
    return False


def test_a_cold_board_builds_once_and_says_when(board):
    calls, _ = board
    r = wf.board_data(days=60, cap="all")
    assert r["ok"] and r["rows"] == [{"sym": "N1"}] and isinstance(r["built_at"], float)
    assert wf.board_data(days=60, cap="all") is r and len(calls) == 1


def test_an_expired_board_is_served_AT_ONCE_and_rebuilt_behind_the_caller(board):
    calls, gate = board
    wf.board_data(days=60, cap="all")
    ckey = (60, "all", 30, 0.75, 300)
    at, res = wf._BOARD_CACHE[ckey]
    wf._BOARD_CACHE[ckey] = (at - wf._BOARD_TTL - 1, res)
    gate.clear()                                   # the rebuild will block until released
    t0 = time.time()
    got = wf.board_data(days=60, cap="all")
    assert time.time() - t0 < 1.0 and got["rows"] == [{"sym": "N1"}]
    assert _wait(lambda: len(calls) == 2)
    wf.board_data(days=60, cap="all")              # a second caller during the rebuild
    gate.set()
    assert _wait(lambda: wf._BOARD_CACHE[ckey][1]["rows"] == [{"sym": "N2"}])
    assert len(calls) == 2, "two callers past the TTL started two rebuilds"


def test_a_board_past_the_stale_limit_is_rebuilt_inline(board):
    calls, _ = board
    wf.board_data(days=60, cap="all")
    ckey = (60, "all", 30, 0.75, 300)
    at, res = wf._BOARD_CACHE[ckey]
    wf._BOARD_CACHE[ckey] = (at - wf._BOARD_STALE_MAX_S - 1, res)
    assert wf.board_data(days=60, cap="all")["rows"] == [{"sym": "N2"}]


def test_the_board_survives_a_restart_from_disk(board):
    calls, _ = board
    first = wf.board_data(days=30, cap="mega", limit=50)
    wf._BOARD_CACHE.clear()                        # a redeploy
    again = wf.board_data(days=30, cap="mega", limit=50)
    assert again == first and len(calls) == 1


def test_CONTROL_persistence_is_off_outside_railway_unless_asked(monkeypatch):
    monkeypatch.delenv("FLOW_PRODUCT_PERSIST_DIR", raising=False)
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
    monkeypatch.delenv("RAILWAY_ENVIRONMENT_NAME", raising=False)
    assert wf.product_persist_dir() is None
    monkeypatch.setenv("FLOW_PRODUCT_PERSIST_DIR", "")
    assert wf.product_persist_dir() is None


def test_a_failed_build_with_nothing_cached_still_answers_honestly(monkeypatch, tmp_path):
    monkeypatch.setenv("FLOW_PRODUCT_PERSIST_DIR", str(tmp_path))
    wf._BOARD_CACHE.clear()
    monkeypatch.setattr(wf, "_board_compute", lambda *a: (_ for _ in ()).throw(RuntimeError("boom")))
    r = wf.board_data(days=7, cap="all")
    assert r["ok"] is False and r["rows"] == []
    wf._BOARD_CACHE.clear()


# ── the Confluence flow leg ───────────────────────────────────────────────────
@pytest.fixture
def leg(monkeypatch, tmp_path):
    from api import confluence_flow as cf
    monkeypatch.setenv("FLOW_PRODUCT_PERSIST_DIR", str(tmp_path / "products"))
    cf._CACHE.clear()
    calls = []

    def fake(days, min_dte, cap, frac):
        calls.append(days)
        return {"ok": True, "names": {"N%d" % len(calls): {}}, "days": days, "cap": cap}

    monkeypatch.setattr(cf, "_compute", fake)
    yield cf, calls
    cf._CACHE.clear()


def test_an_expired_leg_is_served_and_refreshed_off_hours(leg, monkeypatch):
    cf, calls = leg
    monkeypatch.setattr(cf, "_is_rth", lambda: False)
    cf.flow_leg(days=30, cap="all")
    ckey = (30, 30, "all", 0.75)
    at, res = cf._CACHE[ckey]
    cf._CACHE[ckey] = (at - cf._TTL - 1, res)
    assert cf.flow_leg(days=30, cap="all")["names"] == {"N1": {}}
    assert _wait(lambda: cf._CACHE[ckey][1]["names"] == {"N2": {}})


def test_during_the_session_an_expired_leg_is_served_and_NOT_recomputed(leg, monkeypatch):
    cf, calls = leg
    monkeypatch.setattr(cf, "_is_rth", lambda: True)
    cf.flow_leg(days=30, cap="all")
    ckey = (30, 30, "all", 0.75)
    at, res = cf._CACHE[ckey]
    cf._CACHE[ckey] = (at - cf._TTL - 1, res)
    assert cf.flow_leg(days=30, cap="all")["names"] == {"N1": {}}
    time.sleep(0.2)
    assert calls == [30]


def test_the_leg_survives_a_restart_from_disk(leg, monkeypatch):
    cf, calls = leg
    first = cf.flow_leg(days=5, cap="large")
    cf._CACHE.clear()
    assert cf.flow_leg(days=5, cap="large") == first and calls == [5]


def test_the_warm_loop_rebuilds_serially_in_its_own_thread(leg, monkeypatch):
    cf, calls = leg
    cf.warm_all()
    assert sorted(calls) == [5, 5, 30, 30]
    cf.warm_all()                                   # all fresh: nothing rebuilt
    assert len(calls) == 4

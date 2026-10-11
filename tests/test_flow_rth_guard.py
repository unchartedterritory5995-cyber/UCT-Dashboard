"""Pre-open review of the 2026-10-11 flow perf lanes: they must not compete with the live tape.

The OPRA consumer is a thread in the same flow-worker process, so a pure-Python board scan or a
heavy Search read competes with it for the GIL. Measured on the pod 2026-10-11:
  * SNDK (510,440 rows) and MU (734,540 rows) both hit the heavy lane's 180 s node timeout after
    a ~33 s read -- and nothing remembered it, so every member search re-ran that 3.5 min build
    every refresh window (300 s), all session long.
  * a 60-day board build is ~116 s of Python; stamped at its START, it is already past the
    120 s TTL when it lands, so a page polling every 120 s kept one rebuilding back to back.
  * `days`/`limit`/`cap` reached the scan unvalidated: any member could ask for days=5000.
"""
import subprocess
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api import confluence_flow as cf
from api import flow_router as fr
from api import weekly_flow as wf


def _et(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=ZoneInfo("America/New_York"))


MON_OPEN = _et(2026, 10, 12, 9, 40)      # inside the open rush
MON_MID = _et(2026, 10, 12, 11, 30)      # RTH, after the rush
MON_PRE = _et(2026, 10, 12, 8, 0)        # pre-market
SUN = _et(2026, 10, 11, 13, 40)


# ── the clock gates ──────────────────────────────────────────────────────────
@pytest.mark.parametrize("now,quiet,rth", [
    (MON_OPEN, True, True), (MON_MID, False, True), (MON_PRE, False, False),
    (SUN, False, False), (_et(2026, 10, 12, 9, 25), True, False), (_et(2026, 10, 12, 10, 5), False, True),
])
def test_the_open_rush_and_session_windows(monkeypatch, now, quiet, rth):
    monkeypatch.setattr(wf, "_now_et", lambda: now)
    assert wf.ingest_quiet_now() is quiet
    assert wf.in_rth_now() is rth


def test_the_quiet_window_can_be_turned_off(monkeypatch):
    monkeypatch.setattr(wf, "_now_et", lambda: MON_OPEN)
    monkeypatch.setenv("FLOW_INGEST_QUIET_ET", "")
    assert wf.ingest_quiet_now() is False


# ── the board ────────────────────────────────────────────────────────────────
@pytest.fixture
def board(monkeypatch, tmp_path):
    monkeypatch.setenv("FLOW_PRODUCT_PERSIST_DIR", str(tmp_path / "products"))
    wf._BOARD_CACHE.clear()
    calls = []

    def fake_compute(days, cap, min_dte, frac, limit):
        calls.append((days, cap, limit))
        return {"ok": True, "rows": [], "window": [], "n_names": 0, "open_contracts": 0,
                "days": days, "cap": cap, "min_dte": min_dte}

    monkeypatch.setattr(wf, "_board_compute", fake_compute)
    yield calls
    wf._BOARD_CACHE.clear()


def _age_board(seconds):
    ckey = (60, "all", 30, 0.75, 300)
    at, res = wf._BOARD_CACHE[ckey]
    wf._BOARD_CACHE[ckey] = (time.time() - seconds, res)


def _settle():
    for t in list(threading.enumerate()):
        if t.name == "flow-board-refresh":
            t.join(5)


@pytest.mark.parametrize("now,age,rebuilds", [
    (MON_OPEN, 3600, False),    # the open rush: the stale board is served, nothing scans
    (MON_MID, 300, False),      # the session: past the 120 s TTL but under the RTH interval
    (MON_MID, 700, True),       # the session: due
    (SUN, 300, True),           # off hours: the 120 s TTL as before
])
def test_a_stale_board_is_rebuilt_only_when_the_tape_can_spare_it(board, monkeypatch, now, age, rebuilds):
    monkeypatch.setattr(wf, "_now_et", lambda: now)
    wf.board_data(days=60, cap="all")
    _age_board(age)
    got = wf.board_data(days=60, cap="all")
    assert got["ok"]
    _settle()
    assert (len(board) == 2) is rebuilds


def test_a_board_with_nothing_to_serve_still_builds_in_the_rush(board, monkeypatch):
    monkeypatch.setattr(wf, "_now_et", lambda: MON_OPEN)
    assert wf.board_data(days=60, cap="all")["ok"] and len(board) == 1


def test_board_params_are_clamped_before_they_reach_the_scan(board, monkeypatch):
    monkeypatch.setattr(wf, "_now_et", lambda: SUN)
    wf.board_data(days=5000, cap="bogus", limit=10 ** 9)
    wf.board_data(days=-3, cap="MEGA", limit=0)
    assert board == [(wf._SCAN_MAX_DAYS, "all", 1000), (1, "mega", 1)]


def test_confluence_params_are_clamped(monkeypatch, tmp_path):
    monkeypatch.setenv("FLOW_PRODUCT_PERSIST_DIR", str(tmp_path))
    cf._CACHE.clear()
    seen = []
    monkeypatch.setattr(cf, "_compute", lambda days, min_dte, cap, frac: seen.append((days, cap)) or
                        {"ok": True, "names": {}})
    cf.flow_leg(days=9999, cap="nope")
    assert seen == [(wf._SCAN_MAX_DAYS, "all")]
    cf._CACHE.clear()


# ── the heavy Search lane ────────────────────────────────────────────────────
@pytest.fixture
def heavy(monkeypatch, tmp_path):
    monkeypatch.setenv("FLOW_PRODUCT_PERSIST_DIR", str(tmp_path / "products"))
    monkeypatch.setattr(fr.flow_aggregate, "available", lambda: True)
    monkeypatch.setattr(fr, "_search_product_cache_put", lambda k, v: None)
    monkeypatch.setattr(fr, "_search_freshness", lambda sym, src: "100.0")
    monkeypatch.setattr(fr, "_symbol_session_counts", lambda sym: [("10/9/2026", 10)])

    class _DB:
        def stream_csv_symbol(self, sym, source="stocks", columns=None, dates=None):
            yield b"Symbol,Premium\n"
            yield b"MU,1\n"
    monkeypatch.setattr(fr, "db", _DB())

    def _clear():
        with fr._HEAVY_GUARD:
            fr._HEAVY_INFLIGHT.clear()
            fr._HEAVY_LAST_START.clear()
            fr._HEAVY_TOO_BIG_UNTIL.clear()
        with fr._LAST_GOOD_LOCK:
            fr._LAST_GOOD.clear()
            fr._LAST_GOOD_DISK_MISS.clear()
    _clear()
    yield
    _clear()


def test_a_heavy_build_that_times_out_sits_out_instead_of_repeating(heavy, monkeypatch):
    def _timeout(*a, **k):
        raise subprocess.TimeoutExpired(cmd="node", timeout=180)
    monkeypatch.setattr(fr.subprocess, "run", _timeout)
    monkeypatch.setattr(wf, "_now_et", lambda: SUN)
    assert fr._heavy_build_now("MU", "stocks") == "failed"
    with fr._HEAVY_GUARD:
        fr._HEAVY_LAST_START.clear()          # past the refresh window
    assert fr._spawn_heavy_build("MU", "stocks") is False


def test_no_heavy_build_starts_in_the_open_rush(heavy, monkeypatch):
    monkeypatch.setattr(fr, "_heavy_build_now", lambda s, src: "built")
    monkeypatch.setattr(wf, "_now_et", lambda: MON_OPEN)
    assert fr._spawn_heavy_build("NVDA", "stocks") is False
    monkeypatch.setattr(wf, "_now_et", lambda: MON_MID)
    assert fr._spawn_heavy_build("NVDA", "stocks") is True


def test_concurrent_persists_of_one_name_never_collide(monkeypatch, tmp_path):
    """Every writer has its own temp file: two threads persisting one name must both succeed
    and leave one whole document (a shared `.tmp<pid>` let one rename the other's half-file)."""
    monkeypatch.setenv("FLOW_PRODUCT_PERSIST_DIR", str(tmp_path))
    names = []
    real_open = open

    def spy_open(path, *a, **k):
        if ".tmp" in str(path):
            names.append(str(path))
        return real_open(path, *a, **k)
    monkeypatch.setattr("builtins.open", spy_open)
    ts = [threading.Thread(target=wf.persisted_json_put, args=("board_x", 1.0, {"n": i})) for i in range(4)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert len(set(names)) == len(names) == 4
    assert wf.persisted_json_get("board_x") is not None


def test_the_boot_prewarm_waits_out_the_open_rush(monkeypatch):
    """A pod that (re)boots at 09:31 must not start head-ticker builds on top of the open."""
    monkeypatch.setenv("FLOW_SEARCH_HEAVY_PREWARM", "NVDA")
    monkeypatch.setattr(fr, "_PREWARM_POLL_S", 0.01)
    quiet = {"on": True}
    built = []
    monkeypatch.setattr(fr, "_ingest_quiet_now", lambda: quiet["on"])
    monkeypatch.setattr(fr, "_heavy_build_now", lambda s, src: built.append(s) or "built")
    assert fr.start_heavy_prewarm(delay_s=0) is True
    time.sleep(0.3)
    assert built == [], "a prewarm build started inside the open rush"
    quiet["on"] = False
    t = time.time()
    while not built and time.time() - t < 5:
        time.sleep(0.01)
    assert built == ["NVDA"]


def test_the_default_prewarm_names_are_the_ones_the_heavy_lane_can_build():
    """SNDK and MU time out in node at 180 s on the pod (2026-10-11, twice): prewarming them cost
    ~7-11 minutes of a 2 GB node build on every boot, for nothing."""
    import inspect
    src = inspect.getsource(fr.start_heavy_prewarm)
    assert '"NVDA,TSLA"' in src and "SNDK" not in src.split("os.environ.get")[1].split(")")[0]

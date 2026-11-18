"""Rails for the web pod's background lane (api/services/bg_lane.py) and the sweeps wired into it.

The defect (production web, 2026-11-17): for ~15 minutes after every restart a dozen member-invisible
sweeps ran at once and starved every request of the interpreter (`/api/health` p50 1.2-1.6 s at the
edge for 16 minutes, 6-58 ms after). The lane's three rules: nothing before the settle window, one
item at a time, a bounded share of the clock. Plus the contract that keeps the worker safe: inert in
any process that did not activate it.
"""
from __future__ import annotations

import importlib
import pathlib
import threading
import time

import pytest

from api.services import bg_lane

ROOT = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture
def lane(monkeypatch):
    monkeypatch.delenv(bg_lane.ENV_ENABLED, raising=False)
    monkeypatch.setenv(bg_lane.ENV_SETTLE, "0")
    monkeypatch.setenv(bg_lane.ENV_DUTY, "0.25")
    monkeypatch.setattr(bg_lane, "SETTLE_POLL_S", 0.02)
    bg_lane._reset_for_tests(active=True)
    yield bg_lane
    bg_lane._reset_for_tests(active=False)


# ── the lane itself ─────────────────────────────────────────────────────────────────────────────

def test_inert_until_the_web_lifespan_activates_it(monkeypatch):
    """The worker runs the weekly purge SYNCHRONOUSLY and its R2 uploader waits for it: in any
    process that never called activate(), a turn must neither wait nor pace."""
    importlib.reload(bg_lane)                           # the import-time default, not a test helper's
    monkeypatch.setenv(bg_lane.ENV_SETTLE, "3600")
    monkeypatch.setattr(bg_lane, "SETTLE_POLL_S", 0.05)

    def five():
        for _ in range(5):
            with bg_lane.turn("x"):
                time.sleep(0.01)
    assert _finishes_within(2.0, five), "a turn waited in a process that never activated the lane"
    assert bg_lane.stats()["sweeps"] == {} and bg_lane.enabled() is False


def _finishes_within(seconds, fn):
    """Run `fn` on a daemon thread: a lane that wrongly waits fails the rail in seconds, not after
    the hour-long settle window it set."""
    th = threading.Thread(target=fn, daemon=True)
    th.start()
    th.join(seconds)
    return not th.is_alive()


def test_the_kill_switch_makes_it_a_pass_through(lane, monkeypatch):
    monkeypatch.setenv(bg_lane.ENV_ENABLED, "0")
    monkeypatch.setenv(bg_lane.ENV_SETTLE, "3600")

    def one():
        with lane.turn("x"):
            time.sleep(0.05)
    assert _finishes_within(2.0, one), "a turn waited with BG_LANE_ENABLED=0"


def test_no_item_starts_before_the_settle_window(lane, monkeypatch):
    monkeypatch.setenv(bg_lane.ENV_SETTLE, "0.4")
    lane._reset_for_tests(active=True)                  # t0 = now
    started = []
    with lane.turn("x"):
        started.append(time.monotonic() - lane._t0)
    assert started[0] >= 0.39
    assert lane.stats()["sweeps"]["x"]["settle_wait_s"] >= 0.3


def test_one_item_at_a_time_across_threads(lane, monkeypatch):
    monkeypatch.setenv(bg_lane.ENV_DUTY, "1.0")         # no pause: overlap is the only thing measured
    spans, guard = [], threading.Lock()

    def sweep(name):
        for _ in range(6):
            with lane.turn(name):
                a = time.perf_counter()
                time.sleep(0.01)
                with guard:
                    spans.append((a, time.perf_counter()))

    ths = [threading.Thread(target=sweep, args=("s%d" % i,)) for i in range(3)]
    for th in ths:
        th.start()
    for th in ths:
        th.join(10)
    spans.sort()
    assert len(spans) == 18
    assert all(spans[i][1] <= spans[i + 1][0] + 1e-4 for i in range(len(spans) - 1)), "two items overlapped"


def test_lane_work_uses_at_most_its_duty_share_of_the_clock(lane):
    busy = 0.0
    t = time.perf_counter()
    for _ in range(8):
        with lane.turn("x"):
            a = time.perf_counter()
            time.sleep(0.02)
            busy += time.perf_counter() - a
    wall = time.perf_counter() - t
    assert busy / wall <= 0.25 + 0.03, (busy, wall)
    s = lane.stats()["sweeps"]["x"]
    assert s["items"] == 8 and s["paused_s"] >= 3 * s["busy_s"] * 0.9


def test_the_pause_follows_the_item_and_is_capped():
    assert bg_lane.pause_for(0.1, 0.2) == pytest.approx(0.4)
    assert bg_lane.pause_for(1000.0, 0.2) == bg_lane.MAX_PAUSE_S
    assert bg_lane.pause_for(0.1, 1.0) == 0.0


@pytest.mark.parametrize("raw,want", [(None, 600.0), ("", 600.0), ("abc", 600.0), ("-5", 600.0),
                                      ("99999", 600.0), ("nan", 600.0), ("120", 120.0)])
def test_a_bad_settle_value_is_the_default_never_an_extreme(raw, want):
    env = {} if raw is None else {bg_lane.ENV_SETTLE: raw}
    assert bg_lane.settle_s(env) == want


@pytest.mark.parametrize("raw,want", [(None, 0.2), ("0", 0.2), ("5", 0.2), ("x", 0.2), ("0.5", 0.5)])
def test_a_bad_duty_value_is_the_default_never_an_extreme(raw, want):
    env = {} if raw is None else {bg_lane.ENV_DUTY: raw}
    assert bg_lane.duty(env) == want


def test_a_nested_turn_on_one_thread_does_not_deadlock(lane):
    done = []

    def run():
        with lane.turn("outer"):
            with lane.turn("inner"):
                done.append(1)

    th = threading.Thread(target=run, daemon=True)     # a deadlock must fail the test, not hang the run
    th.start()
    th.join(5)
    assert done == [1] and not th.is_alive()


# ── who activates it ────────────────────────────────────────────────────────────────────────────

def test_only_the_web_lifespan_activates_the_lane():
    hits = [p.relative_to(ROOT).as_posix() for p in (ROOT / "api").rglob("*.py")
            if "bg_lane.activate(" in p.read_text(encoding="utf-8", errors="replace")]
    assert hits == ["api/main.py"], hits
    main = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    # once, and inside the web lifespan: the worker / bars-api / flow-worker mains run their OWN
    # lifespans and import api.main without running this one, so the lane stays off there
    assert main.count("bg_lane.activate(") == 1
    life = main[main.index("async def lifespan(app: FastAPI):"):]
    at = life.index("bg_lane.activate(_BOOT_T0)")
    # before anything that takes a turn is started
    assert at < life.index("purge_mis_keyed_weekly_rows_async()")
    assert at < life.index("sweep_async(delay_s=120)")
    assert at < life.index("exchange breadth authority replica sync started")


# ── the sweeps wired into it ────────────────────────────────────────────────────────────────────

@pytest.fixture
def turns(monkeypatch):
    seen = []
    real = bg_lane.turn

    def spy(name):
        seen.append(name)
        return real(name)

    monkeypatch.setattr(bg_lane, "turn", spy)
    bg_lane._reset_for_tests(active=False)
    return seen


@pytest.fixture
def store(tmp_path, monkeypatch):
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    c = bars_sqlite._conn()
    rows = []
    for tkr in ("AAA", "BBB", "CCC"):
        rows += [(tkr, "D", 20261113, 10, 11, 9, 10, 100), (tkr, "W", 20261113, 10, 11, 9, 10, 100),
                 (tkr, "5", 1794600000, 10, 11, 9, 10, 100)]
    c.executemany("INSERT INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)", rows)
    c.commit()
    yield
    bars_sqlite.bump_db_epoch()


def test_the_weekly_purge_takes_one_turn_per_ticker(store, turns):
    from api.services import bars_sqlite
    bars_sqlite.purge_mis_keyed_weekly_rows()
    assert turns.count("weekly-key-purge") == 3


def test_the_offgrid_sweep_takes_one_turn_per_ticker(store, turns):
    from api.services import intraday_grid
    intraday_grid.sweep(tickers=["AAA", "BBB", "CCC"])
    assert turns.count("bars-offgrid-sweep") == 3


def test_a_background_audit_takes_one_turn_per_ticker_and_an_admin_audit_none(turns, monkeypatch, tmp_path):
    from api.services import bars_audit
    monkeypatch.setattr(bars_audit, "_DB_PATH", str(tmp_path / "audit.db"))
    monkeypatch.setattr(bars_audit, "_AUDIT_DIR", str(tmp_path / "audits"))
    monkeypatch.setattr(bars_audit, "audit_ticker",
                        lambda t, tfs, counts: {"bars_scanned": 1, "issues": []})
    bars_audit.audit_universe(["A", "B", "C", "D"], scope="continuous-universe", lane="continuous-universe")
    assert turns.count("continuous-universe") == 4
    turns.clear()
    bars_audit.audit_universe(["A", "B"], scope="priority")
    assert turns == []


def test_a_lane_audit_uses_one_worker_so_it_does_not_crowd_the_repairs(lane, monkeypatch, tmp_path):
    """Four workers queueing for a one-at-a-time lane took four turns in six from the weekly purge
    and the off-grid repair. With the lane active a lane audit runs on one worker."""
    from api.services import bars_audit
    monkeypatch.setenv(bg_lane.ENV_DUTY, "1.0")
    monkeypatch.setattr(bars_audit, "_DB_PATH", str(tmp_path / "audit.db"))
    monkeypatch.setattr(bars_audit, "_AUDIT_DIR", str(tmp_path / "audits"))
    names = set()

    def fake(t, tfs, counts):
        names.add(threading.current_thread().name)
        time.sleep(0.01)
        return {"bars_scanned": 1, "issues": []}
    monkeypatch.setattr(bars_audit, "audit_ticker", fake)
    bars_audit.audit_universe(["A", "B", "C", "D", "E", "F", "G", "H"], scope="s", lane="s")
    assert len(names) == 1, names


def test_the_background_audit_callers_name_a_lane():
    cont = (ROOT / "api" / "services" / "bars_continuous_audit.py").read_text(encoding="utf-8")
    assert "scope=PRIORITY_SCOPE, lane=PRIORITY_SCOPE" in cont
    assert "scope=UNIVERSE_SCOPE, lane=UNIVERSE_SCOPE" in cont
    main = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    assert 'lane="startup-priority-audit"' in main
    assert 'scope="deploy-smoke", lane="deploy-smoke"' in main


def test_the_split_heal_and_breadth_heal_run_inside_a_turn():
    heal = (ROOT / "api" / "services" / "intraday_split_heal.py").read_text(encoding="utf-8")
    job = heal[heal.index("def _job():"):][:900]
    assert job.index('bg_lane.turn("intraday-split-heal")') < job.index("res = heal_ticker(tk)")
    bsh = (ROOT / "api" / "services" / "breadth_self_heal.py").read_text(encoding="utf-8")
    auto = bsh[bsh.index("def maybe_auto_heal"):bsh.index("def start_background_heal")]
    assert auto.index('bg_lane.turn("breadth-auto-heal")') < auto.index("heal_recent(5)")
    boot = bsh[bsh.index("def start_background_heal"):]
    assert boot.index('bg_lane.turn("breadth-self-heal-boot")') < boot.index("res = heal_recent(10)")
    main = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    loop = main[main.index("def _breadth_heal_loop():"):][:700]
    assert loop.index('bg_lane.turn("breadth-self-heal-loop")') < loop.index("heal_recent(10)")

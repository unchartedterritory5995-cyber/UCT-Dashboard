"""A bars background refresh ends with the test that started it.

THE FLAKE (master deploy gate 45085093354 on 2026-11-22, PR runs 45056547092 and 45015805620; about 1 run in 100):

    tests/test_bars_since_index_scan.py::test_date_tf_since_iso_string_converts_to_int_key
    assert ['2026-11-20'] == ['2026-06-15', '2026-06-16']

THE CAUSE, each step measured (the runs are in the pull request that added this file):

  1. `tests/test_bars_server_timing.py::test_layer_stale_swr_on_daily_rows` stored ONE AAPL daily row dated the last
     session and asked `bars_fetch._get_bars_inner` for it. That serves the row and starts the
     stale-while-revalidate refresh: a daemon thread named `bars-bg-AAPL-D`. No provider was stubbed. A runner
     holds no Massive key, so `_fill_daily_tail_with_yf` asked Yahoo, over the network, for AAPL. The test returned
     at once. The thread did not.
  2. When Yahoo answered, `_delta_daily` kept the rows at or after the stored one (exactly one: the last session)
     and the thread wrote it with `put_bars` into whatever `bars_sqlite._DB_PATH` named BY THEN: a later test's
     temp store. Nothing knew the thread was still running: it registers in `bars_fetch._inflight`, and that
     file's own `fresh` fixture clears `_inflight` before the next test (which is why a drain that waited on
     `_inflight`, #2365, did not hold: reverted in bd8ce6e230).
  3. 39 tests later test_bars_since_index_scan re-points the store, writes 06-10 .. 06-16 and reads `since` 06-12.
     Whenever the write of step 2 landed between its `init_db` and its read, the store held its five rows AND the
     last session, the read returned 06-15, 06-16, 11-20, and the serve path's listing cutoff
     (`bars_sanitize._apply_listing_cutoff`: a long hole in the dates starts a new listing) kept only what follows
     the hole. Hence exactly one bar, the last session's, and neither of the stored ones.

THE RULE (tests/conftest.py `pytest_runtest_call`): when a test's body returns, pytest waits for every bars refresh
thread still running (`BARS_REFRESH_THREADS`) and for every job the bars work pools have accepted
(`BARS_WORK_POOLS`) before any fixture is undone, so the write lands in the store of the test that started it.
test_1 and test_2 below are the leak above, in order, with the provider's latency replaced by a provider that
answers at the worst moment: without the rule test_2 reads the last session and nothing else. test_4 and test_5 are
the same leak through the cold pool (their own heading says where that one was seen).
"""
import os
import sqlite3
import threading
import time
from unittest.mock import patch

import orjson
import pytest

from api.services import bars_fetch, bars_sqlite
from api.services.cache import cache as _cache

#: How long the late provider waits for a LATER test's store before it answers anyway. With the rule in place the
#: store is never re-pointed while it waits (pytest is waiting for it), so this is what the pair costs: keep it small.
LATE_PROVIDER_WAITS_S = 1.0
JUNE = ("2026-06-10", "2026-06-11", "2026-06-12", "2026-06-15", "2026-06-16")

#: What the first test hands the second: the refresh thread it started, and the store it started it in.
_STARTED: dict = {}


def _own_store(tmp_path, monkeypatch) -> str:
    """What every bars rail's `fresh` / `fresh_db` fixture does: re-point the store at a file of this test's own."""
    path = str(tmp_path / "bars.db")
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", path)
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    _cache._store.clear()
    return path


def _aapl_daily(path: str) -> list:
    """(ts, close) of every AAPL daily row in the FILE at `path`, read on a connection of its own ([] if none)."""
    if not os.path.exists(path):
        return []
    c = sqlite3.connect(path)
    try:
        return c.execute("SELECT ts, c FROM ohlcv WHERE ticker='AAPL' AND tf='D' ORDER BY ts").fetchall()
    except sqlite3.OperationalError:          # no table yet
        return []
    finally:
        c.close()


def test_1_a_test_starts_a_refresh_whose_provider_answers_late(tmp_path, monkeypatch):
    """The body of tests/test_bars_server_timing.py::test_layer_stale_swr_on_daily_rows as it stood, with Yahoo
    replaced by a provider that answers only once a LATER test's store holds that test's rows (or, when no later
    test ever gets the store while it waits, after LATE_PROVIDER_WAITS_S)."""
    mine = _own_store(tmp_path, monkeypatch)
    session = str(bars_fetch._last_weekday_yyyymmdd())
    last_session = f"{session[:4]}-{session[4:6]}-{session[6:]}"
    bars_sqlite.put_bars("AAPL", "D", [{"t": last_session, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}], date_tf=True)
    asked = threading.Event()

    def _late_provider(sym, last_ts):
        asked.set()
        deadline = time.monotonic() + LATE_PROVIDER_WAITS_S
        while time.monotonic() < deadline:
            now = bars_sqlite._DB_PATH
            if now != mine and (int(JUNE[-1].replace("-", "")), 1.5) in _aapl_daily(now):
                break
            time.sleep(0.005)
        return [{"t": last_session, "o": 9, "h": 9.5, "l": 8.5, "c": 9, "v": 1}]

    monkeypatch.setattr(bars_fetch, "_delta_daily", _late_provider)
    before = set(threading.enumerate())
    bars_fetch._get_bars_inner("AAPL", "D", 1)
    assert bars_fetch.get_serve_layer() == "stale-swr"
    started = [t for t in threading.enumerate() if t not in before and t.name == "bars-bg-AAPL-D"]
    assert len(started) == 1, [t.name for t in threading.enumerate()]
    assert asked.wait(5), "the refresh thread never asked its provider"
    _STARTED.update(thread=started[0], store=mine, last_session=last_session)


def test_2_the_next_test_reads_only_what_it_wrote(tmp_path, monkeypatch):
    """The body of tests/test_bars_since_index_scan.py::test_date_tf_since_iso_string_converts_to_int_key in a store
    of its own, right after test_1. The refresh test_1 started must have ended in test_1's store."""
    if "thread" not in _STARTED:
        pytest.skip("runs right after test_1 in this file (it is the second half of one ordered pair)")
    mine = _own_store(tmp_path, monkeypatch)
    bars_sqlite.put_bars("AAPL", "D", [{"t": d, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10} for d in JUNE], date_tf=True)
    _STARTED["thread"].join(10)               # a refresh still running ends when its provider answers
    assert not _STARTED["thread"].is_alive()

    with patch.object(bars_fetch, "_needs_fresh", return_value=False):
        resp = bars_fetch._get_bars_since_response("AAPL", "D", 5000, "2026-06-12")

    got = [b["t"] for b in orjson.loads(bytes(resp.body))["bars"]]
    session = int(_STARTED["last_session"].replace("-", ""))
    assert got == ["2026-06-15", "2026-06-16"], (
        f"served {got}; this test's store holds {_aapl_daily(mine)}; test_1's holds {_aapl_daily(_STARTED['store'])}")
    assert [ts for ts, _c in _aapl_daily(mine)] == [int(d.replace("-", "")) for d in JUNE]
    # ...and the refresh did run: its row (close 9) replaced the stored one (close 1.5) in the store it started in.
    assert _aapl_daily(_STARTED["store"]) == [(session, 9.0)]


def test_3_the_rule_sees_both_refreshes_by_the_names_bars_fetch_gives_them(tmp_path, monkeypatch, request):
    """`BARS_REFRESH_THREADS` is two name prefixes. test_1 started the first through `_get_bars_inner`; this starts
    the second through the `since=` poll's own door, and reads both off the module pytest itself runs."""
    import tests.conftest as rule
    assert request.config.pluginmanager.is_registered(rule), "a second copy of tests/conftest.py, not the plugin"
    assert _STARTED.get("thread") is None or _STARTED["thread"].name.startswith(rule.BARS_REFRESH_THREADS)
    _own_store(tmp_path, monkeypatch)
    asked, answer = threading.Event(), threading.Event()
    monkeypatch.setattr(bars_fetch, "_delta_daily", lambda *a, **k: (asked.set(), answer.wait(10), [])[-1])
    try:
        bars_fetch._enqueue_since_bg_heal("bars_AAPL_D_5000", "AAPL", "D", 20260616, True)
        assert asked.wait(5), "the since= refresh never asked its provider"
        assert [t.name for t in rule.live_bars_refreshes()] == ["bars-sincebg-AAPL-D"]
        # A refresh whose provider is held is NAMED when the wait runs out (the hook fails the test with it).
        assert rule.end_bars_refreshes(timeout_s=0.05) == ["bars-sincebg-AAPL-D"]
    finally:
        answer.set()
    assert rule.end_bars_refreshes(timeout_s=10) == []


# ── The same leak through the cold pool ──────────────────────────────────────────────────────────────────────
#
# Merge-queue run 45274569039 (2026-11-23): tests/test_bars_derived_tail_local_first.py::test_Z2, whose fresh store
# must stay empty, held "[('AAPL', 'D'), ('QQQ', 'D')], 6 bars". tests/test_bars_data_auth.py had asked
# `/api/bars/AAPL?tf=D&bars=3` and `/api/bars/QQQ?tf=D&bars=3` for entitled callers five files earlier: a cold
# symbol, so `bars_fetch._kick_cold_fetch` queued its first fetch on the `bars-cold-bg` pool, no provider stubbed,
# and the pool wrote Yahoo's three bars per symbol into the store that was current when Yahoo answered.

_COLD: dict = {}
_COLD_ROWS = ("2026-06-10", "2026-06-11", "2026-06-12")


def _has_bars_table(path: str) -> bool:
    if not os.path.exists(path):
        return False
    c = sqlite3.connect(path)
    try:
        return c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ohlcv'").fetchone() is not None
    finally:
        c.close()


def test_4_a_test_asks_for_a_cold_symbol_and_the_provider_answers_late(tmp_path, monkeypatch):
    """What tests/test_bars_data_auth.py's entitled request reaches: a cold AAPL daily read answers "warming" and
    queues the first fetch on the cold pool. The provider answers once a LATER test's store exists (or, when no
    later test gets the store while it waits, after LATE_PROVIDER_WAITS_S)."""
    from api.services import bars_disk_cache
    mine = _own_store(tmp_path, monkeypatch)
    monkeypatch.setattr(bars_disk_cache, "_CACHE_DIR", str(tmp_path / "disk"))
    asked = threading.Event()

    def _late_provider(sym, bars, deep=False):
        asked.set()
        deadline = time.monotonic() + LATE_PROVIDER_WAITS_S
        while time.monotonic() < deadline:
            now = bars_sqlite._DB_PATH
            if now != mine and _has_bars_table(now):
                break
            time.sleep(0.005)
        return [{"t": d, "o": 9, "h": 9.5, "l": 8.5, "c": 9, "v": 1} for d in _COLD_ROWS]

    monkeypatch.setattr(bars_fetch, "_fetch_daily", _late_provider)
    bars_fetch._get_bars_inner("AAPL", "D", 3)
    assert bars_fetch.get_serve_layer() == "cold-bg"
    assert asked.wait(5), "the cold pool never asked its provider"
    _COLD.update(store=mine)


def test_5_the_next_tests_store_holds_nothing_of_it(tmp_path, monkeypatch):
    """The second half: a store of its own, written by nobody. The cold fetch test_4 queued must have ended in
    test_4's store."""
    if "store" not in _COLD:
        pytest.skip("runs right after test_4 in this file (it is the second half of one ordered pair)")
    mine = _own_store(tmp_path, monkeypatch)
    deadline = time.monotonic() + 10          # a fetch still queued or running ends when its provider answers
    while "AAPL_D" in bars_fetch._cold_bg_inflight and time.monotonic() < deadline:
        time.sleep(0.005)
    assert "AAPL_D" not in bars_fetch._cold_bg_inflight
    assert _aapl_daily(mine) == [], (
        f"another test's cold fetch wrote into this store: {_aapl_daily(mine)}; test_4's holds "
        f"{_aapl_daily(_COLD['store'])}")
    assert _aapl_daily(_COLD["store"]) == [(int(d.replace("-", "")), 9.0) for d in _COLD_ROWS]


def test_6_a_pool_job_that_never_ends_is_named(request):
    """The pool half of the rule names a pool whose job is held when the wait runs out (the hook fails the test with
    it), and says nothing once the job has ended."""
    import tests.conftest as rule
    assert request.config.pluginmanager.is_registered(rule), "a second copy of tests/conftest.py, not the plugin"
    assert [(m, a) for m, a, _prefix in rule.BARS_WORK_POOLS] == [("api.services.bars_fetch", "_cold_bg_pool")]
    asked, answer = threading.Event(), threading.Event()
    bars_fetch._cold_bg_pool.submit(lambda: (asked.set(), answer.wait(10)))
    try:
        assert asked.wait(5)
        assert rule.end_bars_pool_work(timeout_s=0.05) == ["_cold_bg_pool (bars-cold-bg)"]
    finally:
        answer.set()
    assert rule.end_bars_pool_work(timeout_s=10) == []

"""`rs_store`: a built RS envelope outlives the process, and lives no longer than it would have.

Measured on production 2026-11-13: an RS envelope costs 0.7 to 1.3 s to build for a
symbol nobody has asked for yet, and it lived only in the shared in-memory cache (1,000
entries for the whole app, emptied by every deploy). After each deploy every symbol was
cold for every member again.

What this file holds the store, and the provider's use of it, to:
  * the SAME response whether it was computed, read from memory or read from the file,
    for every RS definition, byte for byte;
  * nothing is served past the instant the in-memory entry would have expired, and a
    row read back goes into memory for the time it had LEFT, not a fresh lifetime;
  * while a regular session is open, a D/W/M answer read back from the file is used for
    ten minutes after it was built and no longer (the forming day's cells are a snapshot);
  * the one-minute "no benchmark bars yet" answer is never kept;
  * bounded: a cap (the rows closest to expiry go first), no write on a tight volume,
    a queue that drops instead of growing;
  * every failure is a miss or a skipped write; a malformed file is started again once;
  * off under pytest unless a test turns it on, and `0` opens no file at all.
"""
import json
import os
import queue
import sqlite3
import threading
import time
import types

import pytest

from api.routers import signature as sig
from api.services import rs_benchmarks as rb
from api.services.cache import cache
from api.services.signature import registry_defs as rd
from api.services.signature import rs_provider as rsp
from api.services.signature import rs_store
from tests.test_rs_columns_provider import (  # noqa: F401 - fixtures are used by name
    _fetcher, _hermetic_reads, _long_daily,
)

RS_IDS = ("rsLine", "rsRating", "rsPhases", "rsVsEma", "rsExit")
ENV = {"columns": {"rs": [1.5, None, 2.25]}, "times": [1, 2, 3], "asOf": 1.0,
       "payload": {"state": "ok", "legend": {"summary": "above its 21 EMA by 6.8%", "stale": False}}}


@pytest.fixture
def store(monkeypatch, tmp_path):
    """The store ON, against a file of this test's own."""
    path = str(tmp_path / "rs_envelopes.db")
    monkeypatch.setenv("RS_ENVELOPE_STORE", "1")
    monkeypatch.setenv("RS_ENVELOPE_STORE_PATH", path)
    # Room on the volume is a fact about the box; the tests that are about it set their own.
    monkeypatch.setattr(rs_store.shutil, "disk_usage", lambda p: types.SimpleNamespace(free=rs_store.MIN_FREE_BYTES * 50))
    rs_store.reset_for_tests()
    yield path
    rs_store.reset_for_tests()


def _rows(path):
    if not os.path.exists(path):
        return []
    conn = sqlite3.connect(path)
    try:
        return conn.execute("SELECT ck, expires_at, bytes FROM env ORDER BY expires_at").fetchall()
    finally:
        conn.close()


# ── the test environment ─────────────────────────────────────────────────────

def test_the_store_is_off_under_pytest_unless_a_test_turns_it_on(tmp_path, monkeypatch):
    assert os.environ.get("RS_ENVELOPE_STORE") == "0", "conftest.py pins it off"
    path = str(tmp_path / "never.db")
    monkeypatch.setenv("RS_ENVELOPE_STORE_PATH", path)
    assert rs_store.enabled() is False
    assert rs_store.put("k", ENV, 3600) is False and rs_store.get("k") is None
    assert not os.path.exists(path), "off opens no file"


def test_unset_is_on_and_only_zero_is_off(monkeypatch):
    monkeypatch.delenv("RS_ENVELOPE_STORE", raising=False)
    assert rs_store.enabled() is True
    for raw, want in (("1", True), ("", True), ("yes", True), ("0", False), (" 0 ", False)):
        monkeypatch.setenv("RS_ENVELOPE_STORE", raw)
        assert rs_store.enabled() is want, raw


# ── the store alone ──────────────────────────────────────────────────────────

def test_what_was_kept_comes_back_equal_with_the_time_it_has_left(store):
    assert rs_store.get("sig:rs5:NVDA") is None
    assert rs_store.put("sig:rs5:NVDA", ENV, 3600) is True
    assert rs_store.flush()
    envelope, left = rs_store.get("sig:rs5:NVDA")
    assert envelope == ENV and envelope is not ENV
    assert 3590 < left <= 3600
    assert rs_store.get("sig:rs5:AMD") is None, "another key is another answer"


def test_nothing_is_served_past_the_instant_it_expires(store):
    t0 = time.time()
    rs_store.put("k", ENV, 400)
    assert rs_store.flush()
    kept = rs_store.get("k", now=t0 + 100)
    assert kept is not None and 295 < kept[1] <= 300.5
    assert rs_store.get("k", now=t0 + 399.5) is None, "under a second left is not worth serving"
    assert rs_store.get("k", now=t0 + 401) is None
    assert rs_store.get("k", now=t0 + 86_400) is None


def test_a_short_lived_answer_is_never_written(store):
    assert rs_store.put("k", ENV, rs_store.MIN_TTL_S - 1) is False
    assert rs_store.put("k60", ENV, 60) is False
    assert rs_store.flush() and _rows(store) == []
    assert rs_store.put("k", ENV, rs_store.MIN_TTL_S) is True
    assert rs_store.flush() and [r[0] for r in _rows(store)] == ["k"]


def test_a_newer_build_replaces_the_row(store):
    rs_store.put("k", ENV, 600)
    rs_store.put("k", {**ENV, "asOf": 2.0}, 900)
    assert rs_store.flush()
    assert len(_rows(store)) == 1 and rs_store.get("k")[0]["asOf"] == 2.0


def test_a_full_queue_drops_the_write_and_says_so(store, monkeypatch):
    held = queue.Queue(maxsize=2)
    monkeypatch.setattr(rs_store, "_queue", held)
    monkeypatch.setattr(rs_store, "_ensure_writer", lambda: None)      # nobody drains it
    assert rs_store.put("a", ENV, 600) and rs_store.put("b", ENV, 600)
    before = rs_store.stats()["dropped"]
    assert rs_store.put("c", ENV, 600) is False
    assert rs_store.stats()["dropped"] == before + 1
    while not held.empty():                                             # leave nothing for the teardown to wait on
        held.get_nowait()
        held.task_done()


def test_over_its_cap_the_rows_closest_to_expiry_go_first(store, monkeypatch):
    monkeypatch.setattr(rs_store, "SWEEP_EVERY_WRITES", 1)             # a sweep before every write
    rs_store.put("probe", ENV, 600)
    assert rs_store.flush()
    size = _rows(store)[0][2]
    monkeypatch.setattr(rs_store, "MAX_BYTES", size * 5)
    for i in range(12):
        rs_store.put(f"k{i:02d}", ENV, 1000 + i * 100)                 # k00 expires first, k11 last
        assert rs_store.flush()
    kept = [r[0] for r in _rows(store)]
    assert sum(r[2] for r in _rows(store)) <= size * 6, "the cap, give or take the write after the sweep"
    assert "k11" in kept and "k10" in kept and "k00" not in kept and "probe" not in kept
    assert kept == sorted(kept, key=lambda k: (k == "probe", k)), "what is left is the longest-lived"
    assert rs_store.stats()["evicted"] >= 6


def test_the_sweep_removes_what_has_expired(store, monkeypatch):
    rs_store.put("live", ENV, 3600)
    assert rs_store.flush()
    conn = sqlite3.connect(store)
    conn.execute("INSERT INTO env(ck, expires_at, saved_at, bytes, body) VALUES ('dead', ?, ?, 3, x'7a31')",
                 (time.time() - 5, time.time() - 500))
    conn.commit()
    conn.close()
    assert rs_store.get("dead") is None, "expired: a miss even before it is removed"
    monkeypatch.setattr(rs_store, "SWEEP_EVERY_WRITES", 1)
    rs_store.put("next", ENV, 3600)
    assert rs_store.flush()
    assert sorted(r[0] for r in _rows(store)) == ["live", "next"]


def test_a_tight_volume_stops_writes_not_reads_and_is_looked_at_again(store, monkeypatch):
    rs_store.put("before", ENV, 3600)
    assert rs_store.flush()
    free = [rs_store.MIN_FREE_BYTES - 1]
    monkeypatch.setattr(rs_store.shutil, "disk_usage", lambda p: types.SimpleNamespace(free=free[0]))
    monkeypatch.setattr(rs_store, "SWEEP_EVERY_S", 0.0)                # every write looks
    rs_store.put("during", ENV, 3600)
    assert rs_store.flush()
    assert rs_store.stats()["low_disk"] is True
    assert [r[0] for r in _rows(store)] == ["before"], "nothing was written on a tight volume"
    assert rs_store.get("before")[0] == ENV, "what is already kept is still served"
    free[0] = rs_store.MIN_FREE_BYTES * 2
    rs_store.put("after", ENV, 3600)
    assert rs_store.flush()
    assert rs_store.stats()["low_disk"] is False
    assert sorted(r[0] for r in _rows(store)) == ["after", "before"]


def test_a_tight_volume_is_not_asked_about_on_every_build(store, monkeypatch):
    monkeypatch.setattr(rs_store.shutil, "disk_usage", lambda p: types.SimpleNamespace(free=0))
    rs_store.put("first", ENV, 3600)                                    # the first write sweeps and finds it tight
    assert rs_store.flush() and rs_store.stats()["low_disk"] is True
    monkeypatch.setattr(rs_store, "_ensure_writer", lambda: pytest.fail("skipped before the queue"))
    skipped = rs_store.stats()["skipped"]
    assert rs_store.put("second", ENV, 3600) is False
    assert rs_store.stats()["skipped"] == skipped + 1


def test_an_envelope_over_the_entry_cap_is_not_kept(store, monkeypatch):
    monkeypatch.setattr(rs_store, "MAX_ENTRY_BYTES", 16)
    rs_store.put("big", ENV, 3600)
    assert rs_store.flush() and _rows(store) == []


def test_a_file_that_is_not_a_database_is_started_again_once(store):
    with open(store, "wb") as fh:
        fh.write(b"this is not a sqlite file" * 64)
    assert rs_store.get("k") is None, "a miss, never an exception"
    assert rs_store.stats()["off"] is False, "healed, not switched off"
    rs_store.put("k", ENV, 3600)
    assert rs_store.flush()
    assert rs_store.get("k")[0] == ENV, "the new file works"


def test_a_second_malformed_file_turns_the_store_off_for_this_process(store, monkeypatch):
    with open(store, "wb") as fh:
        fh.write(b"garbage" * 300)
    assert rs_store.get("k") is None                                    # the one heal
    with open(store, "wb") as fh:
        fh.write(b"garbage again" * 300)
    assert rs_store.get("k") is None
    assert rs_store.stats()["off"] is True
    monkeypatch.setattr(rs_store, "_conn", lambda: pytest.fail("off: the file is not opened again"))
    assert rs_store.get("k") is None and rs_store.put("k", ENV, 3600) is False


def test_a_thread_still_on_the_replaced_file_does_not_spend_the_heal(store, monkeypatch):
    """The file is started again ONCE. A thread whose failed call was made against the file a
    heal has already replaced must not use up (or, the second time, switch off) the store."""
    stale = rs_store._key()
    with open(store, "wb") as fh:
        fh.write(b"garbage" * 300)
    assert rs_store.get("k") is None                                    # the heal: a new generation
    assert rs_store._key() != stale and rs_store.stats()["off"] is False
    rs_store._failed(sqlite3.DatabaseError("database disk image is malformed"), stale, "read failed")
    assert rs_store.stats()["off"] is False, "the late failure was about the old file"
    rs_store.put("k", ENV, 3600)
    assert rs_store.flush() and rs_store.get("k")[0] == ENV


def test_a_busy_file_is_a_miss_and_never_a_heal(store, monkeypatch):
    rs_store.put("k", ENV, 3600)
    assert rs_store.flush()

    class Busy:
        def execute(self, *a):
            raise sqlite3.OperationalError("database is locked")
    with monkeypatch.context() as m:
        m.setattr(rs_store, "_conn", lambda: Busy())
        m.setattr(rs_store, "_heal", lambda: pytest.fail("a locked file is not a malformed one"))
        assert rs_store.get("k") is None
    rs_store._state["quiet_until"] = 0.0                               # the quiet that follows is its own test
    assert rs_store.get("k")[0] == ENV, "and the row is still there"


def test_after_a_failure_the_file_is_left_alone_for_a_few_seconds(store, monkeypatch):
    rs_store.put("k", ENV, 3600)
    assert rs_store.flush()

    class Busy:
        def execute(self, *a):
            raise sqlite3.OperationalError("unable to open database file")
    with monkeypatch.context() as m:
        m.setattr(rs_store, "_conn", lambda: Busy())
        assert rs_store.get("k") is None
    t0 = time.time()
    with monkeypatch.context() as m:
        m.setattr(rs_store, "_conn", lambda: pytest.fail("left alone: not opened again yet"))
        m.setattr(rs_store, "_ensure_writer", lambda: pytest.fail("left alone: nothing queued"))
        assert rs_store.get("k") is None and rs_store.put("j", ENV, 3600) is False
        m.setattr(rs_store.time, "time", lambda: t0 + rs_store.QUIET_AFTER_FAILURE_S - 1.0)
        assert rs_store.get("k") is None
    with monkeypatch.context() as m:
        m.setattr(rs_store.time, "time", lambda: t0 + rs_store.QUIET_AFTER_FAILURE_S + 1.0)
        assert rs_store.get("k")[0] == ENV, "and then asked again"


def test_a_read_can_be_bounded_by_the_age_of_the_row(store):
    t0 = time.time()
    rs_store.put("k", ENV, 3600)
    assert rs_store.flush()
    assert 3400 < rs_store.get("k", now=t0 + 100)[1] <= 3500.5, "no bound: the row's own expiry"
    kept = rs_store.get("k", now=t0 + 100, max_age=300)
    assert kept is not None and 195 < kept[1] <= 200.5, "what is left of the bound, not of the expiry"
    assert rs_store.get("k", now=t0 + 100, max_age=4000)[1] <= 3500.5, "a bound past the expiry changes nothing"
    assert rs_store.get("k", now=t0 + 100, max_age=100.5) is None, "under a second of the bound left"
    assert rs_store.get("k", now=t0 + 100, max_age=50) is None
    assert rs_store.get("k", now=t0 + 100) is not None, "and the row is still there for a reader with no bound"


def test_the_file_is_prepared_once_however_many_threads_open_it(store, monkeypatch):
    rs_store.put("k", ENV, 3600)
    assert rs_store.flush() and rs_store.get("k") is not None           # prepared, by now
    monkeypatch.setattr(rs_store, "_SCHEMA", ("THIS IS NOT SQL",))      # a second preparation would run this
    hits = []

    def read():
        hits.append(rs_store.get("k") is not None)
    threads = [threading.Thread(target=read) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert hits == [True] * 8 and rs_store.stats()["errors"] == 0


@pytest.mark.parametrize("body", [b"", b"xx" + b"\x00" * 8, b"z1not-zlib", None])
def test_a_row_that_cannot_be_read_back_is_a_miss(store, body):
    rs_store.put("good", ENV, 3600)
    assert rs_store.flush()
    conn = sqlite3.connect(store)
    blob = body if body is not None else b"z1" + __import__("zlib").compress(b'["not", "an", "envelope"]')
    conn.execute("INSERT INTO env(ck, expires_at, saved_at, bytes, body) VALUES ('bad', ?, ?, ?, ?)",
                 (time.time() + 3600, time.time(), len(blob), blob))
    conn.commit()
    conn.close()
    assert rs_store.get("bad") is None
    assert rs_store.get("good")[0] == ENV


def test_readers_on_many_threads_while_the_writer_writes(store):
    for i in range(20):
        rs_store.put(f"k{i}", ENV, 3600)
    assert rs_store.flush()
    wrong = []

    def read(n):
        for i in range(60):
            kept = rs_store.get(f"k{(i + n) % 20}")
            if kept is None or kept[0] != ENV:
                wrong.append((n, i))
            if i % 10 == 0:
                rs_store.put(f"w{n}-{i}", ENV, 3600)
    threads = [threading.Thread(target=read, args=(n,)) for n in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert rs_store.flush(10.0) and wrong == []


def test_stats_never_open_the_file(store, monkeypatch):
    rs_store.put("k", ENV, 3600)
    assert rs_store.flush()
    monkeypatch.setattr(rs_store, "_conn", lambda: pytest.fail("a health read opens nothing"))
    out = rs_store.stats()
    assert out["enabled"] is True and {"hits", "misses", "writes", "dropped", "skipped", "errors", "queued"} <= set(out)
    assert out["writes"] == 1 and out["cap_bytes"] == rs_store.MAX_BYTES
    assert out["free_bytes"] == rs_store.MIN_FREE_BYTES * 50, "the volume's room as of the last sweep"
    assert out["kept_bytes"] == 0, "what the file held when it was last swept (before this first write)"


def test_the_admin_cache_health_read_carries_the_stores_counters(store):
    from api import main
    out = main.health_cache(_admin={"role": "admin"})
    assert {"use_remote_bars", "snapshot_ts", "synced_at", "seconds_since_sync"} <= set(out), "what it already said"
    assert out["rs_envelope_store"] == rs_store.stats()


# ── the provider, through the lane ───────────────────────────────────────────

@pytest.fixture
def lane(store, monkeypatch):
    """Every RS definition installed the way the flags install them, the REAL cache
    (emptied before and after), the store on, and a synthetic bar store behind the lane."""
    monkeypatch.setitem(rd._BY_ID, "rsLine", rd._rs_line_row(True, True))
    monkeypatch.setattr(rd, "RS_V2_ENABLED", True)
    for row in rd.RS_SPLIT_DEFS:
        monkeypatch.setitem(rd._BY_ID, row["id"], row)
        monkeypatch.setitem(rd._PROVIDERS, row["id"], sig.RS_SPLIT_PROVIDERS[row["id"]])
    monkeypatch.setattr(rd, "SERVER_DEFS", tuple(rd.SERVER_DEFS) + tuple(rd.RS_SPLIT_DEFS))
    monkeypatch.setattr(rb, "_custom_warmed", {})
    monkeypatch.setattr(sig, "_rs_warm_bars", lambda *a, **k: None)     # never a real bar warm from a test
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Technology", "industry": "Semiconductors"})
    monkeypatch.setattr(rsp, "_rs_data_generation", lambda now=None: "r-|e-")
    # ⛔ NOT THE WALL CLOCK. While a session is open the provider bounds a read from the file
    # by age; left to the real clock these tests would be a function of the hour they run at.
    monkeypatch.setattr(rsp, "_rs_session_open", lambda now_et=None: False)
    # ... nor the day or the time to the close: five minutes before 16:05 ET an answer lives under
    # the store's floor and would not be kept at all, and at midnight ET the key changes.
    monkeypatch.setattr(rsp, "_seconds_to_next_et_close", lambda *a, **k: 6 * 3600)
    monkeypatch.setattr(rsp, "_et_session_day", lambda: "2026-11-13")
    bars = _long_daily(n=700)
    fetch = _fetcher(bars)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", fetch)
    cache.clear()
    rsp.rs_core_reset()
    yield types.SimpleNamespace(bars=bars, fetch=fetch, path=store)
    cache.clear()
    rsp.rs_core_reset()


def _served(def_id, sym="NVDA", tf="D", inputs=None):
    rsp.timing_reset()
    body = rd.serve(def_id, sym, tf, inputs)
    return json.dumps(body, sort_keys=True), rsp.last_timing()["tier"]


def _a_new_process():
    """What a deploy leaves: nothing in memory, everything on the volume."""
    assert rs_store.flush()
    cache.clear()
    rsp.rs_core_reset()


@pytest.mark.parametrize("def_id", RS_IDS)
def test_the_same_response_computed_from_the_file_and_from_memory(lane, monkeypatch, def_id):
    computed, tier = _served(def_id)
    assert tier == "cold" and len(json.loads(computed)["times"]) == 700
    _a_new_process()
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", lambda *a, **k: pytest.fail("no bars are read for a kept answer"))
    from_file, tier = _served(def_id)
    assert tier == "disk"
    assert from_file == computed, "byte for byte what was computed"
    from_memory, tier = _served(def_id)
    assert tier == "cache" and from_memory == computed, "and it is back in memory"


def test_every_definition_is_kept_under_its_own_key(lane):
    for def_id in RS_IDS:
        _served(def_id)
    assert rs_store.flush()
    keys = [r[0] for r in _rows(lane.path)]
    assert len(keys) == len(RS_IDS) == len(set(keys))
    assert all(k.startswith("sig:rs") and ":NVDA:D:" in k for k in keys), keys


def test_a_row_read_back_lives_in_memory_only_for_the_time_it_had_left(lane, monkeypatch):
    _served("rsPhases")
    assert rs_store.flush()
    (ck, expires_at, _size), = _rows(lane.path)
    built = {k: exp for k, _v, exp in cache.items_with_expiry()}[ck]
    assert abs(built - expires_at) < 2.0, "the file holds the instant memory was given"
    _a_new_process()
    later = time.time() + 1234.0
    with monkeypatch.context() as m:
        m.setattr(rs_store.time, "time", lambda: later)                # the next process asks 20 minutes on
        assert _served("rsPhases")[1] == "disk"
    again = {k: exp for k, _v, exp in cache.items_with_expiry()}[ck]
    assert abs(again - expires_at) < 2.0, "not a fresh lifetime: the same instant"


def test_past_its_instant_the_answer_is_computed_again(lane, monkeypatch):
    _served("rsVsEma")
    _a_new_process()
    (_ck, expires_at, _size), = _rows(lane.path)
    calls = len(lane.fetch.calls)
    with monkeypatch.context() as m:
        m.setattr(rs_store.time, "time", lambda: expires_at + 5.0)
        _body, tier = _served("rsVsEma")
    assert tier == "cold" and len(lane.fetch.calls) > calls


def test_other_inputs_and_another_timeframe_are_other_answers(lane):
    _served("rsPhases")
    _a_new_process()
    assert _served("rsPhases", inputs={"longEma": 12})[1] == "cold"
    assert _served("rsPhases", tf="W")[1] == "cold"
    assert _served("rsPhases", sym="SPY")[1] == "cold"
    _a_new_process()
    assert _served("rsPhases")[1] == "disk"
    assert _served("rsPhases", inputs={"longEma": 12})[1] == "disk"


def test_the_no_benchmark_answer_is_never_kept(lane, monkeypatch):
    only = {"NVDA": lane.bars["NVDA"]}
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _fetcher(only))      # no benchmark rows on the pod yet
    for def_id in ("rsLine", "rsPhases", "rsVsEma", "rsExit"):
        body, tier = _served(def_id)
        assert tier == "cold"
    assert rs_store.flush()
    assert _rows(lane.path) == [], "a one-minute answer must not outlive its minute on disk"


def test_the_store_switched_off_leaves_the_provider_as_it_was(lane, monkeypatch):
    monkeypatch.setenv("RS_ENVELOPE_STORE", "0")
    monkeypatch.setattr(rs_store, "_conn", lambda: pytest.fail("off: no file"))
    computed, tier = _served("rsLine")
    assert tier == "cold"
    assert _served("rsLine") == (computed, "cache")
    cache.clear()
    rsp.rs_core_reset()
    assert _served("rsLine")[1] == "cold", "nothing outlived the memory"


def test_a_store_that_fails_is_a_build_never_an_error(lane, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("the volume went away")
    monkeypatch.setattr(rs_store, "get", boom)
    body, tier = _served("rsRating")
    assert tier == "cold" and json.loads(body)["times"]


# ── while a session is open ──────────────────────────────────────────────────

def _et(y, mo, d, h, mi):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return datetime(y, mo, d, h, mi, tzinfo=ZoneInfo("America/New_York"))


@pytest.mark.parametrize("when,want", [
    (_et(2026, 11, 13, 9, 29), False), (_et(2026, 11, 13, 9, 30), True), (_et(2026, 11, 13, 12, 0), True),
    (_et(2026, 11, 13, 16, 4), True), (_et(2026, 11, 13, 16, 5), False), (_et(2026, 11, 13, 20, 0), False),
    (_et(2026, 11, 13, 4, 0), False), (_et(2026, 11, 14, 12, 0), False), (_et(2026, 11, 15, 12, 0), False),
    (_et(2026, 11, 16, 9, 30), True),
])
def test_a_session_is_open_monday_to_friday_from_the_open_to_five_past_the_close(when, want):
    assert rsp._rs_session_open(when) is want, when.strftime("%a %H:%M")


def test_the_age_bound_is_for_daily_weekly_monthly_answers_while_a_session_is_open(monkeypatch):
    monkeypatch.setattr(rsp, "_rs_session_open", lambda now_et=None: True)
    assert rsp._rs_disk_max_age(False) == rsp._RS_DISK_SESSION_MAX_AGE_S == 600.0
    assert rsp._rs_disk_max_age(True) is None, "an intraday answer lives 900 s in all"
    monkeypatch.setattr(rsp, "_rs_session_open", lambda now_et=None: False)
    assert rsp._rs_disk_max_age(False) is None and rsp._rs_disk_max_age(True) is None


def test_in_a_session_an_answer_from_the_file_is_used_for_ten_minutes_from_its_build(lane, monkeypatch):
    monkeypatch.setattr(rsp, "_rs_session_open", lambda now_et=None: True)
    built = time.time()
    computed, tier = _served("rsVsEma")
    assert tier == "cold"
    _a_new_process()
    (ck, _expires_at, _size), = _rows(lane.path)
    with monkeypatch.context() as m:
        m.setattr(rs_store.time, "time", lambda: built + 240.0)         # four minutes on: within the bound
        assert _served("rsVsEma") == (computed, "disk")
    back = {k: exp for k, _v, exp in cache.items_with_expiry()}[ck]
    assert abs(back - (built + rsp._RS_DISK_SESSION_MAX_AGE_S)) < 3.0, "in memory only until the bound, not until the close"
    _a_new_process()
    calls = len(lane.fetch.calls)
    with monkeypatch.context() as m:
        m.setattr(rs_store.time, "time", lambda: built + 660.0)         # eleven minutes on
        _body, tier = _served("rsVsEma")
    assert tier == "cold" and len(lane.fetch.calls) > calls, "past the bound: built again, with the bars of now"


def test_outside_a_session_the_same_row_is_used_for_as_long_as_it_lives(lane, monkeypatch):
    built = time.time()
    computed, _tier = _served("rsVsEma")
    _a_new_process()
    with monkeypatch.context() as m:
        m.setattr(rs_store.time, "time", lambda: built + 3000.0)        # fifty minutes on, nothing forming
        assert _served("rsVsEma") == (computed, "disk")


def test_an_intraday_answer_is_never_bounded_by_the_session_rule(lane, monkeypatch):
    monkeypatch.setattr(rsp, "_rs_session_open", lambda now_et=None: True)
    seen = []
    real = rs_store.get
    monkeypatch.setattr(rs_store, "get", lambda ck, **k: seen.append(k.get("max_age")) or real(ck, **k))
    _served("rsVsEma", tf="5")
    _served("rsVsEma", tf="D")
    assert seen == [None, rsp._RS_DISK_SESSION_MAX_AGE_S]


# ── the batch header ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("tiers,want", [
    (["cache", "cache"], "cache"), (["cache", "disk"], "disk"), (["disk", "disk"], "disk"),
    (["disk", "cold"], "cold"), (["cache", "cold", "disk"], "cold"),
])
def test_the_batch_says_cold_only_when_something_was_computed(tiers, want):
    response = types.SimpleNamespace(headers={})
    sig._rs_batch_server_timing(response, [{"tier": t, "total_ms": 1.0, "stages": {}} for t in tiers])
    assert response.headers["Server-Timing"].startswith(f'rs;desc="{want}";dur='), response.headers
